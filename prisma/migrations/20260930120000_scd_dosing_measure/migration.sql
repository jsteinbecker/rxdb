CREATE TABLE "scd_dosing_measure" (
    "concept_key" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "ingredient" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scd_dosing_measure_pkey" PRIMARY KEY ("concept_key")
);
