-- CreateEnum
CREATE TYPE "GeofenceShape" AS ENUM ('CIRCLE', 'POLYGON');

-- CreateEnum
CREATE TYPE "TelemetryEventType" AS ENUM ('GEOFENCE_ENTER', 'GEOFENCE_EXIT', 'OVERSPEED', 'IDLE', 'IGNITION_ON', 'IGNITION_OFF', 'GPS_OFFLINE', 'GPS_RESTORED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "speed_limit_kmh" INTEGER;

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SITE',
    "shape" "GeofenceShape" NOT NULL,
    "center_lat" DOUBLE PRECISION,
    "center_lng" DOUBLE PRECISION,
    "radius_m" DOUBLE PRECISION,
    "polygon" JSONB,
    "alert_on_enter" BOOLEAN NOT NULL DEFAULT false,
    "alert_on_exit" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "type" "TelemetryEventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "speed_kmh" DOUBLE PRECISION,
    "geofence_id" UUID,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_telemetry_state" (
    "vehicle_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "last_fix_at" TIMESTAMP(3),
    "ignition" BOOLEAN,
    "inside_geofence_ids" TEXT[],
    "overspeed_event_id" UUID,
    "overspeed_max_kmh" DOUBLE PRECISION,
    "idle_since" TIMESTAMP(3),
    "idle_event_id" UUID,
    "offline_event_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_telemetry_state_pkey" PRIMARY KEY ("vehicle_id")
);

-- CreateIndex
CREATE INDEX "geofences_company_id_active_idx" ON "geofences"("company_id", "active");

-- CreateIndex
CREATE INDEX "telemetry_events_company_id_occurred_at_idx" ON "telemetry_events"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "telemetry_events_vehicle_id_occurred_at_idx" ON "telemetry_events"("vehicle_id", "occurred_at");

-- CreateIndex
CREATE INDEX "vehicle_telemetry_state_company_id_idx" ON "vehicle_telemetry_state"("company_id");


-- Row-Level Security for the new tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['geofences','telemetry_events','vehicle_telemetry_state'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (fms_rls_bypass() OR company_id = fms_current_company()) '
      'WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company())', t);
  END LOOP;
END $$;
