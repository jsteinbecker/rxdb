# Local Superseding Concepts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user defines a local SCD/SBD with correct ingredients and has it stand in for a wrong RxNorm concept in a
scope, applied when data is read, with drift review when RxNorm changes. TrophAmine 10% (RxCUI 800611) is the first
case.

**Architecture:**
- The pure logic lives in three files: `src/lib/local-concept.ts` (naming, parsing, diff), `src/lib/local-concept-view.ts`
  (resolution and attaching to packages) and `src/lib/local-concept-drift.ts`.
- Storage is two new tables plus a `supersedes` `EntityMapping` (an entity type and mapping type that already exist).
- The server wrapper `withLocalConcepts` is called from the same read paths as `withPharmClassRules`. Formulary item
  names are swapped at read time in `loadedItems` and `formularyRows`, as pseudo-SCD names already are. The stored
  `displayName` stays RxNorm's.
- Snapshots are never changed.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Prisma 7 (`prisma-client` → `src/generated`), PostgreSQL 15+,
`node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-14-local-superseding-concepts-design.md`

## Global Constraints

- Open questions use the spec's defaults:
  - **Scope:** `defaultScope()`.
  - **N-acetyl-L-tyrosine:** its own row at 2.4 MG/ML.
  - **Salts:** lysine and cysteine on a moiety basis (`active_moiety`).
- **Two changes to the spec,** made in Task 1:
  1. `local_concept_ingredient` has **no** `measure` columns. The existing `product_ingredient.strength*` measure
     columns are plain composites that nothing fills. Strengths are compared in TypeScript on exact rationals
     normalized to mg/mL (or mEq/mL).
  2. `loadToFormulary` keeps storing RxNorm's name. Local names are applied when read, so "Stop superseding" restores
     the RxNorm name everywhere at once.
  3. **Saved local SBDs are deferred.** The schema supports them (`generic_id`, `brand_name`), but this plan only
     creates local SCDs. SBD-coded NDCs get the derived SBD.
- Never call `withLocalConcepts` or `localConceptsForRxcuis` from sync, staging, `reinterpret`, override propagation or
  `findEquivalentPackages`. The one write-path hook is the drift check in Task 6, which only writes `review_item`.
- **API responses** keep `rxcui` and `details.rxnav` exactly as RxNav gave them, and only **add** `localConcept`. If
  the lookup fails, the response falls back to no `localConcept`; it never fails the request.
- **Basis values:** the DB enum `StrengthBasis` (`as_labeled` | `active_moiety` | `salt`). A local concept uses only
  `as_labeled` and `active_moiety`. From `IngredientCorrection.basis`: `ingredient` → `as_labeled` and
  `moiety` → `active_moiety`. `reference` is rejected.
- **Codes** are `LC` followed by a six-digit zero-padded number (`LC000001`), in identifier namespace `local_concept`.
- **Tests** are `node:test` in `src/lib/server/*.test.ts` and use relative imports (no `$lib`). DB tests are opt-in
  with `RUN_DB_TESTS=1` and are added to the `test:db` script.
- **Code style:** 2 spaces in `src/lib/*.ts`; tabs in `.svelte` and route files that already use tabs. Per-row
  options go behind a ⋯ menu (`.row-menu`).

## Review Focus

- **An NDC whose RxCUI is an SBD with no mapping of its own** (TrophAmine 0264-1933-10 → 1189640): it must get a
  derived local SBD through the SCD's counterpart. A missing concept snapshot means no `localConcept`, not an error
  (Task 3).
- **Two active mappings for one RxCUI in one scope:** the second `supersede` call must fail with a clear message
  rather than silently making two (Task 4).
- **A formulary item with a `nameOverride`:** the user's override still wins over the local name (Task 5).
- **Equal strengths in different units** (`8.51 MG/ML` vs `0.851 G/100ML`, and the mEq units in the RxNorm name) must
  not count as changes in the diff (Task 2).
- **Retired or stopped mappings:** a mapping with `validTo` or `supersededAt` set, or a retired local concept, never
  resolves, and stopping one hides it from all read paths without reloading the cache (Tasks 3, 4).

---

