import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role, SapCredentialInput } from '@fms/shared';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth-user';
import { env } from '../../common/config/env';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { localDate } from '../../common/time';
import { CostsService } from '../costs/costs.service';
import { decryptSecret, encryptSecret } from '../iam/sso/sso-core';
import { nextAttempt } from '../integrations/webhook-delivery';
import { NotificationsService } from '../notifications/notifications.service';
import { checkGarageInvoice } from './hooks';
import { aggregatePosting, isBalanced, JournalItem, journalItems, matchReceipt } from './posting';
import { JournalDoc, MockSapClient, ODataSapClient, PoRequest, SapBillingItem, SapClient, SapError } from './sap-client';

const r2 = (x: number) => Math.round(x * 100) / 100;
const LEASE_MS = 120_000;
const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** SAP S/4HANA link: connection, master data, monthly cost posting, purchase orders, billing, outbox. */
@Injectable()
export class SapService {
  private readonly log = new Logger('SAP');

  constructor(
    private readonly db: PrismaService,
    private readonly costs: CostsService,
    private readonly notifications: NotificationsService,
  ) {}

  private get encKey() {
    const e = env();
    return e.SSO_ENCRYPTION_KEY ?? `jwt:${e.JWT_ACCESS_SECRET}`;
  }

  private assertMode() {
    if (env().SAP_MODE === 'none') throw new BadRequestException('The SAP link is not switched on for this installation (SAP_MODE)');
  }

  /** The client for a company (mock, or OData with the stored, decrypted connection). */
  async client(companyId: string): Promise<SapClient> {
    const mode = env().SAP_MODE;
    if (mode === 'mock') {
      return new MockSapClient({
        purchaseOrder: (po) =>
          this.db.tenant(companyId, async (tx) => {
            const d = await tx.sapDocument.findFirst({ where: { kind: 'PO', sapDocNo: po } });
            if (!d) return null;
            const p = d.payload as unknown as PoRequest;
            return { po, supplier: p.supplier, items: [{ item: '10', material: null, quantity: 1, netPrice: p.netAmount, text: p.text }], netValue: p.netAmount };
          }),
        // The mock "bills" what the rate cards computed, so billed vs rated can be shown in demos.
        billing: (since) =>
          this.db.tenant(companyId, async (tx) => {
            const s = parseCompanySettings((await tx.company.findFirstOrThrow({ select: { settings: true } })).settings).sap;
            const revs = await tx.tripRevenue.findMany({ where: { source: 'RATE_CARD', computedAt: { gte: since ?? new Date(Date.now() - 60 * 86_400_000) } }, take: 2000 });
            const [trips, customers] = await Promise.all([
              tx.trip.findMany({ where: { id: { in: revs.map((r) => r.tripId) } }, select: { id: true, tripNo: true, actualEnd: true } }),
              tx.customer.findMany({ where: { id: { in: revs.map((r) => r.customerId).filter((x): x is string => !!x) } }, select: { id: true, code: true, sapCustomer: true } }),
            ]);
            const tm = new Map(trips.map((t) => [t.id, t]));
            const cm = new Map(customers.map((c) => [c.id, c]));
            return revs.map((r): SapBillingItem => {
              const t = tm.get(r.tripId);
              const c = r.customerId ? cm.get(r.customerId) : undefined;
              return {
                billingDoc: '90' + String(parseInt(createHash('sha1').update(r.tripId).digest('hex').slice(0, 8), 16) % 1e8).padStart(8, '0'),
                item: String(10 * (1 + (parseInt(createHash('sha1').update(r.id).digest('hex').slice(0, 4), 16) % 900))),
                date: (t?.actualEnd ?? r.computedAt).toISOString().slice(0, 10),
                soldTo: c?.sapCustomer ?? c?.code ?? 'ONE-TIME',
                reference: t?.tripNo ?? null,
                netAmount: Math.round(Number(r.amount) / 1000) * 1000,
                currency: s.currency,
                cancelled: false,
              };
            });
          }),
      });
    }
    if (mode !== 'odata') throw new BadRequestException('The SAP link is not switched on for this installation (SAP_MODE)');
    const c = await this.db.tenant(companyId, (tx) => tx.integrationCredential.findFirst({ where: { system: 'SAP' } }));
    if (!c) throw new BadRequestException('Enter the SAP connection first');
    return new ODataSapClient({ baseUrl: c.baseUrl, authType: c.authType as 'BASIC' | 'OAUTH', username: c.username, secret: decryptSecret(c.secretEnc, this.encKey), tokenUrl: c.tokenUrl, sapClient: c.sapClient });
  }

