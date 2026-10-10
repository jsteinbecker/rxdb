# Pharm-Class Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users assign, add or hide pharmacologic classes for an ingredient set + dose-form group (optionally route and
concentration). Every matching NDC reflects the change at read time, with no per-NDC edits.

**Architecture:**
- Pure key and resolution logic lives in `src/lib/pharm-class-key.ts` and `src/lib/pharm-class-rules.ts`.
- One new table, `pharm_class_rule`.
- A server read-side wrapper, `withPharmClassRules`, is called from the loaders that show classes.
- SvelteKit form actions handle the NDC-page dialog and the rules list page.
- Snapshots are never changed.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Prisma 7 (`prisma-client` → `src/generated`), PostgreSQL 15+,
`node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-10-pharm-class-rules-design.md`

## Global Constraints

- Never call `withPharmClassRules` from sync, staging or `reinterpret` paths. Staged `product.pharmClasses` must
  stay exactly what the source said.
- Rules belong to the **default scope** (`defaultScope()`). Never accept a rule id from outside it (404).
- Strength comparison is exact: rational strings, never floats.
- Per-row options (edit, delete) go behind a ⋯ menu, following `.row-menu` in `src/routes/formulary/+page.svelte`.
- Tests are `node:test` in `src/lib/server/*.test.ts` (the `npm test` glob) and use **relative** imports (no `$lib`).
- Code style: 2 spaces in `src/lib/*.ts`; tabs in `.svelte` and route files that already use tabs.

## Review Focus

- A package with no active UNIIs, an SPL-less package, or a snapshot loaded `withoutLabel`: the key comes from
  `details.spl.ingredients`, then `details.product.uniis`; if both are empty, no rule matches (Task 2).
- Salt vs. base: lidocaine HCl and lidocaine produce the same `moietyKey`. A combination never matches a
  single-ingredient rule (Task 2).
- Equivalent strengths written differently (`100 mg/5 mL` vs. `20 mg/mL`) produce the same `strengthKey`. An
  unparseable strength gives null, which makes the key strength-less, so only rules without a strength match
  (Task 2).
- Two rules for the same key: prevented by the `NULLS NOT DISTINCT` unique constraint; the upsert edits the existing
  rule rather than erroring (Tasks 1, 4).
- A loader that shows classes but misses the wrapper: grep `pharmClasses` in `src/routes` and `src/lib/server` after
  Task 5.

---

### Task 1: Schema and migration

**Files:** `prisma/schema.prisma`, `prisma/migrations/20261010120000_pharm_class_rule/migration.sql`

- [ ] Add the model:
  ```prisma
  model PharmClassRule {
    id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
    scopeId       String   @map("scope_id") @db.Uuid
    moietyKey     String   @map("moiety_key")
    moietyNames   String   @map("moiety_names")
    doseFormGroup String?  @map("dose_form_group")
    route         String?
    strengthKey   String?  @map("strength_key")
    mode          String   @default("replace")
    classes       String[]
    note          String?
    createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

    scope Scope @relation(fields: [scopeId], references: [id])

    @@index([scopeId, moietyKey])
    @@map("pharm_class_rule")
  }
  ```
  Add `pharmClassRules PharmClassRule[]` to `Scope`.
- [ ] Run `npx prisma migrate dev --create-only --name pharm_class_rule`. Then append to the SQL:
  ```sql
  ALTER TABLE pharm_class_rule ADD CONSTRAINT pharm_class_rule_key
    UNIQUE NULLS NOT DISTINCT (scope_id, moiety_key, dose_form_group, route, strength_key);
  ALTER TABLE pharm_class_rule ADD CONSTRAINT pharm_class_rule_mode
    CHECK (mode IN ('replace','add','suppress'));
  ```
- [ ] Run `npx prisma migrate dev` and `npx prisma generate`. Commit.

### Task 2: Package key (pure) with tests

**Files:** `src/lib/pharm-class-key.ts`, `src/lib/server/pharm-class-key.test.ts`

