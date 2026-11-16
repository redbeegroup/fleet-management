-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "arrival_source" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "invited_at" TIMESTAMP(3),
ADD COLUMN     "password_set_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vehicle_telemetry_state" ADD COLUMN     "at_stop_id" UUID,
ADD COLUMN     "stop_visit_id" UUID;

-- CreateTable
CREATE TABLE "site_visits" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID,
    "trip_id" UUID,
    "kind" TEXT NOT NULL,
    "geofence_id" UUID,
    "stop_id" UUID,
    "customer_id" UUID,
    "site_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL,
    "exited_at" TIMESTAMP(3),
    "duration_min" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_visits_company_id_entered_at_idx" ON "site_visits"("company_id", "entered_at");

-- CreateIndex
CREATE INDEX "site_visits_vehicle_id_entered_at_idx" ON "site_visits"("vehicle_id", "entered_at");

-- CreateIndex
CREATE INDEX "site_visits_stop_id_idx" ON "site_visits"("stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_kind_idx" ON "auth_tokens"("user_id", "kind");


ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_visits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON site_visits USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());

ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth_tokens USING (fms_rls_bypass() OR company_id = fms_current_company())
  WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company());