  // ------------------------------------------------------------------ status & connection

  status(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const company = await tx.company.findFirstOrThrow({ select: { settings: true, currency: true } });
      const [cred, runs, outbox, postings] = await Promise.all([
        tx.integrationCredential.findFirst({ where: { system: 'SAP' } }),
        tx.sapSyncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
        tx.sapDocument.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.costPosting.findMany({ orderBy: [{ period: 'desc' }, { version: 'desc' }], take: 24 }),
      ]);
      return {
        mode: env().SAP_MODE,
        settings: parseCompanySettings(company.settings).sap,
        connection: cred ? { baseUrl: cred.baseUrl, authType: cred.authType, username: cred.username, tokenUrl: cred.tokenUrl, sapClient: cred.sapClient, hasSecret: true, updatedAt: cred.updatedAt } : null,
        runs,
        outbox: Object.fromEntries(outbox.map((o) => [o.status, o._count._all])),
        postings,
      };
    });
  }

  saveConnection(user: AuthUser, b: SapCredentialInput) {
    const u = new URL(b.baseUrl);
    if (u.protocol !== 'https:' && !env().SAP_ALLOW_INSECURE) throw new BadRequestException('Use an https:// SAP URL');
    return this.db.tenant(user.companyId, async (tx) => {
      const existing = await tx.integrationCredential.findFirst({ where: { system: 'SAP' } });
      if (!existing && !b.secret) throw new BadRequestException('Enter the password / client secret');
      const data = { baseUrl: b.baseUrl, authType: b.authType, username: b.username, tokenUrl: b.tokenUrl ?? null, sapClient: b.sapClient ?? null, updatedBy: user.userId, ...(b.secret && { secretEnc: encryptSecret(b.secret, this.encKey) }) };
      const c = existing
        ? await tx.integrationCredential.update({ where: { id: existing.id }, data })
        : await tx.integrationCredential.create({ data: { ...data, companyId: user.companyId, system: 'SAP', secretEnc: encryptSecret(b.secret!, this.encKey) } });
      return { baseUrl: c.baseUrl, authType: c.authType, username: c.username, tokenUrl: c.tokenUrl, sapClient: c.sapClient, hasSecret: true, updatedAt: c.updatedAt };
    });
  }

  async test(user: AuthUser) {
    this.assertMode();
    try {
      return await (await this.client(user.companyId)).ping();
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadGatewayException(`SAP did not answer: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ master data

  /** Pulls cost centres, vendors, materials, customers and fixed assets and maps them onto FMS records. */
  async syncMaster(companyId: string, by: string | null) {
    this.assertMode();
    const client = await this.client(companyId);
    const s = await this.db.tenant(companyId, async (tx) => parseCompanySettings((await tx.company.findFirstOrThrow({ select: { settings: true } })).settings).sap);
    const run = await this.db.tenant(companyId, (tx) => tx.sapSyncRun.create({ data: { companyId, kind: 'MASTER', createdBy: by } }));
    const stats: Record<string, unknown> = {};
    const errors: string[] = [];
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        stats[name] = await fn();
      } catch (e) {
        errors.push(`${name}: ${(e as Error).message}`);
      }
    };
    const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
    await step('costCenters', async () => {
      const ccs = await client.costCenters(s.controllingArea);
      return this.db.tenant(companyId, async (tx) => {
        const depts = await tx.department.findMany();
        let matched = 0;
        let created = 0;
        for (const cc of ccs) {
          const d = depts.find((x) => x.sapCostCenter === cc.costCenter) ?? depts.find((x) => x.code === cc.costCenter || norm(x.name) === norm(cc.name));
          if (d) {
            if (d.sapCostCenter !== cc.costCenter) await tx.department.update({ where: { id: d.id }, data: { sapCostCenter: cc.costCenter } });
            matched++;
          } else {
            await tx.department.create({ data: { companyId, code: cc.costCenter, name: cc.name, sapCostCenter: cc.costCenter } });
            created++;
          }
        }
        return { received: ccs.length, matched, created };
      });
    });
    await step('vendors', async () => {
      const vs = await client.vendors();
      return this.db.tenant(companyId, async (tx) => {
        const sups = await tx.supplier.findMany();
        let matched = 0;
        let created = 0;
        for (const v of vs) {
          const x = sups.find((y) => y.externalRef === v.supplier) ?? sups.find((y) => norm(y.name) === norm(v.name) || (!!v.taxNumber && y.taxId === v.taxNumber));
          if (x) {
            if (x.externalRef !== v.supplier) await tx.supplier.update({ where: { id: x.id }, data: { externalRef: v.supplier } });
            matched++;
          } else if (!sups.some((y) => norm(y.name) === norm(v.name))) {
            await tx.supplier.create({ data: { companyId, name: v.name, kinds: ['OTHER'], taxId: v.taxNumber, externalRef: v.supplier } });
            created++;
          }
        }
        return { received: vs.length, matched, created };
      });
    });
    await step('materials', async () => {
      const ms = await client.materials();
      return this.db.tenant(companyId, async (tx) => {
        const parts = await tx.part.findMany({ select: { id: true, partNo: true, externalRef: true } });
        let matched = 0;
        for (const m of ms) {
          const p = parts.find((x) => x.externalRef === m.material) ?? parts.find((x) => x.partNo === m.material);
          if (!p) continue;
          if (p.externalRef !== m.material) await tx.part.update({ where: { id: p.id }, data: { externalRef: m.material } });
          matched++;
        }
        return { received: ms.length, matched, unmatchedParts: parts.length - matched };
      });
    });
    await step('customers', async () => {
      const cs = await client.customers();
      return this.db.tenant(companyId, async (tx) => {
        const mine = await tx.customer.findMany({ select: { id: true, code: true, name: true, sapCustomer: true } });
        let matched = 0;
        for (const c of cs) {
          const x = mine.find((y) => y.sapCustomer === c.customer) ?? mine.find((y) => y.code === c.customer || norm(y.name) === norm(c.name));
          if (!x) continue;
          if (x.sapCustomer !== c.customer) await tx.customer.update({ where: { id: x.id }, data: { sapCustomer: c.customer } });
          matched++;
        }
        return { received: cs.length, matched };
      });
    });
    await step('assets', async () => {
      const as = await client.fixedAssets(s.companyCode);
      return this.db.tenant(companyId, async (tx) => {
        const vs = await tx.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, plateNumber: true, vin: true, sapAssetNo: true } });
        const key = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const suggestions = as.map((a) => {
          const linked = vs.find((v) => v.sapAssetNo === a.assetNo);
          const hay = key(`${a.description} ${a.serial ?? ''} ${a.inventoryNo ?? ''}`);
          const guess = linked ?? vs.find((v) => !v.sapAssetNo && (hay.includes(key(v.plateNumber)) || (!!v.vin && hay.includes(key(v.vin)))));
          return { ...a, vehicleId: guess?.id ?? null, plateNumber: guess?.plateNumber ?? null, linked: !!linked };
        });
        return { received: as.length, linked: suggestions.filter((x) => x.linked).length, suggestions };
      });
    });
    return this.db.tenant(companyId, (tx) =>
      tx.sapSyncRun.update({ where: { id: run.id }, data: { status: errors.length ? (Object.keys(stats).length ? 'PARTIAL' : 'FAILED') : 'OK', stats: stats as Prisma.InputJsonValue, errors, finishedAt: new Date() } }),
    );
  }

  /** Links (or unlinks) a vehicle to a SAP fixed asset; SAP then runs its depreciation. */
  matchAsset(user: AuthUser, vehicleId: string, sapAssetNo: string | null) {
    return this.db.tenant(user.companyId, async (tx) => {
      const v = await tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } });
      if (!v) throw new NotFoundException('Vehicle not found');
      if (sapAssetNo) {
        const other = await tx.vehicle.findFirst({ where: { sapAssetNo, id: { not: vehicleId } }, select: { plateNumber: true } });
        if (other) throw new ConflictException(`Asset ${sapAssetNo} is already linked to ${other.plateNumber}`);
        // The acquisition value fills the purchase price only when FMS has none.
        const run = await tx.sapSyncRun.findFirst({ where: { kind: 'MASTER' }, orderBy: { startedAt: 'desc' } });
        const a = ((run?.stats as { assets?: { suggestions?: { assetNo: string; acquisitionValue: number | null }[] } } | null)?.assets?.suggestions ?? []).find((x) => x.assetNo === sapAssetNo);
        return tx.vehicle.update({ where: { id: vehicleId }, data: { sapAssetNo, ...(v.purchasePrice == null && a?.acquisitionValue && { purchasePrice: a.acquisitionValue }) }, select: { id: true, plateNumber: true, sapAssetNo: true, purchasePrice: true } });
      }
      return tx.vehicle.update({ where: { id: vehicleId }, data: { sapAssetNo: null }, select: { id: true, plateNumber: true, sapAssetNo: true, purchasePrice: true } });
    });
  }

  // ------------------------------------------------------------------ monthly cost posting

  private async build(tx: Tx, period: string) {
    const company = await tx.company.findFirstOrThrow({ select: { timezone: true, currency: true, settings: true } });
    const s = parseCompanySettings(company.settings).sap;
    const from = `${period}-01`;
    const to = lastDay(period);
    const l = await this.costs.ledger(tx, company.timezone, { from, to });
    const vs = await tx.vehicle.findMany({ where: { id: { in: l.vehicles.map((v) => v.id) } }, select: { id: true, plateNumber: true, sapAssetNo: true, department: { select: { sapCostCenter: true } } } });
    const map = new Map(vs.map((v) => [v.id, { costCenter: v.department?.sapCostCenter ?? null, sapAssetNo: v.sapAssetNo, plate: v.plateNumber }]));
    const rows = [...l.rows.map((r) => ({ vehicleId: r.vehicleId, category: r.category, amount: r.amount })), ...l.unallocated.map((u) => ({ vehicleId: null, category: 'SHARED', amount: u.amount }))];
    const agg = aggregatePosting(rows, map, s);
    return { s, company, agg, from, to };
  }

  private assertClosed(period: string, tz: string) {
    if (period >= localDate(new Date(), tz).slice(0, 7)) throw new BadRequestException('Only months that have ended can be posted');
  }

  previewPosting(user: AuthUser, period: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { s, company, agg } = await this.build(tx, period);
      const previous = await tx.costPosting.findMany({ where: { period }, orderBy: { version: 'desc' } });
      return { period, currency: s.currency || company.currency, ...agg, journal: agg.errors.length ? [] : journalItems(agg.lines, s.offsetAccount, period), previous };
    });
  }

  /** Snapshot the month and queue its journal entry; a month posted before is reversed first. */
  async post(companyId: string, period: string, by: string | null) {
    this.assertMode();
    return this.db.tenant(companyId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sap-post:${companyId}:${period}`}::text))`;
      const { s, company, agg, to } = await this.build(tx, period);
      this.assertClosed(period, company.timezone);
      if (!s.enabled) throw new BadRequestException('Switch on the SAP link in the SAP settings first');
      if (!s.companyCode) throw new BadRequestException('Enter the SAP company code');
      if (agg.errors.length) throw new BadRequestException({ message: 'The posting is incomplete', errors: agg.errors.map((m) => ({ path: 'mapping', message: m })) });
      if (!agg.lines.length) throw new BadRequestException('Nothing to post for this month');
      const prev = await tx.costPosting.findFirst({ where: { period, status: { in: ['PENDING', 'POSTED'] } }, orderBy: { version: 'desc' } });
      if (prev?.status === 'PENDING') throw new ConflictException('This month is still being posted');
      const last = await tx.costPosting.findFirst({ where: { period }, orderBy: { version: 'desc' }, select: { version: true } });
      const currency = s.currency || company.currency;
      const posting = await tx.costPosting.create({
        data: { companyId, period, version: (last?.version ?? 0) + 1, total: agg.total, currency, createdBy: by, lines: { create: agg.lines.map((l) => ({ ...l, companyId })) } },
      });
      const items = journalItems(agg.lines, s.offsetAccount, period);
      if (!isBalanced(items)) throw new BadRequestException('The journal does not balance');
      const today = localDate(new Date(), company.timezone);
      if (prev?.status === 'POSTED') {
        const orig = await tx.sapDocument.findFirst({ where: { ref: `posting:${prev.id}`, kind: 'JOURNAL' } });
        const p = orig?.payload as unknown as JournalDoc | undefined;
        if (p) {
          const reversal: JournalDoc = { ...p, documentDate: today, reference: `${p.reference}R`, headerText: `Reversal ${period}`, items: p.items.map((i): JournalItem => ({ ...i, side: i.side === 'S' ? 'H' : 'S' })) };
          await tx.sapDocument.create({ data: { companyId, kind: 'REVERSAL', ref: `posting:${prev.id}`, payload: reversal as unknown as Prisma.InputJsonValue } });
        }
      }
      const doc: JournalDoc = { companyCode: s.companyCode, currency, documentDate: today, postingDate: to, reference: `FMS${period.replace('-', '')}V${posting.version}`, headerText: `FMS fleet costs ${period}`, items };
      // Created after the reversal so the outbox sends them in that order.
      const d = await tx.sapDocument.create({ data: { companyId, kind: 'JOURNAL', ref: `posting:${posting.id}`, payload: doc as unknown as Prisma.InputJsonValue, createdAt: new Date(Date.now() + 1) } });
      return tx.costPosting.update({ where: { id: posting.id }, data: { documentId: d.id }, include: { lines: true } });
    });
  }

  postings(user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) => tx.costPosting.findMany({ orderBy: [{ period: 'desc' }, { version: 'desc' }], include: { lines: true }, take: 60 }));
  }

  // ------------------------------------------------------------------ outbox

  documents(user: AuthUser, status?: string) {
    return this.db.tenant(user.companyId, (tx) => tx.sapDocument.findMany({ where: { ...(status && { status }) }, orderBy: { createdAt: 'desc' }, take: 200 }));
  }

  redeliver(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const d = await tx.sapDocument.findFirst({ where: { id } });
      if (!d) throw new NotFoundException('Document not found');
      if (d.status === 'SENT') throw new BadRequestException('Already sent');
      if (d.ref.startsWith('posting:')) await tx.costPosting.updateMany({ where: { id: d.ref.slice(8), status: 'FAILED' }, data: { status: 'PENDING' } });
      if (d.kind === 'PO') await tx.workOrder.updateMany({ where: { id: d.ref.slice(3) }, data: { poStatus: 'REQUESTED' } });
      return tx.sapDocument.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lockedUntil: null, lastError: null } });
    });
  }

  /** Sends due outbox documents (oldest first per company). */
  async dispatchDue(limit = 20, now = new Date()): Promise<{ sent: number; failed: number }> {
    if (env().SAP_MODE === 'none') return { sent: 0, failed: 0 };
    const due = await this.db.system(async (tx) => {
      const rows = await tx.sapDocument.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      if (rows.length) await tx.sapDocument.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { lockedUntil: new Date(now.getTime() + LEASE_MS) } });
      return rows;
    });
    let sent = 0;
    let failed = 0;
    const clients = new Map<string, SapClient>();
    const blocked = new Set<string>(); // a failed journal holds back later documents of the company
    for (const d of due) {
      if (blocked.has(d.companyId)) {
        await this.db.system((tx) => tx.sapDocument.update({ where: { id: d.id }, data: { lockedUntil: null } }));
        continue;
      }
      try {
        const client = clients.get(d.companyId) ?? (await this.client(d.companyId));
        clients.set(d.companyId, client);
        const no = d.kind === 'PO' ? await client.createPurchaseOrder(d.payload as unknown as PoRequest) : await client.postJournal(d.payload as unknown as JournalDoc);
        await this.db.tenant(d.companyId, async (tx) => {
          await tx.sapDocument.update({ where: { id: d.id }, data: { status: 'SENT', sapDocNo: no, attempts: { increment: 1 }, lastAttemptAt: new Date(), lockedUntil: null, lastError: null } });
          const id = d.ref.split(':')[1];
          if (d.kind === 'JOURNAL') await tx.costPosting.update({ where: { id }, data: { status: 'POSTED', sapDocNo: no, postedAt: new Date() } });
          if (d.kind === 'REVERSAL') await tx.costPosting.update({ where: { id }, data: { status: 'REVERSED', reversedAt: new Date() } });
          if (d.kind === 'PO') {
            await tx.workOrder.update({ where: { id }, data: { poNumber: no, poStatus: 'CREATED' } });
            await checkGarageInvoice(tx, id);
          }
        });
        sent++;
      } catch (e) {
        failed++;
        const attempts = d.attempts + 1;
        const next = nextAttempt(attempts, new Date());
        const msg = (e as Error).message.slice(0, 1000);
        if (d.kind !== 'PO') blocked.add(d.companyId);
        await this.db.tenant(d.companyId, async (tx) => {
          await tx.sapDocument.update({ where: { id: d.id }, data: { attempts, lastAttemptAt: new Date(), lockedUntil: null, lastError: msg, ...(next ? { nextAttemptAt: next } : { status: 'FAILED' }) } });
          if (!next) {
            const id = d.ref.split(':')[1];
            if (d.kind === 'JOURNAL') await tx.costPosting.update({ where: { id }, data: { status: 'FAILED' } });
            if (d.kind === 'PO') await tx.workOrder.update({ where: { id }, data: { poStatus: 'FAILED' } });
          }
        });
        if (!next || attempts === 3) {
          await this.notifications.notify({
            companyId: d.companyId,
            roles: [Role.COMPANY_ADMIN, Role.FLEET_MANAGER],
            topic: 'sap.failed',
            severity: 'warning',
            title: `SAP ${d.kind === 'PO' ? 'purchase order' : 'journal entry'} ${next ? 'keeps failing' : 'failed'}`,
            body: `${msg}${next ? '\nFMS keeps retrying.' : '\nFix the cause and send it again from Integrations → SAP.'}`,
            data: { link: '/integrations/sap' },
            dedupeKey: `sap-doc:${d.id}:${next ? 'retry' : 'failed'}`,
          });
        }
        this.log.warn(`SAP ${d.kind} ${d.id} attempt ${attempts}: ${msg}`);
      }
    }
    return { sent, failed };
  }

  // ------------------------------------------------------------------ parts receipts against POs

  /** Checks receipts booked against a PO (pending checks only), flags differences. */
  async checkReceipts(limit = 50): Promise<number> {
    if (env().SAP_MODE === 'none') return 0;
    const pending = await this.db.system((tx) =>
      tx.stockMovement.findMany({ where: { kind: 'RECEIPT', poNumber: { not: null }, poCheck: { equals: Prisma.DbNull } }, select: { id: true, companyId: true, poNumber: true, qty: true, unitCost: true, part: { select: { partNo: true, externalRef: true } } }, take: limit }),
    );
    const groups = new Map<string, typeof pending>();
    for (const m of pending) groups.set(`${m.companyId}|${m.poNumber}`, [...(groups.get(`${m.companyId}|${m.poNumber}`) ?? []), m]);
    let checked = 0;
    for (const [key, rows] of groups) {
      const [companyId, po] = key.split('|');
      try {
        const settings = await this.db.tenant(companyId, async (tx) => parseCompanySettings((await tx.company.findFirstOrThrow({ select: { settings: true } })).settings).sap);
        if (!settings.enabled || !settings.poForReceipts) continue;
        const sapPo = await (await this.client(companyId)).getPurchaseOrder(po);
        const issuesAll = sapPo
          ? matchReceipt(sapPo.items, rows.map((r) => ({ partNo: r.part.partNo, material: r.part.externalRef, qty: Number(r.qty), unitCost: Number(r.unitCost) })), settings.poTolerancePct)
          : rows.map((r) => ({ partNo: r.part.partNo, issue: 'NOT_ON_PO' as const, detail: `PO ${po} not found in SAP` }));
        await this.db.tenant(companyId, async (tx) => {
          for (const r of rows) {
            const issues = issuesAll.filter((i) => i.partNo === r.part.partNo);
            await tx.stockMovement.update({ where: { id: r.id }, data: { poCheck: { ok: issues.length === 0, issues, checkedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
          }
        });
        checked += rows.length;
        if (issuesAll.length) {
          await this.notifications.notify({
            companyId,
            roles: [Role.STOREKEEPER, Role.FLEET_MANAGER],
            topic: 'sap.receipt_mismatch',
            severity: 'warning',
            title: `Parts receipt differs from PO ${po}`,
            body: issuesAll.map((i) => `${i.partNo}: ${i.detail}`).join('\n'),
            data: { link: '/integrations/sap?tab=receipts' },
            dedupeKey: `sap-receipt:${po}:${rows.map((r) => r.id).join(',').slice(0, 100)}`,
          });
        }
      } catch (e) {
        this.log.warn(`PO ${po} check: ${(e as Error).message}`);
      }
    }
    return checked;
  }

  receipts(user: AuthUser) {
    return this.db.tenant(user.companyId, (tx) =>
      tx.stockMovement.findMany({ where: { kind: 'RECEIPT', poNumber: { not: null } }, select: { id: true, poNumber: true, poCheck: true, qty: true, unitCost: true, occurredAt: true, reference: true, part: { select: { partNo: true, name: true, externalRef: true } } }, orderBy: { occurredAt: 'desc' }, take: 200 }),
    );
  }

  // ------------------------------------------------------------------ SD billing

  async importBilling(companyId: string, by: string | null) {
    this.assertMode();
    const client = await this.client(companyId);
    const last = await this.db.tenant(companyId, (tx) => tx.sapSyncRun.findFirst({ where: { kind: 'BILLING', status: 'OK' }, orderBy: { startedAt: 'desc' } }));
    const started = new Date();
    const run = await this.db.tenant(companyId, (tx) => tx.sapSyncRun.create({ data: { companyId, kind: 'BILLING', createdBy: by } }));
    try {
      // One hour overlap; duplicates are ignored by the unique key.
      const since = last?.watermark ? new Date(last.watermark.getTime() - 3_600_000) : null;
      const items = await client.billingDocuments(since);
      const stats = await this.db.tenant(companyId, async (tx) => {
        const [customers, trips, orders] = await Promise.all([
          tx.customer.findMany({ select: { id: true, code: true, sapCustomer: true } }),
          tx.trip.findMany({ where: { tripNo: { in: items.map((i) => i.reference).filter((x): x is string => !!x) } }, select: { id: true, tripNo: true } }),
          tx.deliveryOrder.findMany({ where: { externalRef: { in: items.map((i) => i.reference).filter((x): x is string => !!x) } }, select: { id: true, externalRef: true, tripId: true, customerId: true } }),
        ]);
        let imported = 0;
        let updated = 0;
        let unmatched = 0;
        for (const i of items) {
          const order = i.reference ? orders.find((o) => o.externalRef === i.reference) : undefined;
          const trip = i.reference ? trips.find((t) => t.tripNo === i.reference) : undefined;
          const customer = customers.find((c) => c.sapCustomer === i.soldTo) ?? customers.find((c) => c.code === i.soldTo);
          if (!order && !trip) unmatched++;
          const data = {
            billingDate: new Date(i.date),
            soldTo: i.soldTo,
            customerId: customer?.id ?? order?.customerId ?? null,
            reference: i.reference,
            deliveryOrderId: order?.id ?? null,
            tripId: trip?.id ?? order?.tripId ?? null,
            netAmount: i.netAmount,
            currency: i.currency,
            cancelled: i.cancelled,
          };
          const existing = await tx.sapBillingItem.findFirst({ where: { billingDoc: i.billingDoc, item: i.item }, select: { id: true } });
          if (existing) {
            await tx.sapBillingItem.update({ where: { id: existing.id }, data });
            updated++;
          } else {
            await tx.sapBillingItem.create({ data: { ...data, companyId, billingDoc: i.billingDoc, item: i.item } });
            imported++;
          }
        }
        return { received: items.length, imported, updated, unmatched, total: r2(items.filter((i) => !i.cancelled).reduce((a, i) => a + i.netAmount, 0)) };
      });
      return this.db.tenant(companyId, (tx) => tx.sapSyncRun.update({ where: { id: run.id }, data: { status: 'OK', stats, watermark: started, finishedAt: new Date() } }));
    } catch (e) {
      const msg = e instanceof SapError || e instanceof Error ? e.message : String(e);
      await this.db.tenant(companyId, (tx) => tx.sapSyncRun.update({ where: { id: run.id }, data: { status: 'FAILED', errors: [msg], finishedAt: new Date() } }));
      throw new BadGatewayException(`Billing import failed: ${msg}`);
    }
  }

  billing(user: AuthUser, from: string, to: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const items = await tx.sapBillingItem.findMany({ where: { billingDate: { gte: new Date(from), lte: new Date(to) } }, orderBy: [{ billingDate: 'desc' }, { billingDoc: 'asc' }], take: 1000 });
      const tripIds = [...new Set(items.map((i) => i.tripId).filter((x): x is string => !!x))];
      const revs = await tx.tripRevenue.groupBy({ by: ['tripId'], where: { tripId: { in: tripIds } }, _sum: { amount: true } });
      const rated = new Map(revs.map((r) => [r.tripId, Number(r._sum.amount ?? 0)]));
      const billed = new Map<string, number>();
      for (const i of items) if (i.tripId && !i.cancelled) billed.set(i.tripId, (billed.get(i.tripId) ?? 0) + Number(i.netAmount));
      const trips = await tx.trip.findMany({ where: { id: { in: tripIds } }, select: { id: true, tripNo: true } });
      return {
        items,
        compare: trips
          .map((t) => ({ tripId: t.id, tripNo: t.tripNo, billed: r2(billed.get(t.id) ?? 0), rated: r2(rated.get(t.id) ?? 0), diff: r2((billed.get(t.id) ?? 0) - (rated.get(t.id) ?? 0)) }))
          .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
      };
    });
  }

  // ------------------------------------------------------------------ jobs

  private async enabledCompanies(): Promise<{ id: string; settings: ReturnType<typeof parseCompanySettings>['sap']; timezone: string }[]> {
    if (env().SAP_MODE === 'none') return [];
    const cs = await this.db.system((tx) => tx.company.findMany({ where: { active: true }, select: { id: true, settings: true, timezone: true } }));
    return cs.map((c) => ({ id: c.id, settings: parseCompanySettings(c.settings).sap, timezone: c.timezone })).filter((c) => c.settings.enabled);
  }

  async syncAll() {
    let n = 0;
    for (const c of await this.enabledCompanies()) {
      try {
        await this.syncMaster(c.id, null);
        n++;
      } catch (e) {
        this.log.warn(`Master data ${c.id}: ${(e as Error).message}`);
      }
    }
    return n;
  }

  async billingAll() {
    let n = 0;
    for (const c of (await this.enabledCompanies()).filter((x) => x.settings.importBilling)) {
      try {
        await this.importBilling(c.id, null);
        n++;
      } catch (e) {
        this.log.warn(`Billing ${c.id}: ${(e as Error).message}`);
      }
    }
    return n;
  }

  /** On the posting day, post last month once (skipped when it was posted already). */
  async autoPostAll(now = new Date()) {
    let n = 0;
    for (const c of (await this.enabledCompanies()).filter((x) => x.settings.autoPost)) {
      const today = localDate(now, c.timezone);
      if (Number(today.slice(8, 10)) !== c.settings.postingDay) continue;
      const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 1);
      const period = d.toISOString().slice(0, 7);
      const done = await this.db.tenant(c.id, (tx) => tx.costPosting.findFirst({ where: { period, status: { in: ['PENDING', 'POSTED'] } } }));
      if (done) continue;
      try {
        await this.post(c.id, period, null);
        n++;
      } catch (e) {
        await this.notifications.notify({
          companyId: c.id,
          roles: [Role.COMPANY_ADMIN],
          topic: 'sap.failed',
          severity: 'warning',
          title: `Automatic SAP cost posting for ${period} did not run`,
          body: (e as Error).message,
          data: { link: '/integrations/sap' },
          dedupeKey: `sap-autopost:${period}`,
        });
      }
    }
    return n;
  }
}
