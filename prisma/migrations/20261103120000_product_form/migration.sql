-- AlterEnum
ALTER TYPE "entity_type" ADD VALUE 'product_form';

-- CreateTable
CREATE TABLE "product_form" (
    "id" UUID NOT NULL,
    "type" "entity_type" NOT NULL DEFAULT 'product_form',
    "ingredient_key" TEXT NOT NULL,
    "dose_form" TEXT NOT NULL,
    "scdf_rxcui" TEXT,
    "refreshed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_form_ingredient" (
    "product_form_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_form_ingredient_pkey" PRIMARY KEY ("product_form_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "product_form_strength" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_form_id" UUID NOT NULL,
    "clinical_drug_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "basis_ingredient_id" UUID,
    "basis" "strength_basis" NOT NULL DEFAULT 'as_labeled',
    "strength_num_mag" DECIMAL NOT NULL,
    "strength_num_uom" TEXT NOT NULL,
    "strength_den_mag" DECIMAL NOT NULL DEFAULT 1,
    "strength_den_uom" TEXT NOT NULL,

    CONSTRAINT "product_form_strength_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_form_package" (
    "product_form_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,

    CONSTRAINT "product_form_package_pkey" PRIMARY KEY ("product_form_id","package_id")
);

-- CreateTable
CREATE TABLE "product_form_route" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_form_id" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'derived',
    "status" TEXT NOT NULL DEFAULT 'active',
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_form_route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_form_route_prep" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_form_route_id" UUID NOT NULL,
    "package_id" UUID,
    "vial_mass_mg" DECIMAL,
    "diluents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diluent_ml" DECIMAL NOT NULL,
    "final_volume_ml" DECIMAL,
    "concentration_mg_per_ml" DECIMAL,
    "agreeing" INTEGER NOT NULL DEFAULT 1,
    "stating" INTEGER NOT NULL DEFAULT 1,
    "refreshed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_form_route_prep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_form_route_override" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_form_route_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "note" TEXT,
    "edited_by" UUID,
    "edited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_form_route_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_form_id_type_key" ON "product_form"("id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "product_form_ingredient_key_dose_form_key" ON "product_form"("ingredient_key", "dose_form");

-- CreateIndex
CREATE UNIQUE INDEX "product_form_strength_product_form_id_clinical_drug_id_ingr_key" ON "product_form_strength"("product_form_id", "clinical_drug_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_form_package_package_id_key" ON "product_form_package"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_form_route_product_form_id_route_key" ON "product_form_route"("product_form_id", "route");

-- CreateIndex
CREATE INDEX "product_form_route_prep_product_form_route_id_idx" ON "product_form_route_prep"("product_form_route_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_form_route_override_product_form_route_id_field_key" ON "product_form_route_override"("product_form_route_id", "field");

-- AddForeignKey
ALTER TABLE "product_form" ADD CONSTRAINT "product_form_id_type_fkey" FOREIGN KEY ("id", "type") REFERENCES "entity"("id", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_ingredient" ADD CONSTRAINT "product_form_ingredient_product_form_id_fkey" FOREIGN KEY ("product_form_id") REFERENCES "product_form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_ingredient" ADD CONSTRAINT "product_form_ingredient_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_strength" ADD CONSTRAINT "product_form_strength_product_form_id_fkey" FOREIGN KEY ("product_form_id") REFERENCES "product_form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_strength" ADD CONSTRAINT "product_form_strength_clinical_drug_id_fkey" FOREIGN KEY ("clinical_drug_id") REFERENCES "clinical_drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_strength" ADD CONSTRAINT "product_form_strength_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_strength" ADD CONSTRAINT "product_form_strength_basis_ingredient_id_fkey" FOREIGN KEY ("basis_ingredient_id") REFERENCES "ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_package" ADD CONSTRAINT "product_form_package_product_form_id_fkey" FOREIGN KEY ("product_form_id") REFERENCES "product_form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_package" ADD CONSTRAINT "product_form_package_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_route" ADD CONSTRAINT "product_form_route_product_form_id_fkey" FOREIGN KEY ("product_form_id") REFERENCES "product_form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_route_prep" ADD CONSTRAINT "product_form_route_prep_product_form_route_id_fkey" FOREIGN KEY ("product_form_route_id") REFERENCES "product_form_route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_route_prep" ADD CONSTRAINT "product_form_route_prep_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_form_route_override" ADD CONSTRAINT "product_form_route_override_product_form_route_id_fkey" FOREIGN KEY ("product_form_route_id") REFERENCES "product_form_route"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Constraints
ALTER TABLE product_form ADD CONSTRAINT product_form_type CHECK (type = 'product_form');
ALTER TABLE product_form_route ADD CONSTRAINT product_form_route_route
  CHECK (route IN ('IM','IV','SC','PO'));
ALTER TABLE product_form_route ADD CONSTRAINT product_form_route_source
  CHECK (source IN ('derived','manual'));
ALTER TABLE product_form_route ADD CONSTRAINT product_form_route_status
  CHECK (status IN ('active','retired') AND (status = 'retired') = (retired_at IS NOT NULL));
ALTER TABLE product_form_route_prep ADD CONSTRAINT product_form_route_prep_counts
  CHECK (agreeing >= 1 AND agreeing <= stating);