- [ ] Write the failing tests first:
  - `moietyKey`:
    - HCl salt (moiety UNII present) equals the base
    - two actives → sorted `A|B`
    - inactive ingredients ignored
    - no SPL → `product.uniis`
    - nothing → `''`
  - `doseFormGroup`:
    - `INJECTION, SOLUTION` → `injectable`
    - `TABLET, FILM COATED` → `oral-solid`
    - `SOLUTION` with route `OPHTHALMIC` → `ophthalmic` (the route breaks the tie for ambiguous forms)
    - unknown → `other`
  - `strengthKey`:
    - `100 mg/5 mL` equals `20 mg/mL`
    - `1 g/50 mL` equals `20 mg/mL`
    - `500 mcg` → `1/2 mg/1`
    - two actives are sorted
    - any unparseable value → `null`
- [ ] Implement:
  ```ts
  export type PackageClassKey = {
    moietyKey: string;
    moietyNames: string;
    doseFormGroup: string;
    routes: string[];
    strengthKey: string | null;
  };
  export function packageClassKey(item: Pick<ExternalPackage, 'doseForm' | 'details'>): PackageClassKey;
  export function doseFormGroup(doseForm: string | null, routes: string[]): string;
  export function strengthKey(strengths: (string | null)[]): string | null;
  ```
  Use `parseStrength` from `catalog-store.ts` for parsing (move it to a shared non-server module if the import would
  pull Prisma into `$lib`). Reduce fractions with a bigint gcd, and normalize mass to mg and volume to mL. The form
  table is an ordered list of `[RegExp, group]` pairs, in the same style as `routesFromProductText`.
- [ ] Run `npm test`. Commit.

### Task 3: Resolution (pure) with tests

**Files:** `src/lib/pharm-class-rules.ts`, `src/lib/server/pharm-class-rules.test.ts`

- [ ] Write the failing tests first:
  - no rules → source unchanged, `applied` empty
  - a moiety-only `replace` → its classes
  - moiety-only `replace` A plus form-level `replace` B → B
  - moiety-only `add` C plus form-level `replace` B → B (narrower wins)
  - form-level `replace` B plus strength-level `add` D → B + D
  - `suppress` removes a source class
  - a rule for a different form group does not match
  - a single-ingredient rule does not match a combination key
  - a rule with a strength never matches a package whose `strengthKey` is `null`
- [ ] Implement:
  ```ts
  export type PharmClassRule = {
    id: string;
    moietyKey: string;
    doseFormGroup: string | null;
    route: string | null;
    strengthKey: string | null;
    mode: 'replace' | 'add' | 'suppress';
    classes: string[];
  };
  export function ruleMatches(rule: PharmClassRule, key: PackageClassKey): boolean;
  export function specificity(rule: PharmClassRule): number; // strength 4 + route 2 + form 1
  export function resolvePharmClasses(source: string[], key: PackageClassKey, rules: PharmClassRule[]): {
    classes: string[];
    source: string[];
    applied: { ruleId: string; mode: PharmClassRule['mode']; classes: string[] }[];
  };
  ```
  Fold the matching rules in ascending specificity. Keep the output order: source order first, then added classes in
  rule order, de-duplicated.
- [ ] Run `npm test`. Commit.

### Task 4: Rule store

**Files:** `src/lib/server/pharm-class-rule-store.ts`

- [ ] Add:
  - `rulesForKeys(db, scopeId, moietyKeys)`: one `findMany` with `moietyKey: { in }`.
  - `listRules(db, scopeId)`.
  - `upsertRule(db, scopeId, input)`: find by the full key (nullable facets compared with `equals: null`), then
    update or create. Before writing:
    - trim classes, drop blanks, de-duplicate
    - reject an empty class list unless the mode is `suppress`
    - reject any class longer than 160 characters
  - `deleteRule(db, scopeId, id)`: 404 if the rule is not in the scope.
  - `countMatches(db, rule)`: use `latestCacheRecords`-style SQL with `withoutLabel` and
    `r.payload #> '{item,details,product,uniis}' @> ${JSON.stringify(uniis)}::jsonb`, limited to 2000. Then filter
    with `packageClassKey` + `ruleMatches` and return `{ count, capped }`.
  - `knownClasses(db)`: the distinct `pharmClasses` strings across latest snapshots, for the type-ahead. Cache this in
    memory for 10 minutes.
