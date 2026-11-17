# Fleet Management System — Development Plan

> Status: **Phase 1 (MVP, Sprints 1–6) delivered** — ready for UAT ([UAT_PHASE1.md](UAT_PHASE1.md)). **Phase 2 delivered: S7 (driver safety), S8 (inspections, training, incentives) S9 (integration platform & approvals), S10 (delivery planning & multi-stop trips) and S11 (OSRM/VROOM routing, ePOD, returns, delivery KPIs) and S12 (costs & control, offline driver app, manager mobile approvals, route deviation) delivered; S13 (fuel control, cards, sensors, diagnostics) and S14 (site visits, group administration, UAT pack) delivered — Phase 2 complete, in UAT ([UAT_PHASE2.md](UAT_PHASE2.md))**. **Phase 3: S15 (single sign-on, BI access, scheduled management reports) S16 (parts, tires, outside garages, warranty) and S17 (lifecycle, replacement advice, benchmarking) delivered.** Next: S18 trailers & equipment, compliance rules, safety audits. Timelines are indicative, not a validated estimate.

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
| Vehicle history | P1 | 1 / S2–S13 | ✅ one timeline: status, assignments, documents, trips, fuel, maintenance, repairs, expenses, incidents, inspections, alerts; filters + paging |
| Vehicle lifecycle (acquisition → disposal) | P2 | 3 | ✅ S17: lifetime view, replacement advice and plans, disposal with book value and gain / loss |
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
| Route deviation | P2 | 2 / S12 | ✅ off the planned road route (OSRM) for N m during M min |
| Unauthorized vehicle usage | P2 | 2 / S12 | ✅ moving without a trip (opt-in), outside working hours, without a driver on duty, restricted geofences |
| Engine diagnostics (OBD/CAN) | P2 | 2 / S13 | ✅ trouble codes, check-engine, coolant, battery, engine hours from device data; ENGINE_FAULT alerts, auto repair requests (Watch Tower field names to confirm) |
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
| Vehicle capacity | P2 | 2 / S10 | ✅ kg, m³, cases, pallets, max stops; checked when planning loads |
| Multi-stop routing | P2 | 2 / S10–S11 | ✅ delivery loads with ordered stops |
| Route optimization | P2 | 2 / S11 | ✅ self-hosted OSRM + VROOM |
| Dynamic dispatch | P3 | 4 | ⏳ |
| AI dispatch recommendation | P3 | 4 | ⏳ |

### Module 4 — Fuel Management (`fuel`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Fuel consumption recording | P1 | 1 / S5 | ✅ web + driver app API, receipt scans |
| Fuel expense tracking | P1 | 1 / S5 | ✅ per vehicle and fleet, per period |
| Fuel efficiency (km/L, L/100 km) | P1 | 1 / S5 | ✅ full-to-full method, recomputed on back-dated entries |
| Fuel refill history | P1 | 1 / S5 | ✅ date, odometer, litres, price, station, driver |
| Fuel budget | P2 | 2 / S12–S13 | ✅ FUEL budgets (branch/department/company) shown on the Fuel page |
| Consumption variance | P2 | 2 / S13 | ✅ km/L vs the vehicle's 90-day median (else class), excess litres and cost |
| Fuel fraud detection (rules) | P2 | 2 / S5–S13 | ✅ odometer backwards, refill > tank, low km/L, vehicle not at the fill location, odometer vs GPS km, card and sensor mismatches |
| Fuel card integration | P2 | 2 / S13 | ✅ CSV/Excel statements with saved column mapping, `FuelCardProvider` API adapter (mock + generic REST until a provider is chosen), reconciliation |
| Fuel sensor integration | P2 | 2 / S13 | ✅ tank level from device data: refills checked against recorded fills, drops while parked alerted |
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
| Spare parts inventory | P2 | 3 | ✅ S16: store per branch, moving average cost, receipts, issues to work orders, transfers, counts, reorder alerts |
| Tire management | P2 | 3 | ✅ S16: per vehicle position — changes, rotation, tread/pressure checks (web and inspections), wear projection, cost per km by brand |
| Workshop management | P2 | 3 | ✅ S16: outside garages — quotes (approval limit), invoices, garage performance (turnaround, repeat repairs, invoice vs quote) |
| Warranty management | P2 | 3 | ✅ S16: vehicle / part / tire warranty, coverage hints on work orders, claims with recovered credit in costs |
| Predictive maintenance | P3 | 4 | ⏳ |

