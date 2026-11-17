-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "replacement_note" TEXT,
ADD COLUMN     "replacement_planned_for" DATE;

-- CreateTable
CREATE TABLE "vehicle_disposals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "disposed_at" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "buyer" TEXT,
    "sale_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "odometer_km" DECIMAL(12,1),
    "book_value" DECIMAL(14,2),
    "gain_loss" DECIMAL(14,2),
    "reason" TEXT,
    "file_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_disposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_disposals_vehicle_id_key" ON "vehicle_disposals"("vehicle_id");

-- CreateIndex
CREATE INDEX "vehicle_disposals_company_id_disposed_at_idx" ON "vehicle_disposals"("company_id", "disposed_at");

-- AddForeignKey
ALTER TABLE "vehicle_disposals" ADD CONSTRAINT "vehicle_disposals_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE vehicle_disposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_disposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicle_disposals USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

-- BI (see 20270421000000_bi_reporting for the security model)
CREATE VIEW reporting.vehicle_disposals AS
SELECT x.company_id, c.code AS company_code,
       x.id AS disposal_id, x.vehicle_id, x.disposed_at, x.method, x.sale_value, x.odometer_km, x.book_value, x.gain_loss
FROM public.vehicle_disposals x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.vehicle_disposals IS 'Vehicle disposals with sale value, book value and gain / loss.';

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS bi_read ON public.vehicle_disposals';
  EXECUTE format('CREATE POLICY bi_read ON public.vehicle_disposals FOR SELECT TO %I USING (fms_bi_sees(company_id))', current_user);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fms_bi_reader') THEN
    EXECUTE 'GRANT SELECT ON reporting.vehicle_disposals TO fms_bi_reader';
  END IF;
END $$;
