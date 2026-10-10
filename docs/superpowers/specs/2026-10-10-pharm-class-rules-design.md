# Pharm-class assignment rules

## Goal
Let a user assign, add or suppress pharmacologic classes for one **ingredient set + dose-form group** (optionally
narrowed by route and concentration). The change reaches every matching NDC automatically, including NDCs cached
later, with no per-NDC edits.

## Decisions
- **Rules match packages by their properties; nothing is copied onto packages.** A rule stores a match key, not an NDC
  list. It is applied when packages are **read**, so a new or edited rule changes every matching package immediately,
  and a package synced later matches as soon as it is loaded. No restaging, no propagation job, nothing to go stale.
  (Per-NDC overrides need `override-propagation.ts` only because they are attached to one snapshot.)
- **Staged snapshots are never changed.** `product.pharmClasses` in a snapshot stays exactly what openFDA/NDC
  directory said. Rules are applied on top in the view layer, so removing a rule restores the source classes.
- **Not keyed on RxCUI.** Many NDCs have no RxCUI or have one that moves (bulk, kits, unapproved drugs), and RxNorm
  has no clean "ingredient + form group, any strength" node.
- **Not on `FormularyItem`.** Classes are facts about a drug, and they must also apply to packages nobody has curated
  into a formulary item.
- **Scoped** per `Scope` (`defaultScope()` for now), the same way overrides are.

## Match key (computed per package, pure)
| Facet | Computed from | On the rule |
|---|---|---|
| `moietyKey` | Active ingredients in `details.spl.ingredients` (`kind === 'active'`). Each one contributes its first moiety UNII when present, else its own UNII. The result is de-duplicated, sorted and joined with `\|`. Falls back to `details.product.uniis` when there is no SPL or it lists no active UNII. | required |
| `doseFormGroup` | `doseFormGroup(item.doseForm, routes)`: a fixed table from SPL dose-form text to RxNorm-DFG-like groups (`injectable`, `oral-solid`, `oral-liquid`, `topical`, `ophthalmic`, `otic`, `nasal`, `inhalation`, `rectal`, `vaginal`, `transdermal`, `other`). Forms that name no site, and solids, suppositories, films and kits, take the route into account (an implant, a pellet given by injection, an oral gel, an intravesical or dental product are `other`; a suppository is `vaginal` by vaginal route, else `rectal`; a kit follows an injectable or topical-type route, else `other`; an oral film is `oral-solid`). | nullable = any |
| `route` | `details.product.routes` (already normalized). A rule matches when its route is among the package's routes. | nullable = any |
| `strengthKey` | Each active ingredient's `parseStrength` result, normalized (mg, mcg→mg, g→mg; per mL / per unit), reduced to an exact rational string such as `20/1 mg/mL`. A combination pairs each strength with its own moiety UNII (`MOIETY=20/1 mg/mL`), so 5/10 and 10/5 of the same pair differ; the pairs are sorted and joined with `\|`. A single active has no prefix. Null when any active strength cannot be parsed. Shown in words without the prefixes. | nullable = any |

Salts and esters collapse because the key uses moiety UNIIs (lidocaine HCl → lidocaine). Combination products have
their own `moietyKey`, so a single-ingredient rule never reaches a combination product.

A package whose `moietyKey` is empty (no active UNIIs) matches no rule.

## Data
`pharm_class_rule`: `id`, `scope_id` (FK), `moiety_key`, `moiety_names` (display text captured when the rule was made),
`dose_form_group` (nullable), `route` (nullable), `strength_key` (nullable), `mode` (`replace` | `add` | `suppress`),
`classes` (text[]), `note` (nullable), `created_at`, `updated_at`.
Rule ids are checked as UUIDs before any lookup, so a malformed id is a 404. A save that loses a race on the unique key retries once as an update of the winning row. Unique on `(scope_id, moiety_key, dose_form_group, route, strength_key)`, which needs `NULLS NOT DISTINCT` (PG 15+;
raw SQL in the migration, because Prisma cannot express it). Indexed on `(scope_id, moiety_key)`. One migration.

Class strings follow openFDA's format, `Name [EPC|MoA|PE|CS]`. A class without a suffix is stored as given and shown
with a "custom" tag.

## Resolution (pure)
`resolvePharmClasses(source: string[], key: PackageClassKey, rules: Rule[])`:
1. Keep the rules that match: the same `moietyKey`, and every non-null facet on the rule equals the package's.
2. Order them by specificity, computed as `count * 8 + weight`: the number of non-null facets first, with ties broken
   by facet weight (strength 4, route 2, form 1; at most 7, so it never outranks a facet). Two different rules can't
   share a key, so there are never exact ties (equal scores fall back to creation order).
