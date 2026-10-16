# Label Relevance Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an NDC's label is shared with other dose forms or strengths, show only the label passages that apply to the viewed NDC, and say what was hidden.

**Architecture:** A new pure module `src/lib/label-relevance.ts` takes the structured `LabelBlock[]` that `labelSectionBlocks` already produces, plus a `LabelScope` describing this NDC and its label siblings (built from `parseSplIngredients`), and returns kept blocks plus `Omission` notes. `catalog-providers.ts` applies it per section when building `label.sections`; `SplLabelSections.svelte` renders a small disclaimer with a "show full label text" toggle. Filtering is conservative: a passage is dropped only when it positively names *another* form/strength of the same label and does not name this one.

**Tech Stack:** TypeScript, SvelteKit (Svelte 5 runes), `node:test` via `npm test`.

**Spec:** The user request (2026-10-15): scan imported label info per NDC; filter out info meant for other sizes or dose forms (e.g. reconstitution text for an oral suspension shown on the tablet NDC; per-vial dilution rows for other strengths); add a small disclaimer wherever something was filtered.

## Global Constraints

- Filtering never runs when the label covers only one dose-form family and one strength — nothing on such a label is "for another product".
- Ambiguous passages are always kept. Drop only on positive evidence: names a sibling form/strength **and** does not name the viewed one.
- Headings are never orphaned: if every block under a heading is dropped, the heading is dropped too; if a heading's subsection is dropped, everything under it (to the next heading of the same or higher level) goes with it.
- Table header rows are never dropped; only body rows.
- Sections with only flattened openFDA `text` (no `blocks`) are not filtered.
- Nothing is hidden irrecoverably: the full, unfiltered blocks stay available behind a toggle.
- Disclaimer copy pattern: `Hidden: {n} passage(s) for {other things}. This NDC is {this thing}.` — e.g. `Hidden: 2 passages for oral suspension. This NDC is a tablet.` / `Hidden: 3 table rows for the 500 mg and 2 g vials. This NDC is the 1 g vial.`
- Label sections are computed per request (not persisted in the catalog snapshot), so no `CATALOG_VERSION` bump is needed.

## Review Focus

1. **Combined passages** ("Tablets and oral suspension may be taken with food") — names both forms; must be kept on either NDC. Test in Task 2.
2. **Strength substrings** — "1 g" must not match "10 g" or "1 g/50 mL" premixed rows of the viewed 1 g vial; "250 mg" must not match "1250 mg". Test in Task 3.
3. **Sibling strength = this strength in another form** (250 mg tablet and 250 mg/5 mL suspension) — a "250 mg" row is not evidence of another product; form evidence decides. Test in Task 3.
4. **Kit diluent parts** (Sterile Water part listed as its own product) — a diluent part is not a sibling dose form; its form must not make the kit's reconstitution text "other-form". Test in Task 1.
5. **Bottle-size lists on oral powders** ("80 mL – add 80 mL water. 150 mL – add 150 mL water") — keep only this bottle's line, matching `catalog-facts.ts`'s `ownBottle` behavior. Test in Task 3.

---

## File Structure

- Create `src/lib/label-relevance.ts` — scope building, form-family vocabulary, block filtering. Pure, shared by server and client types.
- Create `src/lib/server/label-relevance.test.ts` — unit tests with small inline SPL/blocks.
- Modify `src/lib/server/catalog-providers.ts:1637-1641` — apply the filter per section; carry `fullBlocks` and `omissions`.
- Modify `src/lib/components/SplLabelSections.svelte` — disclaimer + toggle.

---

### Task 1: Label scope — who else shares this label

**Files:**
- Create: `src/lib/label-relevance.ts`
- Test: `src/lib/server/label-relevance.test.ts`

**Interfaces:**
- Consumes: `SplProduct` from `$lib/spl-ingredients` (`doseForm`, `packageCodes`, `ingredients`, `presentation`, `part`); `strengthText` from `$lib/spl-ingredients`; `toNdc11` (same import catalog-providers uses).
- Produces:
  - `type FormFamily = 'tablet' | 'capsule' | 'oral-suspension' | 'oral-solution' | 'injection' | 'topical' | 'ophthalmic' | 'other'`
  - `formFamilyOf(doseForm: string | null): FormFamily`
  - `interface LabelStrength { text: string; mg: number | null; containerMl: number | null }` — `text` is display copy (`"1 g vial"`, `"80 mL bottle"`).
  - `interface LabelScope { own: { family: FormFamily; formLabel: string; strengths: LabelStrength[] }; siblings: { family: FormFamily; formLabel: string; strengths: LabelStrength[] }[] }`
  - `labelScope(products: SplProduct[], ndc: string): LabelScope | null` — null when there are no siblings that differ in family or strength (filtering then never runs).

