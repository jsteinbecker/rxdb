# Ingredient correction wizard — design

Date: 2026-10-07

## Goal

Let a user correct an NDC's ingredient table when the label got the substance,
the basis of strength, or the moiety wrong — including a basis substance the
label never lists — identified by UNII. When the basis substance changes, the
strength is converted by the ratio of the two substances' molecular weights
(from FDA GSRS), adjusted for stoichiometry. The flow is a guided, step-by-step
dialog rather than the free-text property override.

## Scope

Edits to existing ingredient rows only (no adding/removing rows). Per row the
user may:

- replace the substance (name + UNII),
- change the basis (`ingredient` | `moiety` | `reference`),
- set or replace the basis-of-strength moiety (name + UNII), even when unlisted,
- recompute the strength by MW conversion when the measured substance changes.

## 1. Data shape and precedence

New module `src/lib/ingredient-correction.ts`:

```ts
type SubstanceRef = { name: string; unii: string };

type IngredientCorrection = {
  substance?: SubstanceRef;          // omitted when unchanged
  basis: StrengthBasis;
  moiety?: SubstanceRef;             // required when basis ≠ 'ingredient'
  strength: { value: string; unit: string; per: string; perUnit: string };
  conversion?: {
    from: { unii: string; mw: number };
    to: { unii: string; mw: number };
    n: number;                       // units of `from` per `to`, default 1
    factor: string;                  // exact decimal: MW(to) / (n · MW(from))
    original: string;                // strength before conversion
    gsrsFetchedAt: string | null;    // null when MWs were entered by hand
    mwEdited: boolean;
  };
};
```

- Stored as one property override at key
  `details.spl.ingredients.<i>.correction`; `value` is the JSON string.
  No change to the override store schema.
- `parseIngredientCorrection(value)` validates; invalid values are skipped at
  apply time.
- `overrideField` gains the key: `set` writes name, UNII, basis, moieties and
  strength onto `details.spl.ingredients[i]` and keeps `item.ingredients` in
  step (as the strength override does); `affectsVolume: true`.
- **Precedence:** a `.correction` wins over a `.strength` override on the same
  row. The `.strength` override is kept, and shown as "superseded by ingredient
  correction"; removing the correction restores it.
- Product-level by prefix, so it propagates to sibling NDCs. `unii-usage.ts`
  reads the corrected row, so corrected UNIIs appear in UNII usage.
- The generic override panel hides the key from its free-text picker and shows
  a read-only summary with **Edit** (opens the wizard) and **Remove**.

## 2. GSRS lookup and cache

- `src/lib/server/gsrs.ts` — `lookupUnii(unii)` against the public GSRS API
  (`https://gsrs.ncats.nih.gov/api/v1/substances(<UNII>)?view=full`; endpoint
  to be confirmed during implementation). Parses preferred name, formula,
  `mwt`, active moiety (moieties / `ACTIVE MOIETY` relationship) and, where the
  data shows it, the moiety count n.
- Substances without a structure (proteins, mixtures, polymers) return
  `mw: null`; the wizard asks for a manual MW and explains why.
- Prisma model `UniiSubstance` (migration): `unii` (PK), `name`, `formula`,
  `mw`, `moietyUnii`, `moietyCount`, `notFound`, `raw` (JSON), `fetchedAt`.
  Fresh for 90 days; not-found entries for 1 day.
- Route `GET /api/unii/[unii]`; validates with `normalizeUnii`. Network
  failure or 5 s timeout → `{ status: 'unavailable' }`; the wizard falls back
  to manual MWs and records `gsrsFetchedAt: null, mwEdited: true`.

## 3. Guided flow — `IngredientCorrectionDialog.svelte`

Opened by **Correct…** on each active ingredient row of the NDC page, or by
**Edit** on an existing correction. Stepped `<dialog>` like
`ReinterpretDialog`.

1. **What's wrong?** — wrong substance / strength stated as a different
   substance / basis substance not on the label. Current row shown read-only.
2. **Identify substances** — UNII inputs with live GSRS cards (name, formula,
   MW, moiety). Name mismatch with the label warns and requires confirmation.
   For a basis change: "Label's number measures [X]" → "Should measure [Y]",
   pre-filled from the row and GSRS's moiety.
3. **Convert strength** (only if the measured substance changed) — editable
   MW(from), MW(to), n with "edited" badges; worked formula shown
   (`500 mg × 513.6 / (1 × 444.4) = 577.9 mg`); "relabel only" toggle skips
   conversion; rounded result editable, exact factor kept.
4. **Cite** — the existing citation step from `PropertyOverridePanel`;
   equivalent NDCs whose row already matches the corrected substance first.
5. **Review** — before/after row table, note on sibling propagation, **Save**.

Next disabled until the step is valid; Back keeps input; closing with unsaved
input confirms. Save uses the existing property-override form action.

## 4. Arithmetic

`src/lib/strength-conversion.ts` (pure): `conversionFactor(mwFrom, mwTo, n)`
and `convertStrength(value, factor)` using exact decimal arithmetic; rejects
MW ≤ 0 and n ≤ 0. Display rounding is separate from the stored factor.

## 5. Testing

- `strength-conversion.test.ts` — factor, n > 1, rounding, relabel-only,
  invalid MW.
- `ingredient-correction.test.ts` — parse accept/reject; apply updates both
  ingredient lists; precedence over `.strength`; removal restores it.
- `gsrs.test.ts` — parser on recorded fixtures (salt, hydrate, moiety-only,
  protein without structure, 404); cache freshness and not-found caching.
  No live network.
- `property-override.test.ts` — correction propagates to siblings.
- Manual: run the wizard end to end in the browser on a real ACTIM salt NDC.

## Out of scope

Adding/removing ingredient rows; PubChem fallback; bulk correction across
products.
