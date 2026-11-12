import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role } from '@fms/shared';
import { Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { NotificationsService } from '../notifications/notifications.service';
import type { PositionFix } from './providers/telematics-provider';
import { EMPTY_STATE, evaluate, evaluateOffline, EventClose, EventDraft, Fence, RuleState } from './rules/rules-engine';

export interface VehicleRef {
  id: string;
  companyId: string;
  plateNumber: string;
  speedLimitKmh: number | null;
}

export interface PersistedEvent extends EventDraft {
  companyId: string;
  vehicleId: string;
  plateNumber: string;
}

const ALERT_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER, Role.DISPATCHER];

function toState(row: Prisma.VehicleTelemetryStateGetPayload<object> | undefined): RuleState {
  if (!row) return { ...EMPTY_STATE };
  return {
    lastFixAt: row.lastFixAt,
    ignition: row.ignition,
    insideGeofenceIds: row.insideGeofenceIds,
    overspeedEventId: row.overspeedEventId,
    overspeedMaxKmh: row.overspeedMaxKmh,
    idleSince: row.idleSince,
    idleEventId: row.idleEventId,
    offlineEventId: row.offlineEventId,
  };
}

/** Loads state/context, runs the pure rules engine, persists events and state. */
@Injectable()
export class TelemetryRulesService {
  private readonly logger = new Logger(TelemetryRulesService.name);

  constructor(private readonly notifications: NotificationsService) {}

