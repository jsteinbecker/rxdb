# Compound builder

## Goal
Rebuild MedPool's Compound builder in rxdb, on rxdb's own model: a technician names a compound, adds components from the
formulary, enters Conc / Dose / Vol per component (any one drives the others), sets a total volume, reads the final
concentrations, and saves (locks) the compound. Compounds persist in Postgres.

First version is the **core builder only**. Out of scope (separate specs later): percent (w/v) display, combo-product
"sum" dosing, house-dilution defaults, reconstitution/vial planner, ion/mEq output, Data Matrix, the BuildPlan optimizer.

## Decisions
- **Reuse the existing compounding schema** (`CompoundFormula` → `FormulaSlot` → `SlotCandidate`), plus two additive columns.
  Not a new table family, not a JSON blob. The future optimizer can consume the same formulas.
- **Components are formulary packages (NDCs)**, picked from the default scope's formulary — not RxNorm concepts. MedPool's
  "lock the concept scope and pool NDCs" has no analogue here; a component is one chosen package.
- **Server-authoritative.** SvelteKit load + form actions; no client-side persistent store, no `localStorage`.
- Row controls (remove, move) sit behind a ⋯ menu, no inline per-row subforms.

## Data
Mapping:

| Builder concept | Storage |
|---|---|
| Compound | `CompoundFormula` (`name`, `status`, `version`) |
| Component | `FormulaSlot` (`ordinal`, `role` = `active` \| `diluent`) |
| Chosen package + its labeled concentration | one `SlotCandidate` (`packageId`, `sourceConc*`) per slot |
| Dose | `FormulaSlot.targetAmount*` (existing mixed-number columns, exact) |
| Component volume | **new** `FormulaSlot.volume{Whole,Num,Den,Uom}` (same mixed-number shape as `targetAmount*`) |
| Total volume | **new** `CompoundFormula.totalVolume{Whole,Num,Den,Uom}`; null ⇒ sum of component volumes |
| Save / Edit lock | `CompoundFormula.status`: `draft` ⇄ `saved` |

One Prisma migration adds the eight nullable columns (no generated column; nothing queries them yet).

Fields the builder does not ask for get fixed defaults on create: `scopeId` = default formulary scope
(`defaultScope()`), `kind` = `sterile`, `budCategory` = `unassigned`, `defaultStorage` = `controlled_room`, `version` = 1.
`(scopeId, name, version)` is unique, so a duplicate name is rejected with a notice. Exactness: dose and volume are stored
as exact fractions; `sourceConc` is the package's decimal concentration, re-derived exactly from the package strength text
when a compound is loaded.

## Pure logic — `src/lib/compound-builder.ts`
Built on `rational.ts` / `quantity.ts`; no I/O.
- `solveLine(line, edited)`: given the field just edited (`conc` | `dose` | `volume`) and the other two, returns the
  recomputed line. dose = conc × vol; vol = dose ÷ conc; editing conc recomputes vol from dose (as MedPool does).
  Diluents are volume-only. Unit mismatches (mass vs. volume) return the line unchanged with a `problem`.
- `effectiveTotalVolume(compound)`: explicit total, else sum of component volumes.
- `finalConcentrations(compound)`: one row per active component = dose ÷ effective total volume, expressed in the
  component's dose unit per the volume unit; diluent rows show the volume added. Total ≤ 0 or mixed volume units ⇒ `—`.

## Server — `src/lib/server/compound-store.ts`
`listCompounds`, `loadCompound(id)`, `createCompound(name)`, `renameCompound`, `deleteCompound`, `addComponent(id, packageId)`,
`updateComponent(slotId, {dose, volume})`, `removeComponent`, `setTotalVolume`, `setSaved(id, saved)`. Every mutator is
refused on a `saved` compound and rejects ids outside the default scope. `addComponent` takes the package's labeled
concentration from its caller — the page load derives it per formulary row with `packageConcentration` — and creates slot + candidate in one nested write. Prisma access follows the existing
`catalog-*` store pattern (`PrismaClient` passed in, so tests can fake it).

## Routes and UI
- `/compounds` — list (name, component count, status) and a "new compound" form.
- `/compounds/[id]` — the builder: header (name, count, Saved badge, Edit/Save, ⋯ menu with Delete), component rows, total
  volume, final-concentrations table. A saved compound renders read-only values instead of fields.
- `+page.server.ts` actions mirror the store functions; failures return `fail(400, {message})` shown as a notice.
- `CompoundComponentRow.svelte`: Conc / Dose / Vol via `QuantityField` (exact fractions, `MixedFraction` display); editing one
  field calls `solveLine` and submits on blur. Remove behind the row's ⋯ menu.
- `AddComponentPanel.svelte`: filter box over the default-scope formulary rows (`formulary-view`), pick a package to add;
  diluent role is set at add time.
- Add a "Compounds" link on the formulary page header, next to its existing links (the layout has no shared nav).

## Error handling
Unparseable or non-positive numbers keep the previous value and show the field's message; unit-dimension mismatch shows a
row-level note; add/save on a saved or deleted compound returns a notice rather than a 500; saving an empty compound is
disabled (as in MedPool).

## Testing
- `compound-builder.test.ts` (pure): all three solve directions, exact-fraction results (e.g. 1500 mg ÷ 11.4 mL), diluent
  rows, default vs explicit total, unit mismatch, zero/negative inputs, mixed volume units.
- `compound-store.integration.test.ts` (opt-in via `npm run test:db`, rolled back): create/add/save/remove, saved-lock refusal,
  duplicate name, out-of-scope package and slot ids.
- Dev-server check of `/compounds` and `/compounds/[id]`: build a compound end to end, save, reload.
