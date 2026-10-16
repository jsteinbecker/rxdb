-- AlterEnum
ALTER TYPE "mapping_type" ADD VALUE 'supersedes';

-- AlterTable
ALTER TABLE "entity_mapping" ADD COLUMN     "superseded_name" TEXT;

-- CreateTable
CREATE TABLE "local_concept" (
    "id" UUID NOT NULL,
    "generic_id" UUID,
    "brand_name" TEXT,
    "dose_form" TEXT NOT NULL,
    "evidence_set_id" TEXT NOT NULL,
    "evidence_version" TEXT NOT NULL,
    "evidence_ndc" TEXT,
    "ionic_content" JSONB,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_concept_ingredient" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "local_concept_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "substance_unii" TEXT NOT NULL,
    "substance_name" TEXT NOT NULL,
    "basis" "strength_basis" NOT NULL DEFAULT 'as_labeled',
    "moiety_unii" TEXT,
    "moiety_name" TEXT,
    "strength_num_mag" DECIMAL NOT NULL,
    "strength_num_uom" TEXT NOT NULL,
    "strength_den_mag" DECIMAL NOT NULL DEFAULT 1,
    "strength_den_uom" TEXT NOT NULL,

    CONSTRAINT "local_concept_ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_concept_ingredient_local_concept_id_substance_unii_key" ON "local_concept_ingredient"("local_concept_id", "substance_unii");

-- AddForeignKey
ALTER TABLE "local_concept" ADD CONSTRAINT "local_concept_id_fkey" FOREIGN KEY ("id") REFERENCES "clinical_drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_concept" ADD CONSTRAINT "local_concept_generic_id_fkey" FOREIGN KEY ("generic_id") REFERENCES "local_concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_concept_ingredient" ADD CONSTRAINT "local_concept_ingredient_local_concept_id_fkey" FOREIGN KEY ("local_concept_id") REFERENCES "local_concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed rows
INSERT INTO source (code, description) VALUES ('local', 'Locally defined concepts') ON CONFLICT DO NOTHING;
INSERT INTO identifier_namespace (code, applies_to) VALUES ('local_concept', ARRAY['clinical_drug']::entity_type[])
  ON CONFLICT DO NOTHING;

-- Constraints
ALTER TABLE local_concept_ingredient ADD CONSTRAINT local_concept_ingredient_basis
  CHECK (basis IN ('as_labeled','active_moiety'));
ALTER TABLE local_concept_ingredient ADD CONSTRAINT local_concept_ingredient_moiety
  CHECK (basis = 'as_labeled' OR moiety_unii IS NOT NULL);
ALTER TABLE local_concept ADD CONSTRAINT local_concept_brand
  CHECK ((generic_id IS NULL) = (brand_name IS NULL));
CREATE UNIQUE INDEX entity_mapping_one_supersedes ON entity_mapping (object_entity_id, scope_id)
  WHERE mapping_type = 'supersedes' AND valid_to IS NULL AND superseded_at IS NULL;