### Module 6 — Driver Management & Safety (`drivers`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Driver profile | P1 | 1 / S2 | ✅ |
| Driving licence management + expiry | P1 | 1 / S2 | ✅ licences with scans, expiry alerts to managers and the driver |
| Driver attendance | P1 | 1 / S4 | ✅ duty sessions (app or supervisor), daily attendance report |
| Driver assignment history | P1 | 1 / S2 | ✅ |
| Driver behaviour monitoring | P2 | 2 / S7 | ✅ harsh accel/brake/corner computed from GPS (dense fixes) or taken from device events; attributed to the trip/assigned driver |
| Driver performance score | P2 | 2 / S7 | ✅ safety score per 100 km with configurable weights, ranking, scorecard, weekly low-score alerts |
| Accident & incident reporting | P2 | 2 / S7 | ✅ web + driver app (photos), REPORTED → INVESTIGATING → CLOSED with findings/corrective actions, manager alerts for high severity or injuries |
| Driver training & certification | P2 | 2 / S8 | ✅ course catalogue (validity, mandatory), certificates with scans, compliance matrix, expiry alerts to managers and the driver |
| Incentives & penalties (rules) | P2 | 2 / S8 | ✅ monthly items proposed → approved/rejected (no self-approval), automatic safety bonus rule, payroll summary + CSV |
| Fatigue monitoring | P3 | 4 | ⏳ hardware-dependent |
| AI dashcam integration | P3 | 4 | ⏳ |

### Module 7 — Logistics & Delivery (`logistics`, optional industry module)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Delivery order management | P1* | 2 / S9–S10 | ✅ DMS order API, orders list, customers |
| Vehicle loading plan | P1* | 2 / S10 | ✅ capacity by kg, m³, cases, pallets, stops; auto-fill |
| Delivery status | P1* | 2 / S10 | ✅ per stop and order, with webhooks |
| Delivery location tracking | P1* | 2 / S10–S11 | ✅ live map + POD GPS position vs customer |
| Electronic proof of delivery | P2 | 2 / S11 | ✅ photos, signature, GPS check, COD collected; exceptions list |
| Delivery time monitoring | P2 | 2 / S11 | ✅ planned ETA per stop, ETA error and dwell time |
| Failed delivery management | P2 | 2 / S10–S11 | ✅ reasons, re-planning, check-in of undelivered goods |
| Return goods management | P2 | 2 / S11 | ✅ customer returns at the stop; warehouse check-in with differences |
| Digital cargo manifest | P2 | 2 / S10 | ✅ printable manifest |
| Loading/unloading time | P2 | 2 / S14 | ✅ GPS site visits: depot/warehouse geofences (loading) and delivery-stop radius (unloading), avg/p90 per vehicle, driver, site; GPS auto-arrive at stops |
| Delivery route optimization | P2 | 2 / S11 | ✅ self-hosted OSRM + VROOM (straight-line fallback) |
| AI load consolidation | P3 | 4 | ⏳ |

\* P1 for the FMCG distribution module; scheduled in Phase 2 because it depends on dispatch (S4) and is an optional industry module. If Myanmar Zarla's distribution rollout is the first customer, pull delivery orders + status forward into S6.

### Module 8 — Fleet Cost & Financial Management (`costs`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Vehicle operating cost | P1 | 1 / S6 | ✅ fuel + maintenance + other expenses per vehicle |
| Cost per kilometre | P1 | 1 / S6 | ✅ total, fuel and maintenance per km (GPS distance) |
| Fleet expense dashboard | P1 | 1 / S6 | ✅ dashboard + reports by vehicle and branch, CSV |
| Maintenance cost analysis | P1 | 1 / S5–S6 | ✅ parts/labour/external, per km, downtime |
| Budget vs actual | P2 | 2 / S12 | ✅ monthly budgets per branch / department / company and category; forecast; 90 % / 100 % alerts |
| Total cost of ownership | P2 | 2 / S12 | ✅ straight-line depreciation or lease + running costs + documents + shared costs; book value; CSV |
| Cost per trip | P2 | 2 / S12 | ✅ trip km × full cost per km + trip expenses + driver cost per day |
| Cost per delivery | P2 | 2 / S11–S12 | ✅ cost per drop / order / kg on the full cost per km |
| Internal cost allocation | P2 | 2 / S12 | ✅ shared costs allocated to vehicles by km driven in the month |
| Fleet profitability | P2 | 3 | ⏳ needs revenue from ERP/TMS |
| Vehicle replacement ROI | P3 | 4 | ⏳ |

### Module 9 — Fleet Performance & KPI (`analytics`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Fleet overview dashboard | P1 | 1 / S6 | ✅ KPI tiles, daily distance and cost charts, top cost/km, status, expiring documents |
| Vehicle utilization | P1 | 1 / S6 | ✅ vehicle-days used, engine hours, idle % (daily GPS rollup) |
| Distance & trip analysis | P1 | 1 / S6 | ✅ daily distance series, trips per vehicle-day |
| Vehicle downtime | P1 | 1 / S6 | ✅ downtime and availability % |
| Fuel efficiency dashboard | P1 | 1 / S6 | ✅ fleet and per-vehicle km/L |
| Driver performance dashboard | P2 | 2 / S7 | ✅ safety dashboard (fleet score, event mix, ranking) |
| Delivery efficiency | P2 | 2 / S11 | ✅ Delivery KPIs: OTIF, success, cost per drop, fill rate, route adherence |
| Branch fleet comparison | P2 | 3 | ✅ S17: branches compared against each vehicle's class median |
| Vehicle productivity ranking | P2 | 3 | ✅ S17: productivity score and rank within the class |
| Benchmarking (same class) | P2 | 3 | ✅ S17: class medians, percentiles, deviation per metric |
| Automated management reports | P2 | 3 | ✅ S15: fleet, budget & TCO, delivery, safety & compliance — daily/weekly/monthly e-mail with PDF + CSV |
| AI executive insights | P3 | 4 | ⏳ |

