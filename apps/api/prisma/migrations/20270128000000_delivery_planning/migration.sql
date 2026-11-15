-- CreateEnum
CREATE TYPE "TripKind" AS ENUM ('GENERAL', 'DELIVERY');

-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('PENDING', 'ARRIVED', 'DELIVERED', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "delivery_order_lines" ADD COLUMN     "cases" DECIMAL(12,2),
ADD COLUMN     "delivered_qty" DECIMAL(14,3),
ADD COLUMN     "pallets" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "delivery_orders" ADD COLUMN     "branch_id" UUID,
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "delivery_date" DATE,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "stop_id" UUID,
ADD COLUMN     "total_cases" DECIMAL(12,2),
ADD COLUMN     "total_pallets" DECIMAL(12,2),
ADD COLUMN     "trip_id" UUID;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "kind" "TripKind" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "planned_date" DATE;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "capacity_cases" INTEGER,
ADD COLUMN     "capacity_pallets" INTEGER,
ADD COLUMN     "max_stops" INTEGER;


-- CreateTable
CREATE TABLE "trip_stops" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "status" "StopStatus" NOT NULL DEFAULT 'PENDING',
    "arrived_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_stops_trip_id_seq_idx" ON "trip_stops"("trip_id", "seq");

-- CreateIndex
CREATE INDEX "delivery_orders_company_id_delivery_date_status_idx" ON "delivery_orders"("company_id", "delivery_date", "status");

-- CreateIndex
CREATE INDEX "delivery_orders_trip_id_idx" ON "delivery_orders"("trip_id");

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "trip_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing orders: plan by the delivery window (or the day they arrived).
UPDATE delivery_orders SET delivery_date = COALESCE(window_start, created_at)::date WHERE delivery_date IS NULL;

-- Row-Level Security for the new tenant table
ALTER TABLE trip_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_stops FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trip_stops USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
