-- CreateEnum
CREATE TYPE "EntryApproval" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeliveryOrderStatus" AS ENUM ('RECEIVED', 'PLANNED', 'DISPATCHED', 'DELIVERED', 'PARTIAL', 'FAILED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('WORK_ORDER', 'EXPENSE', 'FUEL', 'VEHICLE_REQUEST', 'CLAIM');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VehicleRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SCHEDULED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ClaimStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterEnum
ALTER TYPE "WorkOrderStatus" ADD VALUE 'AWAITING_APPROVAL';

-- AlterTable
ALTER TABLE "fuel_records" ADD COLUMN     "approval_status" "EntryApproval" NOT NULL DEFAULT 'APPROVED';

-- AlterTable
ALTER TABLE "vehicle_expenses" ADD COLUMN     "approval_status" "EntryApproval" NOT NULL DEFAULT 'APPROVED';

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "estimated_cost" DECIMAL(14,2);


-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "township" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'dms',
    "external_ref" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "DeliveryOrderStatus" NOT NULL DEFAULT 'RECEIVED',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "order_date" TIMESTAMP(3),
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "total_weight_kg" DECIMAL(12,2),
    "total_volume_m3" DECIMAL(12,3),
    "cod_amount" DECIMAL(14,2),
    "notes" TEXT,
    "payload_hash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_order_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "weight_kg" DECIMAL(12,2),
    "volume_m3" DECIMAL(12,3),

    CONSTRAINT "delivery_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "disabled_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMP(3),
    "response_status" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "entity_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "requested_by" UUID,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "required_approvals" INTEGER NOT NULL DEFAULT 1,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "request_no" TEXT NOT NULL,
    "requested_by" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "origin_name" TEXT NOT NULL,
    "destination_name" TEXT NOT NULL,
    "planned_start" TIMESTAMP(3) NOT NULL,
    "planned_end" TIMESTAMP(3) NOT NULL,
    "passengers" INTEGER,
    "cargo_description" TEXT,
    "preferred_class" TEXT,
    "notes" TEXT,
    "status" "VehicleRequestStatus" NOT NULL DEFAULT 'PENDING',
    "trip_id" UUID,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_company_id_idx" ON "api_keys"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_code_key" ON "customers"("company_id", "code");

-- CreateIndex
CREATE INDEX "delivery_orders_company_id_updated_at_idx" ON "delivery_orders"("company_id", "updated_at");

-- CreateIndex
CREATE INDEX "delivery_orders_company_id_status_idx" ON "delivery_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_orders_company_id_source_external_ref_key" ON "delivery_orders"("company_id", "source", "external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_order_lines_order_id_line_no_key" ON "delivery_order_lines"("order_id", "line_no");

-- CreateIndex
CREATE INDEX "webhook_endpoints_company_id_idx" ON "webhook_endpoints"("company_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_company_id_status_idx" ON "approval_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_entity_id_idx" ON "approval_requests"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_request_id_approver_id_key" ON "approval_decisions"("request_id", "approver_id");

-- CreateIndex
CREATE INDEX "vehicle_requests_company_id_status_idx" ON "vehicle_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "vehicle_requests_requested_by_idx" ON "vehicle_requests"("requested_by");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_requests_company_id_request_no_key" ON "vehicle_requests"("company_id", "request_no");

-- AddForeignKey
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_order_lines" ADD CONSTRAINT "delivery_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "delivery_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security for the new tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['api_keys','customers','delivery_orders','delivery_order_lines','webhook_endpoints','webhook_deliveries',
                           'approval_requests','approval_decisions','vehicle_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (fms_rls_bypass() OR company_id = fms_current_company()) '
      'WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company())', t);
  END LOOP;
END $$;