### Task 1: Schema, migration and spec amendments

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261014120000_local_concept/migration.sql`
- Modify: `docs/superpowers/specs/2026-10-14-local-superseding-concepts-design.md`

**Interfaces:**
- Produces: Prisma models `LocalConcept` and `LocalConceptIngredient`; `MappingType.supersedes`;
  `EntityMapping.supersededName`; seed rows `source.code = 'local'` and `identifier_namespace.code = 'local_concept'`.

- [ ] **Step 1: Add the models.** `LocalConcept` (`@@map("local_concept")`):
  - `id` — UUID, PK, and a relation to `ClinicalDrug.id`
  - `genericId` — nullable, a self-relation (`"LocalConceptGeneric"`)
  - `brandName` — nullable
  - `doseForm`
  - `evidenceSetId`
  - `evidenceVersion`
  - `evidenceNdc` — nullable
  - `ionicContent` — `Json?`
  - `note` — nullable
  - `createdBy` — UUID, nullable
  - `createdAt`, `updatedAt`
  - `ingredients LocalConceptIngredient[]`

  `LocalConceptIngredient` (`@@map("local_concept_ingredient")`):
  - `id`
  - `localConceptId` — FK, `onDelete: Cascade`
  - `ordinal`
  - `substanceUnii`, `substanceName`
  - `basis StrengthBasis @default(as_labeled)`
  - `moietyUnii`, `moietyName` — both nullable
  - `strengthNumMag Decimal`, `strengthNumUom`
  - `strengthDenMag Decimal @default(1)`, `strengthDenUom`
  - `@@unique([localConceptId, substanceUnii])`

  Also: add `localConcept LocalConcept?` to `ClinicalDrug`, `supersedes` to `MappingType`, and
  `supersededName String? @map("superseded_name")` to `EntityMapping`.
- [ ] **Step 2: Create the migration.** Run `npx prisma migrate dev --create-only --name local_concept`, rename the
  folder to `20261014120000_local_concept`, and append:
  ```sql
  INSERT INTO source (code, description) VALUES ('local', 'Locally defined concepts') ON CONFLICT DO NOTHING;
  INSERT INTO identifier_namespace (code, applies_to) VALUES ('local_concept', ARRAY['clinical_drug']::entity_type[])
    ON CONFLICT DO NOTHING;
  ALTER TABLE local_concept_ingredient ADD CONSTRAINT local_concept_ingredient_basis
    CHECK (basis IN ('as_labeled','active_moiety'));
  ALTER TABLE local_concept_ingredient ADD CONSTRAINT local_concept_ingredient_moiety
    CHECK (basis = 'as_labeled' OR moiety_unii IS NOT NULL);
  ALTER TABLE local_concept ADD CONSTRAINT local_concept_brand
    CHECK ((generic_id IS NULL) = (brand_name IS NULL));
  CREATE UNIQUE INDEX entity_mapping_one_supersedes ON entity_mapping (object_entity_id, scope_id)
    WHERE mapping_type = 'supersedes' AND valid_to IS NULL AND superseded_at IS NULL;
  ```
  Check the `identifier_namespace` column names against `prisma/schema.prisma` before running.
- [ ] **Step 3: Run the migration.** Run `npx prisma migrate dev` and `npx prisma generate`. Expected: the migration
  applies and `src/generated` gains `LocalConcept`.
- [ ] **Step 4: Amend the spec.** In the spec's Data section, replace the `measure` columns sentence with the
  TypeScript comparison from Global Constraints item 1. In "Where it is applied", replace the formulary-load bullet
  with Global Constraints item 2. In Testing, drop the migration `measure` check.
- [ ] **Step 5: Commit.**
  ```bash
  git add prisma/schema.prisma prisma/migrations/20261014120000_local_concept src/generated docs/superpowers/specs/2026-10-14-local-superseding-concepts-design.md
  git commit -m "feat(local-concept): schema for local superseding concepts"
  ```

### Task 2: Naming, parsing and diff (pure)

**Files:**
- Create: `src/lib/local-concept.ts`
- Test: `src/lib/server/local-concept.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LocalIngredient = {
    substanceUnii: string; substanceName: string;
    basis: 'as_labeled' | 'active_moiety';
    moietyUnii: string | null; moietyName: string | null;
    strengthNumMag: string; strengthNumUom: string; strengthDenMag: string; strengthDenUom: string;
  };
  export type ConceptIngredient = { name: string; value: string; unit: string }; // unit like 'MG/ML', 'MEQ/ML'
  export function ingredientDisplayName(row: LocalIngredient): string;       // moietyName for active_moiety, else substanceName; lower-case
  export function rxnormNumber(value: string): string;                       // '8.510' → '8.51', '.5' → '0.5', '14.0' → '14'
  export function localConceptName(input: { ingredients: LocalIngredient[]; doseForm: string; brandName?: string | null }): string;
  export function parseScdName(name: string): { ingredients: ConceptIngredient[]; doseForm: string | null; brand: string | null } | null;
  export function sameStrength(a: ConceptIngredient, b: ConceptIngredient): boolean;
  export type IngredientDiff = { name: string; change: 'added' | 'removed' | 'changed' | 'same'; rxnorm: ConceptIngredient | null; local: ConceptIngredient | null }[];
  export function diffIngredients(rxnorm: ConceptIngredient[], local: ConceptIngredient[]): IngredientDiff;
  export function asConceptIngredient(row: LocalIngredient): ConceptIngredient;
  ```

- [ ] **Step 1: Write the failing tests** in `local-concept.test.ts`:
  - `rxnormNumber`: `'8.510'` → `'8.51'`; `'.5'` → `'0.5'`; `'14.0'` → `'14'`; `'0.166'` → `'0.166'`.
  - `localConceptName`:
    - Rows (`taurine 0.25 MG/ML`, `alanine 5.4 MG/ML`, lysine `active_moiety` 8.51 MG/ML) with `Injectable Solution`
      → `'alanine 5.4 MG/ML / lysine 8.51 MG/ML / taurine 0.25 MG/ML Injectable Solution'`.
    - With `brandName: 'TrophAmine'` → the same name plus `' [TrophAmine]'`.
    - Denominator 100 ML is normalized: `0.851 G/100 ML` is named `8.51 MG/ML`.
  - `parseScdName` on the full RxCUI 800611 name (copied verbatim from the spec's First case section):
    - 22 ingredients
    - `sodium acetate` = `{ value: '0.097', unit: 'MEQ/ML' }`
    - `leucine` = `{ value: '1.4', unit: 'MG/ML' }`
    - doseForm `'Injectable Solution'`, brand `null`
  - `parseScdName` with a `[Trophamine 10 %]` suffix gives brand `'Trophamine 10 %'`. A name with no strengths
    returns `null`.
  - `sameStrength`: `8.51 MG/ML` equals `851 MG/100ML`; `1.4 MG/ML` differs from `14 MG/ML`; `MG/ML` vs `MEQ/ML` is
    never equal.
  - `diffIngredients` with RxNorm 800611 against the TrophAmine local rows from the spec table:
    - `removed`: `sodium acetate`, `sodium chloride`, `sodium metabisulfite`
    - `changed`: `leucine`, `lysine`, `cysteine`, `tyrosine`
    - `added`: `N-acetyl-L-tyrosine`
    - `same`: `isoleucine`, `taurine`, and the other 13 unchanged amino acids

    Names match case-insensitively.
- [ ] **Step 2: Run the tests to see them fail.** Run `npm test`. Expected: FAIL, because `local-concept.ts` is
  missing.
- [ ] **Step 3: Implement `src/lib/local-concept.ts`.**
  - **Strength values:** exact rationals from `src/lib/rational.ts` (`fromNumber` on decimal strings, then
    `multiply`/`divide`), with mass scaled by `mgPer` and volume by `mlPer` from `src/lib/units.ts`. Never compare
    floats.
  - **Names:** sort ingredients by their lower-case display name (as RxNorm does), join with `' / '`, then
    `' ' + doseForm`.
  - **`parseScdName`:** split off a trailing `[...]` as the brand. Split the rest on `' / '`. The last segment is
    `name value unit doseForm`; match it with `/^(.*?) (\d*\.?\d+) ([A-Z[\]]+\/[A-Z]+|[A-Z[\]]+)(?: (.*))?$/i` and
    take group 4 of the last segment as the dose form.
- [ ] **Step 4: Run the tests to see them pass.** Run `npm test`. Expected: all `local-concept` tests PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(local-concept): RxNorm-style naming, name parsing and ingredient diff"`