### Module 10 — Compliance, Insurance & Incidents (`compliance`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Road tax & registration tracking | P1 | 1 / S2 | ✅ as vehicle document types with expiry |
| Insurance management | P1 | 1 / S2 | ✅ policy number, issuer, expiry, premium amount, policy scan |
| Driving licence compliance | P1 | 1 / S2–S4 | ✅ expiry alerts; licence class vs vehicle class enforced at dispatch (configurable) |
| Vehicle inspection checklist | P2 | 2 / S8 | ✅ configurable pre-trip / post-trip / periodic checklists per vehicle class, critical items |
| Accident management | P2 | 2 / S7 | ✅ incidents & accidents, investigation, insurance claims |
| Insurance claims | P2 | 2 / S7 | ✅ per incident; insurer/policy from the vehicle's insurance document; SUBMITTED → APPROVED/REJECTED → SETTLED |
| Regulatory compliance (country config) | P2 | 3 | ⏳ |
| Safety audit | P2 | 3 | ⏳ |

### Module 11 — Mobile Applications (`apps/driver-app`)

| Feature | Pri | Phase / Sprint | Status |
|---|---|---|---|
| Driver mobile app | P1 | 1 / S6 | ✅ Expo app: trips, duty, fuel, problem reports, alerts |
| Trip start/end | P1 | 1 / S6 | ✅ in the app, with optional odometer |
| Driver notifications (push) | P1 | 1 / S6 | ✅ Expo push (device registration, dead-token pruning) + in-app list |
| Vehicle inspection | P2 | 2 / S8 | ✅ driver app with defect photos; defects raise repair requests; optional pre-trip gate on trip start |
| Fuel expense submission | P2 | 2 | ✅ delivered early (S5/S6) |
| Repair requests | P2 | 2 | ✅ delivered early (S5/S6) |
| Proof of delivery | P2 | 2 / S10–S11 | ✅ stop list, photos, GPS, signature pad, COD, customer returns |
| Offline mode | P2 | 2 / S12 | ✅ SQLite outbox + Idempotency-Key, cached trips/stops, photos kept until upload |
| Fleet manager mobile app | P2 | 2 / S12 | ✅ manager mode in the same app: approvals with attachments, fleet summary, alerts; push opens the request |

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
| Notification engine | P1 | 1 / S2–S6 | ✅ in-app, SMTP e-mail, Expo push; role-based recipients; dedupe |
| ERP integration (SAP S/4HANA) | P2 | 3 | ⏳ |
| DMS / TMS integration | P2 | 2 / S9 → 3 | 🟡 DMS order intake API + status webhooks (S9); delivery planning/ePOD S10–S11 (`pod` in delivery webhooks, `return.collected`, `load.checked_in`) |
| BI integration (Tableau, Metabase) | P2 | 3 | ✅ S15: read-only `reporting` views, per-company and group logins ([BI_REPORTING.md](BI_REPORTING.md)) |
| REST APIs & webhooks | P2 | 2 / S9 | ✅ scoped API keys, integration API v1 (separate OpenAPI), signed webhooks with retries ([INTEGRATION_API.md](INTEGRATION_API.md)) |
| SSO (Entra ID / OIDC) | P2 | 3 | ✅ S15: Microsoft Entra ID and Google Workspace (group and per-company), invited users only |
| Workflow & approval engine | P2 | 2 / S9 | ✅ work orders, expenses, fuel and claims above configurable limits, vehicle booking requests; two approvers above a second limit; no self-approval |
| Multi-tenant SaaS architecture | P2 | 2 / S14 | ✅ group companies: tenant isolation, super-admin company onboarding with invited first admin, user invitations and password reset (no self-signup or billing: group use only) |

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

**Phase 1 is feature-complete** (all P1 items in modules 1–6, 8, 9, 10, 11 and 13 are ✅ above; module 7 logistics is scheduled for Phase 2 as an industry module). Next steps: run the UAT checklist, connect the real Watch Tower API (confirm the contract — the adapter is isolated in `WatchTowerProvider.toFix`), choose the production S3 store, then start Phase 2 (logistics & ePOD, dispatch optimisation, driver safety scoring, workflow/approvals, inspections, offline mobile).

Delivered in Sprint 1:

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

### Sprint 6 (delivered) — Phase 1 complete

