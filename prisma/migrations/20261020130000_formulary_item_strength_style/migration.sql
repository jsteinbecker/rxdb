-- An item's own strength display style: 'percent', 'ratio', 'stored', or NULL to
-- follow the formulary's rules. Items that showed their strength as a percent keep it.
ALTER TABLE "formulary_item" ADD COLUMN "strength_style" TEXT;

UPDATE "formulary_item" SET "strength_style" = 'percent' WHERE "strength_as_percent";

ALTER TABLE "formulary_item" DROP COLUMN "strength_as_percent";
