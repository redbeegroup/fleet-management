# Architecture

## Overview

```
                       ┌───────────────── Users ──────────────────┐
                       │ Web console (admin, fleet manager,       │
                       │ dispatch, executive) · Driver app (Expo) │
                       └───────────────┬──────────────────────────┘
                                       │ HTTPS
                          ┌────────────▼────────────┐
                          │ Ingress / nginx (web)   │  /api → api, / → SPA
                          └──────┬──────────────────┘
                                 │
        ┌────────────────────────▼─────────────────────────┐
        │ fms/api image (NestJS modular monolith)          │
        │  MODE=api     REST + OpenAPI, RBAC, audit        │
        │  MODE=worker  BullMQ jobs: alerts, partitions,   │
        │               reports                            │
        │  MODE=ingest  Watch Tower poller (leader lock)   │
        └──────┬───────────────────────┬───────────────────┘
               │                       │
     ┌─────────▼─────────┐   ┌─────────▼─────────┐      ┌──────────────────────┐
     │ PostgreSQL 16     │   │ Redis 7           │      │ Integrations         │
     │ RLS per company   │   │ queues, locks,    │      │ Watch Tower API      │
     │ partitioned GPS   │   │ cache             │      │ SAP S/4HANA (Ph. 3)  │
     └───────────────────┘   └───────────────────┘      │ DMS/TMS, fuel cards, │
                                                        │ BI, AI service       │
                                                        └──────────────────────┘
```

## Code layout

```
apps/api/src
├─ main.ts                    # bootstraps api | worker | ingest from MODE
├─ app.module.ts              # ApiAppModule, WorkerAppModule, IngestAppModule
├─ common/
│  ├─ auth/                   # AuthGuard (JWT + RBAC), decorators
│  ├─ audit/                  # AuditInterceptor → audit_logs
│  ├─ config/env.ts           # zod-validated environment
│  ├─ db/prisma.service.ts    # tenant() / system() transactions
│  ├─ health/                 # /api/health/live, /api/health/ready
│  ├─ http/                   # ZodPipe, Prisma error filter
│  └─ redis/
├─ modules/
│  ├─ iam/                    # auth, company, branches, departments, users, audit
│  ├─ vehicles/
│  ├─ drivers/
│  ├─ telematics/             # providers/ (TelematicsProvider, WatchTower, Mock)
│  ├─ files/                  # StorageDriver (local | s3), upload/download
│  └─ notifications/          # in-app notifications, channels (log, email)
└─ worker/                    # job processor, compliance alerts, ingest runner
```

Future modules follow the same pattern: `dispatch`, `fuel`, `maintenance`, `costs`, `analytics`, `logistics`, `compliance`, `inventory`, `workflow`, `integrations`.

## Multi-tenancy and Row-Level Security

Every tenant-owned table has `company_id`. Isolation is enforced twice:

1. **Application:** every request-scoped query runs inside `PrismaService.tenant(companyId, fn)`, an interactive transaction that first executes `set_config('app.company_id', <id>, true)`.
2. **Database:** each table has `ENABLE` + `FORCE ROW LEVEL SECURITY` with the policy
   `fms_rls_bypass() OR company_id = fms_current_company()`.
   A query that forgets the scope returns nothing rather than another company's rows. The e2e suite checks this (`isolates tenants`).

`PrismaService.system(fn)` sets `app.bypass_rls = on`. It is used only for login (the tenant is not yet known), the refresh-token store, audit writes, telemetry ingest and background jobs.

> PostgreSQL superusers always bypass RLS. The application must connect as a **non-superuser** role (`fms_app`). Migrations run as the owner or migrator role. Compose, CI and the Helm chart all follow this.
>
> `app.bypass_rls` is a session setting, so RLS protects against *missing* scoping (programming errors), not against arbitrary SQL injection. For stronger separation, a later hardening step moves `system()` work to a dedicated role with `BYPASSRLS`, leaving `fms_app` with no bypass path.

Group-level users who need consolidated views across companies (a holding company) are planned for S6, through an explicit `company_ids` scope list. Shared rows are never used for this.

## Authentication and authorization

