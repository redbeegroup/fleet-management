-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('COLLISION', 'DAMAGE', 'THEFT', 'INJURY', 'NEAR_MISS', 'BREAKDOWN', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'INVESTIGATING', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'SETTLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TelemetryEventType" ADD VALUE 'HARSH_ACCEL';
ALTER TYPE "TelemetryEventType" ADD VALUE 'HARSH_BRAKE';
ALTER TYPE "TelemetryEventType" ADD VALUE 'HARSH_CORNER';

-- AlterTable
ALTER TABLE "telemetry_events" ADD COLUMN     "driver_id" UUID;

-- AlterTable
ALTER TABLE "vehicle_telemetry_state" ADD COLUMN     "last_heading" DOUBLE PRECISION,
ADD COLUMN     "last_speed_kmh" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "incident_no" TEXT NOT NULL,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "trip_id" UUID,
    "type" "IncidentType" NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" "IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "injuries" BOOLEAN NOT NULL DEFAULT false,
    "third_party" TEXT,
    "police_report_no" TEXT,
    "estimated_cost" DECIMAL(14,2),
    "photo_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "findings" TEXT,
    "corrective_actions" TEXT,
    "work_order_id" UUID,
    "reported_by" UUID,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "claim_no" TEXT NOT NULL,
    "incident_id" UUID NOT NULL,
    "insurer" TEXT,
    "policy_no" TEXT,
    "external_ref" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount_claimed" DECIMAL(14,2) NOT NULL,
    "amount_approved" DECIMAL(14,2),
    "amount_paid" DECIMAL(14,2),
    "decided_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_company_id_occurred_at_idx" ON "incidents"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "incidents_driver_id_occurred_at_idx" ON "incidents"("driver_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_company_id_incident_no_key" ON "incidents"("company_id", "incident_no");

-- CreateIndex
CREATE INDEX "insurance_claims_company_id_status_idx" ON "insurance_claims"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_claims_company_id_claim_no_key" ON "insurance_claims"("company_id", "claim_no");

-- CreateIndex
CREATE INDEX "telemetry_events_driver_id_occurred_at_idx" ON "telemetry_events"("driver_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security for the new tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incidents','insurance_claims'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (fms_rls_bypass() OR company_id = fms_current_company()) '
      'WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company())', t);
  END LOOP;
END $$;
