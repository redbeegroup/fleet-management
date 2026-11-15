-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "cod_collected" DECIMAL(14,2),
ADD COLUMN     "cod_expected" DECIMAL(14,2),
ADD COLUMN     "planned_arrival" TIMESTAMP(3),
ADD COLUMN     "pod_accuracy_m" DOUBLE PRECISION,
ADD COLUMN     "pod_distance_m" INTEGER,
ADD COLUMN     "pod_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pod_lat" DOUBLE PRECISION,
ADD COLUMN     "pod_lng" DOUBLE PRECISION,
ADD COLUMN     "pod_photo_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pod_signature" JSONB,
ADD COLUMN     "pod_signed_by" TEXT;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "check_in" JSONB,
ADD COLUMN     "checked_in_at" TIMESTAMP(3),
ADD COLUMN     "checked_in_by" UUID,
ADD COLUMN     "planned_km" DECIMAL(10,1),
ADD COLUMN     "planned_minutes" INTEGER,
ADD COLUMN     "route_geometry" TEXT,
ADD COLUMN     "routing_source" TEXT;


-- CreateTable
CREATE TABLE "delivery_returns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "stop_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "reason" TEXT NOT NULL,
    "photo_file_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_returns_trip_id_idx" ON "delivery_returns"("trip_id");

-- CreateIndex
CREATE INDEX "delivery_returns_company_id_created_at_idx" ON "delivery_returns"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "delivery_returns" ADD CONSTRAINT "delivery_returns_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "trip_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE delivery_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_returns USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
