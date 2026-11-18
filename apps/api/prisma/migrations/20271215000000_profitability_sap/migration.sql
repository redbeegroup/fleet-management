-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "sap_customer" TEXT;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "sap_cost_center" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "po_check" JSONB,
ADD COLUMN     "po_number" TEXT;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "sap_asset_no" TEXT;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "po_number" TEXT,
ADD COLUMN     "po_status" TEXT;


-- CreateTable
CREATE TABLE "rate_cards" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "customer_id" UUID,
    "vehicle_class" TEXT,
    "branch_id" UUID,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "per_trip" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "per_km" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "per_kg" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "per_drop" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "per_pallet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "min_charge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fuel_surcharge_pct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "waiting_per_hour" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "free_wait_minutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_revenues" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "customer_id" UUID,
    "rate_card_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "basis" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'RATE_CARD',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_revenues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "system" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "auth_type" TEXT NOT NULL DEFAULT 'BASIC',
    "username" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "token_url" TEXT,
    "sap_client" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sap_sync_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "watermark" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_by" UUID,

    CONSTRAINT "sap_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_postings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total" DECIMAL(16,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "sap_doc_no" TEXT,
    "document_id" UUID,
    "posted_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_posting_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "cost_posting_id" UUID NOT NULL,
    "cost_center" TEXT NOT NULL,
    "gl_account" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "vehicles" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "cost_posting_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sap_documents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "sap_doc_no" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sap_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sap_billing_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "billing_doc" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "billing_date" DATE NOT NULL,
    "sold_to" TEXT NOT NULL,
    "customer_id" UUID,
    "reference" TEXT,
    "delivery_order_id" UUID,
    "trip_id" UUID,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sap_billing_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_cards_company_id_active_idx" ON "rate_cards"("company_id", "active");

-- CreateIndex
CREATE INDEX "trip_revenues_company_id_trip_id_idx" ON "trip_revenues"("company_id", "trip_id");

-- CreateIndex
CREATE INDEX "trip_revenues_company_id_customer_id_idx" ON "trip_revenues"("company_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_credentials_company_id_system_key" ON "integration_credentials"("company_id", "system");

-- CreateIndex
CREATE INDEX "sap_sync_runs_company_id_kind_started_at_idx" ON "sap_sync_runs"("company_id", "kind", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "cost_postings_company_id_period_version_key" ON "cost_postings"("company_id", "period", "version");

-- CreateIndex
CREATE INDEX "cost_posting_lines_cost_posting_id_idx" ON "cost_posting_lines"("cost_posting_id");

-- CreateIndex
CREATE INDEX "sap_documents_status_next_attempt_at_idx" ON "sap_documents"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "sap_documents_company_id_ref_idx" ON "sap_documents"("company_id", "ref");

-- CreateIndex
CREATE INDEX "sap_billing_items_company_id_billing_date_idx" ON "sap_billing_items"("company_id", "billing_date");

-- CreateIndex
CREATE UNIQUE INDEX "sap_billing_items_company_id_billing_doc_item_key" ON "sap_billing_items"("company_id", "billing_doc", "item");

-- AddForeignKey
ALTER TABLE "cost_posting_lines" ADD CONSTRAINT "cost_posting_lines_cost_posting_id_fkey" FOREIGN KEY ("cost_posting_id") REFERENCES "cost_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Row-level security
ALTER TABLE rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rate_cards USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE trip_revenues ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_revenues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trip_revenues USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_credentials USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE sap_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sap_sync_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sap_sync_runs USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE cost_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_postings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cost_postings USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE cost_posting_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_posting_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cost_posting_lines USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE sap_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sap_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sap_documents USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE sap_billing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sap_billing_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sap_billing_items USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

-- BI views (S19; security model: 20270421000000_bi_reporting). Credentials and the SAP outbox are not exposed.
CREATE VIEW reporting.rate_cards AS
SELECT x.company_id, c.code AS company_code, x.id AS rate_card_id, x.name, x.customer_id, x.vehicle_class, x.branch_id, x.valid_from, x.valid_to, x.active,
       x.per_trip, x.per_km, x.per_kg, x.per_drop, x.per_pallet, x.min_charge, x.fuel_surcharge_pct, x.waiting_per_hour, x.free_wait_minutes
FROM public.rate_cards x JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.rate_cards IS 'Freight rate cards used to compute trip revenue.';

CREATE VIEW reporting.trip_revenues AS
SELECT x.company_id, c.code AS company_code, x.id AS revenue_id, x.trip_id, t.trip_no, t.vehicle_id, t.branch_id,
       ((COALESCE(t.actual_end, t.planned_end) AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date,
       x.customer_id, x.rate_card_id, x.source, x.amount,
       (x.basis->>'km')::numeric AS km, (x.basis->>'kg')::numeric AS kg, (x.basis->>'drops')::numeric AS drops, x.computed_at
FROM public.trip_revenues x JOIN public.companies c ON c.id = x.company_id JOIN public.trips t ON t.id = x.trip_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.trip_revenues IS 'Rate-card revenue per completed trip (one row per customer on delivery trips).';

CREATE VIEW reporting.cost_postings AS
SELECT p.company_id, c.code AS company_code, p.id AS posting_id, p.period, p.version, p.status, p.sap_doc_no, p.posted_at, p.currency,
       l.cost_center, l.gl_account, l.category, l.vehicles, l.amount
FROM public.cost_postings p JOIN public.cost_posting_lines l ON l.cost_posting_id = p.id JOIN public.companies c ON c.id = p.company_id
WHERE fms_bi_sees(p.company_id);
COMMENT ON VIEW reporting.cost_postings IS 'Monthly fleet cost postings to SAP FI/CO by cost centre and GL account.';

CREATE VIEW reporting.sap_billing_items AS
SELECT x.company_id, c.code AS company_code, x.billing_doc, x.item, x.billing_date, x.sold_to, x.customer_id, x.reference,
       x.delivery_order_id, x.trip_id, x.net_amount, x.currency, x.cancelled
FROM public.sap_billing_items x JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.sap_billing_items IS 'Billed revenue (SAP SD billing document items) for comparison with rate-card revenue.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rate_cards', 'trip_revenues', 'cost_postings', 'cost_posting_lines', 'sap_billing_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS bi_read ON public.%I', t);
    EXECUTE format('CREATE POLICY bi_read ON public.%I FOR SELECT TO %I USING (fms_bi_sees(company_id))', t, current_user);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fms_bi_reader') THEN
    EXECUTE 'GRANT SELECT ON reporting.rate_cards, reporting.trip_revenues, reporting.cost_postings, reporting.sap_billing_items TO fms_bi_reader';
  END IF;
END $$;
