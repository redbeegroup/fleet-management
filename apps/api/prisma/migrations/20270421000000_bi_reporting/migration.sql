-- Sprint 15: read-only BI access (Power BI, Metabase, Tableau).
--
-- BI tools connect with their own PostgreSQL login. A login can read only the views in
-- schema "reporting"; it has no rights on the application tables. Each view filters rows
-- with fms_bi_sees(company_id): a company login sees its company, the group login sees all.
-- The login -> company mapping lives in fms_bi.logins and is keyed by session_user, which
-- a session cannot change. The views run with their owner's rights (the migration role);
-- for a non-superuser owner, which is subject to FORCE ROW LEVEL SECURITY, an extra SELECT
-- policy for that owner applies the same rule, so application queries are unaffected.

CREATE SCHEMA IF NOT EXISTS fms_bi;
REVOKE ALL ON SCHEMA fms_bi FROM PUBLIC;

CREATE TABLE IF NOT EXISTS fms_bi.logins (
  role_name  text PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS logins_company_key ON fms_bi.logins (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE OR REPLACE FUNCTION fms_bi_sees(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fms_bi, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM fms_bi.logins l
    WHERE l.role_name = session_user AND (l.company_id IS NULL OR l.company_id = cid)
  )
$$;

CREATE SCHEMA IF NOT EXISTS reporting;
REVOKE ALL ON SCHEMA reporting FROM PUBLIC;

CREATE VIEW reporting.companies AS
SELECT c.id AS company_id, c.code AS company_code, c.name, c.timezone, c.currency, c.active
FROM public.companies c
WHERE fms_bi_sees(c.id);
COMMENT ON VIEW reporting.companies IS 'One row per group company.';

CREATE VIEW reporting.branches AS
SELECT x.company_id, c.code AS company_code,
       x.id AS branch_id, x.code, x.name, x.address, x.latitude, x.longitude, x.active
FROM public.branches x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.branches IS 'Branches / depots.';

CREATE VIEW reporting.departments AS
SELECT x.company_id, c.code AS company_code,
       x.id AS department_id, x.code, x.name
FROM public.departments x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.departments IS 'Departments (cost centres).';

CREATE VIEW reporting.vehicles AS
SELECT x.company_id, c.code AS company_code,
       x.id AS vehicle_id, x.plate_number, x.vin, x.make, x.model, x.year, x.vehicle_class::text AS vehicle_class,
       x.ownership::text AS ownership, x.fuel_type, x.status::text AS status, x.branch_id, b.name AS branch_name,
       x.department_id, d.name AS department_name, x.odometer_km, x.capacity_kg, x.capacity_m3, x.capacity_cases,
       x.capacity_pallets, x.tank_capacity_l, x.acquired_at, x.in_service_at, x.disposed_at, x.purchase_price,
       x.residual_value, x.useful_life_months, x.monthly_lease_cost, x.deleted_at IS NOT NULL AS deleted
FROM public.vehicles x
JOIN public.companies c ON c.id = x.company_id
LEFT JOIN public.branches b ON b.id = x.branch_id
LEFT JOIN public.departments d ON d.id = x.department_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.vehicles IS 'Vehicles with asset data (purchase or lease) for TCO.';

CREATE VIEW reporting.drivers AS
SELECT x.company_id, c.code AS company_code,
       x.id AS driver_id, x.employee_no, x.full_name, x.branch_id, x.active
FROM public.drivers x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.drivers IS 'Drivers.';

CREATE VIEW reporting.trips AS
SELECT x.company_id, c.code AS company_code,
       x.id AS trip_id, x.trip_no, x.kind::text AS kind, x.status::text AS status, x.branch_id, x.vehicle_id, x.driver_id,
       x.purpose, x.origin_name, x.destination_name, x.planned_start, x.planned_end, x.actual_start, x.actual_end,
       ((x.actual_start AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date,
       coalesce(x.gps_distance_km, x.end_odometer_km - x.start_odometer_km) AS distance_km,
       x.planned_km, x.planned_minutes, x.cargo_weight_kg,
       CASE WHEN x.actual_end IS NOT NULL AND x.actual_start IS NOT NULL THEN extract(epoch FROM x.actual_end - x.actual_start) / 60 END AS duration_min
FROM public.trips x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.trips IS 'Trips; times in UTC and in company-local time; distance from GPS, else odometer.';

CREATE VIEW reporting.vehicle_daily AS
SELECT x.company_id, c.code AS company_code, x.vehicle_id, x.day, x.distance_km, x.engine_minutes, x.moving_minutes,
       x.idle_minutes, x.max_speed_kmh
FROM public.vehicle_daily_stats x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.vehicle_daily IS 'Daily GPS statistics per vehicle (company-local day).';

CREATE VIEW reporting.fuel AS
SELECT x.company_id, c.code AS company_code,
       x.id AS fuel_id, x.vehicle_id, x.driver_id, x.filled_at, ((x.filled_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date, x.litres, x.unit_price,
       x.total_cost, x.fuel_type, x.station, x.full_tank, x.odometer_km, x.distance_km, x.km_per_litre, x.source,
       x.approval_status::text AS approval_status, array_to_string(x.flags, ',') AS flags
FROM public.fuel_records x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.fuel IS 'Fuel fills (all approval states; filter approval_status = APPROVED for costs).';

CREATE VIEW reporting.work_orders AS
SELECT x.company_id, c.code AS company_code,
       x.id AS work_order_id, x.wo_no, x.vehicle_id, x.type::text AS type, x.status::text AS status, x.priority, x.title,
       x.workshop, x.off_road, x.opened_at, x.started_at, x.completed_at, ((x.completed_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS completed_local_date,
       x.estimated_cost, x.total_cost,
       CASE WHEN x.completed_at IS NOT NULL THEN extract(epoch FROM x.completed_at - x.opened_at) / 3600 END AS downtime_hours
FROM public.work_orders x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.work_orders IS 'Maintenance and repair work orders.';

CREATE VIEW reporting.expenses AS
SELECT x.company_id, c.code AS company_code,
       x.id AS expense_id, x.vehicle_id, x.trip_id, x.category, x.incurred_at, ((x.incurred_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date,
       x.amount, x.description, x.approval_status::text AS approval_status
FROM public.vehicle_expenses x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.expenses IS 'Vehicle expenses (tolls, parking, repairs on the road…).';

CREATE VIEW reporting.cost_ledger AS
SELECT company_id, company_code, vehicle_id, local_date, to_char(local_date, 'YYYY-MM') AS period, category, source, source_id, amount
FROM (
  SELECT x.company_id, c.code AS company_code, x.vehicle_id, ((x.filled_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date,
         'FUEL' AS category, 'fuel' AS source, x.id AS source_id, x.total_cost AS amount
  FROM public.fuel_records x JOIN public.companies c ON c.id = x.company_id
  WHERE x.approval_status = 'APPROVED'
  UNION ALL
  SELECT x.company_id, c.code, x.vehicle_id, ((x.completed_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date,
         'MAINTENANCE', 'maintenance', x.id, x.total_cost
  FROM public.work_orders x JOIN public.companies c ON c.id = x.company_id
  WHERE x.status = 'COMPLETED' AND x.completed_at IS NOT NULL AND x.total_cost IS NOT NULL
  UNION ALL
  SELECT x.company_id, c.code, x.vehicle_id, ((x.incurred_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date,
         x.category, 'expense', x.id, x.amount
  FROM public.vehicle_expenses x JOIN public.companies c ON c.id = x.company_id
  WHERE x.approval_status = 'APPROVED'
) l
WHERE fms_bi_sees(l.company_id);
COMMENT ON VIEW reporting.cost_ledger IS 'Direct costs by vehicle and day: approved fuel, completed work orders, approved expenses. Ownership (depreciation/lease), document fees and shared-cost allocation are in the FMS Costs & TCO screens and the vehicles/shared_costs views.';

CREATE VIEW reporting.shared_costs AS
SELECT x.company_id, c.code AS company_code,
       x.id AS shared_cost_id, x.period, x.branch_id, x.department_id, x.category, x.description, x.amount
FROM public.shared_costs x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.shared_costs IS 'Shared (non-vehicle) costs per month, before allocation.';

CREATE VIEW reporting.budgets AS
SELECT x.company_id, c.code AS company_code,
       x.id AS budget_id, x.period, x.scope_key, x.branch_id, x.department_id, x.category, x.amount
FROM public.budgets x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.budgets IS 'Budgets per period (YYYY-MM), scope (company, branch or department) and category.';

CREATE VIEW reporting.customers AS
SELECT x.company_id, c.code AS company_code,
       x.id AS customer_id, x.code, x.name, x.township, x.city, x.latitude, x.longitude, x.active
FROM public.customers x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.customers IS 'Delivery customers.';

CREATE VIEW reporting.delivery_orders AS
SELECT x.company_id, c.code AS company_code,
       x.id AS order_id, x.external_ref, x.source, x.customer_id, x.branch_id, x.status::text AS status, x.priority, x.order_date,
       x.delivery_date, x.window_start, x.window_end, x.delivered_at, x.trip_id, x.stop_id, x.total_weight_kg, x.total_volume_m3,
       x.total_cases, x.total_pallets, x.cod_amount, x.failure_reason, x.cancelled_at
FROM public.delivery_orders x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.delivery_orders IS 'Delivery orders (from the DMS or entered in FMS).';

CREATE VIEW reporting.delivery_stops AS
SELECT x.company_id, c.code AS company_code,
       x.id AS stop_id, x.trip_id, x.seq, x.customer_id, x.name, x.status::text AS status, x.planned_arrival, x.arrived_at,
       x.arrival_source, x.completed_at, x.failure_reason, x.cod_expected, x.cod_collected, x.pod_distance_m,
       array_to_string(x.pod_flags, ',') AS pod_flags,
       CASE WHEN x.arrived_at IS NOT NULL AND x.planned_arrival IS NOT NULL THEN extract(epoch FROM x.arrived_at - x.planned_arrival) / 60 END AS eta_error_min
FROM public.trip_stops x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.delivery_stops IS 'Stops of delivery trips with proof-of-delivery results.';

CREATE VIEW reporting.site_visits AS
SELECT x.company_id, c.code AS company_code,
       x.id AS visit_id, x.vehicle_id, x.driver_id, x.trip_id, x.kind, x.category, x.site_name, x.geofence_id, x.stop_id,
       x.customer_id, x.entered_at, x.exited_at, ((x.entered_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date, x.duration_min
FROM public.site_visits x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.site_visits IS 'Loading (depots) and unloading (customers) visits measured from GPS.';

CREATE VIEW reporting.incidents AS
SELECT x.company_id, c.code AS company_code,
       x.id AS incident_id, x.incident_no, x.vehicle_id, x.driver_id, x.trip_id, x.type::text AS type, x.severity,
       x.status::text AS status, x.occurred_at, ((x.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date, x.injuries, x.estimated_cost, x.closed_at
FROM public.incidents x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.incidents IS 'Accidents and incidents.';

CREATE VIEW reporting.insurance_claims AS
SELECT x.company_id, c.code AS company_code,
       x.id AS claim_id, x.claim_no, x.incident_id, x.insurer, x.status::text AS status, x.submitted_at, x.amount_claimed,
       x.amount_approved, x.amount_paid, x.decided_at, x.settled_at
FROM public.insurance_claims x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.insurance_claims IS 'Insurance claims of incidents.';

CREATE VIEW reporting.inspections AS
SELECT x.company_id, c.code AS company_code,
       x.id AS inspection_id, x.inspection_no, x.vehicle_id, x.driver_id, x.trip_id, x.kind::text AS kind, x.performed_at,
       ((x.performed_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date, x.result::text AS result, x.defects, x.critical_defects
FROM public.inspections x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.inspections IS 'Vehicle inspections (pre-trip, periodic).';

CREATE VIEW reporting.alerts AS
SELECT x.company_id, c.code AS company_code,
       x.id AS event_id, x.vehicle_id, x.driver_id, x.type::text AS type, x.occurred_at, ((x.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date,
       x.ended_at, x.speed_kmh, x.latitude, x.longitude, x.geofence_id
FROM public.telemetry_events x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.alerts IS 'Telematics and control events (speeding, harsh driving, geofence, off route, after hours…).';

CREATE VIEW reporting.vehicle_documents AS
SELECT x.company_id, c.code AS company_code,
       x.id AS document_id, x.vehicle_id, x.type::text AS type, x.number, x.issuer, x.issued_at, x.expires_at, x.amount
FROM public.vehicle_documents x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.vehicle_documents IS 'Vehicle documents (registration, insurance, permits) with expiry.';

CREATE VIEW reporting.driver_licenses AS
SELECT x.company_id, c.code AS company_code,
       x.id AS license_id, x.driver_id, x.license_class, x.issued_at, x.expires_at
FROM public.driver_licenses x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.driver_licenses IS 'Driver licences with expiry.';

CREATE VIEW reporting.calendar AS
SELECT d::date AS date, extract(year FROM d)::int AS year, extract(quarter FROM d)::int AS quarter,
       extract(month FROM d)::int AS month, to_char(d, 'Mon') AS month_name, to_char(d, 'YYYY-MM') AS period,
       extract(isoyear FROM d)::int AS iso_year, extract(week FROM d)::int AS iso_week,
       extract(isodow FROM d)::int AS weekday, extract(isodow FROM d) IN (6, 7) AS weekend
FROM generate_series('2020-01-01'::date, '2040-12-31'::date, interval '1 day') d;
COMMENT ON VIEW reporting.calendar IS 'Calendar 2020–2040 for date tables in BI tools.';

-- Owner policy (see header). Superusers / BYPASSRLS owners skip RLS; the views' own filter applies.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies', 'branches', 'departments', 'vehicles', 'drivers', 'trips', 'vehicle_daily_stats', 'fuel_records', 'work_orders', 'vehicle_expenses', 'shared_costs', 'budgets', 'customers', 'delivery_orders', 'trip_stops', 'site_visits', 'incidents', 'insurance_claims', 'inspections', 'telemetry_events', 'vehicle_documents', 'driver_licenses'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS bi_read ON public.%I', t);
    EXECUTE format('CREATE POLICY bi_read ON public.%I FOR SELECT TO %I USING (fms_bi_sees(%s))', t, current_user, CASE WHEN t = 'companies' THEN 'id' ELSE 'company_id' END);
  END LOOP;
END $$;

-- Group role of all BI logins: read the reporting views, nothing else.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fms_bi_reader') THEN
    BEGIN
      CREATE ROLE fms_bi_reader NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'fms_bi_reader not created (no CREATEROLE). BI logins stay unavailable until a DBA creates it; see docs/BI_REPORTING.md.';
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fms_bi_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA reporting TO fms_bi_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO fms_bi_reader';
  END IF;
END $$;