### Task 3: Resolution and view (pure)

**Files:**
- Create: `src/lib/local-concept-view.ts`
- Modify: `src/lib/server/catalog-providers.ts` (type only: add `localConcept?: LocalConceptView` to `ExternalPackage`,
  commented `Read-side only`)
- Test: `src/lib/server/local-concept-view.test.ts`

**Interfaces:**
- Consumes: `LocalIngredient`, `localConceptName`, `asConceptIngredient` (Task 2).
- Produces:
  ```ts
  export type LocalConceptRecord = {
    id: string; code: string; tty: 'SCD' | 'SBD'; name: string; doseForm: string;
    brandName: string | null; ingredients: LocalIngredient[]; ionicContent: unknown | null;
    supersedes: { rxcui: string; name: string | null; mappingId: string };
  };
  export type LocalConceptView = Omit<LocalConceptRecord, 'supersedes'> & {
    supersedes: { rxcui: string; name: string | null };
    derived: boolean;
  };
  /** rxcuis → view. `byRxcui` holds direct mappings; `counterparts` maps an SBD rxcui to its SCD rxcui; `brands` maps an SBD rxcui to its brand name. */
  export function resolveLocal(rxcuis: string[], byRxcui: Map<string, LocalConceptRecord>,
    counterparts: Map<string, string>, brands: Map<string, string>): Map<string, LocalConceptView>;
  export async function applyLocalConcepts<T extends { details: { rxnav: { rxcui: string | null } | null } | null }>(
    items: T[], load: (rxcuis: string[]) => Promise<Map<string, LocalConceptView>>): Promise<(T & { localConcept?: LocalConceptView })[]>;
  ```

