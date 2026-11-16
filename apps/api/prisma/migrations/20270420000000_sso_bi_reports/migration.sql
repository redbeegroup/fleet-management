-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sso_linked_at" TIMESTAMP(3),
ADD COLUMN     "sso_subject" TEXT;

-- CreateTable
CREATE TABLE "sso_providers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_enc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sso_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_domains" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provider_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_subscriptions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "report" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "branch_id" UUID,
    "user_ids" UUID[],
    "extra_emails" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sso_providers_company_id_idx" ON "sso_providers"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sso_domains_domain_key" ON "sso_domains"("domain");

-- CreateIndex
CREATE INDEX "sso_domains_company_id_idx" ON "sso_domains"("company_id");

-- CreateIndex
CREATE INDEX "report_subscriptions_company_id_idx" ON "report_subscriptions"("company_id");

-- CreateIndex
CREATE INDEX "report_runs_company_id_created_at_idx" ON "report_runs"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_runs_subscription_id_period_key_key" ON "report_runs"("subscription_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_sso_subject_key" ON "users"("sso_subject");


ALTER TABLE sso_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_providers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sso_providers USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

ALTER TABLE sso_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_domains FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sso_domains USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

ALTER TABLE report_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON report_subscriptions USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON report_runs USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
