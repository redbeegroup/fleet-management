-- CreateEnum
CREATE TYPE "InspectionKind" AS ENUM ('PRE_TRIP', 'POST_TRIP', 'PERIODIC');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'DEFECTS', 'FAIL');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('INCENTIVE', 'PENALTY');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');


-- CreateTable
CREATE TABLE "inspection_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "InspectionKind" NOT NULL,
    "vehicle_classes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "items" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "inspection_no" TEXT NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID,
    "trip_id" UUID,
    "template_id" UUID NOT NULL,
    "kind" "InspectionKind" NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL,
    "odometer_km" DECIMAL(12,1),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "items" JSONB NOT NULL,
    "defects" INTEGER NOT NULL DEFAULT 0,
    "critical_defects" INTEGER NOT NULL DEFAULT 0,
    "result" "InspectionResult" NOT NULL,
    "notes" TEXT,
    "performed_by" UUID,
    "repair_request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_courses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "validity_months" INTEGER,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_trainings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "completed_at" DATE NOT NULL,
    "expires_at" DATE,
    "provider" TEXT,
    "score" DECIMAL(5,1),
    "certificate_no" TEXT,
    "certificate_file_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_adjustments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "category" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "dedupe_key" TEXT,
    "incident_id" UUID,
    "proposed_by" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspection_templates_company_id_kind_idx" ON "inspection_templates"("company_id", "kind");

-- CreateIndex
CREATE INDEX "inspections_company_id_performed_at_idx" ON "inspections"("company_id", "performed_at");

-- CreateIndex
CREATE INDEX "inspections_vehicle_id_kind_performed_at_idx" ON "inspections"("vehicle_id", "kind", "performed_at");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_company_id_inspection_no_key" ON "inspections"("company_id", "inspection_no");

-- CreateIndex
CREATE UNIQUE INDEX "training_courses_company_id_code_key" ON "training_courses"("company_id", "code");

-- CreateIndex
CREATE INDEX "driver_trainings_driver_id_course_id_idx" ON "driver_trainings"("driver_id", "course_id");

-- CreateIndex
CREATE INDEX "driver_trainings_company_id_expires_at_idx" ON "driver_trainings"("company_id", "expires_at");

-- CreateIndex
CREATE INDEX "driver_adjustments_company_id_period_idx" ON "driver_adjustments"("company_id", "period");

-- CreateIndex
CREATE INDEX "driver_adjustments_driver_id_period_idx" ON "driver_adjustments"("driver_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "driver_adjustments_company_id_dedupe_key_key" ON "driver_adjustments"("company_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "inspection_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_trainings" ADD CONSTRAINT "driver_trainings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_trainings" ADD CONSTRAINT "driver_trainings_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "training_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_adjustments" ADD CONSTRAINT "driver_adjustments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-Level Security for the new tenant tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inspection_templates','inspections','training_courses','driver_trainings','driver_adjustments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (fms_rls_bypass() OR company_id = fms_current_company()) '
      'WITH CHECK (fms_rls_bypass() OR company_id = fms_current_company())', t);
  END LOOP;
END $$;
