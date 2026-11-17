import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChecklistItem, Role, TIRE_LAYOUTS, tireLayoutOf, TireChangeInput, TireCheckInput, TireRotateInput, TireSettings } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChangeRow, CheckRow, lifeByBrand, PositionStatus, positionStatus, replay } from './tires';

const n = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));

const toChange = (c: { id: string; position: string; fromPosition: string | null; changedAt: Date; odometerKm: Prisma.Decimal; reason: string; brand: string | null; model: string | null; size: string | null; condition: string; cost: Prisma.Decimal; removedTreadMm: Prisma.Decimal | null; warrantyMonths: number | null; warrantyKm: number | null }): ChangeRow => ({
  ...c,
  odometerKm: Number(c.odometerKm),
  cost: Number(c.cost),
  removedTreadMm: n(c.removedTreadMm),
});
const toCheck = (c: { position: string; checkedAt: Date; odometerKm: Prisma.Decimal | null; treadMm: Prisma.Decimal | null; pressure: Prisma.Decimal | null }): CheckRow => ({
  position: c.position,
  checkedAt: c.checkedAt,
  odometerKm: n(c.odometerKm),
  treadMm: n(c.treadMm),
  pressure: n(c.pressure),
});

/** Tires per vehicle position: fitment history, checks, status, costs and alerts. */
@Injectable()
export class TiresService {
  private readonly log = new Logger('Tires');

  constructor(
    private readonly db: PrismaService,
    private readonly maintenance: MaintenanceService,
    private readonly notifications: NotificationsService,
  ) {}

  private async vehicle(tx: Tx, id: string) {
    const v = await tx.vehicle.findFirst({ where: { id, deletedAt: null }, select: { id: true, plateNumber: true, vehicleClass: true, tireLayout: true, odometerKm: true } });
    if (!v) throw new NotFoundException('Vehicle not found');
    return { ...v, layout: tireLayoutOf(v.vehicleClass, v.tireLayout), odometer: Number(v.odometerKm) };
  }

  private async settings(tx: Tx): Promise<TireSettings> {
    const c = await tx.company.findFirstOrThrow({ select: { settings: true } });
    return parseCompanySettings(c.settings).tires;
  }

  private status(v: { vehicleClass: string; layout: string; odometer: number }, changes: ChangeRow[], checks: CheckRow[], settings: TireSettings, now = new Date()) {
    const { current, removed } = replay(changes);
    const positions = TIRE_LAYOUTS[v.layout].positions.map((p) =>
      positionStatus(p, current.get(p) ?? null, checks, { odometerKm: v.odometer, now, settings, pressureTarget: settings.pressureTargets[v.vehicleClass] ?? null }),
    );
    return { positions, removed };
  }