- [ ] **Step 1: Write the failing tests:**
  - A direct mapping gives `derived: false` and the record's name.
  - An SBD rxcui with no mapping, whose counterpart SCD is mapped, gives
    `{ tty: 'SBD', derived: true, brandName: 'TrophAmine', supersedes.rxcui: '1189640' }`, with the name ending
    `' [TrophAmine]'` and the SCD's ingredients.
  - An SBD with a direct mapping wins over the derived one.
  - An unmapped rxcui is absent from the map.
  - `applyLocalConcepts`:
    - makes one `load` call with de-duplicated rxcuis
    - makes no call when no item has an rxcui
    - returns new objects with `details.rxnav` deep-equal to the input
    - does not mutate the input (`assert.deepEqual` against a `structuredClone` taken before the call)
- [ ] **Step 2: Run the tests to see them fail.** Run `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement**, following `src/lib/pharm-class-view.ts`.
- [ ] **Step 4: Run the tests to see them pass.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(local-concept): resolve local concepts, including derived SBDs"`

### Task 4: Store and input validation

**Files:**
- Create: `src/lib/local-concept-input.ts`, `src/lib/server/local-concept-store.ts`
- Test: `src/lib/server/local-concept-input.test.ts`, `src/lib/server/local-concept-store.integration.test.ts`
- Modify: `package.json` (`test:db` gains the new integration test)

**Interfaces:**
- Consumes: Task 2 types; Prisma models from Task 1.
- Produces:
  ```ts
  // local-concept-input.ts
  export class LocalConceptInputError extends Error {}
  export type LocalConceptInput = { doseForm: string; ingredients: LocalIngredient[]; evidenceSetId: string;
    evidenceVersion: string; evidenceNdc: string | null; ionicContent: unknown | null; note: string | null };
  export function parseLocalConceptInput(raw: unknown): LocalConceptInput; // throws LocalConceptInputError
  // local-concept-store.ts
  export async function createLocalConcept(db, input: LocalConceptInput): Promise<{ id: string; code: string }>;
  export async function updateLocalConcept(db, id: string, input: LocalConceptInput): Promise<void>;
  export async function supersede(db, scopeId: string, localId: string, rxcui: string, approvedBy: string | null): Promise<{ mappingId: string }>;
  export async function stopSuperseding(db, scopeId: string, mappingId: string): Promise<void>;
  export async function retireLocalConcept(db, id: string): Promise<void>; // retiredAt + ends its mappings
  export async function localConceptsForRxcuis(db, scopeId: string, rxcuis: string[]): Promise<Map<string, LocalConceptRecord>>;
  export async function listLocalConcepts(db, scopeId: string): Promise<(LocalConceptRecord & { openDrift: number })[]>;
  ```

