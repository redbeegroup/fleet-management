# Phase 1 (MVP) — User acceptance test checklist

Run against the Docker test environment (`docs/DEPLOYMENT.md` §1) with the demo seed, or against staging with real Watch Tower data. Tick each line; record defects with the step number.

Logins (seed): `admin@fms.local` (super admin), `manager@fms.local` (fleet manager), `driver@fms.local` (driver, mobile app) — password `ChangeMe123!` unless changed via `SEED_ADMIN_PASSWORD`.

## A. Access & security
1. [ ] Wrong password is rejected; 10+ attempts per minute are throttled (HTTP 429).
2. [ ] A fleet manager sees no *Settings → company* write actions; a viewer cannot create vehicles (403).
3. [ ] Users of company B cannot see any record of company A (vehicles, trips, files, notifications) — try direct URLs.
4. [ ] Audit log (`GET /api/audit-logs`) lists every change made during the test, without passwords.

## B. Vehicles & drivers
5. [ ] Register a vehicle with GPS device ID, tank capacity and speed-limit override; edit it.
6. [ ] Status changes follow the rules (e.g. AVAILABLE → DISPOSED is refused) and appear in the history.
7. [ ] Add insurance and road-tax documents with a PDF/photo; open the scan.
8. [ ] Add a driver with licence (class + expiry + scan); link to an app login.
9. [ ] Assign a driver to a vehicle; reassign; release. Deactivating a driver releases the vehicle.
10. [ ] Run `compliance-alerts` (`MODE=job JOB=compliance-alerts`): documents/licences expiring within 30 days notify managers (and the driver for their licence); running it again sends nothing new; renewing a document stops its alerts. Warning/critical alerts arrive by e-mail (Mailpit).

## C. GPS & telematics
11. [ ] Live map shows every tracked vehicle; markers move without reloading (WebSocket).
12. [ ] Draw a circle and a polygon geofence; enable entry alerts; a vehicle entering raises an event and a notification.
13. [ ] With a low speed limit in *Settings*, overspeed events appear with max speed and duration.
14. [ ] Idling (engine on, stationary ≥ threshold) creates an event with duration.
15. [ ] A vehicle silent for longer than the offline threshold raises *GPS offline*; it is closed by *GPS restored* when data resumes.
16. [ ] Trip history: pick a range, see distance / driving time / max speed / stops, play back the track.

## D. Dispatch
17. [ ] Create a trip with vehicle + driver: unavailable ones are listed with the reason (booked, under repair, wrong licence class, licence expiring).
18. [ ] Two dispatchers booking the same truck for overlapping times: only one succeeds.
19. [ ] The driver gets a notification (and a push on the phone); the trip appears in the app.
20. [ ] Start in the app → vehicle OPERATING; complete → GPS distance and end odometer filled, vehicle back to ASSIGNED/AVAILABLE, vehicle odometer advanced.
21. [ ] Dispatch board shows the day's trips per vehicle; double-click plans a trip at that time.
22. [ ] Cancel requires a reason; finished trips cannot be cancelled.
23. [ ] Attendance: driver goes on/off duty in the app; supervisor can clock a driver in; daily attendance shows hours and trips.

## E. Fuel & maintenance
24. [ ] Record fuel (web and app with receipt photo); km/L appears from the second full fill; back-dating a fill recalculates.
25. [ ] Anomalies are flagged: odometer lower than the previous fill; more litres than the tank; unusually low km/L.
26. [ ] Create preventive plans (bulk for several vehicles); statuses OK / due soon / overdue are correct; `maintenance-due` alerts once per cycle.
27. [ ] Driver reports a problem with a photo; manager converts it to a work order.
28. [ ] Start the work order → vehicle UNDER_REPAIR and cannot be dispatched; add parts/labour lines; complete → vehicle back in service, plan reset.
29. [ ] Cost & downtime report shows the work order cost and the downtime.

## F. Costs, KPIs, reports
30. [ ] Add other expenses (toll, parking) with receipt.
31. [ ] Dashboard KPIs for 7/30 days: cost per km, utilization, availability, fuel efficiency, maintenance per km, trips, idle %, overspeed per 100 km — spot-check two against the reports table.
32. [ ] Charts: hover shows values; *Table* view shows the same numbers; dark mode legible.
33. [ ] Reports: per-vehicle and per-branch tables; CSV opens in Excel with correct columns.

## G. Operations
34. [ ] `docker compose … up -d` from scratch: all services healthy, migrations and seed complete.
35. [ ] Upgrade path: pull a newer image, `up -d` — migrations apply, data preserved.
36. [ ] `/api/health/ready` reports database and Redis; stopping Redis turns it to 503.
37. [ ] Prometheus `/metrics` reachable inside the network only (not through the web port).

Sign-off: ______________________ (fleet operations) ______________________ (IT) Date: __________
