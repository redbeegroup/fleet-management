import { WebhooksService } from '../integrations/webhooks.service';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role, WebhookEvent } from '@fms/shared';
import { Tx } from '../../common/db/prisma.service';
import { parseCompanySettings } from '../../common/settings';
import { NotificationsService } from '../notifications/notifications.service';
import type { PositionFix } from './providers/telematics-provider';
import { decodePolyline } from '../routing/polyline';
import { ControlState, EMPTY_CONTROL, evaluateControl } from './rules/control';
import { Diagnostics, diagnosticEvents, EMPTY_FUEL, evaluateFuelLevel, FuelLevelState, fuelLevelL, readDiagnostics } from './rules/fuel-level';
import { EMPTY_STATE, evaluate, evaluateOffline, EventClose, EventDraft, Fence, RuleState } from './rules/rules-engine';

export interface VehicleRef {
  id: string;
  companyId: string;
  plateNumber: string;
  speedLimitKmh: number | null;
  tankCapacityL?: Prisma.Decimal | number | null;
}

export interface PersistedEvent extends EventDraft {
  companyId: string;
  vehicleId: string;
  plateNumber: string;
  driverId?: string | null;
}

/** Telemetry events that are also pushed to webhook subscribers. */
const WEBHOOK_FOR: Partial<Record<string, WebhookEvent>> = {
  OVERSPEED: WebhookEvent.VEHICLE_OVERSPEED,
  GEOFENCE_ENTER: WebhookEvent.VEHICLE_GEOFENCE_ENTER,
  GEOFENCE_EXIT: WebhookEvent.VEHICLE_GEOFENCE_EXIT,
  GPS_OFFLINE: WebhookEvent.VEHICLE_GPS_OFFLINE,
  OFF_ROUTE: WebhookEvent.VEHICLE_OFF_ROUTE,
  UNAUTHORISED_MOVEMENT: WebhookEvent.VEHICLE_UNAUTHORISED_USE,
  AFTER_HOURS: WebhookEvent.VEHICLE_UNAUTHORISED_USE,
  NO_DRIVER: WebhookEvent.VEHICLE_UNAUTHORISED_USE,
  RESTRICTED_AREA: WebhookEvent.VEHICLE_UNAUTHORISED_USE,
  FUEL_DROP: WebhookEvent.VEHICLE_FUEL_DROP,
  ENGINE_FAULT: WebhookEvent.VEHICLE_ENGINE_FAULT,
};

function toFuel(row: Prisma.VehicleTelemetryStateGetPayload<object> | undefined): FuelLevelState {
  if (!row) return { ...EMPTY_FUEL };
  return { samples: (row.fuelSamples as [number, number][] | null) ?? [], level: row.fuelLevelL, riseFrom: row.fuelRiseFrom, dropFrom: row.fuelDropFrom };
}

/** Decoded planned routes, keyed by trip id + version (routes change only when a load is edited). */
const routeCache = new Map<string, { lat: number; lng: number }[]>();
function routeOf(trip: { id: string; updatedAt: Date; routeGeometry: string | null; routingSource: string | null }) {
  if (!trip.routeGeometry || trip.routingSource !== 'osrm') return null; // straight-line plans are not a route to follow
  const key = `${trip.id}:${trip.updatedAt.getTime()}`;
  let r = routeCache.get(key);
  if (!r) {
    r = decodePolyline(trip.routeGeometry);
    if (routeCache.size > 2000) routeCache.clear();
    routeCache.set(key, r);
  }
  return r;
}

function toControl(row: Prisma.VehicleTelemetryStateGetPayload<object> | undefined): ControlState {
  if (!row) return { ...EMPTY_CONTROL };
  return {
    lastLat: row.lastLat,
    lastLng: row.lastLng,
    offRouteSince: row.offRouteSince,
    offRouteEventId: row.offRouteEventId,
    offRouteMaxM: row.offRouteMaxM,
    noTripKm: row.noTripKm,
    noTripEventId: row.noTripEventId,
    afterHoursEventId: row.afterHoursEventId,
    noDriverEventId: row.noDriverEventId,
  };
}

const ALERT_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.FLEET_MANAGER, Role.DISPATCHER];