- [ ] **Step 1: Write failing tests**
  - `labelScope: tablet + powder-for-suspension label` → `own.family === 'tablet'`, one sibling with `family === 'oral-suspension'`.
  - `labelScope: three vial strengths of one injection` viewing the 1 g NDC → `own.strengths[0].mg === 1000`, sibling strengths `[500, 2000]`, all `family === 'injection'`.
  - `labelScope: single-product label` → `null`.
  - `labelScope: kit with a Sterile Water diluent part` → diluent part is not listed as a sibling (Review Focus 4); returns `null` for a one-strength kit.
  - Build SPL with the inline `part`/product template style used in `src/lib/server/kit-parts.test.ts`.
- [ ] **Step 2: Run** `npm test` — expected FAIL (module missing).
- [ ] **Step 3: Implement** `formFamilyOf` by regex on the SPL form display name (`FOR SUSPENSION`/`SUSPENSION` + oral → `oral-suspension`; `INJECTION`/`FOR SOLUTION` with no oral → `injection`; etc.), and `labelScope` by splitting `products` into own (`packageCodes` contain the NDC, as `splProductsForNdc` does) vs. siblings, skipping products whose `part` is a diluent (reuse the active/diluent role test in `$lib/kit-parts.ts`). A product with multiple packages of different sizes yields one `LabelStrength` per package for bottle-size cases (`containerMl` from `presentation`).
- [ ] **Step 4: Run** `npm test` — expected PASS.
- [ ] **Step 5: Commit** `feat(label): derive label scope of sibling forms and strengths`

### Task 2: Filter by dose form

**Files:**
- Modify: `src/lib/label-relevance.ts`
- Test: `src/lib/server/label-relevance.test.ts`

**Interfaces:**
- Consumes: `LabelBlock` from `$lib/spl-sections`; `LabelScope`, `FormFamily` from Task 1.
- Produces:
  - `interface Omission { reason: 'form' | 'strength'; count: number; unit: 'passage' | 'row'; others: string[] /* "oral suspension", "500 mg vial" */; own: string /* "a tablet", "the 1 g vial" */ }`
  - `interface FilteredBlocks { blocks: LabelBlock[]; omissions: Omission[] }`
  - `filterLabelBlocks(blocks: LabelBlock[], scope: LabelScope): FilteredBlocks`
  - `FORM_TERMS: Record<FormFamily, RegExp>` (internal, exported for tests).

- [ ] **Step 1: Write failing tests**
  - Heading `"Preparation of Oral Suspension"` + 2 paragraphs, viewing tablet → all 3 dropped; one `Omission { reason: 'form', count: 1, unit: 'passage', others: ['oral suspension'] }` (a dropped subsection counts as one passage).
  - Paragraph `"Constitute the powder with 63 mL of water; shake well."`, viewing tablet with an oral-suspension sibling → dropped (reconstitution vocabulary — `constitut`, `reconstitut`, `add .* water`, `shake well` — attributes to the powder sibling when own family is oral solid; reuse `isOralSolidForm` from `$lib/ingredient-content`).
  - Same paragraph viewing the suspension NDC → kept.
  - `"Tablets and oral suspension may be taken with or without food."` → kept on both (Review Focus 1).
  - List with items for tablets and for suspension → only the suspension item dropped; list kept.
  - Heading whose every child block is dropped → heading dropped; heading with one kept child → heading kept.
- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement** `filterLabelBlocks` form pass: group the flat block array into heading-scoped runs by `level`; test a heading's text first (drops whole run), then each paragraph/list item text (`runs.map(r => r.text).join('')`). Rule: drop when text matches `FORM_TERMS[sibling.family]` for some sibling family ≠ own and does not match `FORM_TERMS[own.family]`. Accumulate counts per (reason, others) into `omissions`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(label): hide label passages for sibling dose forms`

### Task 3: Filter by strength / container size

**Files:**
- Modify: `src/lib/label-relevance.ts`
- Test: `src/lib/server/label-relevance.test.ts`

**Interfaces:**
- Consumes: `parseMassMg`, `parseVolumeMl` from `$lib/reconstitution`; `toGrid`-style cell text from `LabelCell.runs`.
- Produces: no new exports; `filterLabelBlocks` now also emits `reason: 'strength'` omissions.

