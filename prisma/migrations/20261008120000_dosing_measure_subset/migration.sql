ALTER TABLE "scd_dosing_measure" ADD COLUMN "ingredients" TEXT[] DEFAULT ARRAY[]::TEXT[];
