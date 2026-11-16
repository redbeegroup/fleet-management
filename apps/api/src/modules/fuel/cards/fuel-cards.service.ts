import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FuelCardInput, FuelCardMapping, fuelCardMappingSchema, ReviewCardTxnInput, Role } from '@fms/shared';
import type { AuthUser } from '../../../common/auth/auth-user';
import { env } from '../../../common/config/env';
import { PrismaService, Tx } from '../../../common/db/prisma.service';
import { parseCompanySettings } from '../../../common/settings';
import { tzOffsetMs } from '../../../common/time';
import { NotificationsService } from '../../notifications/notifications.service';
import { FuelService } from '../fuel.service';
import { cardLast4, reconcile } from '../reconcile';
import { FuelCardProvider, MockFuelCardProvider, RawCardTxn, RestFuelCardProvider } from './providers';
import { mapStatement, readTable } from './statement';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));
const MAX_ROWS = 20_000;

@Injectable()
export class FuelCardsService {
  private readonly logger = new Logger(FuelCardsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly fuel: FuelService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- cards -------------------------------------------------------------------

  listCards(user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) => tx.fuelCard.findMany({ orderBy: [{ provider: 'asc' }, { last4: 'asc' }] }));
  }

  createCard(user: AuthUser, input: FuelCardInput) {
    const last4 = cardLast4(input.number);
    if (!last4) throw new BadRequestException('Enter at least the last 4 digits of the card');
    return this.db.tenant(user.companyId, async (tx) => {
      await this.assertRefs(tx, input.vehicleId, input.driverId);
      const card = await tx.fuelCard.create({ data: { companyId: user.companyId, provider: input.provider.toUpperCase(), last4, label: input.label ?? null, vehicleId: input.vehicleId ?? null, driverId: input.driverId ?? null, active: input.active } });
      // Earlier unassigned transactions of this card now belong to the vehicle.
      if (card.vehicleId) await this.attach(tx, card.provider, card.last4, card.id, card.vehicleId);
      return card;
    });
  }

  updateCard(user: AuthUser, id: string, input: Partial<FuelCardInput>) {
    return this.db.tenant(user.companyId, async (tx) => {
      const card = await tx.fuelCard.findFirst({ where: { id } });
      if (!card) throw new NotFoundException('Card not found');
      await this.assertRefs(tx, input.vehicleId, input.driverId);
      const next = await tx.fuelCard.update({ where: { id }, data: { label: input.label, vehicleId: input.vehicleId, driverId: input.driverId, active: input.active } });
      if (next.vehicleId && next.vehicleId !== card.vehicleId) await this.attach(tx, next.provider, next.last4, next.id, next.vehicleId);
      return next;
    });
  }

  private async attach(tx: Tx, provider: string, last4: string, cardId: string, vehicleId: string) {
    const r = await tx.fuelCardTransaction.updateMany({ where: { provider, cardLast4: last4, vehicleId: null }, data: { cardId, vehicleId } });
    if (r.count) {
      const ids = (await tx.fuelCardTransaction.findMany({ where: { cardId, status: 'CARD_ONLY' }, select: { id: true } })).map((x) => x.id);
      await this.reconcileIn(tx, ids);
    }
  }

  private async assertRefs(tx: Tx, vehicleId?: string | null, driverId?: string | null) {
    if (vehicleId && !(await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null }, select: { id: true } }))) throw new BadRequestException('Vehicle not found');
    if (driverId && !(await tx.driver.findFirst({ where: { id: driverId }, select: { id: true } }))) throw new BadRequestException('Driver not found');
  }

  // ---- statement import ----------------------------------------------------------

  /**
   * Reads a statement with a column mapping. With `commit` false only a preview is returned (headers, first
   * rows, errors); otherwise the rows are stored (duplicates skipped) and reconciled, and the mapping is saved.
   */
  async importStatement(user: AuthUser, file: { buffer: Buffer; originalname: string; size: number } | undefined, mappingJson: string, commit: boolean) {
    if (!file) throw new BadRequestException('Attach a .csv or .xlsx statement');
    if (!/\.(csv|xlsx)$/i.test(file.originalname)) throw new BadRequestException('Only .csv and .xlsx statements are supported');
    let mapping: FuelCardMapping | null = null;
    const table = await readTable(file.buffer, file.originalname).catch(() => {
      throw new BadRequestException('The file could not be read');
    });
    if (table.rows.length > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} rows per statement`);
    if (mappingJson) {
      const parsed = fuelCardMappingSchema.safeParse(JSON.parse(mappingJson || '{}'));
      if (!parsed.success) throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      mapping = { ...parsed.data, provider: parsed.data.provider.toUpperCase() };
    }
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { timezone: true, settings: true } });
      const settings = parseCompanySettings(company.settings).fuelControl;
      if (!mapping) return { headers: table.headers, savedMappings: settings.cardMappings, preview: [], errors: [], total: table.rows.length };
      const offset = Math.round(tzOffsetMs(company.timezone, new Date()) / 60_000);
      const parsed = mapStatement(table, mapping, offset);
      if (!commit) return { headers: parsed.headers, savedMappings: settings.cardMappings, preview: parsed.rows.slice(0, 15), errors: parsed.errors.slice(0, 50), total: table.rows.length, valid: parsed.rows.length };
      const imp = await tx.fuelCardImport.create({ data: { companyId: user.companyId, provider: mapping.provider, source: 'file', filename: file.originalname.slice(0, 200), rows: table.rows.length, errors: parsed.errors.slice(0, 200) as unknown as Prisma.InputJsonValue, createdBy: user.userId } });
      const r = await this.store(tx, user.companyId, imp.id, mapping.provider, parsed.rows);
      await tx.fuelCardImport.update({ where: { id: imp.id }, data: { imported: r.imported, duplicates: r.duplicates } });
      // Remember the mapping for the next statement of this provider.
      const all = parseCompanySettings(company.settings);
      await tx.company.update({ where: { id: user.companyId }, data: { settings: { ...all, fuelControl: { ...all.fuelControl, cardMappings: { ...all.fuelControl.cardMappings, [mapping.provider]: mapping } } } as Prisma.InputJsonValue } });
      return { importId: imp.id, total: table.rows.length, imported: r.imported, duplicates: r.duplicates, errors: parsed.errors.slice(0, 50), status: r.status };
    }).then(async (res) => {
      if ('status' in res && res.status) await this.notifyMismatches(user.companyId, res.status.mismatchIds);
      return res;
    });
  }

  /** Stores transactions (dedupe on provider + externalId), assigns cards/vehicles and reconciles the new ones. */
  private async store(tx: Tx, companyId: string, importId: string, provider: string, rows: (RawCardTxn & { nonFuel?: boolean })[]) {
    const cards = await tx.fuelCard.findMany({ where: { provider } });
    const byLast4 = new Map(cards.map((c) => [c.last4, c]));
    const plates = new Map((await tx.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, plateNumber: true } })).map((v) => [v.plateNumber.toUpperCase().replace(/\s+/g, ''), v.id]));
    let imported = 0;
    const ids: string[] = [];
    for (const r of rows) {
      const last4 = cardLast4(r.card) ?? r.card;
      const card = byLast4.get(last4);
      const vehicleId = card?.vehicleId ?? (r.plate ? (plates.get(r.plate.toUpperCase().replace(/\s+/g, '')) ?? null) : null);
      const created = await tx.fuelCardTransaction.createManyAndReturn({
        data: [{ companyId, importId, provider, externalId: r.externalId, cardLast4: last4, cardId: card?.id ?? null, vehicleId, occurredAt: r.occurredAt, station: r.station, product: r.product, litres: r.litres, amount: r.amount, plate: r.plate, status: r.nonFuel ? 'NON_FUEL' : 'CARD_ONLY' }],
        skipDuplicates: true,
        select: { id: true, status: true },
      });
      if (created[0]) {
        imported++;
        if (created[0].status === 'CARD_ONLY') ids.push(created[0].id);
      }
    }
    const status = await this.reconcileIn(tx, ids);
    return { imported, duplicates: rows.length - imported, status };
  }

  /**
   * Matches the given unreconciled transactions with fuel records of their vehicle that no other transaction
   * claimed yet. Mismatched records get the CARD_MISMATCH flag.
   */
  private async reconcileIn(tx: Tx, txnIds: string[]) {
    if (!txnIds.length) return { matched: 0, mismatched: 0, cardOnly: 0, mismatchIds: [] as string[] };
    const settings = parseCompanySettings((await tx.company.findFirstOrThrow({ select: { settings: true } })).settings).fuelControl;
    const txns = await tx.fuelCardTransaction.findMany({ where: { id: { in: txnIds }, status: 'CARD_ONLY' } });
    const vehicleIds = [...new Set(txns.map((t) => t.vehicleId).filter((x): x is string => !!x))];
    const times = txns.map((t) => t.occurredAt.getTime());
    const pad = settings.matchHours * 3_600_000;
    const records = vehicleIds.length
      ? await tx.fuelRecord.findMany({
          where: { vehicleId: { in: vehicleIds }, cardTxnId: null, filledAt: { gte: new Date(Math.min(...times) - pad), lte: new Date(Math.max(...times) + pad) } },
          select: { id: true, vehicleId: true, filledAt: true, litres: true, totalCost: true },
        })
      : [];
    const res = reconcile(
      txns.map((t) => ({ id: t.id, vehicleId: t.vehicleId, occurredAt: t.occurredAt, litres: n(t.litres), amount: Number(t.amount) })),
      records.map((r) => ({ id: r.id, vehicleId: r.vehicleId, filledAt: r.filledAt, litres: Number(r.litres), totalCost: Number(r.totalCost) })),
      settings,
    );
    const touched = new Set<string>();
    const mismatchIds: string[] = [];
    for (const m of res) {
      if (m.status === 'CARD_ONLY') continue;
      await tx.fuelCardTransaction.update({ where: { id: m.txnId }, data: { status: m.status, fuelRecordId: m.fuelRecordId, differences: m.differences as Prisma.InputJsonValue } });
      const rec = await tx.fuelRecord.update({ where: { id: m.fuelRecordId! }, data: { cardTxnId: m.txnId, paymentMethod: 'FUEL_CARD' }, select: { vehicleId: true, flags: true, id: true } });
      if (m.status === 'MISMATCH') {
        mismatchIds.push(m.txnId);
        if (!rec.flags.includes('CARD_MISMATCH')) await tx.fuelRecord.update({ where: { id: rec.id }, data: { flags: [...rec.flags, 'CARD_MISMATCH'] } });
      }
      touched.add(rec.vehicleId);
    }
    const company = await tx.company.findFirstOrThrow({ select: { id: true } });
    for (const v of touched) await this.fuel.recomputeIn(tx, company.id, v);
    return { matched: res.filter((r) => r.status === 'MATCHED').length, mismatched: mismatchIds.length, cardOnly: res.filter((r) => r.status === 'CARD_ONLY').length, mismatchIds };
  }

  private async notifyMismatches(companyId: string, ids: string[]) {
    if (!ids.length) return;
    await this.notifications.notify({
      companyId,
      roles: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER],
      topic: 'fuel.card_mismatch',
      severity: 'warning',
      title: `${ids.length} fuel card transaction(s) do not match the recorded fill`,
      body: 'Amounts or litres on the card statement differ from what was recorded in FMS. Review them under Fuel → Cards.',
      data: { link: '/fuel?tab=cards' },
      dedupeKey: `card-mismatch:${ids.sort().join(',').slice(0, 180)}`,
    });
  }

  // ---- provider API sync ----------------------------------------------------------

  private provider(): FuelCardProvider | null {
    const kind = env().FUEL_CARD_API;
    if (kind === 'rest') return new RestFuelCardProvider();
    if (kind === 'mock')
      return new MockFuelCardProvider((companyId, since) =>
        this.db.tenant(companyId, async (tx) => {
          const cards = await tx.fuelCard.findMany({ where: { active: true, vehicleId: { not: null } } });
          const byVehicle = new Map(cards.map((c) => [c.vehicleId!, c]));
          const fills = await tx.fuelRecord.findMany({ where: { filledAt: { gte: since }, vehicleId: { in: [...byVehicle.keys()] } }, include: { vehicle: { select: { plateNumber: true } } }, orderBy: { filledAt: 'asc' } });
          return fills.map((f) => ({ id: f.id, card: byVehicle.get(f.vehicleId)!.last4, filledAt: f.filledAt, litres: Number(f.litres), totalCost: Number(f.totalCost), plate: f.vehicle.plateNumber }));
        }),
      );
    return null;
  }

  /** Worker job: pulls new transactions for every company with card sync enabled. */
  async syncAll(now = new Date()): Promise<{ companies: number; imported: number }> {
    const provider = this.provider();
    if (!provider) return { companies: 0, imported: 0 };
    const companies = await this.db.system((tx) => tx.company.findMany({ where: { active: true }, select: { id: true, code: true, settings: true } }));
    let total = 0;
    let n = 0;
    for (const c of companies) {
      const s = parseCompanySettings(c.settings).fuelControl;
      if (!s.cardSyncEnabled) continue;
      n++;
      try {
        total += (await this.syncCompany(c.id, c.code, s.cardSyncProvider.toUpperCase(), provider, now)).imported;
      } catch (e) {
        this.logger.error(`Fuel card sync failed for ${c.code}: ${(e as Error).message}`);
      }
    }
    return { companies: n, imported: total };
  }

  async syncNow(user: AuthUser) {
    const provider = this.provider();
    if (!provider) throw new BadRequestException('No fuel card API is configured for this installation (FUEL_CARD_API)');
    const company = await this.db.tenant(user.companyId, (tx) => tx.company.findFirstOrThrow({ select: { code: true, settings: true } }));
    const s = parseCompanySettings(company.settings).fuelControl;
    return this.syncCompany(user.companyId, company.code, s.cardSyncProvider.toUpperCase(), provider, new Date(), user.userId);
  }

  private async syncCompany(companyId: string, code: string, providerName: string, provider: FuelCardProvider, now: Date, userId?: string) {
    const last = await this.db.tenant(companyId, (tx) => tx.fuelCardImport.findFirst({ where: { source: 'api', provider: providerName }, orderBy: { createdAt: 'desc' } }));
    // Overlap one day: providers post late; duplicates are skipped by externalId.
    const since = last ? new Date(last.createdAt.getTime() - 86_400_000) : new Date(now.getTime() - 30 * 86_400_000);
    const rows = await provider.fetchTransactions({ companyId, companyCode: code }, since);
    const res = await this.db.tenant(companyId, async (tx) => {
      const imp = await tx.fuelCardImport.create({ data: { companyId, provider: providerName, source: 'api', rows: rows.length, createdBy: userId ?? null } });
      const r = await this.store(tx, companyId, imp.id, providerName, rows);
      await tx.fuelCardImport.update({ where: { id: imp.id }, data: { imported: r.imported, duplicates: r.duplicates } });
      return { importId: imp.id, total: rows.length, imported: r.imported, duplicates: r.duplicates, status: r.status };
    });
    await this.notifyMismatches(companyId, res.status.mismatchIds);
    return res;
  }

  // ---- review ---------------------------------------------------------------------

  listTxns(user: AuthUser, q: { status?: string; from?: Date; to?: Date; page: number; pageSize: number }) {
    const where: Prisma.FuelCardTransactionWhereInput = {
      ...(q.status && { status: q.status }),
      ...((q.from || q.to) && { occurredAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } }),
    };
    return this.db.tenant(user.companyId, async (tx) => {
      const [items, total, counts] = await Promise.all([
        tx.fuelCardTransaction.findMany({ where, orderBy: { occurredAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.fuelCardTransaction.count({ where }),
        tx.fuelCardTransaction.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: { _all: true }, _sum: { amount: true } }),
      ]);
      const plates = new Map((await tx.vehicle.findMany({ where: { id: { in: items.map((i) => i.vehicleId).filter((x): x is string => !!x) } }, select: { id: true, plateNumber: true } })).map((v) => [v.id, v.plateNumber]));
      const recs = new Map((await tx.fuelRecord.findMany({ where: { id: { in: items.map((i) => i.fuelRecordId).filter((x): x is string => !!x) } }, select: { id: true, filledAt: true, litres: true, totalCost: true } })).map((r) => [r.id, r]));
      return {
        items: items.map((i) => ({ ...i, amount: Number(i.amount), litres: n(i.litres), plateNumber: i.vehicleId ? (plates.get(i.vehicleId) ?? null) : null, record: i.fuelRecordId ? recs.get(i.fuelRecordId) ?? null : null })),
        total,
        page: q.page,
        pageSize: q.pageSize,
        summary: Object.fromEntries(counts.map((c) => [c.status, { count: c._count._all, amount: Number(c._sum.amount ?? 0) }])),
      };
    });
  }

  imports(user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) => tx.fuelCardImport.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }));
  }

  async review(user: AuthUser, id: string, input: ReviewCardTxnInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const t = await tx.fuelCardTransaction.findFirst({ where: { id } });
      if (!t) throw new NotFoundException('Transaction not found');
      const done = { reviewedBy: user.userId };
      switch (input.action) {
        case 'accept':
          if (t.status !== 'MISMATCH' && t.status !== 'CARD_ONLY') throw new BadRequestException(`Transaction is ${t.status.toLowerCase()}`);
          return tx.fuelCardTransaction.update({ where: { id }, data: { status: 'ACCEPTED', note: input.note, ...done } });
        case 'non_fuel':
          return tx.fuelCardTransaction.update({ where: { id }, data: { status: 'NON_FUEL', note: input.note ?? null, ...done } });
        case 'link': {
          if (t.status !== 'CARD_ONLY') throw new BadRequestException('Only unmatched transactions can be linked');
          const rec = await tx.fuelRecord.findFirst({ where: { id: input.fuelRecordId, cardTxnId: null } });
          if (!rec) throw new BadRequestException('Fuel record not found or already linked');
          await tx.fuelRecord.update({ where: { id: rec.id }, data: { cardTxnId: id, paymentMethod: 'FUEL_CARD' } });
          return tx.fuelCardTransaction.update({ where: { id }, data: { status: 'ACCEPTED', fuelRecordId: rec.id, vehicleId: t.vehicleId ?? rec.vehicleId, note: 'Linked manually', ...done } });
        }
        case 'create_record': {
          if (t.status !== 'CARD_ONLY') throw new BadRequestException('Only unmatched transactions can become fuel records');
          if (!t.vehicleId) throw new BadRequestException('Assign the card to a vehicle first');
          if (!t.litres) throw new BadRequestException('The transaction has no litres');
          return { txn: t, needsRecord: true as const };
        }
      }
    }).then(async (r) => {
      if (r && typeof r === 'object' && 'needsRecord' in r && input.action === 'create_record') {
        const t = r.txn;
        // Created through FuelService so approvals, efficiency and flags apply as for any fill.
        const rec = await this.fuel.create(user, { vehicleId: t.vehicleId!, filledAt: t.occurredAt, odometerKm: input.odometerKm, litres: Number(t.litres), totalCost: Number(t.amount), station: t.station, fullTank: input.fullTank, paymentMethod: 'FUEL_CARD', notes: `From fuel card statement (${t.provider} ****${t.cardLast4})` } as never, 'card');
        return this.db.tenant(user.companyId, async (tx) => {
          await tx.fuelRecord.update({ where: { id: rec.id }, data: { cardTxnId: t.id } });
          return tx.fuelCardTransaction.update({ where: { id: t.id }, data: { status: 'MATCHED', fuelRecordId: rec.id, reviewedBy: user.userId, note: 'Fuel record created from the statement' } });
        });
      }
      return r;
    });
  }
}