3. Fold them from least to most specific, starting from `source`:
   - `replace`: the result becomes `rule.classes`
   - `add`: union with `rule.classes`
   - `suppress`: remove `rule.classes`; with no classes, hide all (the result is empty)

   The most specific rule wins on what overlaps, while broader `add` rules still contribute when nothing narrower
   replaces them.
4. Return `{ classes, applied: { ruleId, mode, classes }[], source }` so the UI can show where each class came from.

## Read side
The wrapper is split in two so the logic is testable without a database:
- `applyPharmClassRules(items, loadRules)` (`src/lib/pharm-class-view.ts`, pure) computes each item's key, makes one
  `loadRules(moietyKeys)` call (none when no item has a moiety key) and returns copies whose
  `details.product.pharmClasses` is the resolved list, plus a `details.product.pharmClassResolution` holding `source`
  and `applied`.
- `withPharmClassRules(db, scopeId, items)` (`src/lib/server/pharm-class-view.ts`) binds it to the scope's rules, one
  query on `moiety_key IN (…)`.

It is called in the two loaders that show a package's classes: the NDC page and the formulary item page. It is
**not** applied on the root search page or `api/v1/search`, nor in `formulary-view.ts` or other API endpoints (those
do not surface rule-resolved classes yet). It is **never** called in sync, staging, reinterpret or override paths.

## UI
- **NDC page, pharm-class block (`PackageDetail.svelte`):** each class carries a small source marker: none for a
  source class, "rule" for one a rule added. Classes a rule suppressed are listed in a "Hidden by rule (n)" disclosure.
- **"Assign class…" action** (⋯ menu on the block) opens a dialog:
  - Mode: Replace / Add / Hide.
  - Classes: type-ahead over classes already seen in the cache, plus free text.
  - Scope: radio options built from this package's key (`scopeOptions`), each with a live count of matching cached
    NDCs: *All forms* · *{form group} only* · *{form group}, {route}* · *{form group}, {route}, this strength*. Each
    narrower option is cumulative: it keeps the facets of the one before it. The route is the package's first route
    (the matcher accepts a rule's route when the package lists it), and the strength option needs a parseable
    strength. The default is form group.
  - Saving upserts the rule for that exact key. When a rule for the key already exists, the dialog opens with it
    loaded, so you edit it rather than add a duplicate.
- **`/formulary/pharm-classes`:** a table of the scope's rules (key in words, mode, classes, match count, note), with
  edit and delete behind the row ⋯ menu. Editing changes only mode, classes and note; the key is kept as stored. The
  link to it ("Class rules") sits in the eyebrow nav of the formulary page (`/formulary`), because the root layout has
  no nav.

## Match counts
`countMatches(db, key)` uses the cache: the latest completed snapshots that carry every UNII in the rule's key, either
in `details.product.uniis` or as an SPL ingredient UNII or moiety UNII (`details.spl.ingredients`), are pre-filtered
in SQL, then confirmed with the pure matcher, read in NDC order and capped at 2000 rows. `capped` is true whenever that row limit was hit, and the count is then a lower bound. The count is a guide, not a guarantee, because NDCs not cached yet will also match later.

The rules list uses `countMatchesForRules(db, rules)` instead: one scan per distinct moiety key (rules that share a key share the scan), two scans at a time, returning counts keyed by rule id. The NDC dialog keeps `countMatches`.

## Testing
- `node:test` unit tests for the key functions:
  - salt vs. base collapse
  - combination keys
  - dose-form grouping
  - strength normalization (mg/mL vs. mg/5 mL vs. g/L)
  - unparseable strength → null
- Unit tests for resolution:
  - replace beats a broader replace
  - a broad add plus a narrow replace
  - suppress
  - combination isolation
  - no rules → source unchanged
- Dev-server check: pick any moiety in the cache that has both a single-ingredient product and a combination product
  (the dev cache has no lidocaine; ampicillin has plenty of single products). Create a form-group rule for the single
  moiety, then confirm the single product shows the rule's classes, a combination product of the same moiety does not,
  and a product of the same moiety in another dose-form group does not. Also compare the match count on the NDC dialog
  with the one on `/formulary/pharm-classes`; they must agree.

## Out of scope (follow-ups)
- Suggested rules from disagreement between NDCs (a `ReviewItem` when openFDA EPC differs across one moiety key and
  form group).
- Filtering or grouping the formulary by class.
- Opting single-ingredient rules into combination products.
- Exporting or sharing rules across scopes.