- **Daily stats rollup** (`vehicle_daily_stats`, SQL function `fms_rollup_daily_stats`): distance (GPS-jump filtered), engine / moving / idle minutes and max speed per vehicle per company-local day; worker refreshes the last days every 30 minutes (`MODE=job JOB=daily-stats JOB_FROM=… JOB_TO=…` for backfills).
- **Costs:** other operating expenses (tolls, parking, fines, insurance, allowances…) with receipts; operating cost = fuel + maintenance + other.
- **KPIs** (`modules/analytics/kpis.ts`, pure and unit-tested): cost/km, fuel and maintenance cost/km, km/L, utilization (vehicle-days used), availability and downtime %, idle %, trips per vehicle-day, overspeed per 100 km — fleet, per vehicle and per branch, with a daily series; CSV export (formula-injection safe).
- **Web:** KPI dashboard with charts (validated palette, hover + keyboard tooltips, table view, dark mode), reports page (vehicles, branches, expenses, CSV).
- **Driver app:** trips start/complete, duty, fuel with receipt photo, problem reports with photo, alerts; Expo push registration. Type-checked and bundled in CI.
- **Push:** `user_devices` + Expo push channel (warning/critical and personal notifications such as trip assignments); unregistered tokens pruned.
- **Observability:** Prometheus `/metrics` (HTTP latency, positions ingested, telemetry events, notifications, job runs; worker/ingest on `METRICS_PORT`), JSON logs (`LOG_FORMAT=json`), Helm scrape annotations.

### Post-Phase-1 decisions (applied)

- **Myanmar licence categories** (`packages/shared/src/licences.ts`): သ T learner (1 y), က A motorcycle, ခ B private, ဂ C machinery, ဃ D taxi & commercial (3 y), င E heavy (3 y), ဌ TR tractor, ဟ TW three-wheeler, စ CO conductor (5 y unless noted). Myanmar letters or Latin codes are accepted; expiry defaults from the category validity. **Company vehicles are commercial**: cars/vans/pickups need ဃ or င; trucks, buses and trailers need င; tractors ဌ; machinery ဂ; motorcycles က/ခ/ဃ/င/ဟ. Learner and conductor permits never qualify. Rules are editable per company (`settings.dispatch.licenceRules`). New vehicle classes: three-wheeler, tractor, machinery.
- **Storage**: SeaweedFS (S3 API) in the Docker test stack, configured only through environment variables; production points `S3_*` at any S3-compatible service.
- **Driver app** configuration via environment (`EXPO_PUBLIC_API_URL`, `EAS_PROJECT_ID`).
- **Watch Tower API**: pending from the customer.

Object storage decision: **S3 API**, so any S3-compatible service works. Recommended for on-prem: SeaweedFS or Ceph RGW; or the company's existing S3 service.

### Phase 2 — Sprint 7 (driver safety) delivered

- **Harsh events** (`telematics/rules/harsh.ts`, pure): longitudinal Δv/Δt and lateral v·ω between consecutive fixes, only when fixes are ≤ `harshMaxGapSeconds` (15 s) apart; thresholds in company settings (`telematics.harsh*`). Tracker events in `attributes.event|alarm` (`harsh_braking`, `harsh_acceleration`, `harsh_cornering`, `hard_*`) take precedence — this is where Watch Tower accelerometer events plug in. With today's 30 s polling, most harsh events will come from the device once the real API is connected.
- **Driver attribution:** every telemetry event stores `driver_id` (driver of the ONGOING trip, otherwise the standing assignment).
- **Safety score** (`safety/score.ts`, pure): `100 − Σ(weight × events) per 100 km` (idling per 10 min), bands GOOD ≥ 85 / FAIR ≥ `alertBelow` / POOR; drivers under `minDistanceKm` are not scored. Distance per driver comes from `vehicle_daily_stats`, split by trip GPS distance or given to the driver assigned at local noon. Computed on request (no extra rollup table — the inputs are already daily aggregates).
- **Incidents & claims** (`/api/incidents`, `/api/claims`, driver `/api/me/incidents`), safety API (`/api/safety/scores`, `/api/safety/drivers/:id`, driver `/api/me/safety`), `safety-alerts` daily job (07:30 Asia/Yangon).
- Web: Driver safety, Incidents & claims, scorecard on the driver page. Driver app: Safety tab (own score, incident report with photos).

### Phase 2 — Sprint 8 (inspections, training, incentives) delivered

- **Inspections** (`modules/inspections`): checklists (`inspection_templates`) per kind and vehicle class; two defaults are created on first use. An inspection stores a copy of the items with each answer, so later checklist edits do not rewrite history. `evaluate.ts` (pure) requires every item answered and a note or photo per defect; a failed critical item → `FAIL`, other defects → `DEFECTS`. Any defect raises a repair request (HIGH if critical) and alerts managers. With `settings.inspections.requirePreTrip`, `TripsService.start` refuses to start a trip unless the vehicle has a pre-trip inspection within `preTripValidHours` that did not fail.
- **Training** (`modules/training`): `training_courses` (validity months, mandatory) and `driver_trainings` (expiry defaults to completion + validity). `status.ts` (pure) → VALID / EXPIRING / EXPIRED / MISSING. Compliance matrix at `/api/training/matrix`; expiry alerts run with the daily `compliance-alerts` job (managers + the driver, once per bucket).
- **Incentives & penalties** (`modules/incentives`): `driver_adjustments` per payroll month. Fleet managers propose; company admins approve or reject (with a reason) and nobody decides their own proposal. `incentives-monthly` job (1st of the month, 08:00 Asia/Yangon) proposes the safety bonus from last month's scores when enabled (idempotent via `dedupe_key`). Summary and payroll CSV per month.
- Driver app: **Check** tab (inspection with defect photos), training status and incentive/deduction items on the Safety tab. Web: Inspections (list, record, checklist editor), Training (matrix, courses, driver records), Incentives (month view, approvals, CSV), new Settings section.

