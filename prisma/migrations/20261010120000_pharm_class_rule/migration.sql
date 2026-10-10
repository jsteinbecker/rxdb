-- CreateTable
CREATE TABLE "pharm_class_rule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "moiety_key" TEXT NOT NULL,
    "moiety_names" TEXT NOT NULL,
    "dose_form_group" TEXT,
    "route" TEXT,
    "strength_key" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'replace',
    "classes" TEXT[],
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pharm_class_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pharm_class_rule_scope_id_moiety_key_idx" ON "pharm_class_rule"("scope_id", "moiety_key");

-- AddForeignKey
ALTER TABLE "pharm_class_rule" ADD CONSTRAINT "pharm_class_rule_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE pharm_class_rule ADD CONSTRAINT pharm_class_rule_key
  UNIQUE NULLS NOT DISTINCT (scope_id, moiety_key, dose_form_group, route, strength_key);
ALTER TABLE pharm_class_rule ADD CONSTRAINT pharm_class_rule_mode
  CHECK (mode IN ('replace','add','suppress'));