- `POST /api/auth/login` issues a 15-minute JWT access token (`sub`, `cid`, `email`, `roles`) and an opaque refresh token. Only the refresh token's SHA-256 is stored.
- `POST /api/auth/refresh` rotates the token. Presenting an already-revoked token revokes all of the user's active tokens (theft detection).
- Roles map to permissions in `packages/shared/src/permissions.ts`. Endpoints declare `@RequirePermissions(...)`, and the global `AuthGuard` enforces them.
- Login is rate-limited (10 per minute per IP), with a global throttle of 300 per minute.

## Telemetry pipeline

```
Watch Tower API ──poll (since=last)──► IngestRunner (leader via Redis SET NX EX)
                                          │ PositionFix[]
                                          ▼
                                   TelematicsService.ingest
                                   • map gpsDeviceId → vehicle
                                   • batch INSERT vehicle_positions (partitioned by month)
                                   • upsert vehicle_last_positions
                                          │
                       /api/tracking/live ◄┘  /api/tracking/vehicles/:id/history
```

- `vehicle_positions` has a primary key of `(vehicle_id, recorded_at)`, so duplicates are ignored. The worker creates the current and next month's partitions every day. A DEFAULT partition catches out-of-range rows.
- **Rules engine** (`rules/rules-engine.ts`): a pure function `evaluate(state, fix, context) → { state, opened, closed }` applied to each fix in time order. State per vehicle lives in `vehicle_telemetry_state`; events in `telemetry_events` (episodes such as overspeed/idle get `ended_at` when they end). Thresholds come from `companies.settings.telematics` and `vehicles.speed_limit_kmh`. Geometry is in-app (haversine, ray casting), so PostGIS is optional.
- **Live push:** after the ingest transaction commits, positions and events are published to Redis channels `fms:live:<companyId>` / `fms:events:<companyId>`. The `LiveGateway` (socket.io, path `/api/socket.io`) in every API pod pattern-subscribes and emits to the `company:<id>` room. Clients authenticate with the access token in the handshake and are disconnected when it expires (the web client refreshes and reconnects).
- **GPS offline:** the worker runs `gps-offline` every 5 minutes.
- To use another GPS platform or a raw device gateway, implement `TelematicsProvider` and select it with `TELEMATICS_PROVIDER`.

## Data model (current)

`companies` (with `settings`), `company_counters`, `incidents`, `insurance_claims`, `inspection_templates`, `inspections`, `training_courses`, `driver_trainings`, `driver_adjustments`, `vehicle_expenses`, `vehicle_daily_stats`, `user_devices`, `fuel_records`, `maintenance_plans`, `repair_requests`, `work_orders`, `work_order_lines`, `trips`, `trip_status_events`, `duty_sessions`, `branches`, `departments`, `users`, `refresh_tokens`, `audit_logs`, `files`, `notifications`, `vehicles`, `vehicle_status_events`, `vehicle_documents`, `vehicle_assignments`, `drivers`, `driver_licenses`, `geofences`, `telemetry_events`, `vehicle_telemetry_state`, `vehicle_last_positions`, `vehicle_positions` (partitioned).

The source of truth is `apps/api/prisma/schema.prisma` plus `prisma/migrations/*`. The RLS and partitioning SQL is in the second migration.

## Files

`POST /api/files` (multipart `file`) → magic-number sniffing (PDF, JPEG, PNG, WebP, HEIC), size limit `FILE_MAX_MB`, stored under `<companyId>/<yyyy>/<mm>/<uuid>` in the configured `StorageDriver`, metadata (name, type, size, SHA-256) in `files`. `GET /api/files/:id` streams the object after an RLS-scoped lookup — storage is never exposed directly. Documents and licences reference files by `fileId`; `FilesService.assertOwned` checks ownership because PostgreSQL foreign-key checks bypass RLS.

## Notifications

`NotificationsService.notify()` resolves recipients (explicit users, or users holding the given roles; default super/company admins and fleet managers), inserts one `notifications` row per user with `skipDuplicates` on `(user_id, dedupe_key)`, and then fans *newly created* notifications out to channels. The email channel sends warning/critical only. Users read their own notifications via `/api/notifications`.

## Dispatch

`modules/dispatch`: `TripsService` (lifecycle, availability), `DutyService` (attendance), `MeController` (driver self-service; every call resolves the driver linked to the signed-in user). Assignment validation runs inside the tenant transaction after `SELECT … FOR UPDATE` on the vehicle and driver rows, which serialises competing bookings without needing the `btree_gist` extension. Trip numbers come from `company_counters` (atomic upsert-increment).

