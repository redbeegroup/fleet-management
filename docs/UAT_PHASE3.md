# Phase 3 (Advanced) — User acceptance test checklist

Run against the CorexLab test environment (`https://fms.corexlab.net`) or a Docker test stack. Logins as in [UAT_PHASE2.md](UAT_PHASE2.md). Tick each line and record defects with the step number.

## A. Single sign-on (S15)

Needs the app registrations described in [DEPLOYMENT.md](DEPLOYMENT.md) §2.6d (group Microsoft tenant and/or Google Workspace) and a test user per domain.

1. [ ] *Settings → Sign-in*: add your e-mail domain for *Group Microsoft sign-in*. It shows *waiting for group approval*.
2. [ ] A super admin approves it on *Group companies → Group single sign-on domains*.
3. [ ] Invite a user with that domain on *Users*. On the login page, typing the e-mail shows *Continue with Microsoft*; sign-in works without setting a password. *Users* shows the SSO badge and *invited* disappears.
4. [ ] A Microsoft account of that domain that was **not** invited is refused with a clear message. So is an account of another tenant.
5. [ ] *Unlink SSO* on *Users*: the next Microsoft sign-in links the account again. A deactivated user is refused.
6. [ ] Company-owned provider: add your own Google Workspace (client ID and secret). *Test* succeeds. Add a domain for it: it is active at once. A personal Gmail account is refused.
7. [ ] *Require single sign-on*: password sign-in is refused for the company's users. A super admin can still sign in with a password. Switch it back.
8. [ ] Driver app: *Sign in with Microsoft/Google* opens the browser and returns to the app signed in.

## B. BI access (S15)

9. [ ] *Group companies → BI access*: create a company login. The password is shown once. Connection details are shown.
10. [ ] Connect Power BI Desktop, Metabase or Tableau ([BI_REPORTING.md](BI_REPORTING.md)). Schema `reporting` lists the views. Vehicles, trips, fuel and the cost ledger match FMS for the same period.
11. [ ] The company login sees only its company. The group login sees all companies (`company_code`). Neither can read `public` tables.
12. [ ] *New password*: the old password stops working. *Remove*: the login can no longer connect.

## C. Scheduled reports (S15)

13. [ ] *Scheduled reports*: preview each report (Fleet, Budget & TCO, Delivery, Safety & compliance) for daily, weekly and monthly periods. The figures match the related FMS screens. *Download PDF* works.
14. [ ] Subscribe users and an extra address. A dispatcher is not offered cost reports.
15. [ ] With SMTP configured: *Send now* delivers an e-mail with PDF and CSV attachments. The next scheduled report arrives at 07:00 company time, once.
16. [ ] Without SMTP: the run shows *Skipped — Not sent: SMTP is not configured*.

## D. Parts, tires, garages, warranty (S16)

Demo data: `deploy/demo/seed-demo.cjs` adds suppliers, parts in two depots, tires on a truck, an engine warranty and a recovered warranty claim.

17. [ ] *Parts & stock*: receive parts with an invoice. The average cost re-weights (e.g. 10 @ 100 + 10 @ 130 → 115). Transfer to another depot. Do a stock count and check the adjustment.
18. [ ] A storekeeper login can receive, transfer, count and issue parts to a work order, but cannot create work orders.
19. [ ] Work order → *Issue from store*: a PART line at the average cost with its warranty end. Issuing more than is in stock is refused. Removing the line puts the parts back.
20. [ ] *To reorder* lists items at or below minimum. The daily alert arrives once a week. *Movements → Export CSV* opens in Excel.
21. [ ] *Send to a garage* with a quote above the approval limit → approval needed. Completing asks for the invoice. The invoice becomes the cost when there are no lines.
22. [ ] *Suppliers & garages*: performance per garage (turnaround, back within 30 days, invoice vs quote).
23. [ ] Vehicle page → *Tires*: choose the layout; fit tires per position; record tread / pressure; swap two positions (km continue). Status colours and labels: Act now / Watch / OK.
24. [ ] *Inspections → Tire checklist*: the driver app shows number fields. A tread below the minimum fails the inspection and creates a repair request. Readings appear on the vehicle tire diagram.
25. [ ] *Tires*: positions needing attention; tire life and cost per km by brand.
26. [ ] Vehicle warranty (e.g. engine, until date / km). A work order with "engine" in the title shows *likely* warranty. A repeat repair of a part fitted within its warranty is flagged.
27. [ ] Warranty claim: create from the work order → submit → approved → money received. *Costs & TCO* shows the maintenance cost reduced by the recovered amount.
28. [ ] Company B sees none of company A's suppliers, parts, stock, tires, warranties or claims (also in BI views).

## E. Lifecycle, replacement, benchmarking (S17)

29. [ ] *Lifecycle*: each vehicle shows Replace / Plan / OK with reasons (age, km, downtime, running cost vs class, economic life). Vehicles without purchase data are marked.
30. [ ] Change a class limit (e.g. truck max age) in *Replacement limits*: the advice changes accordingly.
31. [ ] Set a replacement month for a vehicle; it shows on the vehicle page timeline.
32. [ ] Vehicle page → *Lifecycle*: lifetime cost, km and cost per km match *Costs & TCO* for the same period; book value as expected.
33. [ ] Dispose of a vehicle: refused while a work order or trip is open; afterwards status *Disposed*, gain / loss = sale value − book value, the vehicle leaves the active lists and depreciation stops.
34. [ ] *Benchmark*: choose a class; vehicles are ranked by score with the class median row; better / worse labels match the figures; branches compare fairly with different class mixes.

## F. Trailers & equipment, compliance, safety audits (S18)

35. [ ] Register a trailer (asset kind *Trailer*) and a generator (meter *Engine hours*). Record an hour reading; a lower reading is refused. A 250-hour service plan shows *due soon* near the interval.
36. [ ] A trailer cannot be chosen as the vehicle of a trip. On a planned trip, set the trailer; the same trailer on an overlapping trip is refused.
37. [ ] A delivery load above the tractor's capacity is accepted once the trailer is added; with legal payload limits set (*Compliance → Legal payload*) a load above tractor + trailer limit is refused.
38. [ ] Start the trip: the trailer shows *coupled* on its page and in the driver app; complete it and the trailer odometer grows by the trip km.
39. [ ] *Compliance*: check the Myanmar rules against current RTAD requirements and correct them. Each vehicle shows its document status; missing / expired documents are alerted weekly.
40. [ ] Turn on *dispatch blocking*: a vehicle without its licence or insurance cannot be assigned or start a trip (the reason is shown); after adding the documents it can.
41. [ ] *Safety audits → Perform audit*: a depot audit with failed items gets a score and corrective actions with owner and due date; a failed critical vehicle item fails the audit and creates a repair request.
42. [ ] The action owner sees it under *My actions*, marks it done with a note; another manager verifies it. Overdue actions are alerted; the branch trend shows score and open / overdue actions.

Sign-off: ______________________ (IT) ______________________ (finance) ______________________ (operations) Date: __________