### Phase 2 — Sprint 9 (integration platform & approvals) delivered

- **API keys** (`common/auth/api-key.ts`): `fms_<prefix>_<secret>`, only the SHA-256 is stored, shown once, scopes, expiry, revocation, last-used. Accepted **only** on routes marked `@ApiKeyAuth(scope)` (`/api/integrations/v1`), never on user routes; rate-limited per key.
- **DMS order API** (`modules/integrations`): idempotent `PUT /orders/{externalRef}` (payload hash → `unchanged`), batch, cancel, changes feed with cursor, `Idempotency-Key` (Redis, 24 h). Minimal `customers`, `delivery_orders`, `delivery_order_lines` that S10 extends. Contract: [INTEGRATION_API.md](INTEGRATION_API.md) and `/api/integrations/docs`.
- **Webhooks**: outbox rows written in the same transaction as the change; `webhook-dispatch` worker job (15 s) with lease + `SKIP LOCKED`, HMAC-SHA256 signatures, 8 attempts over ~22 h, auto-disable after 20 failures, redelivery, test ping. SSRF guard: https only and no private/loopback/link-local targets unless `WEBHOOK_ALLOW_INSECURE` / `WEBHOOK_ALLOW_PRIVATE`.
- **Approvals** (`modules/approvals`): generic requests + decisions, pure rules (`rules.ts`), owning modules register outcome handlers. Work orders (`AWAITING_APPROVAL`, start/complete blocked until the cost is approved, `request-approval` when lines exceed the limit), expenses and fuel (`approval_status`; analytics count approved costs only and report pending separately), insurance claims (`PENDING_APPROVAL` → `SUBMITTED`), vehicle booking requests (new `REQUESTER` role; approved requests are scheduled into trips by dispatchers). Limits are off until set in Settings.
- Web: Integrations (keys, webhooks, delivery log), Delivery orders, Approvals inbox, Booking requests, approval states on work orders/fuel/expenses/claims, approval limits in Settings.

### Phase 2 — Sprint 10 (logistics core) delivered

- **Depots** are branches with a location (Settings → Depots). DMS orders carry `depotCode`, `deliveryDate`, and line `cases`/`pallets`; the default depot applies otherwise.
- **Capacity** (`packages/shared/src/capacity.ts`, used by API and web): weight, volume, cases, pallets and stops (vehicle limit or company default). Violations block a load (422); missing order data only warns.
- **Planning board** (`/planning`): orders to plan for a day and depot (plus failed orders to re-plan), vehicle capacity bars, manual loads, and **auto-fill** (`logistics/autofill.ts`: priority, area, bearing from the depot, first fit into the largest vehicles). Proposals are reviewed and created per vehicle.
- **Loads** are delivery trips (`trips.kind = DELIVERY`) created through `TripsService.createIn` in the same transaction, with all assignment checks. Stops are grouped per customer and ordered nearest-neighbour from the depot (`logistics/sequence.ts`; VROOM replaces it in S11). Loads can be edited (reorder, add, remove, change vehicle/driver) until the trip starts. Printable manifest with COD and signature lines.
- **Execution:** trip start → orders DISPATCHED; drivers record each stop (arrived, delivered, partly delivered with quantities, failed with a reason) in the app; the trip can only be completed once every stop is resolved; cancelling a load returns its orders to planning. Webhooks `order.planned/dispatched/delivered/partially_delivered/failed`.
- Customers page to fix outlet locations; vehicle form has cases, pallets and max-stops capacity.

### Phase 2 — Sprint 11 (routing, proof of delivery, returns, delivery KPIs) delivered

- **Routing engines:** self-hosted OSRM (car profile, MLD, Myanmar OSM extract from Geofabrik) and VROOM. Docker Compose profile `routing`; Helm `routing.enabled` (on for CorexLab) with a PVC, a download/prepare init step that runs only when data is missing, and Services the API reaches through `OSRM_URL`/`VROOM_URL`.
- **`modules/routing`:** `RoutingService` uses VROOM to order a new load's stops (time windows, service time) and to build auto-fill proposals across vehicles (capacity as kg, m³, cases, pallets, max stops), and OSRM to re-route a manually reordered load. On any error it falls back to the straight-line logic and records `routing_source`. `GET /routing/status`. Loads store planned km, minutes, route geometry and per-stop ETAs; the Load page shows the road route on a map.
- **Proof of delivery** (`settings.pod`): photo required (default), optional signature (finger strokes, drawn as SVG), GPS position checked against the customer (flag above `maxDistanceM`, default 300 m), cash collected vs expected COD. Missing required evidence is a 400 for drivers; distance, missing GPS and cash differences are **flags**, not blocks. Dispatch entries are flagged `RECORDED_BY_DISPATCH`. POD exceptions list on the Delivery KPIs page.
- **Returns:** drivers record customer returns/pick-ups at a stop (webhook `return.collected`). After the trip, the warehouse checks in undelivered quantities, customer returns and cash (`warehouse:checkin` permission); differences notify managers and are kept on the load (webhook `load.checked_in`).
- **Delivery KPIs** (`/delivery-kpis`, `GET /analytics/delivery`, CSV): OTIF and success rates, failure reasons, cost per drop/order/kg (trip expenses + km × fuel cost per km + optional driver cost per day — an estimate, method shown), vehicle fill rate (binding limit), route adherence (planned vs GPS km, stop order kept = longest increasing subsequence, ETA error, dwell), per driver, vehicle and day.
- **Driver app:** delivery screen takes photos, GPS, signature and cash, and records customer returns (`expo-location`, `react-native-svg`).

