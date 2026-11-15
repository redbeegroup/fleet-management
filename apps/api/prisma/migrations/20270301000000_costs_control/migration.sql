-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TelemetryEventType" ADD VALUE 'OFF_ROUTE';
ALTER TYPE "TelemetryEventType" ADD VALUE 'UNAUTHORISED_MOVEMENT';
ALTER TYPE "TelemetryEventType" ADD VALUE 'AFTER_HOURS';
ALTER TYPE "TelemetryEventType" ADD VALUE 'NO_DRIVER';
ALTER TYPE "TelemetryEventType" ADD VALUE 'RESTRICTED_AREA';

-- AlterTable
ALTER TABLE "vehicle_telemetry_state" ADD COLUMN     "last_lat" DOUBLE PRECISION,
ADD COLUMN     "last_lng" DOUBLE PRECISION,
ADD COLUMN     "after_hours_event_id" UUID,
ADD COLUMN     "no_driver_event_id" UUID,
ADD COLUMN     "no_trip_event_id" UUID,
ADD COLUMN     "no_trip_km" DOUBLE PRECISION,
ADD COLUMN     "off_route_event_id" UUID,
ADD COLUMN     "off_route_max_m" DOUBLE PRECISION,
ADD COLUMN     "off_route_since" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "in_service_at" DATE,
ADD COLUMN     "monthly_lease_cost" DECIMAL(14,2),
ADD COLUMN     "purchase_price" DECIMAL(14,2),
ADD COLUMN     "residual_value" DECIMAL(14,2),
ADD COLUMN     "useful_life_months" INTEGER;

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "branch_id" UUID,
    "department_id" UUID,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "alerted_level" INTEGER,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_costs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "branch_id" UUID,
    "department_id" UUID,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budgets_company_id_period_idx" ON "budgets"("company_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_company_id_period_scope_key_category_key" ON "budgets"("company_id", "period", "scope_key", "category");

-- CreateIndex
CREATE INDEX "shared_costs_company_id_period_idx" ON "shared_costs"("company_id", "period");


ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budgets USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

ALTER TABLE shared_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_costs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shared_costs USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