- [ ] **Step 1: Write failing tests**
  - Dilution table, header `Vial size | Diluent | Concentration`, body rows `500 mg`, `1 g`, `2 g`, viewing 1 g → body is the `1 g` row only, header kept, `Omission { reason: 'strength', count: 2, unit: 'row', others: ['500 mg vial', '2 g vial'], own: 'the 1 g vial' }`.
  - Row `"10 g pharmacy bulk package"` with own 1 g and no 10 g sibling → kept (unknown strength is not evidence; Review Focus 2).
  - `"1250 mg"` text does not match own/sibling `250 mg` (Review Focus 2).
  - Tablet 250 mg + suspension 250 mg/5 mL: row `"250 mg"` kept on both (Review Focus 3 — equal mg across families is not strength evidence).
  - List `"80 mL – add 80 mL water"`, `"150 mL – add 150 mL water"` on the 150 mL bottle NDC → only the 150 mL item kept (Review Focus 5).
  - Table where no row's first matched mass/volume equals any sibling strength → unchanged, no omission.
- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement** strength pass: for each table body row and each list item, read the first mass (or, for bottle scopes, first volume) with `parseMassMg`/`parseVolumeMl` on the leading cell/text; drop when it equals (±0.5%, like `near` in `kit-parts.ts`) a sibling strength of the **same family** and not the own strength. Only run on tables whose body has ≥2 rows with distinct parsed strengths.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat(label): hide label table rows for sibling strengths`

### Task 4: Wire into the package details and show the disclaimer

**Files:**
- Modify: `src/lib/server/catalog-providers.ts:1390` and `:1637-1641`
- Modify: `src/lib/components/SplLabelSections.svelte`

**Interfaces:**
- Consumes: `labelScope(splProducts, ndc)`, `filterLabelBlocks(blocks, scope)`, `Omission`.
- Produces: each `label.sections[i]` gains optional `fullBlocks?: LabelBlock[]` and `omissions?: Omission[]` (present only when something was hidden). `PackageDetails` type follows from the object literal.

- [ ] **Step 1: Compute** `const scope = labelScope(splProducts, ndc)` beside `sectionBlocks` (line ~1390). In the `sections` map: when `blocks && scope`, run `filterLabelBlocks`; if `omissions.length`, emit `blocks: filtered.blocks, fullBlocks: blocks, omissions`. Skip `package_label_principal_display_panel` (it is the carton art and already per-package).
- [ ] **Step 2: Render** in `SplLabelSections.svelte`: per section with `omissions`, a `<p class="omitted">` above the blocks, one line per omission in the Global Constraints copy pattern (pluralize `passage`/`row`; join `others` with commas and "and"), followed by a `<button class="link">Show full label text</button>` toggling a `showAll[section.key]` `$state` record that swaps `section.blocks` ↔ `section.fullBlocks`. Also append ` · filtered` muted text to the `<summary>` so it's visible collapsed. Style: `font-size: 0.7rem; color: #6b7686; font-style: italic`, matching the section's palette.
- [ ] **Step 3: Verify in the app** — `preview_start` the dev server, open an NDC detail for (a) an amoxicillin/cefuroxime-style label with tablets and powder for oral suspension (tablet NDC: reconstitution passages hidden with disclaimer; suspension NDC: shown), (b) a multi-vial injection (e.g. ceftriaxone 500 mg/1 g/2 g: dilution rows reduced to the viewed vial). Confirm toggle restores the full text and console is clean. Screenshot both.
- [ ] **Step 4: Commit** `feat(label): show only this NDC's label passages, with disclaimer`

### Task 5: Verify on real data

Per the project's standing rule (verify on real data, count before claiming fixed):

- [ ] **Step 1:** Write a scratchpad script that runs `labelScope` + `filterLabelBlocks` over the cached SPL XML for the formulary's NDCs and prints, per NDC: label set id, own vs. sibling families/strengths, omission counts, and the first 80 chars of each dropped block.
- [ ] **Step 2:** Count NDCs with a non-null scope, and NDCs with omissions. Read every dropped passage for at least 20 NDCs across both reasons; any drop that applies to the viewed NDC is a bug — add it as a failing test in Task 2/3's file and fix before closing.
- [ ] **Step 3:** Report the counts and any remaining false-keep patterns (passages for other products that slipped through) as follow-ups rather than widening the heuristics unreviewed.
