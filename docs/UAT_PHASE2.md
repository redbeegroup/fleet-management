# Phase 2 (Operations) — User acceptance test checklist

Run against the CorexLab test environment (`https://fms.corexlab.net`) or a Docker test stack (`docs/DEPLOYMENT.md` §1) after loading the demo data:

```bash
FMS_URL=https://fms.corexlab.net/api FMS_EMAIL=admin@fms.local FMS_PASSWORD='<admin password>' node deploy/demo/seed-demo.cjs
```

The demo seed is idempotent. It sets the approval limits, control rules and POD rules. It also adds:

- depot and restricted geofences;
- vehicle purchase and lease data;
- budgets and a shared cost;
- 8 DMS orders for tomorrow and a planned load;
- an incident with an insurance claim;
- an expense waiting for approval;
- a fuel card statement.

Logins: `admin@fms.local` (company admin), `manager@fms.local` (fleet manager), `driver@fms.local` (driver, mobile app). On CorexLab the GPS feed is simulated (mock telematics) until the Watch Tower API is connected; fuel-card API sync uses a mock provider.

Tick each line and record defects with the step number.

## A. Driver safety, incidents, claims (S7)
1. [ ] *Driver safety*: fleet score, event mix and driver ranking for 30 days; a driver below the threshold is highlighted.
2. [ ] Harsh braking/acceleration/cornering events appear on *Events* and lower the driver's score.
3. [ ] Report an incident (web and driver app, with photos); investigation fields and status flow work; the demo incident has a claim.
4. [ ] Insurance claim: submit → approve amount → paid; a claim above the approval limit waits in *Approvals*.

## B. Inspections, training, incentives (S8)
5. [ ] Checklist templates per vehicle class; the driver completes a pre-trip inspection in the app with a defect photo → a repair request is raised.
6. [ ] With the pre-trip gate on, a trip cannot start until today's inspection is done; a critical failure blocks the vehicle.
7. [ ] Training records with certificates; expiring certificates alert managers (`compliance-alerts`).
8. [ ] Incentives: monthly safety bonuses are proposed and approved by a company admin (not by the proposer); penalties reduce the total; CSV export.

## C. Integrations and approvals (S9)
9. [ ] *Integrations → API keys*: create a key (shown once), use it for `PUT /api/integrations/v1/orders/{ref}`, revoke it (→ 401).
10. [ ] Webhooks: add an endpoint (e.g. a webhook.site URL), *Send test*, see signed deliveries for `order.*` and `trip.*`; a failing endpoint retries and can be redelivered.
11. [ ] Approvals: the demo expense (250,000 > 200,000 limit) is in *Approvals*; the requester cannot approve their own; approve → the expense counts in costs.
12. [ ] Booking requests: a requester asks for a vehicle; a manager approves and a trip is created.

## D. Delivery planning (S10)
13. [ ] *Delivery planning* for tomorrow: the 8 demo orders, capacity bars per vehicle (kg, m³, cases, pallets, stops); a load over capacity is refused.
14. [ ] Auto-fill proposes loads; create one; reorder, add and remove stops until the trip starts.
15. [ ] Printable manifest with COD and signature lines.
16. [ ] Driver app: stop list with call and navigate; delivered / partly delivered (quantities) / failed (reason); completing the trip is blocked while stops are open.

## E. Routing, proof of delivery, returns, delivery KPIs (S11)
17. [ ] *Delivery planning* shows "Road routing (OSRM/VROOM) on"; a new load gets road km, a route on the map and an ETA per stop.
18. [ ] Driver app proof of delivery: photo required, optional signature, GPS position, cash collected; a delivery far from the customer or with short cash is flagged.
19. [ ] Customer return at a stop (driver app); `return.collected` webhook.
20. [ ] After the trip: warehouse check-in of undelivered goods, returns and cash; differences notify managers.
21. [ ] *Delivery KPIs*: OTIF, success rate, cost per drop, fill rate, stop order kept, ETA error; POD exceptions list; CSV.

