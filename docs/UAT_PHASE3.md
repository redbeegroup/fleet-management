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

Sign-off: ______________________ (IT) ______________________ (finance) ______________________ (operations) Date: __________
