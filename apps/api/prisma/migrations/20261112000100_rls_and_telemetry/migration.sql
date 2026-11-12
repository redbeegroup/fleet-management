-- =====================================================================
-- Row-Level Security (tenant isolation, defence in depth)
--
-- The application sets, per transaction:
--   SELECT set_config('app.company_id', '<uuid>', true);   -- tenant scope
--   SELECT set_config('app.bypass_rls', 'on', true);       -- system jobs only
-- FORCE is used so that the policy also applies to the table owner.
-- =====================================================================

CREATE OR REPLACE FUNCTION fms_current_company() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION fms_rls_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on'
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches','departments','users','vehicles','vehicle_status_events',
    'vehicle_documents','vehicle_assignments','drivers','driver_licenses',
    'vehicle_last_positions','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (fms_rls_bypass() OR company_id = fms_current_company()) '
      'WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company())', t);
  END LOOP;
END $$;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON companies
  USING (fms_rls_bypass() OR id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR id = fms_current_company());

-- =====================================================================
-- Telemetry: GPS positions, range-partitioned by month (native partitioning,
-- no TimescaleDB dependency so it runs on any pre-installed PostgreSQL cluster).
-- Not modelled in Prisma; accessed with raw SQL from the telematics module.
-- =====================================================================

CREATE TABLE vehicle_positions (
  company_id   uuid        NOT NULL,
  vehicle_id   uuid        NOT NULL,
  recorded_at  timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  latitude     double precision NOT NULL,
  longitude    double precision NOT NULL,
  speed_kmh    real,
  heading      real,
  altitude_m   real,
  ignition     boolean,
  odometer_km  numeric(12,1),
  source       text NOT NULL DEFAULT 'watchtower',
  attributes   jsonb,
  PRIMARY KEY (vehicle_id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE INDEX vehicle_positions_company_time_idx ON vehicle_positions (company_id, recorded_at);

ALTER TABLE vehicle_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_positions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicle_positions
  USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

-- Creates the monthly partition containing p_day (idempotent).
CREATE OR REPLACE FUNCTION fms_ensure_position_partition(p_day date) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  start_d date := date_trunc('month', p_day)::date;
  end_d   date := (date_trunc('month', p_day) + interval '1 month')::date;
  part    text := 'vehicle_positions_' || to_char(start_d, 'YYYYMM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF vehicle_positions FOR VALUES FROM (%L) TO (%L)',
    part, start_d, end_d);
  RETURN part;
END $$;

-- Catch-all so that out-of-range rows are never rejected.
CREATE TABLE IF NOT EXISTS vehicle_positions_default PARTITION OF vehicle_positions DEFAULT;

SELECT fms_ensure_position_partition(current_date);
SELECT fms_ensure_position_partition((current_date + interval '1 month')::date);

-- =====================================================================
-- Grants for the least-privilege application role, if the DBA created it.
-- (Production: migrations run as fms_migrator, the app runs as fms_app.)
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fms_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO fms_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fms_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fms_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fms_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fms_app';
  END IF;
END $$;
