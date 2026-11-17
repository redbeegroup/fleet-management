-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "tire_layout" TEXT;

-- AlterTable
ALTER TABLE "work_order_lines" ADD COLUMN     "branch_id" UUID,
ADD COLUMN     "part_id" UUID,
ADD COLUMN     "tire_change_id" UUID,
ADD COLUMN     "warranty_km_until" DECIMAL(12,1),
ADD COLUMN     "warranty_until" DATE;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "invoice_amount" DECIMAL(14,2),
ADD COLUMN     "invoice_date" DATE,
ADD COLUMN     "invoice_file_id" UUID,
ADD COLUMN     "invoice_no" TEXT,
ADD COLUMN     "quote_amount" DECIMAL(14,2),
ADD COLUMN     "quote_file_id" UUID,
ADD COLUMN     "quoted_at" TIMESTAMP(3),
ADD COLUMN     "supplier_id" UUID;

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kinds" TEXT[],
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "tax_id" TEXT,
    "payment_terms_days" INTEGER,
    "notes" TEXT,
    "external_ref" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "part_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "supplier_id" UUID,
    "min_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reorder_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "warranty_months" INTEGER,
    "warranty_km" INTEGER,
    "external_ref" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_stocks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "qty_on_hand" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "avg_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "min_qty" DECIMAL(12,2),
    "bin" TEXT,
    "alerted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "qty_after" DECIMAL(12,2) NOT NULL,
    "work_order_id" UUID,
    "line_id" UUID,
    "supplier_id" UUID,
    "reference" TEXT,
    "reason" TEXT,
    "file_id" UUID,
    "created_by" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tire_changes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "position" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "odometer_km" DECIMAL(12,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "from_position" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "size" TEXT,
    "condition" TEXT NOT NULL DEFAULT 'NEW',
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "supplier_id" UUID,
    "work_order_id" UUID,
    "removed_tread_mm" DECIMAL(5,1),
    "warranty_months" INTEGER,
    "warranty_km" INTEGER,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tire_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tire_checks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "position" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,
    "odometer_km" DECIMAL(12,1),
    "tread_mm" DECIMAL(5,1),
    "pressure" DECIMAL(6,1),
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "inspection_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tire_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_warranties" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "component" TEXT NOT NULL,
    "label" TEXT,
    "supplier_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "end_km" DECIMAL(12,1),
    "terms" TEXT,
    "file_id" UUID,
    "alerted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "claim_no" TEXT NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "work_order_id" UUID,
    "supplier_id" UUID,
    "basis" TEXT NOT NULL,
    "basis_ref" UUID,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "amount_claimed" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_approved" DECIMAL(14,2),
    "amount_recovered" DECIMAL(14,2),
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "recovered_at" TIMESTAMP(3),
    "notes" TEXT,
    "file_ids" UUID[],
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_company_id_name_key" ON "suppliers"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "parts_company_id_part_no_key" ON "parts"("company_id", "part_no");

-- CreateIndex
CREATE INDEX "part_stocks_company_id_branch_id_idx" ON "part_stocks"("company_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "part_stocks_part_id_branch_id_key" ON "part_stocks"("part_id", "branch_id");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_occurred_at_idx" ON "stock_movements"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_part_id_branch_id_occurred_at_idx" ON "stock_movements"("part_id", "branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "tire_changes_vehicle_id_position_changed_at_idx" ON "tire_changes"("vehicle_id", "position", "changed_at");

-- CreateIndex
CREATE INDEX "tire_changes_company_id_changed_at_idx" ON "tire_changes"("company_id", "changed_at");

-- CreateIndex
CREATE INDEX "tire_checks_vehicle_id_position_checked_at_idx" ON "tire_checks"("vehicle_id", "position", "checked_at");

-- CreateIndex
CREATE INDEX "vehicle_warranties_company_id_vehicle_id_idx" ON "vehicle_warranties"("company_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "warranty_claims_company_id_status_idx" ON "warranty_claims"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claims_company_id_claim_no_key" ON "warranty_claims"("company_id", "claim_no");

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_stocks" ADD CONSTRAINT "part_stocks_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tire_changes" ADD CONSTRAINT "tire_changes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tire_checks" ADD CONSTRAINT "tire_checks_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_warranties" ADD CONSTRAINT "vehicle_warranties_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppliers USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON parts USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE part_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_stocks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON part_stocks USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_movements USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE tire_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tire_changes USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE tire_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tire_checks USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE vehicle_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_warranties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicle_warranties USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warranty_claims USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

-- BI reporting views (S16); see 20270421000000_bi_reporting for the security model.
CREATE VIEW reporting.suppliers AS
SELECT x.company_id, c.code AS company_code,
       x.id AS supplier_id, x.name, array_to_string(x.kinds, ',') AS kinds, x.payment_terms_days, x.external_ref, x.active
FROM public.suppliers x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.suppliers IS 'Outside garages and parts / tire suppliers.';

CREATE VIEW reporting.parts AS
SELECT x.company_id, c.code AS company_code,
       x.id AS part_id, x.part_no, x.name, x.category, x.unit, x.supplier_id, x.min_qty, x.reorder_qty, x.warranty_months, x.warranty_km, x.external_ref, x.active
FROM public.parts x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.parts IS 'Spare parts catalogue.';

CREATE VIEW reporting.stock AS
SELECT x.company_id, c.code AS company_code,
       x.part_id, p.part_no, p.name AS part_name, x.branch_id, b.name AS branch_name, x.qty_on_hand, x.avg_cost, round(x.qty_on_hand * x.avg_cost, 2) AS stock_value, coalesce(x.min_qty, p.min_qty) AS min_qty, x.qty_on_hand <= coalesce(x.min_qty, p.min_qty) AS below_min
FROM public.part_stocks x
JOIN public.companies c ON c.id = x.company_id
JOIN public.parts p ON p.id = x.part_id
JOIN public.branches b ON b.id = x.branch_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.stock IS 'Stock on hand per part and branch store, valued at moving average cost.';

CREATE VIEW reporting.stock_movements AS
SELECT x.company_id, c.code AS company_code,
       x.id AS movement_id, x.part_id, x.branch_id, x.kind, x.qty, x.unit_cost, x.value, x.qty_after, x.work_order_id, x.supplier_id, x.reference, x.occurred_at, ((x.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date
FROM public.stock_movements x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.stock_movements IS 'Stock movements: RECEIPT, ISSUE (to work orders), RETURN, ADJUST, TRANSFER_OUT / TRANSFER_IN.';

CREATE VIEW reporting.tire_changes AS
SELECT x.company_id, c.code AS company_code,
       x.id AS tire_change_id, x.vehicle_id, x.position, x.changed_at, ((x.changed_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date, x.odometer_km, x.reason, x.brand, x.model, x.size, x.condition, x.cost, x.supplier_id, x.work_order_id, x.removed_tread_mm
FROM public.tire_changes x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.tire_changes IS 'Tires fitted per vehicle position, with cost and the tread of the tire taken off.';

CREATE VIEW reporting.tire_checks AS
SELECT x.company_id, c.code AS company_code,
       x.id AS tire_check_id, x.vehicle_id, x.position, x.checked_at, ((x.checked_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date, x.odometer_km, x.tread_mm, x.pressure, x.source
FROM public.tire_checks x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.tire_checks IS 'Tread depth and pressure checks per vehicle position.';

CREATE VIEW reporting.vehicle_warranties AS
SELECT x.company_id, c.code AS company_code,
       x.id AS warranty_id, x.vehicle_id, x.component, x.label, x.supplier_id, x.start_date, x.end_date, x.end_km
FROM public.vehicle_warranties x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.vehicle_warranties IS 'Vehicle and component warranties (date and/or km).';

CREATE VIEW reporting.warranty_claims AS
SELECT x.company_id, c.code AS company_code,
       x.id AS claim_id, x.claim_no, x.vehicle_id, x.work_order_id, x.supplier_id, x.basis, x.status, x.amount_claimed, x.amount_approved, x.amount_recovered, x.submitted_at, x.recovered_at, ((x.recovered_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS recovered_local_date
FROM public.warranty_claims x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.warranty_claims IS 'Warranty claims to suppliers / manufacturers; recovered amounts reduce the cost.';

-- New columns at the end of an existing view (BI conventions: columns are only appended).
CREATE OR REPLACE VIEW reporting.work_orders AS
SELECT x.company_id, c.code AS company_code,
       x.id AS work_order_id, x.wo_no, x.vehicle_id, x.type::text AS type, x.status::text AS status, x.priority, x.title,
       x.workshop, x.off_road, x.opened_at, x.started_at, x.completed_at, ((x.completed_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS completed_local_date,
       x.estimated_cost, x.total_cost,
       CASE WHEN x.completed_at IS NOT NULL THEN extract(epoch FROM x.completed_at - x.opened_at) / 3600 END AS downtime_hours,
       x.supplier_id, x.quote_amount, x.invoice_no, x.invoice_amount
FROM public.work_orders x
JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);

-- Cost ledger with tires (work-order TIRE lines and tire changes outside work orders) and warranty credits.
CREATE OR REPLACE VIEW reporting.cost_ledger AS
SELECT company_id, company_code, vehicle_id, local_date, to_char(local_date, 'YYYY-MM') AS period, category, source, source_id, amount::numeric(14,2) AS amount
FROM (
  SELECT x.company_id, c.code AS company_code, x.vehicle_id, ((x.filled_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date,
         'FUEL' AS category, 'fuel' AS source, x.id AS source_id, x.total_cost AS amount
  FROM public.fuel_records x JOIN public.companies c ON c.id = x.company_id
  WHERE x.approval_status = 'APPROVED'
  UNION ALL
  SELECT x.company_id, c.code, x.vehicle_id, ((x.completed_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date,
         'MAINTENANCE', 'maintenance', x.id,
         x.total_cost - coalesce((SELECT sum(l.total) FROM public.work_order_lines l WHERE l.work_order_id = x.id AND l.kind = 'TIRE'), 0)
  FROM public.work_orders x JOIN public.companies c ON c.id = x.company_id
  WHERE x.status = 'COMPLETED' AND x.completed_at IS NOT NULL AND x.total_cost IS NOT NULL
  UNION ALL
  SELECT x.company_id, c.code, x.vehicle_id, ((x.completed_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date,
         'TIRES', 'maintenance', x.id, t.total
  FROM public.work_orders x JOIN public.companies c ON c.id = x.company_id
  JOIN (SELECT work_order_id, sum(total) AS total FROM public.work_order_lines WHERE kind = 'TIRE' GROUP BY work_order_id) t ON t.work_order_id = x.id
  WHERE x.status = 'COMPLETED' AND x.completed_at IS NOT NULL
  UNION ALL
  SELECT x.company_id, c.code, x.vehicle_id, ((x.incurred_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date,
         x.category, 'expense', x.id, x.amount
  FROM public.vehicle_expenses x JOIN public.companies c ON c.id = x.company_id
  WHERE x.approval_status = 'APPROVED'
  UNION ALL
  SELECT x.company_id, c.code, x.vehicle_id, ((x.changed_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date,
         'TIRES', 'tire', x.id, x.cost
  FROM public.tire_changes x JOIN public.companies c ON c.id = x.company_id
  WHERE x.work_order_id IS NULL AND x.cost > 0
  UNION ALL
  SELECT x.company_id, c.code, x.vehicle_id, ((x.recovered_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date,
         CASE WHEN x.basis = 'TIRE' THEN 'TIRES' ELSE 'MAINTENANCE' END, 'warranty', x.id, -x.amount_recovered
  FROM public.warranty_claims x JOIN public.companies c ON c.id = x.company_id
  WHERE x.status = 'RECOVERED' AND x.recovered_at IS NOT NULL AND x.amount_recovered > 0
) l
WHERE fms_bi_sees(l.company_id);
COMMENT ON VIEW reporting.cost_ledger IS 'Direct costs by vehicle and day: approved fuel, completed work orders (tire lines as TIRES), approved expenses, tire changes outside work orders, and recovered warranty claims (negative). Ownership (depreciation/lease), document fees and shared-cost allocation are in the FMS Costs & TCO screens and the vehicles/shared_costs views.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suppliers', 'parts', 'part_stocks', 'stock_movements', 'tire_changes', 'tire_checks', 'vehicle_warranties', 'warranty_claims'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS bi_read ON public.%I', t);
    EXECUTE format('CREATE POLICY bi_read ON public.%I FOR SELECT TO %I USING (fms_bi_sees(company_id))', t, current_user);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fms_bi_reader') THEN
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO fms_bi_reader';
  END IF;
END $$;
