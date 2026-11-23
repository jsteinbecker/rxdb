-- Dosable components: one row per drug (ingredient set) + route in a formulary scope,
-- e.g. <Ampicillin, IV>. Formulary items are linked under every component whose
-- ingredient set and route their packages carry, so <Ampicillin, IV> parents the
-- 2 g, 1 g and 500 mg vial items. A compound constituent (formula_slot) names a dosable
-- component and may narrow it to one formulary item, and further to a subset of that
-- item's packages (NDCs).
--
-- The drug set is product_form.ingredient_key (sorted base-ingredient ids), so salts and
-- dose forms collapse: ampicillin sodium powder and ampicillin solution are one drug.

-- CreateTable
CREATE TABLE "dosable_component" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_id" UUID NOT NULL,
    "ingredient_key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "name_override" TEXT,
    "source" TEXT NOT NULL DEFAULT 'derived',
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dosable_component_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dosable_component_source_check" CHECK ("source" IN ('derived', 'manual')),
    -- same vocabulary as product_form_route and compound_formula.route
    CONSTRAINT "dosable_component_route_check" CHECK ("route" IN ('IM', 'IV', 'SC', 'PO'))
);

-- CreateTable
CREATE TABLE "dosable_component_ingredient" (
    "dosable_component_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "dosable_component_ingredient_pkey" PRIMARY KEY ("dosable_component_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "dosable_component_item" (
    "dosable_component_id" UUID NOT NULL,
    "formulary_item_id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'derived',
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "dosable_component_item_pkey" PRIMARY KEY ("dosable_component_id","formulary_item_id"),
    CONSTRAINT "dosable_component_item_source_check" CHECK ("source" IN ('derived', 'manual'))
);

-- CreateTable: a constituent held to an NDC subset of its required formulary item
-- ("only non-DEHP-confirmed D5W bags"). mode 'manual' = the packages are hand-picked;
-- mode 'rule' (later) = `rule` is evaluated and the matching packages are written as
-- formula_slot_package rows with source 'rule', so readers never care which mode made them.
CREATE TABLE "formula_slot_package_restriction" (
    "slot_id" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "reason" TEXT,
    "rule" JSONB,
    "evaluated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formula_slot_package_restriction_pkey" PRIMARY KEY ("slot_id"),
    CONSTRAINT "formula_slot_package_restriction_mode_check" CHECK ("mode" IN ('manual', 'rule')),
    CONSTRAINT "formula_slot_package_restriction_rule_check" CHECK ("mode" = 'manual' OR "rule" IS NOT NULL)
);

-- CreateTable: the allowed packages (NDCs) under a restriction.
CREATE TABLE "formula_slot_package" (
    "slot_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "formula_slot_package_pkey" PRIMARY KEY ("slot_id","package_id"),
    CONSTRAINT "formula_slot_package_source_check" CHECK ("source" IN ('manual', 'rule'))
);

-- AlterTable: the constituent's level of rigidity.
ALTER TABLE "formula_slot"
    ADD COLUMN "dosable_component_id" UUID,
    ADD COLUMN "formulary_item_id" UUID,
    ADD CONSTRAINT "formula_slot_item_needs_component"
        CHECK ("formulary_item_id" IS NULL OR "dosable_component_id" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "dosable_component_scope_id_ingredient_key_route_key" ON "dosable_component"("scope_id", "ingredient_key", "route");
CREATE INDEX "dosable_component_item_formulary_item_id_idx" ON "dosable_component_item"("formulary_item_id");
CREATE INDEX "formula_slot_dosable_component_id_idx" ON "formula_slot"("dosable_component_id");

-- AddForeignKey
ALTER TABLE "dosable_component" ADD CONSTRAINT "dosable_component_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "scope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dosable_component_ingredient" ADD CONSTRAINT "dosable_component_ingredient_dosable_component_id_fkey" FOREIGN KEY ("dosable_component_id") REFERENCES "dosable_component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dosable_component_ingredient" ADD CONSTRAINT "dosable_component_ingredient_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dosable_component_item" ADD CONSTRAINT "dosable_component_item_dosable_component_id_fkey" FOREIGN KEY ("dosable_component_id") REFERENCES "dosable_component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dosable_component_item" ADD CONSTRAINT "dosable_component_item_formulary_item_id_fkey" FOREIGN KEY ("formulary_item_id") REFERENCES "formulary_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "formula_slot" ADD CONSTRAINT "formula_slot_dosable_component_id_fkey" FOREIGN KEY ("dosable_component_id") REFERENCES "dosable_component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A required formulary item must sit under the slot's dosable component.
ALTER TABLE "formula_slot" ADD CONSTRAINT "formula_slot_dosable_component_item_fkey" FOREIGN KEY ("dosable_component_id", "formulary_item_id") REFERENCES "dosable_component_item"("dosable_component_id", "formulary_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "formula_slot" ADD CONSTRAINT "formula_slot_formulary_item_id_fkey" FOREIGN KEY ("formulary_item_id") REFERENCES "formulary_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "formula_slot_package_restriction" ADD CONSTRAINT "formula_slot_package_restriction_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "formula_slot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "formula_slot_package" ADD CONSTRAINT "formula_slot_package_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "formula_slot_package_restriction"("slot_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "formula_slot_package" ADD CONSTRAINT "formula_slot_package_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An NDC subset only narrows a required formulary item: the slot must name one, and each
-- package must be (or have been) one of that item's packages.
CREATE FUNCTION "formula_slot_package_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item UUID;
BEGIN
    SELECT "formulary_item_id" INTO item FROM "formula_slot" WHERE "id" = NEW."slot_id";
    IF item IS NULL THEN
        RAISE EXCEPTION 'formula slot % has no required formulary item to narrow', NEW."slot_id";
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "formulary_item_package"
                   WHERE "formulary_item_id" = item AND "package_id" = NEW."package_id") THEN
        RAISE EXCEPTION 'package % is not a package of formulary item %', NEW."package_id", item;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER "formula_slot_package_check" BEFORE INSERT OR UPDATE ON "formula_slot_package"
    FOR EACH ROW EXECUTE FUNCTION "formula_slot_package_check"();

-- ---------------------------------------------------------------------------
-- refresh_dosable_components(): rebuilds the derived components and item links from
-- the formulary's current packages (formulary item -> package -> product_form -> active
-- route). Run by the migration as the backfill, and after every product form refresh.
-- Rows that drop out are retired, never deleted, so compound lines keep their link;
-- manual rows are left alone. Returns counts as JSON; created and linked include rows
-- brought back from retirement.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "refresh_dosable_components"() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    created INT; retired INT; linked INT; unlinked INT;
BEGIN
    CREATE TEMP TABLE "_dc_current" ON COMMIT DROP AS
    SELECT DISTINCT fi."scope_id", fi."id" AS formulary_item_id, pf."ingredient_key", pfr."route"
    FROM "formulary_item" fi
    JOIN "entity" e ON e."id" = fi."id" AND e."retired_at" IS NULL
    JOIN "formulary_item_package" fip ON fip."formulary_item_id" = fi."id" AND fip."valid_to" IS NULL
    JOIN "product_form_package" pfp ON pfp."package_id" = fip."package_id"
    JOIN "product_form" pf ON pf."id" = pfp."product_form_id"
    JOIN "product_form_route" pfr ON pfr."product_form_id" = pf."id"
         AND pfr."retired_at" IS NULL AND pfr."status" = 'active';

    WITH ins AS (
        INSERT INTO "dosable_component" ("scope_id", "ingredient_key", "route", "display_name")
        SELECT DISTINCT c."scope_id", c."ingredient_key", c."route",
               (SELECT string_agg(n, ' / ' ORDER BY n) FROM (
                    SELECT DISTINCT initcap(i."name") AS n
                    FROM "product_form" pf
                    JOIN "product_form_ingredient" pfi ON pfi."product_form_id" = pf."id"
                    JOIN "ingredient" i ON i."id" = pfi."ingredient_id"
                    WHERE pf."ingredient_key" = c."ingredient_key") names)
        FROM "_dc_current" c
        ON CONFLICT ("scope_id", "ingredient_key", "route") DO UPDATE
            SET "retired_at" = NULL, "updated_at" = now()
            WHERE "dosable_component"."source" = 'derived' AND "dosable_component"."retired_at" IS NOT NULL
        RETURNING 1
    ) SELECT count(*) INTO created FROM ins;

    UPDATE "dosable_component" dc SET "retired_at" = now(), "updated_at" = now()
    WHERE dc."source" = 'derived' AND dc."retired_at" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "_dc_current" c WHERE c."scope_id" = dc."scope_id"
                      AND c."ingredient_key" = dc."ingredient_key" AND c."route" = dc."route");
    GET DIAGNOSTICS retired = ROW_COUNT;

    INSERT INTO "dosable_component_ingredient" ("dosable_component_id", "ingredient_id", "ordinal")
    SELECT DISTINCT ON (dc."id", pfi."ingredient_id") dc."id", pfi."ingredient_id", pfi."ordinal"
    FROM "dosable_component" dc
    JOIN "product_form" pf ON pf."ingredient_key" = dc."ingredient_key"
    JOIN "product_form_ingredient" pfi ON pfi."product_form_id" = pf."id"
    ORDER BY dc."id", pfi."ingredient_id", pfi."ordinal"
    ON CONFLICT DO NOTHING;

    WITH ins AS (
        INSERT INTO "dosable_component_item" ("dosable_component_id", "formulary_item_id")
        SELECT DISTINCT dc."id", c."formulary_item_id"
        FROM "_dc_current" c
        JOIN "dosable_component" dc ON dc."scope_id" = c."scope_id"
             AND dc."ingredient_key" = c."ingredient_key" AND dc."route" = c."route"
        ON CONFLICT ("dosable_component_id", "formulary_item_id") DO UPDATE
            SET "retired_at" = NULL
            WHERE "dosable_component_item"."source" = 'derived' AND "dosable_component_item"."retired_at" IS NOT NULL
        RETURNING 1
    ) SELECT count(*) INTO linked FROM ins;

    UPDATE "dosable_component_item" dci SET "retired_at" = now()
    FROM "dosable_component" dc
    WHERE dc."id" = dci."dosable_component_id" AND dci."source" = 'derived' AND dci."retired_at" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "_dc_current" c WHERE c."formulary_item_id" = dci."formulary_item_id"
                      AND c."scope_id" = dc."scope_id" AND c."ingredient_key" = dc."ingredient_key"
                      AND c."route" = dc."route");
    GET DIAGNOSTICS unlinked = ROW_COUNT;

    DROP TABLE "_dc_current";
    RETURN jsonb_build_object('created', created, 'retired', retired, 'linked', linked, 'unlinked', unlinked);