### Phase 2 — Sprint 12 (costs & control, offline app, manager approvals) delivered — Phase 2 complete

- **Cost ledger** (`modules/costs`): one normalised view of every cost per vehicle, month and category: approved fuel and expenses, completed work orders, document fees spread over their validity (insurance and road tax keep their category), straight-line depreciation (purchase price − residual over the useful life, pro-rated by day, stops at end of life or disposal) or monthly lease/rent, and **shared costs** (company, branch or department overheads) allocated to vehicles by km driven in their month (largest-remainder cents; no km → reported as not allocated).
- **Budgets** per month and cost category for the company, each branch and each department (`/budgets` grid, copy from the previous year with a % change). Status per cell: on track, at risk (≥ 90 % or month-to-date forecast above budget), over. Daily `budget-alerts` job notifies managers once per level (re-armed when the amount changes).
- **TCO** per vehicle (`/costs`, `GET /analytics/tco` + CSV) with ownership, running and shared costs, cost per km and per month, book value, and a flag for vehicles without asset data. **Cost per trip** (`GET /analytics/trip-costs`) and the delivery KPIs now use the vehicle's full cost per km (all categories except trip-linked expenses, which are charged to their trip).
- **Control rules** in the GPS pipeline (pure `telematics/rules/control.ts`, settings `control`): off the planned OSRM route (500 m for 5 min by default), moving without a trip (opt-in, after 1 km), outside working hours per weekday (overnight shifts supported, company time zone), moving without a driver on duty, entering RESTRICTED geofences. Episodes open/close like overspeed, alert managers and dispatchers, and emit `vehicle.off_route` / `vehicle.unauthorised_use` webhooks.
- **Driver app offline mode:** every action goes through a SQLite outbox and is sent in order with an `Idempotency-Key` (server: `@Idempotent()` on driver routes, file upload and approval decisions; 24 h, per user). Photos are kept on the phone until uploaded; trips, stops, profile and approvals are cached for offline viewing; actions waiting to be sent show as done with a "not sent" badge; rejected actions can be retried or discarded. Stop arrival/completion and duty start/end keep the time they happened (`occurredAt`, at most 7 days old).
- **Manager mode** in the same mobile app (company admins and fleet managers): Fleet summary (`GET /mobile/manager-summary`: approvals waiting, trips, vehicles, control alerts of the last 24 h, budgets at risk), Approvals with the record's key facts and photos/receipts (`GET /approvals/:id` → `details`), approve/reject with a note, push notification opens the request. Users with both roles can switch.
- Web: Costs & TCO, Budgets, vehicle cost of ownership and department, control rules in Settings, new event types.

### Phase 2 — Sprint 13 (fuel control, fuel cards, sensors, diagnostics) delivered

- **Fill location and km checks:** the driver app sends the phone position with a fill; the server compares it with the vehicle's GPS fix nearest the fill time (±15 min). `VEHICLE_ELSEWHERE` when more than `locationMaxM` (500 m) apart or the vehicle was driving; `KM_MISMATCH` when odometer km and GPS km since the previous fill differ by more than 15 %. Web entries without a location take the vehicle's position.
- **Consumption variance** (`/fuel?tab=variance`, `GET /fuel/variance`): actual km/L per vehicle vs its own 90-day median (else its class), excess litres and cost; the month's FUEL budget beside it.
- **Fuel cards** (`/fuel?tab=cards`): cards store only the last 4 digits. Statements (CSV/XLSX) are mapped column by column once per provider (remembered), previewed, then imported; duplicates are skipped by transaction id or row hash. A `FuelCardProvider` adapter pulls transactions hourly (`fuel-card-sync`) when enabled — mock and a generic REST adapter until a provider is chosen. Reconciliation matches each transaction to one fill of the card's vehicle (±2 h, amount ±2 %, litres ±3 %): matched, mismatch (fill flagged `CARD_MISMATCH`, managers notified), not recorded in FMS (record the fill from it, or accept with a note), not fuel.
- **Fuel level sensor** (device attributes `fuelLevelL` / `fuelLevelPct`): median-smoothed level; `FUEL_REFILL` compared with fills recorded within 3 h (not recorded / under / over-recorded → alert, `SENSOR_MISMATCH` flag); `FUEL_DROP` when the level falls while parked or idling (possible theft).
- **Engine diagnostics** (`dtc`, `mil`, coolant, battery, engine hours): latest values per vehicle on the vehicle page; `ENGINE_FAULT` for new trouble codes, overheating and low battery (engine off); configured codes open a repair request. Webhooks `vehicle.fuel_drop` and `vehicle.engine_fault`.
- **Watch Tower:** the adapter now passes device attributes through; field names stay unconfirmed until API access exists. The mock provider simulates a fuel curve and an occasional trouble code.
- **Vehicle history** now covers repairs, expenses, incidents, inspections and alerts, with kind filters and paging.

