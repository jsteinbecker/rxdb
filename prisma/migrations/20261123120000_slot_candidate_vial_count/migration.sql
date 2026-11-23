-- How many vials of this package the compound pulls for its slot: the vial combination
-- picked for a generic component's dose. Null: no combination picked for this package.
ALTER TABLE "slot_candidate" ADD COLUMN "vial_count" INTEGER;
ALTER TABLE "slot_candidate" ADD CONSTRAINT "slot_candidate_vial_count_positive" CHECK ("vial_count" IS NULL OR "vial_count" > 0);
