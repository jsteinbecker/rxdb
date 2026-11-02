-- The vial preparation step adopted into a compound component: the step every allowed
-- package's label agreed on when it was adopted, with those NDCs and when. Null: none adopted.
ALTER TABLE "formula_slot" ADD COLUMN "vial_prep" JSONB;