END $$;

-- Backfill.
SELECT "refresh_dosable_components"();

-- Existing compound lines: point each at the one dosable component (in the compound's
-- route) that all its candidate packages fall under; a single-package line also keeps
-- that package's formulary item as required.
WITH slot_dc AS (
    SELECT fs."id" AS slot_id, dci."dosable_component_id", dci."formulary_item_id", sc."package_id"
    FROM "formula_slot" fs
    JOIN "compound_formula" cf ON cf."id" = fs."formula_id"
    JOIN "slot_candidate" sc ON sc."slot_id" = fs."id" AND sc."valid_to" IS NULL
    JOIN "formulary_item_package" fip ON fip."package_id" = sc."package_id"
    JOIN "formulary_item" fi ON fi."id" = fip."formulary_item_id" AND fi."scope_id" = cf."scope_id"
    JOIN "dosable_component_item" dci ON dci."formulary_item_id" = fi."id"
    JOIN "dosable_component" dc ON dc."id" = dci."dosable_component_id"
    WHERE cf."route" IS NULL
       OR dc."route" = upper(cf."route")
),
unique_dc AS (
    SELECT slot_id, min("dosable_component_id"::text)::uuid AS dc_id,
           min("formulary_item_id"::text)::uuid AS fi_id,
           count(DISTINCT "formulary_item_id") AS items, count(DISTINCT "package_id") AS packages
    FROM slot_dc GROUP BY slot_id
    HAVING count(DISTINCT "dosable_component_id") = 1
)
UPDATE "formula_slot" fs
SET "dosable_component_id" = u.dc_id,
    "formulary_item_id" = CASE WHEN u.packages = 1 AND u.items = 1 THEN u.fi_id END
FROM unique_dc u
WHERE fs."id" = u.slot_id;
