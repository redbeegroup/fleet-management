-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'ASSIGNED', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "company_counters" (
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "company_counters_pkey" PRIMARY KEY ("company_id","key")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "trip_no" TEXT NOT NULL,
    "branch_id" UUID,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "purpose" TEXT,
    "origin_name" TEXT NOT NULL,
    "origin_lat" DOUBLE PRECISION,
    "origin_lng" DOUBLE PRECISION,
    "destination_name" TEXT NOT NULL,
    "destination_lat" DOUBLE PRECISION,
    "destination_lng" DOUBLE PRECISION,
    "planned_start" TIMESTAMP(3) NOT NULL,
    "planned_end" TIMESTAMP(3) NOT NULL,
    "actual_start" TIMESTAMP(3),
    "actual_end" TIMESTAMP(3),
    "start_odometer_km" DECIMAL(12,1),
    "end_odometer_km" DECIMAL(12,1),
    "gps_distance_km" DECIMAL(10,1),
    "cargo_description" TEXT,
    "cargo_weight_kg" DECIMAL(12,2),
    "notes" TEXT,
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_status_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "from_status" "TripStatus",
    "to_status" "TripStatus" NOT NULL,
    "note" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_sessions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'web',
    "created_by" UUID,

    CONSTRAINT "duty_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trips_company_id_planned_start_idx" ON "trips"("company_id", "planned_start");

-- CreateIndex
CREATE INDEX "trips_vehicle_id_planned_start_idx" ON "trips"("vehicle_id", "planned_start");

-- CreateIndex
CREATE INDEX "trips_driver_id_planned_start_idx" ON "trips"("driver_id", "planned_start");

-- CreateIndex
CREATE INDEX "trips_company_id_status_idx" ON "trips"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trips_company_id_trip_no_key" ON "trips"("company_id", "trip_no");

-- CreateIndex
CREATE INDEX "trip_status_events_trip_id_created_at_idx" ON "trip_status_events"("trip_id", "created_at");

-- CreateIndex
CREATE INDEX "duty_sessions_driver_id_started_at_idx" ON "duty_sessions"("driver_id", "started_at");

-- CreateIndex
CREATE INDEX "duty_sessions_company_id_started_at_idx" ON "duty_sessions"("company_id", "started_at");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_status_events" ADD CONSTRAINT "trip_status_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duty_sessions" ADD CONSTRAINT "duty_sessions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security for the new tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_counters','trips','trip_status_events','duty_sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (fms_rls_bypass() OR company_id = fms_current_company()) '
      'WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company())', t);
  END LOOP;
END $$;

-- At most one open duty session per driver.
CREATE UNIQUE INDEX duty_sessions_one_open_per_driver ON duty_sessions (driver_id) WHERE ended_at IS NULL;