### Phase 2 — Sprint 14 (site visits, group administration, UAT pack) delivered — Phase 2 complete

- **Site visits** (`site_visits`): the GPS rules pass opens a visit when a vehicle enters a geofence and closes it on exit; during a delivery trip it also detects arrival at a stop (vehicle at ≤ 10 km/h within `logistics.arrivalRadiusM`, default 150 m) and departure beyond twice the radius. A GPS arrival sets the stop to *arrived* (`arrival_source = gps`) unless the driver already did. *Loading & unloading* (`/site-visits`, `GET /analytics/site-visits`): average and p90 minutes for depots/warehouses (loading) and customers (unloading) per vehicle, driver and site. Delivery KPIs use GPS dwell when it exists.
- **Users:** invite by e-mail (one-time link, 72 h) instead of setting passwords; change roles and branch; deactivate (signs the user out everywhere); resend invitations; send password resets. Only super admins grant or change super admins; nobody can deactivate themselves or change their own roles.
- **Password reset** on the web and in the mobile app: the same answer whether the e-mail exists or not, at most 3 e-mails per hour per account, links valid for 1 hour and usable once; setting a password signs out existing sessions. Passwords need 10+ characters with letters and a digit.
- **Group companies** (`/admin/companies`, super admins, `company:manage`): list with users and vehicles, create a company with its first admin (invited), rename, deactivate (all its users are signed out and cannot sign in).
- **UAT pack:** `docs/UAT_PHASE2.md` (44 checks across S7–S14) and the idempotent demo seed `deploy/demo/seed-demo.cjs`, which loads Phase 2 demo data through the public API.

### Phase 3 — Sprint 15 (single sign-on, BI access, scheduled reports) delivered

- **Single sign-on** (OpenID Connect, authorization code + PKCE, `openid-client`):
  - Providers: the group's Microsoft Entra tenant and Google Workspace (configuration and Secret), plus each company's own Entra tenant or Google Workspace. A company's client secret is stored AES-256-GCM encrypted (`SSO_ENCRYPTION_KEY`).
  - E-mail domains route to a company and provider. Domains on the group providers need a super admin's approval; a company's own provider is trusted for its domains.
  - Only invited, active users of that company can sign in; nobody is created on the fly. The first sign-in links the identity (`iss|sub`), later ones must match. Admins can unlink.
  - The ID token must come from the expected tenant (Entra `tid`, Google `hd`), and Google e-mails must be verified.
  - The callback gives the browser or driver app a one-time code (Redis, 60 s), exchanged for the usual tokens; tokens never travel in a URL.
  - A company can switch password sign-in off; super admins keep it. Audit: `sso.login`, `sso.link`, `sso.refused` with the reason.
  - Web: e-mail-first login with Microsoft/Google buttons, *Settings → Sign-in*, an SSO badge and unlink on *Users*, domain approval on *Group companies*. Driver app: `expo-web-browser` with the deep link `fmsdriver://sso`.
- **BI access** ([BI_REPORTING.md](BI_REPORTING.md)):
  - Schema `reporting` holds 24 documented views with company-local dates, including the cost ledger and a calendar.
  - Each BI login is a PostgreSQL role in `fms_bi_reader`. It can read only these views (no table rights) and is read-only, with a statement timeout.
  - Each view filters through `fms_bi_sees(company_id)`, keyed by `session_user`. Company logins see their company; the group login sees all. Session settings cannot widen this.
  - Super admins create, rotate and remove logins on *Group companies*. The password is shown once; the database keeps only its SCRAM hash.
- **Scheduled management reports:**
  - Four reports: Fleet overview, Budget vs actual & TCO, Delivery performance, Safety & compliance. Each compares with the previous period.
  - Periods: daily (yesterday), weekly (last Mon–Sun), monthly (last month), sent at 07:00 company time by the hourly `report-dispatch` job.
  - Each send is recorded once per subscription and period in `report_runs`; failures retry up to 5 times.
  - Every report is an HTML e-mail (email-safe table bars) with a PDF (pdfkit) and CSV attached.
  - Recipients are FMS users who hold the report's permission, plus extra addresses entered by an admin.
  - *Scheduled reports* page: preview in the browser, PDF download, subscribe, pause, send now, last runs.
