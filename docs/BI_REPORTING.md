# BI reporting access (Power BI, Metabase, Tableau)

FMS gives BI tools **read-only PostgreSQL logins** that can read a stable set of views in schema `reporting`, and nothing else.

- **Company login** (`fms_bi_<company code>`): sees only that company's rows.
- **Group login** (`fms_bi_group`): sees every company of the group; use the `company_code` column to compare companies.

## How it is secured

- A BI login is a PostgreSQL role in the group role `fms_bi_reader`. It has `SELECT` on the `reporting` views only; it has **no rights on the application tables** (`public.*`).
- Every view filters rows with `fms_bi_sees(company_id)`. This function looks up the connected login (`session_user`, which a session cannot change) in `fms_bi.logins`. Setting `app.company_id` or `app.bypass_rls` in a BI session changes nothing.
- Logins are read-only (`default_transaction_read_only`), limited to 10 connections, and queries stop after 300 s.
- Passwords are random (32 characters), **shown once** when created or rotated. FMS does not store them; PostgreSQL keeps only the SCRAM hash.
- Creating, rotating and removing logins is audited (`bi.login.*`).

## Managing logins

*Group companies → BI access* (super admins):

1. Choose a company (or *All companies* for the group login) and press **Create BI login**.
2. Copy the password now and store it in your BI tool or a password manager.
3. **New password** rotates it; the old one stops working at once.
4. **Remove** drops the login and closes its open sessions.

The card also shows the connection details: host, port, database, schema `reporting` and SSL mode.

### Prerequisites (DBA, once)

The API runs role DDL through `BI_ADMIN_DATABASE_URL`, or else `DATABASE_MIGRATION_URL`. That role needs `CREATEROLE` and `ADMIN` on `fms_bi_reader`:

```sql
CREATE ROLE fms_bi_reader NOLOGIN;            -- the migration creates it if it may
GRANT fms_bi_reader TO fms_migrator WITH ADMIN OPTION;
ALTER ROLE fms_migrator CREATEROLE;
```

The views are owned by the migration role. Two setups work:

- The migration role is a non-superuser that owns the tables (production). An extra `bi_read` SELECT policy for that owner applies the same per-login rule under `FORCE ROW LEVEL SECURITY`.
- The migration role is a superuser (test clusters). Its views bypass RLS and filter with the view condition.

Roles are cluster-wide: on a shared PostgreSQL cluster, use different company codes per environment, or one cluster per environment.

### Network access

BI tools connect to PostgreSQL directly; keep it private:

- **Power BI (cloud):** install the on-premises data gateway in the network that can reach the database.
- **Metabase / Tableau Server:** run them inside the network, or allow their IPs in `pg_hba.conf` and the firewall.
- **CorexLab test cluster:** the database is internal (ClusterIP). For a quick test from a workstation, use `kubectl -n fms port-forward svc/fms-db 5432:5432`, then connect to `localhost:5432`.

Use TLS (`sslmode=require`) outside the cluster network.

## Connecting the tools

- **Power BI Desktop:** *Get data → PostgreSQL database*.
  1. Server: `host:port`. Database: `fms`. Data connectivity mode: *Import* (recommended) or *DirectQuery*.
  2. Credentials: *Database*, with the BI login and password.
  3. Pick tables from the `reporting` schema.
  4. Publish, then set the gateway and the scheduled refresh in the Power BI service.
- **Metabase:** *Admin → Databases → Add database → PostgreSQL*.
  1. Enter host, port, database name, the BI login and password.
  2. Under *Schemas*, choose *Only these…* and enter `reporting`.
  3. Enable SSL when connecting over an untrusted network.
- **Tableau:** *Connect → PostgreSQL*.
  1. Server, port, database, *Username and Password*. Require SSL if needed.
  2. Choose schema `reporting`.
  3. Use extracts for large tables such as `alerts` and `vehicle_daily`.

**Joins:** every view has `company_id` and `company_code`. Join on the id columns: `vehicle_id`, `driver_id`, `trip_id`, `branch_id`, `customer_id`, and so on. Use `reporting.calendar` as the date table, related on `local_date` or `day`.

## Conventions

- Timestamps are UTC (`timestamp without time zone`, values in UTC). `local_date` columns are the company-local day: use these for daily, weekly and monthly reports.
- Money is in the company currency (`reporting.companies.currency`).
- Enum values are upper-case text (e.g. `status = 'COMPLETED'`).
- `fuel`, `expenses`: filter `approval_status = 'APPROVED'` for costs. `cost_ledger` already includes only approved and completed costs.
- `cost_ledger` holds direct costs: fuel, maintenance and expenses. Ownership costs come from these sources:
  - Depreciation: straight line, (`purchase_price` − `residual_value`) / `useful_life_months` from `in_service_at`.
  - Lease: `monthly_lease_cost`.
  - Document fees: `vehicle_documents.amount` spread over their validity.
  - Shared costs: `shared_costs`, allocated by km in FMS.

  FMS's *Costs & TCO* screen shows the full allocation.

## Data dictionary