- [ ] Commit (thin Prisma wrappers; this task has no unit tests).

### Task 5: Read-side wrapper and wiring

**Files:**
- `src/lib/server/pharm-class-view.ts`
- `src/lib/server/catalog-providers.ts` (type only)
- `src/routes/formulary/ndc/[ndc]/+page.server.ts`
- `src/routes/formulary/items/[id]/+page.server.ts`
- `src/lib/server/formulary-view.ts`
- `src/routes/api/v1/formulary/items/+server.ts`

- [ ] Add an optional `pharmClassResolution?: { source: string[]; applied: …[] }` to `PackageDetails['product']`.
- [ ] Add `withPharmClassRules(db, scopeId, items)`: compute keys, run one `rulesForKeys` query, then
  `structuredClone`-free shallow copies with the resolved `pharmClasses` and `pharmClassResolution` filled in. Items
  without `details.product` pass through unchanged.
- [ ] Call it in each listed loader after the snapshots load. `item-summary` then tallies the resolved classes with no
  change of its own.
- [ ] Unit test in `pharm-class-rules.test.ts`: the wrapper leaves its input untouched and handles a mixed batch. Use a
  stubbed `rulesForKeys` by injecting the rules-loading function as a parameter.
- [ ] Grep `pharmClasses` in `src/routes` and `src/lib/server` and confirm that every display path goes through the
  wrapper. Run `npm test`. Commit.

### Task 6: NDC-page marker and "Assign class…" dialog

**Files:**
- `src/lib/components/PackageDetail.svelte`
- `src/lib/components/PharmClassRuleDialog.svelte`
- `src/routes/formulary/ndc/[ndc]/+page.server.ts`

- [ ] In the pharm-class block:
  - show a "rule" marker on classes not in `pharmClassResolution.source`
  - add a "Hidden by rule (n)" disclosure listing the source classes that were removed
  - add an "Assign class…" item to the ⋯ menu
- [ ] Loader: add `classKey` (`packageClassKey(item)`), the existing rule for each scope option, the match counts for
  each option (four `countMatches` calls, run in parallel), and `knownClasses`.
- [ ] Dialog:
  - mode radio
  - class chips with a type-ahead (`datalist`) over `knownClasses`
  - scope radio showing the counts (default: form group)
  - note
  - choosing a scope that already has a rule pre-fills that rule
- [ ] Add the actions `pharmClassRule` (upsert) and `pharmClassRuleDelete`. Validation failures return `fail(400, {
  message })` and show as a notice.
- [ ] Dev-server check on a lidocaine injectable:
  1. Add a form-level rule.
  2. Reload: the marker shows.
  3. Open a lidocaine topical NDC: unchanged.
  4. Open another lidocaine injectable NDC of a different strength: changed.

  Commit.

### Task 7: Rules list page

**Files:** `src/routes/formulary/pharm-classes/+page.server.ts`, `+page.svelte`; a nav link in
`src/routes/+layout.svelte`

- [ ] Add a table: the key in words (`Lidocaine · Injectable · 20 mg/mL`), mode, classes, match count (loaded in
  parallel with `countMatches`), and note. The row ⋯ menu has Edit (reuses `PharmClassRuleDialog`, with the scope
  fixed) and Delete.
- [ ] Add an empty state that explains rules are created from an NDC page.
- [ ] Dev-server check. Commit.

### Task 8: Verification

- [ ] Run `npm test` and `npx svelte-check`: both clean.
- [ ] Spot-check on the dev server: a combination product (e.g. lidocaine/epinephrine) is unaffected by the
  single-ingredient rule. Deleting the rule restores the source classes.
- [ ] Update the spec if any decision changed during implementation.
