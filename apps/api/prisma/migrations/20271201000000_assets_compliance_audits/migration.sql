-- AlterTable
ALTER TABLE "maintenance_plans" ADD COLUMN     "interval_hours" INTEGER,
ADD COLUMN     "last_done_hours" DECIMAL(10,1);

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "trailer_id" UUID;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "asset_kind" TEXT NOT NULL DEFAULT 'VEHICLE',
ADD COLUMN     "hour_meter" DECIMAL(10,1),
ADD COLUMN     "meter_type" TEXT NOT NULL DEFAULT 'KM';

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(12,1) NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trailer_couplings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "trailer_id" UUID NOT NULL,
    "tractor_id" UUID NOT NULL,
    "trip_id" UUID,
    "coupled_at" TIMESTAMP(3) NOT NULL,
    "uncoupled_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trailer_couplings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "pass_mark" INTEGER NOT NULL DEFAULT 80,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_audits" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "audit_no" TEXT NOT NULL,
    "template_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "branch_id" UUID,
    "vehicle_id" UUID,
    "performed_at" TIMESTAMP(3) NOT NULL,
    "auditor_id" UUID,
    "auditor_name" TEXT,
    "answers" JSONB NOT NULL,
    "score" DECIMAL(5,1) NOT NULL,
    "result" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "question_key" TEXT,
    "description" TEXT NOT NULL,
    "owner_user_id" UUID,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closure_note" TEXT,
    "evidence_file_id" UUID,
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "alerted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meter_readings_vehicle_id_read_at_idx" ON "meter_readings"("vehicle_id", "read_at");

-- CreateIndex
CREATE INDEX "trailer_couplings_trailer_id_coupled_at_idx" ON "trailer_couplings"("trailer_id", "coupled_at");

-- CreateIndex
CREATE INDEX "trailer_couplings_tractor_id_coupled_at_idx" ON "trailer_couplings"("tractor_id", "coupled_at");

-- CreateIndex
CREATE INDEX "safety_audits_company_id_performed_at_idx" ON "safety_audits"("company_id", "performed_at");

-- CreateIndex
CREATE UNIQUE INDEX "safety_audits_company_id_audit_no_key" ON "safety_audits"("company_id", "audit_no");

-- CreateIndex
CREATE INDEX "corrective_actions_company_id_status_due_date_idx" ON "corrective_actions"("company_id", "status", "due_date");

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "safety_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meter_readings USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE trailer_couplings ENABLE ROW LEVEL SECURITY;
ALTER TABLE trailer_couplings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trailer_couplings USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE audit_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_templates USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE safety_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_audits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON safety_audits USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
ALTER TABLE corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrective_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON corrective_actions USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

-- BI views (S18; security model: 20270421000000_bi_reporting)
CREATE VIEW reporting.trailer_couplings AS
SELECT x.company_id, c.code AS company_code, x.id AS coupling_id, x.trailer_id, x.tractor_id, x.trip_id, x.coupled_at, x.uncoupled_at
FROM public.trailer_couplings x JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.trailer_couplings IS 'Which tractor pulled which trailer, and when.';

CREATE VIEW reporting.safety_audits AS
SELECT x.company_id, c.code AS company_code, x.id AS audit_id, x.audit_no, x.template_id, t.name AS template_name, x.target, x.branch_id, x.vehicle_id,
       x.performed_at, ((x.performed_at AT TIME ZONE 'UTC') AT TIME ZONE c.timezone)::date AS local_date, x.score, x.result
FROM public.safety_audits x JOIN public.companies c ON c.id = x.company_id JOIN public.audit_templates t ON t.id = x.template_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.safety_audits IS 'Safety audits of branches / sites and vehicles with score and result.';

CREATE VIEW reporting.corrective_actions AS
SELECT x.company_id, c.code AS company_code, x.id AS action_id, x.audit_id, x.description, x.owner_user_id, x.due_date, x.status, x.closed_at, x.verified_at,
       x.status = 'OPEN' AND x.due_date < (now() AT TIME ZONE c.timezone)::date AS overdue
FROM public.corrective_actions x JOIN public.companies c ON c.id = x.company_id
WHERE fms_bi_sees(x.company_id);
COMMENT ON VIEW reporting.corrective_actions IS 'Corrective actions from safety audits (overdue = open past the due date).';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trailer_couplings', 'safety_audits', 'corrective_actions', 'audit_templates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS bi_read ON public.%I', t);
    EXECUTE format('CREATE POLICY bi_read ON public.%I FOR SELECT TO %I USING (fms_bi_sees(company_id))', t, current_user);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fms_bi_reader') THEN
    EXECUTE 'GRANT SELECT ON reporting.trailer_couplings, reporting.safety_audits, reporting.corrective_actions TO fms_bi_reader';
  END IF;
END $$;
