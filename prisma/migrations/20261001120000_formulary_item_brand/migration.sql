CREATE TABLE "formulary_item_brand" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "formulary_item_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "rxcui" TEXT,
    "source" TEXT NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulary_item_brand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "formulary_item_brand_formulary_item_id_name_key_key" ON "formulary_item_brand"("formulary_item_id", "name_key");

ALTER TABLE "formulary_item_brand" ADD CONSTRAINT "formulary_item_brand_formulary_item_id_fkey" FOREIGN KEY ("formulary_item_id") REFERENCES "formulary_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
