ALTER TABLE "formula_slot"
    ADD COLUMN "volume_whole" BIGINT,
    ADD COLUMN "volume_num" BIGINT,
    ADD COLUMN "volume_den" BIGINT,
    ADD COLUMN "volume_uom" TEXT;

ALTER TABLE "compound_formula"
    ADD COLUMN "total_volume_whole" BIGINT,
    ADD COLUMN "total_volume_num" BIGINT,
    ADD COLUMN "total_volume_den" BIGINT,
    ADD COLUMN "total_volume_uom" TEXT;