- [ ] **Step 1: Write the failing input tests:**
  - A UNII that isn't 10 characters `[A-Z0-9]` → error.
  - Duplicate substance UNIIs → error.
  - `active_moiety` with no moiety → error.
  - A strength that isn't a positive decimal → error.
  - No ingredients → error.
  - A blank `evidenceSetId` → error.
  - A blank dose form → error.
  - Names are trimmed and the UNII upper-cased.
  - The TrophAmine input (21 rows) parses.
- [ ] **Step 2: Run the tests to see them fail.** Run `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement the input parser.** Implement `parseLocalConceptInput`, reusing `readSubstance`-style checks
  from `src/lib/ingredient-correction.ts`.
- [ ] **Step 4: Implement the store.**
  - **Create:** in one transaction under `pg_advisory_xact_lock(731924, 1)`:
    1. Create an `Entity` of type `clinical_drug`.
    2. Create a `ClinicalDrug` with `tty: 'SCD'` and `name: localConceptName(...)`.
    3. Create the `LocalConcept` and its ingredient rows.
    4. Pick the next code (max existing `local_concept` identifier + 1) and attach it as an `ExternalIdentifier` with
       `isPrimary: true`.
  - **Update:** replaces the ingredient rows and regenerates `ClinicalDrug.name`.
  - **`supersede`:**
    - Look up the RxNorm entity by its `rxnorm_rxcui` identifier. If it is missing, throw `LocalConceptInputError`
      (`'RxCUI … is not in the catalog; load it first'`).
    - Create the `EntityMapping` with `mappingType: 'supersedes'`, `assertedBySource: 'local'`,
      `supersededName = ClinicalDrug.name`, and `approvedAt: now`.
    - If the partial unique index rejects it, throw `LocalConceptInputError`
      (`'RxCUI … is already superseded in this scope'`).
  - **`stopSuperseding`:** sets `validTo` and `invalidatedReason: 'stopped by user'`.
  - **`localConceptsForRxcuis`:** one query, filtered on an active mapping in the scope and `entity.retiredAt: null`.
- [ ] **Step 5: Write the DB integration test.** Add `local-concept-store.integration.test.ts`, following
  `catalog-store.integration.test.ts`: `RUN_DB_TESTS` gate, everything in a transaction rolled back at the end. It
  covers:
  - create, then supersede a fixture RxCUI, then `localConceptsForRxcuis` returns it
  - a second `supersede` throws
  - `stopSuperseding`, then it resolves to nothing
  - `retireLocalConcept`, then it resolves to nothing even with a fresh mapping
- [ ] **Step 6: Run the tests.** Run `npm test` and `npm run test:db`. Expected: PASS.
- [ ] **Step 7: Commit.** `git commit -m "feat(local-concept): store, input validation and supersede mapping"`

### Task 5: Read-side wiring

**Files:**
- Create: `src/lib/server/local-concept-view.ts`
- Modify:
  - `src/routes/formulary/ndc/[ndc]/+page.server.ts`
  - `src/routes/formulary/items/[id]/+page.server.ts`
  - `src/routes/api/v1/ndc/[ndc]/+server.ts`
  - `src/routes/api/v1/search/+server.ts`
  - `src/routes/api/v1/search/packages/+server.ts`
  - `src/routes/api/v1/rxcui/names/+server.ts`
  - `src/lib/server/catalog-formulary.ts` (`loadedItems`)
  - `src/lib/server/formulary-view.ts` (`formularyRows`)
- Test: `src/lib/server/local-concept-view.test.ts` (extend)

**Interfaces:**
- Consumes: `applyLocalConcepts`, `resolveLocal` (Task 3); `localConceptsForRxcuis` (Task 4); `loadConceptSnapshots`
  (`catalog-store.ts`).
- Produces:
  ```ts
  export function withLocalConcepts<T extends …>(db, scopeId: string, items: T[], loadRecords = localConceptsForRxcuis): Promise<(T & { localConcept?: LocalConceptView })[]>;
  export async function localConceptsByRxcui(db, scopeId: string, rxcuis: string[]): Promise<Map<string, LocalConceptView>>;
  ```

- [ ] **Step 1: Write the failing test.** `withLocalConcepts` with an injected `loadRecords` and a stub concept loader:
  an SBD-coded package gets a derived view, and a `loadRecords` that throws gives the items back unchanged.
- [ ] **Step 2: Implement `localConceptsByRxcui`:**
  1. Load the direct records.
  2. For rxcuis with no record, read their concept snapshots (`loadConceptSnapshots`). Build `counterparts` from
     `details.counterparts`, keeping entries whose `tty` is `SCD`, and `brands` from `details.brands[0].name`.
  3. Load records for those SCD rxcuis.
  4. Call `resolveLocal`.

  `withLocalConcepts` wraps `applyLocalConcepts` in a `try/catch` that returns the input when anything fails.
- [ ] **Step 3: Run the tests.** Run `npm test`. Expected: PASS.
- [ ] **Step 4: Wire the package paths.** Call `withLocalConcepts` right after `withPharmClassRules` in the NDC page
  loader, the item page loader, `/api/v1/ndc/[ndc]`, `/api/v1/search` and `/api/v1/search/packages`. In search, use
  one call for the whole tree: flatten it like `withPharmClassRulesInTree`.
- [ ] **Step 5: Wire the names.**
  - **`loadedItems`:** for concept targets, call `localConceptsByRxcui` once. Use the local name in place of
    `item.displayName` for `displayName`, `sourceName` and `releasePeriod`. `itemName` still applies `nameOverride`,
    which wins. Add `localConcept: { code, supersedes } | null` to each item.
  - **`formularyRows`:** take an optional `localNames: Map<formularyItemId, string>` (built by the callers from
    `loadedItems`), and pass `itemName(localNames.get(id) ?? pseudo?.name ?? displayName, …)`.
  - **`/api/v1/rxcui/names`:** return `{ name, tty, local: { code, name } | null }`.
- [ ] **Step 6: Check every read path is covered.** Run
  `grep -rn "withPharmClassRules\b" src/routes src/lib/server | grep -v test`. Every hit must also call
  `withLocalConcepts`. Run `npm test` and `npx svelte-check`. Expected: clean.
- [ ] **Step 7: Commit.** `git commit -m "feat(local-concept): apply local concepts on read paths and formulary names"`

### Task 6: Drift review

**Files:**
- Create: `src/lib/local-concept-drift.ts`
- Modify: `src/lib/server/local-concept-store.ts` (add `checkLocalConceptDrift`), `src/lib/server/catalog-store.ts`
  (call it at the end of `persistCollection`, outside the per-concept transactions)
- Test: `src/lib/server/local-concept-drift.test.ts`

**Interfaces:**
- Consumes: `parseScdName`, `diffIngredients`, `asConceptIngredient` (Task 2).
- Produces:
  ```ts
  export type Drift = { severity: 'info' | 'warning'; reason: 'renamed' | 'inactive' | 'caught_up' } | null;
  export function classifyDrift(mapping: { supersededName: string | null }, concept: { name: string; inactive: boolean },
    local: LocalIngredient[]): Drift;
  export async function checkLocalConceptDrift(db, concepts: RxConcept[], packages: ExternalPackage[]): Promise<number>; // review items written
  ```
  `RxConcept` carries no status. A concept counts as `inactive` when any package in the same `persistCollection` call
  has `details.rxnav.rxcui` equal to it and a `conceptStatus` that isn't `ACTIVE` (compared case-insensitively). It
  also counts when that package's `details.rxnav.history` maps the rxcui to a different `activeRxcui`.

- [ ] **Step 1: Write the failing tests:**
  - Same name and active status → `null`.
  - Name changed → `{ info, renamed }`.
  - `inactive: true` → `{ warning, inactive }`. `inactive` wins over `renamed`.
  - A new name whose parsed ingredients all diff as `same` against the local rows, with no added or removed rows →
    `{ info, caught_up }`.
- [ ] **Step 2: Implement `classifyDrift`.** Then implement `checkLocalConceptDrift`:
  1. Find the active `supersedes` mappings whose RxNorm entity has one of the loaded concepts' rxcuis (call it as `checkLocalConceptDrift(db, concepts, packages)`).
  2. Classify each one.
  3. Upsert a `ReviewItem` with `kind: 'local_concept_drift'`, `mappingId`, `entityId = local id`, and
     `note = reason`. It is unique per open mapping: update the open one, else create.

  Wrap the call in `persistCollection` with `try/catch`, logging the error, so a drift failure never fails a load.
- [ ] **Step 3: Run the tests.** Run `npm test`. Expected: PASS.
- [ ] **Step 4: Commit.** `git commit -m "feat(local-concept): flag RxNorm drift on superseded concepts"`

### Task 7: NDC page — local concept block and editor

**Files:**
- Create: `src/lib/local-concept-draft.ts`, `src/lib/components/LocalConceptDialog.svelte`,
  `src/lib/components/LocalConceptBlock.svelte`
- Modify: `src/lib/components/PackageDetail.svelte`, `src/routes/formulary/ndc/[ndc]/+page.server.ts`
- Test: `src/lib/server/local-concept-draft.test.ts`, plus a fixture `src/lib/server/fixtures/trophamine-0264193310.json`
  (the snapshot's `item` trimmed to `ingredients`, `size`, `doseForm`, `details.spl`, `details.rxnav`, `details.label`
  set id and effective time)

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  `export function localConceptDraft(item: ExternalPackage): { input: LocalConceptInput; warnings: string[] }`.

- [ ] **Step 1: Make the fixture.** Export the latest cached snapshot for NDC 00264193310 into the fixture file,
  using the dev DB (one-off script in the scratchpad, not committed).
- [ ] **Step 2: Write the failing draft tests** against the fixture. Expected rows, in mg/mL:
  - `leucine 14`
  - lysine `active_moiety` from `LYSINE ACETATE`, `8.51` (± rounding to 3 significant figures)
  - cysteine `active_moiety` from `CYSTEINE HYDROCHLORIDE`, `0.166`
  - `TYROSINE 0.44`
  - `ACETYL L-TYROSINE 2.4` (`as_labeled`, the substance's own UNII `DA8G610ZO5`)
  - `taurine 0.25`
  - 20 rows in all; no sodium, sulfite or acetic acid rows

  Other expectations:
  - `evidenceSetId = 'cb6d23ff-3ec5-445a-acbe-f88fd57949bf'`, `evidenceNdc = '00264193310'`
  - `doseForm = 'Injectable Solution'` (from the RxNorm name)

  The label's electrolyte statement can't be parsed into structured ionic content reliably, so `ionicContent` stays
  `null` and `warnings` includes `'Ionic content not filled; enter it from the label'`.
- [ ] **Step 3: Implement `localConceptDraft`.**
  - **Rows:** one per SPL ingredient with `kind === 'active'`.
  - **Strength source:** prefer the matching `item.ingredients` (NDC directory) strength when it has a volume
    denominator; match by name through `ingredientGroup`. Otherwise use the SPL strength divided by the package
    volume (`item.size`).
  - **Moiety basis:** when the SPL row's `basis === 'moiety'` or it has `strengthNotes`, use `active_moiety` with
    `moieties[0]`. Use the directory value, which is already on the moiety basis; otherwise convert with
    `gsrsMoietyFactor`.
  - **Units:** normalize to mg per 1 mL and round to 3 significant figures.
  - **Directory values on a tyrosine basis** (N-acetyl-L-tyrosine at 0.1948 g/100 mL): use the SPL's own amount
    instead, per the spec's default.
- [ ] **Step 4: Run the tests.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Build `LocalConceptBlock.svelte`.** It sits in the RxNorm section of `PackageDetail.svelte` when
  `item.localConcept` is set:
  - the local name, the `LC…` code, and a "Local concept · supersedes RxCUI N" badge (adding "derived from LC… SCD"
    when `derived`)
  - the RxNorm name beneath it as "RxNorm says"
  - the `diffIngredients` table (removed struck through, changed showing both values, added marked)
  - ionic content, when set
- [ ] **Step 6: Build `LocalConceptDialog.svelte`.** It opens from "Define local concept…" (or "Edit local
  concept…" when one is set and not derived) in the RxNorm block's ⋯ menu.
  - **Ingredient rows:** substance type-ahead over `unii_substance` names, basis, moiety, strength.
  - **Other fields:** dose form, ionic content (element, mEq/L, source note), note.
  - **Live preview:** the generated name and the diff.
  - **Evidence:** read-only.
  - **Supersede checkbox:** "Supersede RxCUI {SCD rxcui} in this formulary", ticked by default. For an SBD-coded NDC,
    target the SCD counterpart.
- [ ] **Step 7: Add the actions.** In the NDC page server:
  - `localConceptSave` (create or update, then optionally `supersede`)
  - `localConceptStop` (`stopSuperseding`)

  `LocalConceptInputError` → `fail(400, { message })`.
- [ ] **Step 8: Dev-server check on NDC 0264-1933-10:**
  1. Open the dialog. The draft matches Step 2.
  2. Enter acetate 96 mEq/L and chloride < 3 mEq/L.
  3. Save.
  4. Reload. The block shows the derived SBD, the diff has 3 removed, 4 changed and 1 added, and ionic content shows.

  Then commit: `git commit -m "feat(local-concept): NDC page block and editor"`.

### Task 8: Local concepts list page and formulary badge

**Files:**
- Create: `src/routes/formulary/local-concepts/+page.server.ts`, `src/routes/formulary/local-concepts/+page.svelte`
- Modify: `src/routes/formulary/+page.svelte` (eyebrow nav: `Local concepts` after `Class rules`),
  `src/routes/formulary/items/[id]/+page.svelte` (badge)

**Interfaces:**
- Consumes: `listLocalConcepts`, `stopSuperseding`, `retireLocalConcept` (Task 4); `loadedItems().localConcept`
  (Task 5).

- [ ] **Step 1: Build the list page.** Columns: code, name, supersedes (RxCUI and the RxNorm name stored at approval),
  scope, open drift count linking to the review items, and evidence (set id and version). The row ⋯ menu has: Edit
  (links to the evidence NDC page with the dialog open, via `?localConcept=edit`), Stop superseding, Retire (with a
  confirm). The empty state explains that local concepts are created from an NDC page.
- [ ] **Step 2: Add the formulary item badge.** On the item page, show "Local concept LC… · supersedes RxCUI N" next
  to the name when `localConcept` is set.
- [ ] **Step 3: Run the checks.** Run `npx svelte-check`. Expected: clean.
- [ ] **Step 4: Commit.** `git commit -m "feat(local-concept): list page and formulary badge"`

### Task 9: End-to-end verification

- [ ] **Step 1: Run all tests.** Run `npm test`, `npm run test:db` and `npx svelte-check`. Expected: all clean.
- [ ] **Step 2: Check the formulary with the TrophAmine local SCD from Task 7.** Load RxCUI 800611 into the formulary.
  - Its item shows the local name, and reloading finds the same item.
  - Setting a `nameOverride` still wins.
- [ ] **Step 3: Check the API.** `curl -s localhost:5173/api/v1/ndc/00264193310` has `rxcui` 1189640, the original
  `details.rxnav`, and `localConcept.code`.
- [ ] **Step 4: Check that stopping restores RxNorm.** Use "Stop superseding" on the list page. The NDC page,
  formulary item and API all show RxNorm again with no cache reload. Then supersede again from the dialog.
- [ ] **Step 5: Check drift.** In a scratch DB session, set the mapping's `superseded_name` to an old value, re-run a
  concept load for 800611, and confirm an open `local_concept_drift` review item with reason `renamed`. Then reset it.
- [ ] **Step 6: Update the spec if anything changed, and commit.**
