-- CreateTable
CREATE TABLE "vehicle_expenses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "trip_id" UUID,
    "category" TEXT NOT NULL,
    "incurred_at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "receipt_file_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_daily_stats" (
    "vehicle_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "company_id" UUID NOT NULL,
    "distance_km" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "engine_minutes" INTEGER NOT NULL DEFAULT 0,
    "moving_minutes" INTEGER NOT NULL DEFAULT 0,
    "idle_minutes" INTEGER NOT NULL DEFAULT 0,
    "max_speed_kmh" DOUBLE PRECISION,
    "positions" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_daily_stats_pkey" PRIMARY KEY ("vehicle_id","day")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "push_token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_expenses_company_id_incurred_at_idx" ON "vehicle_expenses"("company_id", "incurred_at");

-- CreateIndex
CREATE INDEX "vehicle_expenses_vehicle_id_incurred_at_idx" ON "vehicle_expenses"("vehicle_id", "incurred_at");

-- CreateIndex
CREATE INDEX "vehicle_daily_stats_company_id_day_idx" ON "vehicle_daily_stats"("company_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_push_token_key" ON "user_devices"("push_token");

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "user_devices"("user_id");

-- AddForeignKey
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security for the new tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicle_expenses','vehicle_daily_stats','user_devices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (fms_rls_bypass() OR company_id = fms_current_company()) '
      'WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company())', t);
  END LOOP;
END $$;

-- Rolls GPS positions up into vehicle_daily_stats for local days [p_from, p_to] (company timezone).
-- Gaps longer than 10 minutes are not counted as engine/moving/idle time; segments faster
-- than 250 km/h are treated as GPS jumps and excluded from distance.
CREATE OR REPLACE FUNCTION fms_rollup_daily_stats(p_from date, p_to date) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  WITH pos AS (
    SELECT p.company_id, p.vehicle_id, p.recorded_at, p.latitude, p.longitude, p.speed_kmh, p.ignition,
           (p.recorded_at AT TIME ZONE c.timezone)::date AS day,
           lag(p.recorded_at) OVER w AS prev_t, lag(p.latitude) OVER w AS prev_lat, lag(p.longitude) OVER w AS prev_lng,
           lag(p.speed_kmh) OVER w AS prev_speed, lag(p.ignition) OVER w AS prev_ign
      FROM vehicle_positions p
      JOIN companies c ON c.id = p.company_id
     WHERE p.recorded_at >= (p_from::timestamp AT TIME ZONE 'UTC') - interval '1 day'
       AND p.recorded_at <  (p_to::timestamp AT TIME ZONE 'UTC') + interval '2 day'
    WINDOW w AS (PARTITION BY p.vehicle_id, (p.recorded_at AT TIME ZONE c.timezone)::date ORDER BY p.recorded_at)
  ), seg AS (
    SELECT company_id, vehicle_id, day, speed_kmh, prev_speed, prev_ign,
           EXTRACT(EPOCH FROM (recorded_at - prev_t)) AS dt,
           CASE WHEN prev_lat IS NULL THEN 0 ELSE
             2 * 6371.0088 * asin(least(1, sqrt(
               power(sin(radians(latitude - prev_lat) / 2), 2) +
               cos(radians(prev_lat)) * cos(radians(latitude)) * power(sin(radians(longitude - prev_lng) / 2), 2)))) END AS km
      FROM pos
     WHERE day BETWEEN p_from AND p_to
  ), agg AS (
    SELECT company_id, vehicle_id, day,
           sum(CASE WHEN dt > 0 AND km / (dt / 3600.0) <= 250 THEN km ELSE 0 END) AS distance_km,
           sum(CASE WHEN prev_ign AND dt <= 600 THEN dt ELSE 0 END) / 60 AS engine_min,
           sum(CASE WHEN coalesce(prev_speed, 0) >= 3 AND dt <= 600 THEN dt ELSE 0 END) / 60 AS moving_min,
           sum(CASE WHEN prev_ign AND coalesce(prev_speed, 0) < 3 AND dt <= 600 THEN dt ELSE 0 END) / 60 AS idle_min,
           max(speed_kmh) AS max_speed,
           count(*) AS positions
      FROM seg
     GROUP BY company_id, vehicle_id, day
  )
  INSERT INTO vehicle_daily_stats (vehicle_id, day, company_id, distance_km, engine_minutes, moving_minutes, idle_minutes, max_speed_kmh, positions, computed_at)
  SELECT vehicle_id, day, company_id, round(distance_km::numeric, 2), engine_min::int, moving_min::int, idle_min::int, max_speed, positions, now()
    FROM agg
  ON CONFLICT (vehicle_id, day) DO UPDATE SET
    distance_km = EXCLUDED.distance_km, engine_minutes = EXCLUDED.engine_minutes, moving_minutes = EXCLUDED.moving_minutes,
    idle_minutes = EXCLUDED.idle_minutes, max_speed_kmh = EXCLUDED.max_speed_kmh, positions = EXCLUDED.positions, computed_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
