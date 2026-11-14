-- An item's own ingredient display order: ingredient keys ('clavulanate'), first shown first.
-- Empty keeps the sourced order. Only whole ingredients move, each with its own strength.
ALTER TABLE "formulary_item" ADD COLUMN "ingredient_order" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