## F. Costs, budgets, control (S12)
22. [ ] *Costs & TCO*: ownership (depreciation or lease), running and shared costs per vehicle, cost per km, book value; vehicles without asset data are marked.
23. [ ] *Budgets*: branch / department / company grids, actual vs budget with colours; edit a cell and save; *Copy from last year* with a % change; a budget at 90 % / 100 % notifies managers once (`budget-alerts`).
24. [ ] Shared cost of the month is split over vehicles by km (see the *Shared* column).
25. [ ] Cost per trip list: km × full cost per km + trip expenses + driver cost per day.
26. [ ] Control rules (Settings): with working hours on, a vehicle moving on Sunday raises *Outside working hours*; entering *Thilawa port (restricted)* raises a critical alert; a trip planned on OSRM raises *Off route* when the vehicle leaves the route.

## G. Mobile: offline and manager mode (S12)
27. [ ] Driver app in airplane mode: mark arrived / delivered with photo, record fuel, report a problem → the bar shows "Offline · n waiting"; reconnect → everything is sent once, in order, with the original times.
28. [ ] A rejected offline action appears under "not sent" with the reason; *Try again* / *Discard* work.
29. [ ] Manager signs in to the same app: Fleet summary, Approvals with photos/receipts, approve / reject with a note; tapping an approval push opens the request.

## H. Fuel control, cards, sensors, diagnostics (S13)
30. [ ] A fill recorded in the app far from the truck (or while it drives) is flagged *Vehicle was not at the fill location*; odometer km very different from GPS km is flagged.
31. [ ] *Fuel → Consumption*: km/L per vehicle vs expected, excess litres and cost, fuel budget of the month.
32. [ ] *Fuel → Fuel cards*: the demo statement is reconciled — matched, one mismatch (12 % more expensive), one not recorded, one car wash (not fuel); import the same file again → nothing new; review actions (accept, record fill, not fuel); assign the spare card to a vehicle.
33. [ ] Import a statement from your card provider (CSV or Excel): map the columns once, preview, import; the mapping is remembered next time.
34. [ ] Vehicle page: *Engine & fuel sensor* card (mock data on CorexLab: fuel level, battery, coolant; a trouble code on some vehicles); a configured code (P03…) opens a repair request.
35. [ ] Vehicle history: filters by kind (trips, fuel, maintenance, repairs, expenses, incidents, inspections, alerts); *Older entries* pages back.

## I. Loading/unloading, group administration (S14)
36. [ ] *Loading & unloading*: visits to the depot geofence (loading) and to delivery stops (unloading) with average and p90 minutes per vehicle, driver and site.
37. [ ] During a delivery trip, a vehicle stopping at a customer is marked *arrived (GPS)* on the load page; a driver's own "Arrived" is never overwritten.
38. [ ] *Users*: invite a user (e-mail arrives with a link), the link sets the password and then expires; resend invite; change roles; deactivate → the user is signed out and cannot sign in.
39. [ ] *Forgot your password?* on the web and in the app: the same answer for known and unknown e-mails; the link works once and for one hour.
40. [ ] *Group companies* (super admin): create a company with its first admin (invited by e-mail); that admin sees only the new company; deactivating a company signs its users out.
41. [ ] Company B cannot see any record of company A in any Phase 2 screen or API (orders, loads, budgets, cards, visits, approvals) — try direct URLs.

## J. Operations
42. [ ] `helm upgrade` to a new image: migrations apply, pods roll without downtime, routing data is kept on its volume.
43. [ ] Jobs run on schedule (worker logs): `webhook-dispatch`, `budget-alerts`, `fuel-card-sync` (when enabled), `daily-stats`.
44. [ ] E-mail (invitations, resets, warning/critical alerts) arrives through the configured SMTP server.

Sign-off: ______________________ (fleet operations) ______________________ (logistics) ______________________ (finance) ______________________ (IT) Date: __________
