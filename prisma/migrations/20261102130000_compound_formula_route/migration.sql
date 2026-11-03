-- The compound's route of administration, entered by hand (IV, IM, SC). It decides which
-- label vial preparation applies when labels give different steps per route. Null: not chosen yet.
ALTER TABLE "compound_formula" ADD COLUMN "route" TEXT;
