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
│  └─ notifications/          # NotificationChannel registry
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
- Sprint 3 adds a geofence / speed / idle / offline rules engine over each ingest batch, which emits domain events to notifications. It also adds a WebSocket gateway so the live map stops polling.
- To use another GPS platform or a raw device gateway, implement `TelematicsProvider` and select it with `TELEMATICS_PROVIDER`.

## Data model (current)

`companies`, `branches`, `departments`, `users`, `refresh_tokens`, `audit_logs`, `vehicles`, `vehicle_status_events`, `vehicle_documents`, `vehicle_assignments`, `drivers`, `driver_licenses`, `vehicle_last_positions`, `vehicle_positions` (partitioned).

The source of truth is `apps/api/prisma/schema.prisma` plus `prisma/migrations/*`. The RLS and partitioning SQL is in the second migration.

## Background jobs

| Job | Schedule | Purpose |
|---|---|---|
| `compliance-alerts` | daily 01:30 Asia/Yangon | documents and licences expiring within `DOC_EXPIRY_ALERT_DAYS` |
| `position-partitions` | daily 02:00 UTC | ensure the current and next monthly partitions |

BullMQ job schedulers are idempotent, so several worker replicas are safe.

## Extension points

| Interface | Location | Planned implementations |
|---|---|---|
| `TelematicsProvider` | `modules/telematics/providers` | Watch Tower ✅, mock ✅, other platforms |
| `NotificationChannel` | `modules/notifications` | log ✅, SMTP, FCM push, Viber/Telegram/SMS |
| `ErpConnector` | `modules/integrations` (Phase 3) | SAP S/4HANA (finance postings, assets, procurement) |
| `FuelCardProvider` | `modules/fuel` (Phase 2) | per provider |
| `DmsTmsConnector` | `modules/integrations` (Phase 3) | order/trip sync |
