-- Packages the catalog excluded (obsolete, unlisted, no SPL, marketing ended…) kept their
-- formulary links; exclusion now ends them, so end the ones left behind.
UPDATE "formulary_item_package" AS fip
SET "valid_to" = now()
FROM "entity" AS e
WHERE e."id" = fip."package_id"
  AND e."status" = 'catalog-excluded'
  AND fip."valid_to" IS NULL;