- **Tests:**
  - Unit: SSO claim checks and encryption; report periods, ISO weeks, time zones, CSV, builders and PDF.
  - e2e: SSO against a fake OpenID provider (tenant, subject pinning, unknown or inactive users, password switch, mobile deep link); BI logins connecting to PostgreSQL (own company only, no raw tables, settings cannot widen, group sees all, rotate, remove); reports (preview, recipients' permissions, once per period from 07:00, send now, isolation).

### Phase 3 — Sprint 16 (workshop depth: parts, tires, outside garages, warranty) delivered

- **Suppliers and outside garages** (`suppliers`, kinds GARAGE / PARTS / TIRES / OTHER, SAP vendor no.):
  - A work order can be sent to a garage. Its quote becomes the planned cost, so the approval limit applies.
  - Completing a garage job requires the invoice number and amount. Without cost lines, the invoice becomes an EXTERNAL line.
  - *Suppliers & garages* page: garage performance (jobs, cost, turnaround, repeat repairs within 30 days, invoice vs quote, warranty recovered).
- **Spare parts** (`parts`, `part_stocks`, `stock_movements`; new role `STOREKEEPER`, permissions `inventory:read` / `inventory:write`):
  - One store per branch, valued at moving average cost (pure `inventory/stock.ts`).
  - Store operations: receipts with invoice document, transfers (average cost carried), counts (adjustments).
  - Issue to a work order: a PART line at the average cost, with the part's warranty end. Removing the line returns the stock.
  - Stock rows are locked, so concurrent issues cannot overdraw.
  - Catalogue CSV import. Movements CSV export (for SAP upload until the integration exists).
  - Daily `stock-alerts` and the `stock.low` webhook.
- **Tires per vehicle position** (`tire_changes`, `tire_checks`; layouts in `TIRE_LAYOUTS`):
  - Changes, simultaneous rotations (km continue), and tread / pressure checks.
  - Pure `tires/tires.ts`: current fitment, km, wear projection, pressure vs target, expected life, warranty, life and cost per km by brand / size.
  - Inspection checklists gain numeric items (`type: 'number'`, min / max, tire position). A generated *tire checklist* feeds `tire_checks` from the web and the driver app (offline outbox). Out-of-limit values are defects and raise the usual repair request.
  - New cost category TIRES: work-order TIRE lines and tire changes outside work orders.
  - *Tires* page; tire diagram on the vehicle page; daily `tire-alerts`.
- **Warranty** (`vehicle_warranties`, `warranty_claims`):
  - Coverage (pure `warranty/coverage.ts`) by date / km for vehicle components, parts fitted on earlier work orders, and tires.
  - Work orders show likely matches. Managers are notified when a new work order may be under warranty.
  - Claims go DRAFT → SUBMITTED → APPROVED / REJECTED → RECOVERED. Recovered amounts reduce MAINTENANCE / TIRES costs in the recovery month (ledger, TCO, budgets, BI `cost_ledger`).
  - Daily `warranty-alerts`; `warranty_claim.updated` webhook.
- **BI:** new `reporting` views `suppliers`, `parts`, `stock`, `stock_movements`, `tire_changes`, `tire_checks`, `vehicle_warranties`, `warranty_claims`. `work_orders` gains garage columns, and `cost_ledger` gains tires and warranty credits.
- **Tests:**
  - Unit: stock, tires, warranty coverage, garage performance, numeric inspection items.
  - e2e (`sprint16`): moving average, transfer, count, CSV; issue / return and concurrent overdraw; garage quote → approval and invoice; tires incl. inspection readings and alerts; warranty hint → claim → recovered credit in TCO; storekeeper permissions; isolation.

### Phase 3 — Sprint 17 (lifecycle, replacement advice, benchmarking) delivered

- **Replacement advice** (*Lifecycle* page; pure `lifecycle/replacement.ts`):
  - Each vehicle gets *Replace now* / *Plan* / *OK*, with the reasons.
  - Limits per vehicle class: age, km and downtime over 12 months. Defaults per class can be overridden in settings `lifecycle.limits`.
  - Running cost per km over 12 months is compared with the class median (at least 3 peers).
  - *Plan* when a limit is reached within the planning window (default 12 months; km projected from the last 12 months).
  - **Economic life**: the year of service with the lowest average cost per km. It combines declining-balance market value (reaching the residual at the end of the useful life) with running costs, projected from a linear trend of running cost per km when the minimum lies ahead. It needs purchase data and two complete years of history.
  - Replacement month and note per vehicle.
- **Disposal** (`vehicle_disposals`): sale / scrap / trade-in / transfer / write-off.
  - Book value on the day and gain / loss.
  - Refused while trips or work orders are open. Assignments are ended, and the status goes INACTIVE → DISPOSED.
  - Depreciation stops from the disposal day.
  - Disposals list; BI view `reporting.vehicle_disposals`.
- **Vehicle page → Lifecycle**: timeline, lifetime cost / km / cost per km (up to the last 3 years), book value, advice and the dispose form.
- **Benchmark** (*Benchmark* page, `GET /analytics/benchmark`; pure `analytics/benchmark.ts`):
  - Every vehicle is compared with its class median: utilisation, km per day, trips per day, availability, cost per km, km/L, idle, overspeed.
  - Percentile in the class and a productivity score (average percentile of the first five metrics), with a rank in the class.
  - Branches are compared through each vehicle's deviation from its own class median, so different class mixes stay comparable.
- **Tests:**
  - Unit: limits, plan window, cost vs class, economic life incl. projection, percentiles / ties / ranks / branches.
  - e2e (`sprint17`): advice incl. settings override, lifetime view and plan, disposal (blocked by an open work order, book value → gain), benchmark, isolation.
