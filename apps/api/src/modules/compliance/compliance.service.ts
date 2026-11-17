import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role } from '@fms/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { NotificationsService } from '../notifications/notifications.service';
import { evaluate, RequirementState } from './rules';

/** Country rule packs: status of required documents per vehicle, dashboard and alerts. */
@Injectable()
export class ComplianceService {
  private readonly log = new Logger('Compliance');

  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async fleet(tx: Tx, vehicleIds?: string[]) {
    const company = await tx.company.findFirstOrThrow({ select: { settings: true } });
    const s = parseCompanySettings(company.settings).compliance;
    const [vehicles, docs] = await Promise.all([
      tx.vehicle.findMany({ where: { deletedAt: null, status: { not: 'DISPOSED' }, ...(vehicleIds && { id: { in: vehicleIds } }) }, select: { id: true, plateNumber: true, vehicleClass: true, assetKind: true, branchId: true }, orderBy: { plateNumber: 'asc' } }),
      tx.vehicleDocument.findMany({ where: { ...(vehicleIds && { vehicleId: { in: vehicleIds } }) }, select: { id: true, vehicleId: true, type: true, number: true, issuedAt: true, expiresAt: true } }),
    ]);
    const today = new Date();
    return {
      settings: s,
      rows: vehicles.map((v) => {
        const states = evaluate(v, docs.filter((d) => d.vehicleId === v.id), s, today);
        const worst = (['EXPIRED', 'MISSING', 'EXPIRING', 'UNKNOWN', 'OK'] as const).find((x) => states.some((r) => r.status === x)) ?? 'OK';
        return { vehicle: v, requirements: states, status: states.length ? worst : 'OK', blocked: states.some((r) => r.blocks) };
      }),
    };
  }

  dashboard(user: AuthUser) {
    return this.db.tenant(user.companyId, async (tx) => {
      const { settings, rows } = await this.fleet(tx);
      const count = (st: RequirementState['status']) => rows.reduce((a, r) => a + r.requirements.filter((x) => x.status === st).length, 0);
      return {
        settings,
        totals: { vehicles: rows.length, compliant: rows.filter((r) => r.status === 'OK').length, blocked: rows.filter((r) => r.blocked).length, missing: count('MISSING'), expired: count('EXPIRED'), expiring: count('EXPIRING'), unknown: count('UNKNOWN') },
        vehicles: rows.sort((a, b) => Number(b.blocked) - Number(a.blocked) || a.status.localeCompare(b.status)),
      };
    });
  }

  vehicle(user: AuthUser, id: string) {
    return this.db.tenant(user.companyId, async (tx) => {
      const r = (await this.fleet(tx, [id])).rows[0];
      if (!r) throw new NotFoundException('Vehicle not found');
      return r;
    });
  }

  /** Weekly (run daily, deduplicated per ISO week): vehicles with missing or expired required documents. */
  async alerts(now = new Date()): Promise<number> {
    const companies = await this.db.system((tx) => tx.company.findMany({ where: { active: true }, select: { id: true } }));
    const week = Math.floor((now.getTime() / 86_400_000 + 3) / 7);
    let sent = 0;
    for (const c of companies) {
      const { rows } = await this.db.tenant(c.id, (tx) => this.fleet(tx));
      for (const r of rows) {
        const bad = r.requirements.filter((x) => x.status === 'MISSING' || x.status === 'EXPIRED');
        if (!bad.length) continue;
        sent += await this.notifications.notify({
          companyId: c.id,
          roles: [Role.FLEET_MANAGER, Role.COMPANY_ADMIN],
          topic: 'compliance.documents',
          severity: r.blocked ? 'warning' : 'info',
          title: `${r.vehicle.plateNumber}: ${bad.length} required document(s) ${bad.every((b) => b.status === 'MISSING') ? 'missing' : 'missing or expired'}`,
          body: bad.map((b) => `${b.label}: ${b.status === 'MISSING' ? 'not recorded' : `expired ${b.validUntil}`}`).join('\n') + (r.blocked ? '\nThe vehicle cannot be dispatched until this is fixed.' : ''),
          data: { vehicleId: r.vehicle.id, link: `/vehicles/${r.vehicle.id}` },
          dedupeKey: `compliance:${r.vehicle.id}:${week}`,
        });
      }
    }
    this.log.log(`Compliance alerts: ${sent}`);
    return sent;
  }
}
