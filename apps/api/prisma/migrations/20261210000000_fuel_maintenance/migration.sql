-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'ACCIDENT', 'INSPECTION');

-- CreateEnum
CREATE TYPE "RepairRequestStatus" AS ENUM ('OPEN', 'CONVERTED', 'REJECTED');

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "tank_capacity_l" DECIMAL(8,1);

-- CreateTable
CREATE TABLE "fuel_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID,
    "filled_at" TIMESTAMP(3) NOT NULL,
    "odometer_km" DECIMAL(12,1) NOT NULL,
    "litres" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total_cost" DECIMAL(14,2) NOT NULL,
    "fuel_type" TEXT,
    "station" TEXT,
    "full_tank" BOOLEAN NOT NULL DEFAULT true,
    "payment_method" TEXT,
    "receipt_file_id" UUID,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'web',
    "distance_km" DECIMAL(10,1),
    "km_per_litre" DECIMAL(8,2),
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "interval_km" INTEGER,
    "interval_days" INTEGER,
    "last_done_at" TIMESTAMP(3),
    "last_done_odometer_km" DECIMAL(12,1),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "reported_by" UUID,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "odometer_km" DECIMAL(12,1),
    "photo_file_id" UUID,
    "status" "RepairRequestStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "work_order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "wo_no" TEXT NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "plan_id" UUID,
    "type" "WorkOrderType" NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "workshop" TEXT,
    "assigned_to" TEXT,
    "off_road" BOOLEAN NOT NULL DEFAULT true,
    "odometer_km" DECIMAL(12,1),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "resolution" TEXT,
    "total_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fuel_records_vehicle_id_filled_at_idx" ON "fuel_records"("vehicle_id", "filled_at");

-- CreateIndex
CREATE INDEX "fuel_records_company_id_filled_at_idx" ON "fuel_records"("company_id", "filled_at");

-- CreateIndex
CREATE INDEX "maintenance_plans_company_id_active_idx" ON "maintenance_plans"("company_id", "active");

-- CreateIndex
CREATE INDEX "maintenance_plans_vehicle_id_idx" ON "maintenance_plans"("vehicle_id");

-- CreateIndex
CREATE INDEX "repair_requests_company_id_status_idx" ON "repair_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_company_id_status_idx" ON "work_orders"("company_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_vehicle_id_opened_at_idx" ON "work_orders"("vehicle_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_company_id_wo_no_key" ON "work_orders"("company_id", "wo_no");

-- CreateIndex
CREATE INDEX "work_order_lines_work_order_id_idx" ON "work_order_lines"("work_order_id");

-- AddForeignKey
ALTER TABLE "fuel_records" ADD CONSTRAINT "fuel_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_records" ADD CONSTRAINT "fuel_records_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "maintenance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security for the new tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fuel_records','maintenance_plans','repair_requests','work_orders','work_order_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (fms_rls_bypass() OR company_id = fms_current_company()) '
      'WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company())', t);
  END LOOP;
END $$;

-- At most one open (not completed/cancelled) work order per maintenance plan.
CREATE UNIQUE INDEX work_orders_one_open_per_plan ON work_orders (plan_id) WHERE plan_id IS NOT NULL AND status IN ('OPEN', 'IN_PROGRESS');
