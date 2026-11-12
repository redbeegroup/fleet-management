# Fleet Management System — Development Plan

> Status: **Phase 1 / Sprint 1 scaffold delivered** (see [§8](#8-current-status)). Timelines are indicative, not a validated estimate.

## 1. Product goals

The FMS answers five management questions:

| Question | Answered by |
|---|---|
| Where are our vehicles? | GPS & Telematics (Watch Tower integration), live map, trip history, geofences |
| Are they being used efficiently? | Utilization, availability, downtime, trips/deliveries per vehicle, load utilization |
| What do they cost? | Fuel, maintenance and operating-cost ledger, cost per km / trip / delivery, TCO |
| Are drivers performing safely? | Behaviour events, safety score, incidents, licence compliance |
| How can we reduce operating expenses? | Variance and anomaly detection, replacement ROI, AI recommendations |

**Positioning.** A general-purpose FMS core with optional *industry modules* (FMCG distribution, transport logistics, corporate fleet). Multi-company, tenant isolation and configurable workflows are built in from day one so the same product serves group companies and external SaaS customers.

**Three layers.**

1. **Fleet Visibility** — GPS, trips, geofences, telematics, driver safety. Builds on the existing **Watch Tower** platform through an adapter instead of re-implementing tracking.
2. **Fleet Operations** — assignment, dispatch, maintenance, fuel, logistics, operating cost.
3. **Fleet Intelligence** — analytics, optimization, predictive maintenance, executive reporting (can integrate with Oriona AI).

## 2. Technology decisions

| Area | Choice | Why |
|---|---|---|
| Backend | **NestJS 10 (TypeScript)** modular monolith | Clear module boundaries, one deployable; modules can be split into services later |
| Processes | One image, `MODE=api \| worker \| ingest` | API scales horizontally; worker runs BullMQ jobs; ingest polls Watch Tower with Redis leader election |
| Database | **PostgreSQL 16** (+ PostGIS where available) via **Prisma** | Works on the pre-installed production cluster; no TimescaleDB dependency |
| Telemetry storage | Native monthly **range partitions** (`vehicle_positions`) + `vehicle_last_positions` | Cheap retention (drop partition), fast live map |
| Tenant isolation | `company_id` on every table + **PostgreSQL Row-Level Security** (FORCE) | Defence in depth: a missing `WHERE` cannot leak another company's data |
| Queue / cache | **Redis 7** + BullMQ | Scheduled jobs, alerts, ingest leader lock, future Socket.IO adapter |
| Web | **React 18 + Vite**, TanStack Query, React Router, **MapLibre GL** | Admin, fleet manager, dispatch console, executive views (role-driven) |
| Mobile | **React Native (Expo)** driver app; later fleet-manager app | Shares TypeScript types; offline queue via SQLite (Phase 2) |
| Auth | JWT access token (15 min) + rotating refresh tokens with reuse detection, Argon2id; **OIDC / Entra ID** in Phase 3 | |
| AI (Phase 4) | Separate Python `ai-service` on read replicas / analytics views | Keeps ML dependencies out of the core |
| Deployment | **Docker Compose** for test (DB in Docker); **Helm on Kubernetes** for production with the **external PostgreSQL cluster** | See [DEPLOYMENT.md](DEPLOYMENT.md) |

Architecture details: [ARCHITECTURE.md](ARCHITECTURE.md).

## 3. Roadmap overview

| Phase | Months | Theme | Main deliverables |
|---|---|---|---|
| **1 — MVP** | 1–3 | Fleet foundation | Platform, vehicle registry, drivers, GPS monitoring via Watch Tower, scheduling & trips, fuel records, basic maintenance, cost/km, fleet dashboard, driver app v1 |
| **2 — Operations** | 4–6 | Operational management | Dispatch console, route planning, logistics & ePOD, repairs & work orders, driver safety, budgets & cost analytics, inspections, offline mobile, approval workflows, APIs & webhooks |
| **3 — Advanced** | 7–9 | Integration & depth | SAP S/4HANA, DMS/TMS, BI, SSO, inventory/tires/workshops/warranty, compliance, benchmarking, scheduled reports, lifecycle |
| **4 — Intelligent fleet** | 10–12+ | AI & optimization | Predictive maintenance, anomaly detection, AI assistant, AI dispatch/route/load, replacement & cost recommendations, agentic proposals |

AI predictive features start only once ≥ 6 months of reliable operational data exist (data-quality gate at the end of Phase 3).

### Phase 1 sprint plan (2-week sprints)

| Sprint | Scope | Exit criteria |
|---|---|---|
| **S1 — Platform** | Monorepo, CI, Docker Compose, Helm chart, Prisma baseline, JWT auth, companies/branches/departments, RBAC, audit log, RLS, seed | `docker compose up` gives a working login; tenant-isolation e2e passes ✅ |
| **S2 — Vehicles & drivers** | Vehicle registry/class/assignment/status/documents + expiry alerts; driver profiles & licences; file uploads (S3-compatible store) | Fleet manager can register a fleet and get expiry alerts |
| **S3 — Telematics** | Watch Tower adapter hardening (confirm API contract), live map via WebSocket, trip playback, geofences + entry/exit, overspeed, idling, ignition, GPS-offline alerts | Live map for the whole fleet; alerts delivered |
| **S4 — Scheduling & trips** | Vehicle scheduling calendar, driver assignment, availability check, trip lifecycle, actual departure/arrival/distance reconciled with GPS odometer | Dispatcher plans and closes trips |
| **S5 — Fuel & maintenance** | Fuel records, km/L & L/100 km, refill history; PM plans (km/time), due/overdue alerts, repair requests, work orders, maintenance history & cost, downtime | Monthly fuel & maintenance report per vehicle |
| **S6 — Costs, dashboard, mobile** | Operating-cost ledger, cost/km, maintenance cost analysis, fleet overview dashboard, driver app (trips, start/end, notifications), email/push notifications; UAT & Docker test release | MVP accepted in UAT |

## 4. Feature backlog by module

Legend — Priority: P1 essential, P2 operational, P3 advanced/AI. Phase/Sprint: when it is built. Status: ✅ delivered, 🟡 partial/skeleton, ⏳ planned.

### Module 1 — Vehicle & Asset Management (`vehicles`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Vehicle registration | P1 | 1 / S1–S2 | ✅ CRUD, plate normalisation, unique per company, soft delete |
| Vehicle classification | P1 | 1 / S1 | ✅ truck, van, car, pickup, bus, motorcycle, trailer, other |
| Vehicle assignment (branch / department / driver) | P1 | 1 / S1–S2 | ✅ assignment history, one vehicle per driver |
| Vehicle status | P1 | 1 / S1 | ✅ state machine + status history |
| Document management | P1 | 1 / S2 | ✅ metadata, scans/photos (PDF, JPEG, PNG, WebP, HEIC) via S3-compatible storage |
| Document expiry alerts | P1 | 1 / S2 | ✅ daily scan, 30/14/7/1-day + expired thresholds, renewal-aware, in-app + email |
| Vehicle history | P1 | 1 / S2–S5 | 🟡 consolidated timeline (status, assignments, documents); trips, fuel and maintenance join as they ship |
| Vehicle lifecycle (acquisition → disposal) | P2 | 3 | ⏳ (acquired/disposed dates already stored) |
| Asset & equipment tracking (trailers, containers) | P2 | 3 | ⏳ |
| Vehicle replacement planning | P3 | 4 | ⏳ |

### Module 2 — GPS Tracking & Telematics (`telematics`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Real-time GPS tracking | P1 | 1 / S3 | ✅ Watch Tower adapter + mock, ingest, live map pushed over WebSocket |
| Trip history | P1 | 1 / S3 | ✅ playback with distance, driving time, max/avg speed, stops and events |
| Geofencing | P1 | 1 / S3 | ✅ circle + polygon, map editor, no PostGIS dependency |
| Entry/exit alerts | P1 | 1 / S3 | ✅ per-fence alert flags |
| Speed monitoring & overspeed alerts | P1 | 1 / S3 | ✅ episodes with hysteresis, company limit + per-vehicle override |
| Ignition monitoring | P1 | 1 / S3 | ✅ ignition on/off events |
| Idling monitoring | P1 | 1 / S3 | ✅ engine on + stationary ≥ threshold, with duration |
| GPS offline alerts | P1 | 1 / S3 | ✅ worker check every 5 min, restored event |
| Route deviation | P2 | 2 | ⏳ |
| Unauthorized vehicle usage | P2 | 2 | ⏳ |
| Engine diagnostics (OBD/CAN) | P2 | 2 | ⏳ via Watch Tower where devices support it |
| Remote immobilization (with safety controls) | P3 | 4 | ⏳ dual approval + audit, only when stationary |

### Module 3 — Fleet Scheduling & Dispatch (`dispatch`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Vehicle scheduling | P1 | 1 / S4 | ✅ dispatch board (vehicle × time), day/3-day/week |
| Driver assignment | P1 | 1 / S4 | ✅ per trip, with availability and licence checks; standing vehicle↔driver assignment |
| Trip management | P1 | 1 / S4 | ✅ create, edit, assign, start, complete, cancel; numbered per company |
| Dispatch management | P1 | 1 / S4 | ✅ dispatch board + driver notifications on assignment |
| Vehicle & driver availability | P1 | 1 / S4 | ✅ overlap, vehicle status, licence validity/class, with reasons; row locks prevent double booking |
| Trip status | P1 | 1 / S4 | ✅ state machine + status history |
| Trip completion (actuals) | P1 | 1 / S4 | ✅ actual times, odometer, GPS distance; vehicle odometer/status updated |
| Vehicle capacity | P2 | 2 | 🟡 kg / m³ stored on vehicle |
| Multi-stop routing | P2 | 2 | ⏳ |
| Route optimization | P2 | 2 | ⏳ OSRM + VROOM containers |
| Dynamic dispatch | P3 | 4 | ⏳ |
| AI dispatch recommendation | P3 | 4 | ⏳ |

### Module 4 — Fuel Management (`fuel`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Fuel consumption recording | P1 | 1 / S5 | ✅ web + driver app API, receipt scans |
| Fuel expense tracking | P1 | 1 / S5 | ✅ per vehicle and fleet, per period |
| Fuel efficiency (km/L, L/100 km) | P1 | 1 / S5 | ✅ full-to-full method, recomputed on back-dated entries |
| Fuel refill history | P1 | 1 / S5 | ✅ date, odometer, litres, price, station, driver |
| Fuel budget | P2 | 2 | ⏳ |
| Consumption variance | P2 | 2 | ⏳ |
| Fuel fraud detection (rules) | P2 | 2 | 🟡 rules live: odometer backwards, refill > tank, low km/L vs median; GPS-location check in Phase 2 |
| Fuel card integration | P2 | 2 | ⏳ `FuelCardProvider` adapter |
| Fuel sensor integration | P2 | 2 | ⏳ via Watch Tower (GPS odometer already used) |
| AI fuel optimization | P3 | 4 | ⏳ |

### Module 5 — Maintenance & Repair (`maintenance`, `inventory`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Preventive maintenance (km / time) | P1 | 1 / S5 | ✅ per-vehicle plans, bulk creation, whichever-first |
| Maintenance alerts | P1 | 1 / S5 | ✅ daily due-soon / overdue alerts, once per cycle |
| Repair requests | P1 | 1 / S5 | ✅ staff and drivers (own vehicles), convert or reject |
| Work orders | P1 | 1 / S5 | ✅ numbered, start/complete/cancel, cost lines |
| Maintenance history | P1 | 1 / S5 | ✅ work orders + vehicle history timeline |
| Maintenance expenses | P1 | 1 / S5 | ✅ parts / labour / external per vehicle |
| Vehicle downtime | P1 | 1 / S5 | ✅ off-road work orders set UNDER_REPAIR; downtime report from status history |
| Spare parts inventory | P2 | 3 | ⏳ |
| Tire management | P2 | 3 | ⏳ |
| Workshop management | P2 | 3 | ⏳ |
| Warranty management | P2 | 3 | ⏳ |
| Predictive maintenance | P3 | 4 | ⏳ |

### Module 6 — Driver Management & Safety (`drivers`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Driver profile | P1 | 1 / S2 | ✅ |
| Driving licence management + expiry | P1 | 1 / S2 | ✅ licences with scans, expiry alerts to managers and the driver |
| Driver attendance | P1 | 1 / S4 | ✅ duty sessions (app or supervisor), daily attendance report |
| Driver assignment history | P1 | 1 / S2 | ✅ |
| Driver behaviour monitoring | P2 | 2 | ⏳ harsh accel/brake/corner from telematics |
| Driver performance score | P2 | 2 | ⏳ |
| Accident & incident reporting | P2 | 2 | ⏳ |
| Driver training & certification | P2 | 2 | ⏳ |
| Incentives & penalties (rules) | P2 | 2 | ⏳ |
| Fatigue monitoring | P3 | 4 | ⏳ hardware-dependent |
| AI dashcam integration | P3 | 4 | ⏳ |

### Module 7 — Logistics & Delivery (`logistics`, optional industry module)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Delivery order management | P1* | 2 | ⏳ |
| Vehicle loading plan | P1* | 2 | ⏳ |
| Delivery status | P1* | 2 | ⏳ |
| Delivery location tracking | P1* | 2 | ⏳ |
| Electronic proof of delivery | P2 | 2 | ⏳ photo, signature, timestamp, GPS |
| Delivery time monitoring | P2 | 2 | ⏳ |
| Failed delivery management | P2 | 2 | ⏳ |
| Return goods management | P2 | 2 | ⏳ |
| Digital cargo manifest | P2 | 2 | ⏳ |
| Loading/unloading time | P2 | 2 | ⏳ geofence dwell time |
| Delivery route optimization | P2 | 2 | ⏳ |
| AI load consolidation | P3 | 4 | ⏳ |

\* P1 for the FMCG distribution module; scheduled in Phase 2 because it depends on dispatch (S4) and is an optional industry module. If Myanmar Zarla's distribution rollout is the first customer, pull delivery orders + status forward into S6.

### Module 8 — Fleet Cost & Financial Management (`costs`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Vehicle operating cost | P1 | 1 / S6 | ⏳ unified cost ledger (fuel, maintenance, driver, other) |
| Cost per kilometre | P1 | 1 / S6 | ⏳ |
| Fleet expense dashboard | P1 | 1 / S6 | ⏳ |
| Maintenance cost analysis | P1 | 1 / S5–S6 | 🟡 cost & downtime report per vehicle; per-km in S6 |
| Budget vs actual | P2 | 2 | ⏳ |
| Total cost of ownership | P2 | 2 | ⏳ |
| Cost per trip | P2 | 2 | ⏳ |
| Cost per delivery | P2 | 2 | ⏳ |
| Internal cost allocation | P2 | 2 | ⏳ |
| Fleet profitability | P2 | 3 | ⏳ needs revenue from ERP/TMS |
| Vehicle replacement ROI | P3 | 4 | ⏳ |

### Module 9 — Fleet Performance & KPI (`analytics`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Fleet overview dashboard | P1 | 1 / S6 | 🟡 fleet size, availability, status breakdown, expiring documents |
| Vehicle utilization | P1 | 1 / S6 | ⏳ |
| Distance & trip analysis | P1 | 1 / S6 | ⏳ |
| Vehicle downtime | P1 | 1 / S6 | ⏳ |
| Fuel efficiency dashboard | P1 | 1 / S6 | ⏳ |
| Driver performance dashboard | P2 | 2 | ⏳ |
| Delivery efficiency | P2 | 2 | ⏳ |
| Branch fleet comparison | P2 | 3 | ⏳ |
| Vehicle productivity ranking | P2 | 3 | ⏳ |
| Benchmarking (same class) | P2 | 3 | ⏳ |
| Automated management reports | P2 | 3 | ⏳ daily/weekly/monthly PDF + email |
| AI executive insights | P3 | 4 | ⏳ |

### Module 10 — Compliance, Insurance & Incidents (`compliance`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Road tax & registration tracking | P1 | 1 / S2 | ✅ as vehicle document types with expiry |
| Insurance management | P1 | 1 / S2 | ✅ policy number, issuer, expiry, premium amount, policy scan |
| Driving licence compliance | P1 | 1 / S2–S4 | ✅ expiry alerts; licence class vs vehicle class enforced at dispatch (configurable) |
| Vehicle inspection checklist | P2 | 2 | ⏳ |
| Accident management | P2 | 2 | ⏳ |
| Insurance claims | P2 | 2 | ⏳ |
| Regulatory compliance (country config) | P2 | 3 | ⏳ |
| Safety audit | P2 | 3 | ⏳ |

### Module 11 — Mobile Applications (`apps/driver-app`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Driver mobile app | P1 | 1 / S6 | 🟡 Expo skeleton with login |
| Trip start/end | P1 | 1 / S6 | 🟡 API ready (`/api/me/trips/:id/start|complete`); app screens in S6 |
| Driver notifications (push) | P1 | 1 / S6 | ⏳ |
| Vehicle inspection | P2 | 2 | ⏳ |
| Fuel expense submission | P2 | 2 | ⏳ |
| Repair requests | P2 | 2 | ⏳ |
| Proof of delivery | P2 | 2 | ⏳ |
| Offline mode | P2 | 2 | ⏳ SQLite outbox + idempotency keys |
| Fleet manager mobile app | P2 | 2 | ⏳ |

### Module 12 — AI & Intelligent Automation (`ai-service`, Phase 4)

| Feature | Pri | Status |
|---|---|---|
| AI fleet assistant (natural language) | P3 | ⏳ LLM with read-only tools over FMS APIs |
| Predictive maintenance | P3 | ⏳ |
| AI route optimization | P3 | ⏳ |
| AI fuel analysis | P3 | ⏳ |
| AI driver risk analysis | P3 | ⏳ |
| AI vehicle utilization | P3 | ⏳ |
| AI cost optimization | P3 | ⏳ |
| AI anomaly detection | P3 | ⏳ |
| AI fleet replacement | P3 | ⏳ |
| AI executive reporting | P3 | ⏳ |
| Demand forecasting | P3 | ⏳ |
| Agentic fleet operations (propose → approve) | P3 | ⏳ actions go through the workflow engine; never auto-executed |

### Module 13 — Integrations & Administration (`iam`, `integrations`, `notifications`, `workflow`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| User & role management | P1 | 1 / S1 | ✅ 7 roles, permission-based guards |
| Multi-company & multi-branch | P1 | 1 / S1 | ✅ company/branch/department, RLS; consolidated group view in S6 |
| Audit logs | P1 | 1 / S1 | ✅ every mutating request, sensitive fields redacted |
| GPS device integration | P1 | 1 / S1–S3 | 🟡 `TelematicsProvider` + Watch Tower adapter |
| Notification engine | P1 | 1 / S2–S6 | 🟡 in-app + SMTP email, role-based recipients, dedupe; push in S6 |
| ERP integration (SAP S/4HANA) | P2 | 3 | ⏳ |
| DMS / TMS integration | P2 | 3 | ⏳ |
| BI integration (Tableau, Metabase) | P2 | 3 | ⏳ read-only reporting schema / replica |
| REST APIs & webhooks | P2 | 2 | 🟡 REST + OpenAPI done; API keys + webhooks in Phase 2 |
| SSO (Entra ID / OIDC) | P2 | 3 | ⏳ |
| Workflow & approval engine | P2 | 2 | ⏳ |
| Multi-tenant SaaS architecture | P2 | 2 | 🟡 tenant isolation done; onboarding/billing in Phase 2 |

## 5. KPIs

Implemented as SQL views / materialized views in `analytics`, refreshed by the worker. Each KPI ships once its source data exists.

| KPI | Formula (summary) | Phase |
|---|---|---|
| Fleet utilization % | engine-on (or trip) hours ÷ available hours | 1 |
| Fleet availability % | vehicles not UNDER_REPAIR ÷ active vehicles | 1 (✅ on dashboard) |
| Cost per km | total operating cost ÷ GPS distance | 1 |
| Fuel efficiency | km ÷ litres (and L/100 km) | 1 |
| Maintenance cost per km | maintenance cost ÷ distance | 1 |
| Vehicle downtime % | UNDER_REPAIR hours ÷ period hours | 1 |
| Trips per vehicle per day | completed trips ÷ vehicle-days | 1 |
| Deliveries per vehicle per day | completed deliveries ÷ vehicle-days | 2 |
| On-time delivery % | deliveries within window ÷ deliveries | 2 |
| Load utilization % | loaded kg (or m³) ÷ capacity | 2 |
| Empty running % | distance without load ÷ total distance | 2 |
| Cost per delivery | delivery-attributed cost ÷ deliveries | 2 |
| Driver safety score | weighted behaviour events per 100 km | 2 |
| Fleet budget variance | (actual − budget) ÷ budget | 2 |
| Fleet operating profit | attributable revenue − direct cost | 3 |

## 6. Delivery practices

- **Branching:** trunk-based; short-lived feature branches; PRs require CI green and one review.
- **Definition of done:** tests (unit and, for endpoints, e2e including a tenant-isolation case), OpenAPI updated, migration included, audit-logged mutations, docs updated.
- **Database changes:** Prisma migrations only, forward-only, reviewed; destructive changes use expand → migrate → contract across two releases.
- **Environments:** local (Compose) → test (Compose on the test server) → staging (Kubernetes + staging DB on the PostgreSQL cluster) → production (Kubernetes).
- **Release:** images tagged with the git SHA; `helm upgrade` runs migrations as a pre-upgrade hook.
- **Security:** least-privilege DB roles, secrets only via Kubernetes Secrets / external secret store, dependency and image scanning in CI, quarterly access review.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Watch Tower API contract unknown / changes | All mapping lives in `WatchTowerProvider.toFix`; contract tests against a recorded sample in S3; a mock provider for testing |
| Telemetry volume growth | Monthly partitions, batched inserts, retention job; move to a dedicated time-series store only if needed |
| Pre-installed PostgreSQL lacks PostGIS | Geofencing designed to work with in-app polygon checks; PostGIS used when present |
| Data quality too low for AI | Data-quality dashboard and a gate before Phase 4 |
| Scope creep from industry modules | Industry modules are optional and feature-flagged per company |
| Connectivity for drivers | Offline-first mobile design in Phase 2 |

## 8. Current status

Delivered in this repository (Phase 1 / Sprint 1, plus early S2/S3 work):

- Monorepo (pnpm + Turborepo); shared enums, permissions and zod schemas (`packages/shared`).
- API: auth (login, refresh rotation with reuse detection, logout), RBAC, audit log, health checks, Swagger; organisation (company, branches, departments, users); **vehicles** (CRUD, status machine, assignments, documents, expiring documents); **drivers** (profiles, licences, expiring licences); **telematics** (provider interface, Watch Tower adapter, mock provider, ingest with leader election, partitioned positions, live positions, history); worker jobs (compliance alerts, partition maintenance).
- PostgreSQL schema with RLS on every tenant table, plus partitioned telemetry.
- Web console: login, dashboard, vehicles list/detail/register, drivers, live map.
- Driver app skeleton (Expo).
- Docker Compose test stack; Helm chart for production with the external PostgreSQL cluster; GitHub Actions CI.

### Sprint 2 (delivered)

- **Files:** `files` table; storage drivers `local` (dev/test, Docker volume) and `s3` (any S3-compatible store — verified against SeaweedFS). Uploads are type-sniffed (magic numbers), size-limited and streamed back through the API so RLS applies; attaching another company's file id is rejected.
- **Notifications:** per-user in-app notifications with unread counts, role-based recipients, de-duplication per threshold, SMTP email for warning/critical (Mailpit in Docker).
- **Compliance alerts:** thresholds 30/14/7/1 days and expired; only the latest document per vehicle+type (renewals stop alerts); drivers are notified about their own licence.
- **Drivers:** edit, activate/deactivate (releases vehicle), licences with scans, link to an app login.
- **Vehicles:** edit page, assign/reassign/release driver, documents with scans, consolidated history timeline.
- **Ops:** `MODE=job JOB=<name>` one-shot runner (`compliance-alerts`, `position-partitions`).

### Sprint 3 (delivered)

- **Rules engine** (`modules/telematics/rules`): a pure, unit-tested function run on every ingest batch with per-vehicle state carried in `vehicle_telemetry_state`. Detects geofence entry/exit, overspeed episodes (hysteresis), idling, ignition changes, GPS offline/restored. Out-of-order and re-delivered fixes are ignored by the rules.
- **Events & alerts:** `telemetry_events` with durations; notifications for overspeed, idling, GPS offline and alerting geofences (to admins, fleet managers and dispatchers).
- **Company settings:** default speed limit, hysteresis, idle and offline thresholds (`/api/company/settings`); per-vehicle speed limit override.
- **Live map over WebSocket:** ingest publishes to Redis; every API pod forwards to its company room (socket.io at `/api/socket.io`, WebSocket transport only so no sticky sessions are needed).
- **Web:** live map with fences and live event feed, trip playback, events list, geofence editor (circle/polygon), settings page.
- **Watch Tower contract test** against a recorded sample payload (`providers/__fixtures__`) — replace with a real recording once the API contract is confirmed.

### Sprint 4 (delivered)

- **Trips** with company-sequential numbers (`TRP-2026-000123`), lifecycle PLANNED → ASSIGNED → ONGOING → COMPLETED/CANCELLED, status history.
- **Assignment rules** (pure, unit-tested `dispatch/eligibility.ts`): no overlapping active trips (ongoing trips block until completed), vehicle not under repair/inactive, driver active with a licence valid through the trip end and of an allowed class (`settings.dispatch.licenceRules`, default TRUCK: C/D/E, BUS: D/E, TRAILER: E, MOTORCYCLE: A). Vehicle and driver rows are locked (`FOR UPDATE`) while checking, so concurrent bookings cannot both succeed (e2e-tested).
- **Actuals:** start sets the vehicle to OPERATING and records the start odometer; completion computes GPS distance from the track, derives the end odometer if not entered, advances the vehicle odometer and returns the vehicle to ASSIGNED/AVAILABLE.
- **Attendance:** duty sessions (one open session per driver, enforced by a partial unique index), daily report in the company timezone.
- **Driver self-service API** (`/api/me/...`): profile, active/recent trips, start/complete own trips, duty on/off.
- **Web:** dispatch board (double-click to plan), trips list, trip form with live availability, trip detail with lifecycle actions, attendance page.

### Sprint 5 (delivered)

- **Fuel:** records with receipt scans (web, and `/api/me/fuel` for drivers on their own vehicles), full-to-full efficiency (km/L, L/100 km) recomputed for the whole chain when entries are back-dated or deleted, anomaly flags (odometer backwards, more than the tank holds, km/L below 70% of the vehicle median — configurable), period summary per vehicle and fleet including fuel cost per km. Vehicles gain a tank capacity.
- **Maintenance:** preventive plans by km and/or days (bulk-create for many vehicles, baseline = today's odometer), OK / due soon / overdue with daily alerts once per cycle; repair requests from staff or drivers (drivers only for their own vehicles; HIGH/CRITICAL alert as warnings); numbered work orders with part/labour/external lines; starting an off-road work order puts the vehicle UNDER_REPAIR (blocking dispatch) and completing it returns it to service and resets its plan; cancelling reopens linked repair requests. One open work order per plan (partial unique index).
- **Reports:** maintenance cost (parts/labour/external) and downtime per vehicle for a period (downtime from the status history).
- **Odometer:** devices that report an odometer keep the vehicle odometer current; fuel fills and trip completions also advance it (never backwards).
- **Web:** fuel page (summary, per-vehicle, records, entry form), maintenance page (plans, work orders, repair requests, cost & downtime), work-order detail; navigation grouped into sections.
- **Dev:** the web app compiles `@fms/shared` from source (Vite alias), so shared changes never hit a stale pre-bundled copy.

Object storage decision: **S3 API**, so any S3-compatible service works. Recommended for on-prem: SeaweedFS or Ceph RGW; or the company's existing S3 service.