  /** Must run inside a system (RLS-bypass) transaction. */
  async apply(tx: Tx, batches: { vehicle: VehicleRef; fixes: PositionFix[] }[]): Promise<PersistedEvent[]> {
    if (!batches.length) return [];
    const companyIds = [...new Set(batches.map((b) => b.vehicle.companyId))];
    const [companies, fences, states] = await Promise.all([
      tx.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, settings: true } }),
      tx.geofence.findMany({ where: { companyId: { in: companyIds }, active: true } }),
      tx.vehicleTelemetryState.findMany({ where: { vehicleId: { in: batches.map((b) => b.vehicle.id) } } }),
    ]);
    const settingsBy = new Map(companies.map((c) => [c.id, parseCompanySettings(c.settings).telematics]));
    const fencesBy = new Map<string, Fence[]>();
    for (const f of fences) {
      const list = fencesBy.get(f.companyId) ?? [];
      list.push({ ...f, polygon: f.polygon as [number, number][] | null });
      fencesBy.set(f.companyId, list);
    }
    const stateBy = new Map(states.map((s) => [s.vehicleId, s]));

    const events: PersistedEvent[] = [];
    const closes: EventClose[] = [];
    for (const { vehicle, fixes } of batches) {
      const settings = settingsBy.get(vehicle.companyId)!;
      const ctx = {
        settings,
        speedLimitKmh: vehicle.speedLimitKmh ?? settings.speedLimitKmh,
        geofences: fencesBy.get(vehicle.companyId) ?? [],
      };
      let state = toState(stateBy.get(vehicle.id));
      for (const fix of [...fixes].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
        const r = evaluate(state, fix, ctx);
        state = r.state;
        events.push(...r.opened.map((e) => ({ ...e, companyId: vehicle.companyId, vehicleId: vehicle.id, plateNumber: vehicle.plateNumber })));
        closes.push(...r.closed);
      }
      await this.saveState(tx, vehicle, state);
    }
    await this.persist(tx, events, closes);
    return events;
  }

  /** Opens GPS_OFFLINE events for vehicles whose last fix is too old. */
  async checkOffline(tx: Tx, now = new Date()): Promise<PersistedEvent[]> {
    const rows = await tx.vehicleTelemetryState.findMany({ where: { offlineEventId: null, lastFixAt: { not: null } } });
    if (!rows.length) return [];
    const [companies, vehicles] = await Promise.all([
      tx.company.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, settings: true } }),
      tx.vehicle.findMany({
        where: { id: { in: rows.map((r) => r.vehicleId) }, deletedAt: null, status: { notIn: ['INACTIVE', 'DISPOSED'] } },
        select: { id: true, plateNumber: true },
      }),
    ]);
    const settingsBy = new Map(companies.map((c) => [c.id, parseCompanySettings(c.settings).telematics]));
    const plateBy = new Map(vehicles.map((v) => [v.id, v.plateNumber]));
    const events: PersistedEvent[] = [];
    for (const row of rows) {
      const plateNumber = plateBy.get(row.vehicleId);
      if (!plateNumber) continue;
      const r = evaluateOffline(toState(row), now, settingsBy.get(row.companyId)!);
      if (!r.opened.length) continue;
      await tx.vehicleTelemetryState.update({ where: { vehicleId: row.vehicleId }, data: { offlineEventId: r.state.offlineEventId } });
      events.push(...r.opened.map((e) => ({ ...e, companyId: row.companyId, vehicleId: row.vehicleId, plateNumber })));
    }
    await this.persist(tx, events, []);
    return events;
  }

  /** Sends notifications for events flagged `notify`. Call after the transaction commits. */
  async notify(events: PersistedEvent[]): Promise<void> {
    for (const e of events.filter((x) => x.notify)) {
      const msg = this.describe(e);
      await this.notifications
        .notify({
          companyId: e.companyId,
          topic: `telematics.${e.type.toLowerCase()}`,
          severity: msg.severity,
          title: msg.title,
          body: msg.body,
          roles: ALERT_ROLES,
          data: { eventId: e.id, vehicleId: e.vehicleId, link: `/vehicles/${e.vehicleId}/track` },
          dedupeKey: `evt:${e.id}`,
        })
        .catch((err: Error) => this.logger.error(`Notify failed: ${err.message}`));
    }
  }

  describe(e: PersistedEvent): { title: string; body: string; severity: 'info' | 'warning' | 'critical' } {
    const time = e.occurredAt.toISOString().slice(11, 16);
    switch (e.type) {
      case 'OVERSPEED':
        return {
          severity: 'warning',
          title: `${e.plateNumber} overspeeding: ${Math.round(e.speedKmh ?? 0)} km/h`,
          body: `${e.plateNumber} exceeded the ${e.data?.limitKmh} km/h limit at ${time} UTC (${Math.round(e.speedKmh ?? 0)} km/h).`,
        };
      case 'IDLE':
        return { severity: 'info', title: `${e.plateNumber} idling`, body: `${e.plateNumber} has been idling with the engine on since ${time} UTC.` };
      case 'GPS_OFFLINE':
        return {
          severity: 'warning',
          title: `${e.plateNumber} GPS offline`,
          body: `No position from ${e.plateNumber} since ${String(e.data?.lastFixAt ?? '').slice(0, 16).replace('T', ' ')} UTC.`,
        };
      case 'GEOFENCE_ENTER':
      case 'GEOFENCE_EXIT':
        return {
          severity: 'info',
          title: `${e.plateNumber} ${e.type === 'GEOFENCE_ENTER' ? 'entered' : 'left'} ${e.data?.geofence}`,
          body: `${e.plateNumber} ${e.type === 'GEOFENCE_ENTER' ? 'entered' : 'left'} geofence "${e.data?.geofence}" at ${time} UTC.`,
        };
      default:
        return { severity: 'info', title: `${e.plateNumber} ${e.type}`, body: `${e.type} at ${time} UTC.` };
    }
  }

  private async saveState(tx: Tx, vehicle: VehicleRef, s: RuleState) {
    const data = { ...s, companyId: vehicle.companyId };
    await tx.vehicleTelemetryState.upsert({ where: { vehicleId: vehicle.id }, create: { vehicleId: vehicle.id, ...data }, update: data });
  }

  private async persist(tx: Tx, events: PersistedEvent[], closes: EventClose[]) {
    if (events.length) {
      await tx.telemetryEvent.createMany({
        data: events.map((e) => ({
          id: e.id,
          companyId: e.companyId,
          vehicleId: e.vehicleId,
          type: e.type,
          occurredAt: e.occurredAt,
          endedAt: e.endedAt ?? null,
          latitude: e.latitude ?? null,
          longitude: e.longitude ?? null,
          speedKmh: e.speedKmh ?? null,
          geofenceId: e.geofenceId ?? null,
          data: (e.data ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      });
    }
    for (const c of closes) {
      const existing = await tx.telemetryEvent.findUnique({ where: { id: c.id }, select: { data: true } });
      if (!existing) continue;
      await tx.telemetryEvent.update({
        where: { id: c.id },
        data: { endedAt: c.endedAt, data: { ...((existing.data as object) ?? {}), ...c.data } as Prisma.InputJsonValue },
      });
    }
  }
}
