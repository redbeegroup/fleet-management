-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TelemetryEventType" ADD VALUE 'FUEL_REFILL';
ALTER TYPE "TelemetryEventType" ADD VALUE 'FUEL_DROP';
ALTER TYPE "TelemetryEventType" ADD VALUE 'ENGINE_FAULT';

-- AlterTable
ALTER TABLE "fuel_records" ADD COLUMN     "card_txn_id" UUID,
ADD COLUMN     "gps_km" DECIMAL(10,1),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "location_source" TEXT,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "vehicle_distance_m" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "vehicle_telemetry_state" ADD COLUMN     "fuel_drop_from" DOUBLE PRECISION,
ADD COLUMN     "fuel_level_l" DOUBLE PRECISION,
ADD COLUMN     "fuel_rise_from" DOUBLE PRECISION,
ADD COLUMN     "fuel_samples" JSONB;

-- CreateTable
CREATE TABLE "fuel_cards" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "label" TEXT,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_card_imports" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "filename" TEXT,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_card_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_card_transactions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "import_id" UUID,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "card_last4" TEXT NOT NULL,
    "card_id" UUID,
    "vehicle_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "station" TEXT,
    "product" TEXT,
    "litres" DECIMAL(10,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "plate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CARD_ONLY',
    "fuel_record_id" UUID,
    "differences" JSONB,
    "note" TEXT,
    "reviewed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_card_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_diagnostics" (
    "vehicle_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "dtc_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "check_engine" BOOLEAN,
    "coolant_temp_c" DOUBLE PRECISION,
    "battery_v" DOUBLE PRECISION,
    "engine_hours" DOUBLE PRECISION,
    "fuel_level_l" DOUBLE PRECISION,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_diagnostics_pkey" PRIMARY KEY ("vehicle_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fuel_cards_company_id_provider_last4_key" ON "fuel_cards"("company_id", "provider", "last4");

-- CreateIndex
CREATE INDEX "fuel_card_imports_company_id_created_at_idx" ON "fuel_card_imports"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "fuel_card_transactions_company_id_occurred_at_idx" ON "fuel_card_transactions"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "fuel_card_transactions_vehicle_id_occurred_at_idx" ON "fuel_card_transactions"("vehicle_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_card_transactions_company_id_provider_external_id_key" ON "fuel_card_transactions"("company_id", "provider", "external_id");

-- CreateIndex
CREATE INDEX "vehicle_diagnostics_company_id_idx" ON "vehicle_diagnostics"("company_id");


ALTER TABLE fuel_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fuel_cards USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

ALTER TABLE fuel_card_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_card_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fuel_card_imports USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

ALTER TABLE fuel_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_card_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fuel_card_transactions USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

ALTER TABLE vehicle_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_diagnostics FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicle_diagnostics USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