  /** Vehicle tire sheet: layout, status per position, history. */
  vehicleTires(user: AuthUser, vehicleId: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const v = await this.vehicle(tx, vehicleId);
      const [changes, checks, settings] = await Promise.all([
        tx.tireChange.findMany({ where: { vehicleId }, orderBy: { changedAt: 'asc' } }),
        tx.tireCheck.findMany({ where: { vehicleId }, orderBy: { checkedAt: 'asc' } }),
        this.settings(tx),
      ]);
      const st = this.status(v, changes.map(toChange), checks.map(toCheck), settings);
      const cost = changes.reduce((a, c) => a + Number(c.cost), 0);
      return {
        vehicle: { id: v.id, plateNumber: v.plateNumber, vehicleClass: v.vehicleClass, odometerKm: v.odometer },
        layout: v.layout,
        layouts: Object.entries(TIRE_LAYOUTS).map(([key, l]) => ({ key, label: l.label })),
        settings: { minTreadMm: settings.minTreadMm, pressureUnit: settings.pressureUnit, pressureTarget: settings.pressureTargets[v.vehicleClass] ?? null },
        positions: st.positions,
        removed: st.removed,
        totals: { cost: Math.round(cost), changes: changes.filter((c) => c.reason !== 'ROTATION').length },
        changes: changes.slice(-50).reverse(),
        checks: checks.slice(-50).reverse(),
      };
    });
  }

  setLayout(user: AuthUser, vehicleId: string, layout: string | null) {
    if (layout && !TIRE_LAYOUTS[layout]) throw new BadRequestException('Unknown tire layout');
    return this.db.tenant(user.companyId, async (tx) => {
      await this.vehicle(tx, vehicleId);
      await tx.vehicle.update({ where: { id: vehicleId }, data: { tireLayout: layout } });
      return { layout };
    });
  }

  private checkPosition(layout: string, position: string) {
    if (!TIRE_LAYOUTS[layout].positions.includes(position)) throw new BadRequestException(`Position ${position} is not on this vehicle (${TIRE_LAYOUTS[layout].positions.join(', ')})`);
  }

  async change(user: AuthUser, vehicleId: string, body: TireChangeInput) {
    if (body.reason === 'ROTATION') throw new BadRequestException('Use rotate to swap two positions');
    return this.db.tenant(user.companyId, async (tx) => {
      const v = await this.vehicle(tx, vehicleId);
      this.checkPosition(v.layout, body.position);
      if (body.supplierId && !(await tx.supplier.findFirst({ where: { id: body.supplierId } }))) throw new BadRequestException('Supplier not found');
      const odometerKm = body.odometerKm ?? v.odometer;
      const c = await tx.tireChange.create({
        data: { ...body, changedAt: body.changedAt ?? new Date(), odometerKm, companyId: user.companyId, vehicleId, createdBy: user.userId },
      });
      if (body.workOrderId && body.cost > 0) {
        await this.maintenance.addTireLineTx(tx, user, body.workOrderId, vehicleId, { description: `Tire ${body.position}: ${[body.brand, body.size].filter(Boolean).join(' ') || body.condition.toLowerCase()}`, cost: body.cost, tireChangeId: c.id });
      }
      if (odometerKm > v.odometer) await tx.vehicle.update({ where: { id: vehicleId }, data: { odometerKm } });
      return c;
    });
  }

  /** Swaps the tires of two positions (their km continue). */
  rotate(user: AuthUser, vehicleId: string, body: TireRotateInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const v = await this.vehicle(tx, vehicleId);
      this.checkPosition(v.layout, body.a);
      this.checkPosition(v.layout, body.b);
      const changedAt = body.changedAt ?? new Date();
      const odometerKm = body.odometerKm ?? v.odometer;
      const base = { companyId: user.companyId, vehicleId, changedAt, odometerKm, reason: 'ROTATION', cost: 0, createdBy: user.userId };
      await tx.tireChange.createMany({ data: [{ ...base, position: body.a, fromPosition: body.b }, { ...base, position: body.b, fromPosition: body.a }] });
      return { rotated: [body.a, body.b] };
    });
  }

  check(user: AuthUser, vehicleId: string, body: TireCheckInput) {
    return this.db.tenant(user.companyId, async (tx) => {
      const v = await this.vehicle(tx, vehicleId);
      for (const r of body.readings) this.checkPosition(v.layout, r.position);
      const checkedAt = body.checkedAt ?? new Date();
      await tx.tireCheck.createMany({
        data: body.readings
          .filter((r) => r.treadMm != null || r.pressure != null)
          .map((r) => ({ companyId: user.companyId, vehicleId, position: r.position, checkedAt, odometerKm: body.odometerKm ?? v.odometer, treadMm: r.treadMm ?? null, pressure: r.pressure ?? null, source: 'WEB', createdBy: user.userId })),
      });
      return { saved: body.readings.length };
    });
  }

  private async fleetStatus(tx: Tx, settings: TireSettings) {
    const [vehicles, changes, checks] = await Promise.all([
      tx.vehicle.findMany({ where: { deletedAt: null, status: { notIn: ['DISPOSED', 'INACTIVE'] } }, select: { id: true, plateNumber: true, vehicleClass: true, tireLayout: true, odometerKm: true } }),
      tx.tireChange.findMany({ orderBy: { changedAt: 'asc' } }),
      tx.tireCheck.findMany({ where: { checkedAt: { gte: new Date(Date.now() - 365 * 86_400_000) } }, orderBy: { checkedAt: 'asc' } }),
    ]);
    const byV = <T extends { vehicleId: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(r.vehicleId, [...(m.get(r.vehicleId) ?? []), r]);
      return m;
    };
    const ch = byV(changes);
    const ck = byV(checks);
    return vehicles.map((v) => {
      const vv = { ...v, layout: tireLayoutOf(v.vehicleClass, v.tireLayout), odometer: Number(v.odometerKm) };
      const st = this.status(vv, (ch.get(v.id) ?? []).map(toChange), (ck.get(v.id) ?? []).map(toCheck), settings);
      return { vehicle: { id: v.id, plateNumber: v.plateNumber, vehicleClass: v.vehicleClass, layout: vv.layout }, ...st, cost: (ch.get(v.id) ?? []).reduce((a, c) => a + Number(c.cost), 0) };
    });
  }

  /** Fleet view: positions needing attention, and tire life / cost per km by brand and size. */
  fleet(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const settings = await this.settings(tx);
      const rows = await this.fleetStatus(tx, settings);
      const attention = rows.flatMap((r) => r.positions.filter((p) => p.level === 'critical' || p.level === 'warn').map((p) => ({ vehicle: r.vehicle, ...p })));
      const unchecked = rows.filter((r) => r.positions.every((p) => p.lastCheckAt == null || Date.now() - p.lastCheckAt.getTime() > 30 * 86_400_000)).length;
      return {
        settings: { minTreadMm: settings.minTreadMm, pressureUnit: settings.pressureUnit, expectedLifeKm: settings.expectedLifeKm },
        totals: {
          vehicles: rows.length,
          critical: attention.filter((a) => a.level === 'critical').length,
          warn: attention.filter((a) => a.level === 'warn').length,
          notCheckedIn30Days: unchecked,
          cost12m: Math.round(rows.reduce((a, r) => a + r.cost, 0)),
        },
        attention: attention.sort((a, b) => (a.level === b.level ? (a.treadMm ?? 99) - (b.treadMm ?? 99) : a.level === 'critical' ? -1 : 1)),
        brands: lifeByBrand(rows.flatMap((r) => r.removed)),
        vehicles: rows.map((r) => ({ vehicle: r.vehicle, critical: r.positions.filter((p) => p.level === 'critical').length, warn: r.positions.filter((p) => p.level === 'warn').length, fitted: r.positions.filter((p) => p.tire).length, positions: r.positions.length, cost: Math.round(r.cost) })),
      };
    });
  }

  /** Creates an inspection checklist with one tread and one pressure item per position of a layout. */
  createTireTemplate(user: AuthUser, body: { layout: string; name?: string; vehicleClasses: string[]; kind: 'PRE_TRIP' | 'PERIODIC' }) {
    const layout = TIRE_LAYOUTS[body.layout];
    if (!layout) throw new BadRequestException('Unknown tire layout');
    return this.db.tenant(user.companyId, async (tx) => {
      const s = await this.settings(tx);
      const target = body.vehicleClasses.length === 1 ? (s.pressureTargets[body.vehicleClasses[0]] ?? null) : null;
      const items: ChecklistItem[] = layout.positions.flatMap((p) => {
        const k = p.toLowerCase();
        return [
          { key: `tread_${k}`, label: `Tread depth ${p}`, critical: true, type: 'number' as const, unit: 'mm', min: s.minTreadMm, tirePosition: p, measure: 'TREAD' as const },
          {
            key: `pressure_${k}`,
            label: `Pressure ${p}`,
            critical: false,
            type: 'number' as const,
            unit: s.pressureUnit,
            ...(target ? { min: Math.round(target * (1 - s.tolerancePct / 100) * 10) / 10, max: Math.round(target * (1 + s.tolerancePct / 100) * 10) / 10 } : {}),
            tirePosition: p,
            measure: 'PRESSURE' as const,
          },
        ];
      });
      return tx.inspectionTemplate.create({
        data: { companyId: user.companyId, name: body.name ?? `Tire check — ${layout.label}`, kind: body.kind, vehicleClasses: body.vehicleClasses, items: items as unknown as Prisma.InputJsonValue, active: true },
      });
    });
  }

  /** Daily: tread below minimum, pressure out of tolerance, tire beyond expected life (once a week per position). */
  async alerts(now = new Date()): Promise<number> {
    const companies = await this.db.system((tx) => tx.company.findMany({ where: { active: true }, select: { id: true } }));
    let sent = 0;
    const week = `${now.getUTCFullYear()}-${Math.floor((now.getTime() / 86_400_000 + 3) / 7)}`;
    for (const c of companies) {
      const rows = await this.db.tenant(c.id, async (tx) => this.fleetStatus(tx, await this.settings(tx)));
      for (const r of rows) {
        const bad = r.positions.filter((p: PositionStatus) => p.treadStatus === 'REPLACE' || p.pressureStatus === 'LOW' || p.pressureStatus === 'HIGH' || p.overLife);
        if (!bad.length) continue;
        const what = bad.map((p) => `${p.position}: ${[p.treadStatus === 'REPLACE' && `tread ${p.treadMm} mm`, p.pressureStatus === 'LOW' && `pressure low (${p.pressure})`, p.pressureStatus === 'HIGH' && `pressure high (${p.pressure})`, p.overLife && `${p.kmSinceFit} km, beyond expected life`].filter(Boolean).join(', ')}`);
        sent += await this.notifications.notify({
          companyId: c.id,
          roles: [Role.FLEET_MANAGER, Role.COMPANY_ADMIN],
          topic: 'tires.attention',
          severity: bad.some((p) => p.treadStatus === 'REPLACE' || p.pressureStatus === 'LOW') ? 'warning' : 'info',
          title: `${r.vehicle.plateNumber}: ${bad.length} tire position(s) need attention`,
          body: what.join('\n'),
          data: { vehicleId: r.vehicle.id, link: `/vehicles/${r.vehicle.id}?tab=tires` },
          dedupeKey: `tires:${r.vehicle.id}:${week}`,
        });
      }
    }
    this.log.log(`Tire alerts: ${sent}`);
    return sent;
  }
}