| View | Content | Columns |
|---|---|---|
| `reporting.alerts` | Telematics and control events (speeding, harsh driving, geofence, off route, after hours…). | company_id, company_code, event_id, vehicle_id, driver_id, type, occurred_at, local_date, ended_at, speed_kmh, latitude, longitude, geofence_id |
| `reporting.branches` | Branches / depots. | company_id, company_code, branch_id, code, name, address, latitude, longitude, active |
| `reporting.budgets` | Budgets per period (YYYY-MM), scope (company, branch or department) and category. | company_id, company_code, budget_id, period, scope_key, branch_id, department_id, category, amount |
| `reporting.calendar` | Calendar 2020–2040 for date tables in BI tools. | date, year, quarter, month, month_name, period, iso_year, iso_week, weekday, weekend |
| `reporting.companies` | One row per group company. | company_id, company_code, name, timezone, currency, active |
| `reporting.cost_ledger` | Direct costs by vehicle and day: approved fuel, completed work orders, approved expenses. Ownership (depreciation/lease), document fees and shared-cost allocation are in the FMS Costs & TCO screens and the vehicles/shared_costs views. | company_id, company_code, vehicle_id, local_date, period, category, source, source_id, amount |
| `reporting.customers` | Delivery customers. | company_id, company_code, customer_id, code, name, township, city, latitude, longitude, active |
| `reporting.delivery_orders` | Delivery orders (from the DMS or entered in FMS). | company_id, company_code, order_id, external_ref, source, customer_id, branch_id, status, priority, order_date, delivery_date, window_start, window_end, delivered_at, trip_id, stop_id, total_weight_kg, total_volume_m3, total_cases, total_pallets, cod_amount, failure_reason, cancelled_at |
| `reporting.delivery_stops` | Stops of delivery trips with proof-of-delivery results. | company_id, company_code, stop_id, trip_id, seq, customer_id, name, status, planned_arrival, arrived_at, arrival_source, completed_at, failure_reason, cod_expected, cod_collected, pod_distance_m, pod_flags, eta_error_min |
| `reporting.departments` | Departments (cost centres). | company_id, company_code, department_id, code, name |
| `reporting.driver_licenses` | Driver licences with expiry. | company_id, company_code, license_id, driver_id, license_class, issued_at, expires_at |
| `reporting.drivers` | Drivers. | company_id, company_code, driver_id, employee_no, full_name, branch_id, active |
| `reporting.expenses` | Vehicle expenses (tolls, parking, repairs on the road…). | company_id, company_code, expense_id, vehicle_id, trip_id, category, incurred_at, local_date, amount, description, approval_status |
| `reporting.fuel` | Fuel fills (all approval states; filter approval_status = APPROVED for costs). | company_id, company_code, fuel_id, vehicle_id, driver_id, filled_at, local_date, litres, unit_price, total_cost, fuel_type, station, full_tank, odometer_km, distance_km, km_per_litre, source, approval_status, flags |
| `reporting.incidents` | Accidents and incidents. | company_id, company_code, incident_id, incident_no, vehicle_id, driver_id, trip_id, type, severity, status, occurred_at, local_date, injuries, estimated_cost, closed_at |
| `reporting.inspections` | Vehicle inspections (pre-trip, periodic). | company_id, company_code, inspection_id, inspection_no, vehicle_id, driver_id, trip_id, kind, performed_at, local_date, result, defects, critical_defects |
| `reporting.insurance_claims` | Insurance claims of incidents. | company_id, company_code, claim_id, claim_no, incident_id, insurer, status, submitted_at, amount_claimed, amount_approved, amount_paid, decided_at, settled_at |
| `reporting.shared_costs` | Shared (non-vehicle) costs per month, before allocation. | company_id, company_code, shared_cost_id, period, branch_id, department_id, category, description, amount |
| `reporting.site_visits` | Loading (depots) and unloading (customers) visits measured from GPS. | company_id, company_code, visit_id, vehicle_id, driver_id, trip_id, kind, category, site_name, geofence_id, stop_id, customer_id, entered_at, exited_at, local_date, duration_min |
| `reporting.trips` | Trips; times in UTC and in company-local time; distance from GPS, else odometer. | company_id, company_code, trip_id, trip_no, kind, status, branch_id, vehicle_id, driver_id, purpose, origin_name, destination_name, planned_start, planned_end, actual_start, actual_end, local_date, distance_km, planned_km, planned_minutes, cargo_weight_kg, duration_min |
| `reporting.vehicle_daily` | Daily GPS statistics per vehicle (company-local day). | company_id, company_code, vehicle_id, day, distance_km, engine_minutes, moving_minutes, idle_minutes, max_speed_kmh |
| `reporting.vehicle_documents` | Vehicle documents (registration, insurance, permits) with expiry. | company_id, company_code, document_id, vehicle_id, type, number, issuer, issued_at, expires_at, amount |
| `reporting.vehicles` | Vehicles with asset data (purchase or lease) for TCO. | company_id, company_code, vehicle_id, plate_number, vin, make, model, year, vehicle_class, ownership, fuel_type, status, branch_id, branch_name, department_id, department_name, odometer_km, capacity_kg, capacity_m3, capacity_cases, capacity_pallets, tank_capacity_l, acquired_at, in_service_at, disposed_at, purchase_price, residual_value, useful_life_months, monthly_lease_cost, deleted |
| `reporting.work_orders` | Maintenance and repair work orders. | company_id, company_code, work_order_id, wo_no, vehicle_id, type, status, priority, title, workshop, off_road, opened_at, started_at, completed_at, completed_local_date, estimated_cost, total_cost, downtime_hours |

## Changing the views

The views are part of the database migrations. When a migration adds a view, it must also run `GRANT SELECT ON reporting.<view> TO fms_bi_reader` and filter with `fms_bi_sees(company_id)`. Existing columns are kept stable: add new columns at the end, and never rename or remove one without notice to BI users.