## Fuel & maintenance

- `modules/fuel/efficiency.ts` (pure): full-to-full km/L and anomaly flags. `FuelService` re-runs it over a vehicle's whole chain after every insert/delete, so back-dated entries are handled.
- `modules/maintenance/due.ts` (pure): plan due status (distance or time, whichever first) and minutes-in-status for downtime. `MaintenanceService` owns plans, repair requests and work orders; vehicle status changes go through `common/vehicle-status.ts`, which validates the transition and writes the status history that downtime reporting relies on.

## Analytics

KPIs never scan raw positions at request time. `fms_rollup_daily_stats(from, to)` (SQL, window functions + haversine, GPS jumps > 250 km/h excluded, gaps > 10 min not counted as engine time) fills `vehicle_daily_stats` per vehicle and company-local day. `AnalyticsService.overview` combines it with fuel, work orders, expenses, trips, overspeed events and the status history, and `kpis.ts` (pure) turns those aggregates into fleet / vehicle / branch KPIs.

## Driver safety

- Harsh-driving detection is step 6 of the rules engine (`rules/harsh.ts`): computed from consecutive fixes when they are dense enough, or mapped from device events, which win. Events carry `data = { value, unit, source: gps|device }` and are not pushed as notifications individually.
- `telemetry_events.driver_id` is resolved at ingest (`TelemetryRulesService.currentDrivers`: ONGOING trip driver, else open assignment).
- `SafetyService` scores drivers over company-local days from `vehicle_daily_stats` (distance), trips/assignments (attribution, `score.ts#attributeDistance`) and grouped events. Weights and thresholds live in `companies.settings.safety`.
- `IncidentsService`: incident numbers `INC-<year>-NNNNNN` and claim numbers `CLM-<year>-NNNNNN` from `company_counters`; status flows validated server-side; photos are `files` checked with `FilesService.assertOwned`.

## Inspections, training, incentives

- Inspection numbers `INS-<year>-NNNNNN`; results PASS / DEFECTS / FAIL from `inspections/evaluate.ts`. The pre-trip gate (`InspectionsService.assertPreTrip`) runs inside the trip-start transaction.
- Training status is derived (never stored) from the record with the latest expiry per driver and course.
- Incentive approval is segregated: `incentive:write` (fleet managers) proposes, `incentive:approve` (company admins) decides, and the service refuses a decision by the proposer.

## Background jobs

| Job | Schedule | Purpose |
|---|---|---|
| `compliance-alerts` | daily 01:30 Asia/Yangon | documents and licences expiring within `DOC_EXPIRY_ALERT_DAYS`; mandatory training certificates expiring within `incentives.trainingAlertDays` |
| `position-partitions` | daily 02:00 UTC | ensure the current and next monthly partitions |
| `gps-offline` | every 5 min | open GPS_OFFLINE events for silent vehicles |
| `maintenance-due` | daily 02:00 Asia/Yangon | due-soon / overdue preventive maintenance alerts |
| `incentives-monthly` | 1st of the month 08:00 Asia/Yangon | propose last month's safety bonuses (when enabled) |
| `safety-alerts` | daily 07:30 Asia/Yangon | drivers below `safety.alertBelow` over the last 30 days (once per week per driver) |
| `daily-stats` | every 30 min | roll GPS positions up into `vehicle_daily_stats` (last 3 local days) |

BullMQ job schedulers are idempotent, so several worker replicas are safe. Any job can also be run once with `MODE=job JOB=<name>` (e.g. `docker compose run --rm -e MODE=job -e JOB=compliance-alerts api`, or a Kubernetes CronJob).

## Extension points

| Interface | Location | Planned implementations |
|---|---|---|
| `TelematicsProvider` | `modules/telematics/providers` | Watch Tower ✅, mock ✅, other platforms |
| `NotificationChannel` | `modules/notifications` | log ✅, SMTP, FCM push, Viber/Telegram/SMS |
| `ErpConnector` | `modules/integrations` (Phase 3) | SAP S/4HANA (finance postings, assets, procurement) |
| `FuelCardProvider` | `modules/fuel` (Phase 2) | per provider |
| `DmsTmsConnector` | `modules/integrations` (Phase 3) | order/trip sync |