function toState(row: Prisma.VehicleTelemetryStateGetPayload<object> | undefined): RuleState {
  if (!row) return { ...EMPTY_STATE };
  return {
    lastFixAt: row.lastFixAt,
    ignition: row.ignition,
    lastSpeedKmh: row.lastSpeedKmh,
    lastHeading: row.lastHeading,
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

  constructor(
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  /** Must run inside a system (RLS-bypass) transaction. */
  async apply(tx: Tx, batches: { vehicle: VehicleRef; fixes: PositionFix[] }[]): Promise<PersistedEvent[]> {
    if (!batches.length) return [];
    const companyIds = [...new Set(batches.map((b) => b.vehicle.companyId))];
    const [companies, fences, states] = await Promise.all([
      tx.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, settings: true, timezone: true } }),
      tx.geofence.findMany({ where: { companyId: { in: companyIds }, active: true } }),
      tx.vehicleTelemetryState.findMany({ where: { vehicleId: { in: batches.map((b) => b.vehicle.id) } } }),
    ]);
    const settingsBy = new Map(companies.map((c) => [c.id, parseCompanySettings(c.settings).telematics]));
    const controlBy = new Map(companies.map((c) => [c.id, { settings: parseCompanySettings(c.settings).control, timezone: c.timezone }]));
    const fuelBy = new Map(companies.map((c) => [c.id, parseCompanySettings(c.settings).fuelControl]));
    const diagBy = new Map(companies.map((c) => [c.id, parseCompanySettings(c.settings).diagnostics]));
    const diagRows = new Map((await tx.vehicleDiagnostics.findMany({ where: { vehicleId: { in: batches.map((b) => b.vehicle.id) } } })).map((d) => [d.vehicleId, d]));
    const restricted = new Map(fences.filter((f) => f.category === 'RESTRICTED').map((f) => [f.id, f.name]));
    const fencesBy = new Map<string, Fence[]>();
    for (const f of fences) {
      const list = fencesBy.get(f.companyId) ?? [];
      list.push({ ...f, polygon: f.polygon as [number, number][] | null });
      fencesBy.set(f.companyId, list);
    }
    const stateBy = new Map(states.map((s) => [s.vehicleId, s]));
    const vehicleIds = batches.map((b) => b.vehicle.id);
    const driverBy = await this.currentDrivers(tx, vehicleIds);
    const [ongoing, duty] = await Promise.all([
      tx.trip.findMany({ where: { vehicleId: { in: vehicleIds }, status: 'ONGOING' }, select: { id: true, tripNo: true, vehicleId: true, updatedAt: true, routeGeometry: true, routingSource: true } }),
      tx.dutySession.findMany({ where: { driverId: { in: [...new Set(driverBy.values())] }, endedAt: null }, select: { driverId: true } }),
    ]);
    const tripBy = new Map(ongoing.map((t) => [t.vehicleId!, { id: t.id, tripNo: t.tripNo, route: routeOf(t) }]));
    const onDuty = new Set(duty.map((d) => d.driverId));

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
      let control = toControl(stateBy.get(vehicle.id));
      let fuel = toFuel(stateBy.get(vehicle.id));
      const tankL = vehicle.tankCapacityL == null ? null : Number(vehicle.tankCapacityL);
      const d0 = diagRows.get(vehicle.id);
      let diag: (Diagnostics & { at: Date; fuelLevelL: number | null }) | null = d0
        ? { dtcCodes: d0.dtcCodes, checkEngine: d0.checkEngine, coolantTempC: d0.coolantTempC, batteryV: d0.batteryV, engineHours: d0.engineHours, at: d0.recordedAt, fuelLevelL: d0.fuelLevelL }
        : null;
      let diagChanged = false;
      const ctl = controlBy.get(vehicle.companyId)!;
      const driverId = driverBy.get(vehicle.id) ?? null;
      for (const fix of [...fixes].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
        const prevAt = state.lastFixAt;
        const r = evaluate(state, fix, ctx);
        state = r.state;
        if (!prevAt || fix.recordedAt > prevAt) {
          const c = evaluateControl(control, fix, {
            settings: ctl.settings,
            timezone: ctl.timezone,
            trip: tripBy.get(vehicle.id) ?? null,
            driverId,
            driverOnDuty: !!driverId && onDuty.has(driverId),
            enteredRestricted: r.opened.filter((e) => e.type === 'GEOFENCE_ENTER' && e.geofenceId && restricted.has(e.geofenceId)).map((e) => ({ id: e.geofenceId!, name: restricted.get(e.geofenceId!)! })),
          });
          control = c.state;
          r.opened.push(...c.opened);
          r.closed.push(...c.closed);
          // Fuel level sensor and engine diagnostics (device attributes).
          const litres = fuelLevelL(fix.attributes, tankL);
          const f = evaluateFuelLevel(fuel, fix, litres, fuelBy.get(vehicle.companyId)!);
          fuel = f.state;
          r.opened.push(...f.opened);
          const dNow = readDiagnostics(fix.attributes);
          if (dNow) {
            r.opened.push(...diagnosticEvents(diag, dNow, fix, diagBy.get(vehicle.companyId)!));
            diag = { ...dNow, at: fix.recordedAt, fuelLevelL: fuel.level };
            diagChanged = true;
          } else if (litres != null && diag) {
            diag = { ...diag, at: fix.recordedAt, fuelLevelL: fuel.level };
            diagChanged = true;
          } else if (litres != null) {
            diag = { dtcCodes: [], checkEngine: null, coolantTempC: null, batteryV: null, engineHours: null, at: fix.recordedAt, fuelLevelL: fuel.level };
            diagChanged = true;
          }
        }
        events.push(
          ...r.opened.map((e) => ({
            ...e,
            companyId: vehicle.companyId,
            vehicleId: vehicle.id,
            plateNumber: vehicle.plateNumber,
            driverId: driverBy.get(vehicle.id) ?? null,
          })),
        );
        closes.push(...r.closed);
      }
      await this.saveState(tx, vehicle, state, control, fuel);
      if (diag && diagChanged) {
        const data = { companyId: vehicle.companyId, recordedAt: diag.at, dtcCodes: diag.dtcCodes, checkEngine: diag.checkEngine, coolantTempC: diag.coolantTempC, batteryV: diag.batteryV, engineHours: diag.engineHours, fuelLevelL: diag.fuelLevelL };
        await tx.vehicleDiagnostics.upsert({ where: { vehicleId: vehicle.id }, create: { vehicleId: vehicle.id, ...data }, update: data });
      }
    }
    await this.persist(tx, events, closes);
    await this.followUps(tx, events);
    return events;
  }

  /**
   * Side effects of S13 events: a sensor refill is compared with the fills recorded around it (missing or
   * smaller fills are flagged), and trouble codes marked for auto-repair open a repair request.
   */
  private async followUps(tx: Tx, events: PersistedEvent[]) {
    for (const e of events) {
      if (e.type === 'FUEL_REFILL') {
        const litres = Number((e.data as { litres?: number } | undefined)?.litres ?? 0);
        const tol = parseCompanySettings((await tx.company.findUniqueOrThrow({ where: { id: e.companyId }, select: { settings: true } })).settings).fuelControl.refillToleranceL;
        const recs = await tx.fuelRecord.findMany({ where: { vehicleId: e.vehicleId, filledAt: { gte: new Date(e.occurredAt.getTime() - 3 * 3_600_000), lte: new Date(e.occurredAt.getTime() + 3 * 3_600_000) } } });
        const recorded = recs.reduce((s, r) => s + Number(r.litres), 0);
        const verdict = !recs.length ? 'NOT_RECORDED' : recorded + tol < litres ? 'UNDER_RECORDED' : recorded > litres + tol ? 'OVER_RECORDED' : 'OK';
        await tx.telemetryEvent.update({ where: { id: e.id }, data: { data: { ...(e.data ?? {}), recordedLitres: Math.round(recorded * 10) / 10, verdict } as Prisma.InputJsonValue } });
        if (verdict === 'OVER_RECORDED') for (const r of recs) if (!r.flags.includes('SENSOR_MISMATCH')) await tx.fuelRecord.update({ where: { id: r.id }, data: { flags: [...r.flags, 'SENSOR_MISMATCH'] } });
        if (verdict !== 'OK') {
          e.notify = true;
          (e.data as Record<string, unknown>).verdict = verdict;
          (e.data as Record<string, unknown>).recordedLitres = Math.round(recorded * 10) / 10;
        }
      }
      if (e.type === 'ENGINE_FAULT' && (e.data as { autoRepair?: boolean } | undefined)?.autoRepair) {
        const code = String((e.data as { code?: string }).code);
        const open = await tx.repairRequest.findFirst({ where: { vehicleId: e.vehicleId, status: 'OPEN', description: { contains: code } } });
        if (!open)
          await tx.repairRequest.create({
            data: { companyId: e.companyId, vehicleId: e.vehicleId, description: `Engine fault ${code} reported by the GPS device (raised automatically).`, severity: 'HIGH' },
          });
      }
    }
  }

  /**
   * Who is driving each vehicle now: the driver of its ONGOING trip, otherwise
   * the driver of its open standing assignment.
   */
  async currentDrivers(tx: Tx, vehicleIds: string[]): Promise<Map<string, string>> {
    if (!vehicleIds.length) return new Map();
    const [trips, assignments] = await Promise.all([
      tx.trip.findMany({ where: { vehicleId: { in: vehicleIds }, status: 'ONGOING', driverId: { not: null } }, select: { vehicleId: true, driverId: true } }),
      tx.vehicleAssignment.findMany({ where: { vehicleId: { in: vehicleIds }, endAt: null, driverId: { not: null } }, select: { vehicleId: true, driverId: true } }),
    ]);
    const m = new Map<string, string>();
    for (const a of assignments) m.set(a.vehicleId, a.driverId!);
    for (const t of trips) m.set(t.vehicleId!, t.driverId!); // trip wins
    return m;
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
      case 'OFF_ROUTE':
        return {
          severity: 'warning',
          title: `${e.plateNumber} off route${e.data?.tripNo ? ` on ${e.data.tripNo}` : ''}`,
          body: `${e.plateNumber} has been more than ${e.data?.limitM} m from the planned route since ${time} UTC (${e.data?.distanceM} m away).`,
        };
      case 'UNAUTHORISED_MOVEMENT':
        return { severity: 'critical', title: `${e.plateNumber} moving without a trip`, body: `${e.plateNumber} has driven ${e.data?.km} km without an ongoing trip (since ${time} UTC).` };
      case 'AFTER_HOURS':
        return { severity: 'warning', title: `${e.plateNumber} used outside working hours`, body: `${e.plateNumber} was moving at ${time} UTC, outside the company's working hours.` };
      case 'NO_DRIVER':
        return { severity: 'critical', title: `${e.plateNumber} moving without a driver on duty`, body: `${e.plateNumber} was moving at ${time} UTC: ${e.data?.reason}.` };
      case 'FUEL_DROP':
        return { severity: 'critical', title: `${e.plateNumber} fuel level dropped ${e.data?.litres} L while parked`, body: `The fuel sensor of ${e.plateNumber} dropped from ${e.data?.from} L to ${e.data?.to} L at ${time} UTC with the vehicle stationary. Check for fuel theft or a leak.` };
      case 'FUEL_REFILL':
        return {
          severity: 'warning',
          title: `${e.plateNumber} refill of ${e.data?.litres} L ${e.data?.verdict === 'NOT_RECORDED' ? 'not recorded' : 'does not match the recorded fill'}`,
          body: `The fuel sensor of ${e.plateNumber} shows a refill of ${e.data?.litres} L at ${time} UTC; ${e.data?.recordedLitres ?? 0} L were recorded in FMS within 3 hours.`,
        };
      case 'ENGINE_FAULT':
        return {
          severity: 'warning',
          title: `${e.plateNumber} engine fault${e.data?.code ? ` ${e.data.code}` : e.data?.kind === 'COOLANT_HOT' ? ': engine overheating' : e.data?.kind === 'BATTERY_LOW' ? ': battery low' : ''}`,
          body: `${e.plateNumber} reported ${e.data?.code ? `trouble code ${e.data.code}` : `${String(e.data?.kind).toLowerCase().replace('_', ' ')} (${e.data?.value} vs limit ${e.data?.limit})`} at ${time} UTC.${e.data?.autoRepair ? ' A repair request was opened.' : ''}`,
        };
      case 'RESTRICTED_AREA':
        return { severity: 'critical', title: `${e.plateNumber} entered restricted area ${e.data?.geofence}`, body: `${e.plateNumber} entered the restricted area "${e.data?.geofence}" at ${time} UTC.` };
      default:
        return { severity: 'info', title: `${e.plateNumber} ${e.type}`, body: `${e.type} at ${time} UTC.` };
    }
  }

  private async saveState(tx: Tx, vehicle: VehicleRef, s: RuleState, c: ControlState, f: FuelLevelState) {
    const data = { ...s, ...c, fuelSamples: f.samples as unknown as Prisma.InputJsonValue, fuelLevelL: f.level, fuelRiseFrom: f.riseFrom, fuelDropFrom: f.dropFrom, companyId: vehicle.companyId };
    await tx.vehicleTelemetryState.upsert({ where: { vehicleId: vehicle.id }, create: { vehicleId: vehicle.id, ...data }, update: data });
  }

  private async persist(tx: Tx, events: PersistedEvent[], closes: EventClose[]) {
    if (events.length) {
      await tx.telemetryEvent.createMany({
        data: events.map((e) => ({
          id: e.id,
          companyId: e.companyId,
          vehicleId: e.vehicleId,
          driverId: e.driverId ?? null,
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
      for (const e of events) {
        const hook = WEBHOOK_FOR[e.type];
        if (!hook) continue;
        await this.webhooks.emit(tx, e.companyId, hook, {
          eventId: e.id,
          type: e.type,
          vehicle: { id: e.vehicleId, plateNumber: e.plateNumber },
          driverId: e.driverId ?? null,
          occurredAt: e.occurredAt,
          latitude: e.latitude ?? null,
          longitude: e.longitude ?? null,
          speedKmh: e.speedKmh ?? null,
          geofenceId: e.geofenceId ?? null,
          data: e.data ?? null,
        });
      }
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
