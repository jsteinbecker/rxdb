# Compound Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/compounds` area where a technician builds, edits, saves (locks) and deletes named compounds from formulary packages, with linked Conc / Dose / Vol per component, a total volume and a final-concentrations table.

**Architecture:** Pure exact-fraction logic in `src/lib/compound-builder.ts`; Postgres persistence through the existing `CompoundFormula` → `FormulaSlot` → `SlotCandidate` tables plus eight additive nullable columns; SvelteKit load + form actions; the builder page keeps an editable copy of the lines, solves them client-side with the same pure functions, and saves the whole line set in one action.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Prisma 7 (`prisma-client` generator → `src/generated`, PrismaPg adapter), PostgreSQL, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-01-compound-builder-design.md`

## Global Constraints

- Core builder only. Out of scope: percent (w/v) display, combo-product "sum" dosing, house-dilution defaults, reconstitution/vial planner, ion/mEq, Data Matrix, BuildPlan optimizer.
- Persist through `CompoundFormula` / `FormulaSlot` / `SlotCandidate`; no new table family, no JSON blob, no `localStorage`.
- Components are formulary packages from the **default scope** (`defaultScope()`); never accept ids outside it.
- Defaults on create: `kind` = `sterile`, `budCategory` = `unassigned`, `defaultStorage` = `controlled_room`, `version` = 1.
- Dose and volume are stored as exact mixed numbers (`whole`/`num`/`den`); volumes are always `mL`.
- Every mutator is refused unless the compound's `status` is `draft`; `saved` is the lock. Unique `(scopeId, name, version)` ⇒ duplicate name is a notice, not a 500.
- Per-row options (remove, delete) go behind a ⋯ menu (user preference; follow `src/routes/formulary/+page.svelte` `.row-menu`).
- Tests are `node:test`, live in `src/lib/server/*.test.ts` (that is what `npm test` globs) and import with **relative** paths (no `$lib`). Source style: tabs in `.svelte`/route files that already use tabs, 2 spaces in `src/lib/*.ts`, as the neighbours do.

## Review Focus

- Zero, negative, or non-numeric Conc/Dose/Vol/Total: previous value is kept, nothing is saved as garbage (Task 2 `solveLine`, `parseLinesPayload`).
- Product of two large fractions overflows safe integers: the line is left unchanged rather than saved as a wrong number (Task 2).
- Total volume cleared, or sum of volumes is 0: final concentrations show `—`, never `Infinity`/`NaN` (Task 2).
- Duplicate compound name, or a stale tab editing a compound that was saved/deleted elsewhere: a readable notice (409/404), not a 500 (Task 3).
- Package whose strength cannot be read as a per-volume concentration (dry fill "1 g", two ingredients, percent): Conc starts blank, user types it, Vol is computed (Task 2 `packageConcentration`, Task 5).

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261002120000_compound_builder_columns/migration.sql` | Eight additive nullable columns |
| `src/lib/compound-builder.ts` (new) | Pure: types, `solveLine`, totals, final concentrations, mixed-number storage conversion, package concentration, payload/name parsing |
| `src/lib/server/compound-builder.test.ts` (new) | Unit tests for the above |
| `src/lib/server/compound-store.ts` (new) | Prisma persistence + `CompoundError` |
| `src/lib/server/compound-store.integration.test.ts` (new) | Opt-in DB test, rolled back |
| `src/routes/compounds/+page.server.ts`, `+page.svelte` (new) | List + create |
| `src/routes/compounds/[id]/+page.server.ts`, `+page.svelte` (new) | Builder load + actions + UI |
| `src/lib/components/CompoundLineRow.svelte`, `AddComponentPanel.svelte`, `FinalConcentrations.svelte` (new) | Builder pieces |
| `src/routes/formulary/+page.svelte` | "Compounds" header link |

---

### Task 1: Schema columns and migration

**Files:**
- Modify: `prisma/schema.prisma` (models `FormulaSlot` ~line 1229, `CompoundFormula` ~line 1207)
- Create: `prisma/migrations/20261002120000_compound_builder_columns/migration.sql`
- Regenerate: `src/generated/**` (tracked; produced by `prisma generate`)

**Interfaces:**
- Produces (Prisma fields): `FormulaSlot.volumeWhole|volumeNum|volumeDen: bigint | null`, `FormulaSlot.volumeUom: string | null`; `CompoundFormula.totalVolumeWhole|totalVolumeNum|totalVolumeDen: bigint | null`, `CompoundFormula.totalVolumeUom: string | null`.

- [ ] **Step 1: Add the fields to the Prisma schema**

In `model FormulaSlot`, directly after the `targetConc` generated line (before `tolerancePct`), add:

```prisma
  /// component volume, mixed number in `volumeUom` (mL)
  volumeWhole         BigInt?                          @map("volume_whole")
  volumeNum           BigInt?                          @map("volume_num")
  volumeDen           BigInt?                          @map("volume_den")
  volumeUom           String?                          @map("volume_uom")
```

In `model CompoundFormula`, after `approvedAt`, add:

```prisma
  /// explicit total volume, mixed number in `totalVolumeUom` (mL); null = sum of component volumes
  totalVolumeWhole BigInt? @map("total_volume_whole")
  totalVolumeNum   BigInt? @map("total_volume_num")
  totalVolumeDen   BigInt? @map("total_volume_den")
  totalVolumeUom   String? @map("total_volume_uom")
```

- [ ] **Step 2: Write the migration**

`prisma/migrations/20261002120000_compound_builder_columns/migration.sql`:

```sql
ALTER TABLE "formula_slot"
    ADD COLUMN "volume_whole" BIGINT,
    ADD COLUMN "volume_num" BIGINT,
    ADD COLUMN "volume_den" BIGINT,
    ADD COLUMN "volume_uom" TEXT;

ALTER TABLE "compound_formula"
    ADD COLUMN "total_volume_whole" BIGINT,
    ADD COLUMN "total_volume_num" BIGINT,
    ADD COLUMN "total_volume_den" BIGINT,
    ADD COLUMN "total_volume_uom" TEXT;
```

- [ ] **Step 3: Apply and regenerate**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: "1 migration applied" (or already applied) and "Generated Prisma Client".

- [ ] **Step 4: Verify the client sees the fields**

Run: `npx svelte-kit sync && npx tsc --noEmit -p . 2>&1 | head -5; grep -c "totalVolumeWhole" src/generated/models/CompoundFormula.ts`
Expected: grep prints a number > 0 (type-check noise unrelated to this task is acceptable; no new errors mentioning `volumeWhole`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261002120000_compound_builder_columns src/generated
git commit -m "feat(compounds): add volume and total-volume columns for the builder"
```

---

### Task 2: Pure builder logic

**Files:**
- Create: `src/lib/compound-builder.ts`
- Test: `src/lib/server/compound-builder.test.ts`

**Interfaces:**
- Consumes: `rational`, `divide`, `multiply`, `parseRational`, `toNumber`, `type Rational` from `./rational`; `parseQuantity`, `convertQuantity`, `exactDecimal` from `./quantity`.
- Produces (all exported from `src/lib/compound-builder.ts`):
  - `VOLUME_UNIT = 'mL'`, `type Role = 'active' | 'diluent'`, `type Field = 'conc' | 'dose' | 'volume'`
  - `interface Line { slotId: string; role: Role; label: string; doseUnit: string; conc: Rational | null; dose: Rational | null; volume: Rational | null }`
  - `solveLine(line: Line, edited: Field): Line`
  - `effectiveTotalVolume(lines: Line[], total: Rational | null): Rational | null`
  - `interface FinalRow { slotId: string; label: string; role: Role; amount: Rational | null; unit: string }`; `finalConcentrations(lines: Line[], total: Rational | null): FinalRow[]`
  - `interface Mixed { whole: bigint | null; num: bigint | null; den: bigint | null }`; `toMixed(r: Rational | null): Mixed`; `fromMixed(m: { whole: bigint | number | null; num: bigint | number | null; den: bigint | number | null }): Rational | null`
  - `decimalOf(r: Rational): string`
  - `packageConcentration(ingredients: { name: string; strength: string | null }[]): { conc: Rational; doseUnit: string } | null`
  - `interface LineUpdate { slotId: string; conc: Rational | null; dose: Rational | null; volume: Rational | null }`; `interface LinesPayload { lines: LineUpdate[]; total: Rational | null }`; `parseLinesPayload(text: unknown): LinesPayload | { error: string }`
  - `parseCompoundName(value: unknown): { name: string } | { error: string }`

- [ ] **Step 1: Write the failing tests**

`src/lib/server/compound-builder.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decimalOf,
  effectiveTotalVolume,
  finalConcentrations,
  fromMixed,
  packageConcentration,
  parseCompoundName,
  parseLinesPayload,
  solveLine,
  toMixed,
  type Line
} from '../compound-builder';
import { rational, type Rational } from '../rational';

const r = (n: number, d = 1): Rational => rational(n, d)!;
const line = (over: Partial<Line> = {}): Line => ({
  slotId: 's1',
  role: 'active',
  label: 'Cefepime',
  doseUnit: 'mg',
  conc: null,
  dose: null,
  volume: null,
  ...over
});

test('editing dose computes volume from concentration', () => {
  const out = solveLine(line({ conc: r(100), dose: r(1500) }), 'dose');
  assert.deepEqual(out.volume, r(15));
});

test('editing volume computes dose from concentration', () => {
  const out = solveLine(line({ conc: r(10), volume: r(3, 2) }), 'volume');
  assert.deepEqual(out.dose, r(15));
});

test('editing concentration recomputes volume from dose, exactly', () => {
  // 1500 mg at 2500/19 mg/mL is 11.4 mL = 57/5, with no rounding.
  const out = solveLine(line({ conc: r(2500, 19), dose: r(1500) }), 'conc');
  assert.deepEqual(out.volume, r(57, 5));
});

test('editing concentration with only a volume recomputes dose', () => {
  const out = solveLine(line({ conc: r(5), volume: r(10) }), 'conc');
  assert.deepEqual(out.dose, r(50));
});

test('a diluent line is never solved', () => {
  const input = line({ role: 'diluent', conc: r(5), volume: r(10) });
  assert.deepEqual(solveLine(input, 'volume'), input);
});

test('zero or negative inputs leave the line unchanged', () => {
  const zeroConc = line({ conc: r(0), dose: r(5) });
  assert.deepEqual(solveLine(zeroConc, 'dose'), zeroConc);
  const negDose = line({ conc: r(5), dose: r(-5) });
  assert.deepEqual(solveLine(negDose, 'dose'), negDose);
  const noConc = line({ dose: r(5) });
  assert.deepEqual(solveLine(noConc, 'dose'), noConc);
});

test('a product too large to be exact leaves the line unchanged', () => {
  const huge = r(Number.MAX_SAFE_INTEGER);
  const input = line({ conc: huge, volume: huge });
  assert.deepEqual(solveLine(input, 'volume'), input);
});

test('total volume: explicit wins, else the sum, else null', () => {
  const lines = [line({ volume: r(10) }), line({ slotId: 's2', volume: r(5, 2) })];
  assert.deepEqual(effectiveTotalVolume(lines, r(30)), r(30));
  assert.deepEqual(effectiveTotalVolume(lines, null), r(25, 2));
  assert.deepEqual(effectiveTotalVolume(lines, r(0)), r(25, 2));
  assert.equal(effectiveTotalVolume([line()], null), null);
});

test('final concentrations: dose over total, diluents show their volume', () => {
  const lines = [
    line({ dose: r(1500) }),
    line({ slotId: 's2', role: 'diluent', label: 'NS', volume: r(30) })
  ];
  const rows = finalConcentrations(lines, r(30));
  assert.deepEqual(rows[0].amount, r(50));
  assert.equal(rows[0].unit, 'mg/mL');
  assert.deepEqual(rows[1].amount, r(30));
  assert.equal(rows[1].unit, 'mL');
});

test('final concentrations are blank without a usable total', () => {
  const rows = finalConcentrations([line({ dose: r(1500) })], null);
  assert.equal(rows[0].amount, null);
});

test('mixed-number storage round-trips and rejects non-positive values', () => {
  const mixed = toMixed(r(2500, 19));
  assert.deepEqual(mixed, { whole: 131n, num: 11n, den: 19n });
  assert.deepEqual(fromMixed(mixed), r(2500, 19));
  assert.deepEqual(toMixed(null), { whole: null, num: null, den: null });
  assert.deepEqual(toMixed(r(-1)), { whole: null, num: null, den: null });
  assert.equal(fromMixed({ whole: null, num: null, den: null }), null);
  assert.deepEqual(fromMixed({ whole: 3n, num: null, den: null }), r(3));
});

test('decimalOf is exact when it can be', () => {
  assert.equal(decimalOf(r(9, 2)), '4.5');
  assert.ok(Number(decimalOf(r(2500, 19))) > 131.57 && Number(decimalOf(r(2500, 19))) < 131.58);
});

test('package concentration reads a single per-volume strength', () => {
  assert.deepEqual(packageConcentration([{ name: 'cefepime', strength: '100 mg/mL' }]), {
    conc: r(100),
    doseUnit: 'mg'
  });
  assert.deepEqual(packageConcentration([{ name: 'cefepime', strength: '1000 MG/10 ML' }]), {
    conc: r(100),
    doseUnit: 'mg'
  });
});

test('package concentration is null for dry fill, combos, percents and blanks', () => {
  assert.equal(packageConcentration([{ name: 'cefepime', strength: '1 g' }]), null);
  assert.equal(packageConcentration([{ name: 'a', strength: '5 mg/mL' }, { name: 'b', strength: '1 mg/mL' }]), null);
  assert.equal(packageConcentration([{ name: 'saline', strength: '0.9%' }]), null);
  assert.equal(packageConcentration([{ name: 'x', strength: null }]), null);
  assert.equal(packageConcentration([]), null);
});

test('lines payload parses fractions and blanks', () => {
  const parsed = parseLinesPayload(
    JSON.stringify({
      total: '30/1',
      lines: [{ slotId: 'a', conc: '2500/19', dose: '1500/1', volume: null }]
    })
  );
  assert.ok(!('error' in parsed));
  if ('error' in parsed) return;
  assert.deepEqual(parsed.total, r(30));
  assert.deepEqual(parsed.lines[0], { slotId: 'a', conc: r(2500, 19), dose: r(1500), volume: null });
});

test('lines payload rejects garbage, non-positive numbers and bad shapes', () => {
  for (const bad of [
    'not json',
    '{}',
    JSON.stringify({ lines: [{ slotId: 'a', dose: '-1/1' }] }),
    JSON.stringify({ lines: [{ slotId: 'a', dose: '0/1' }] }),
    JSON.stringify({ lines: [{ slotId: 'a', volume: 'abc' }] }),
    JSON.stringify({ lines: [{ dose: '1/1' }] }),
    JSON.stringify({ lines: [], total: 'x' })
  ])
    assert.ok('error' in (parseLinesPayload(bad) as object), bad);
});

test('compound names are trimmed and bounded', () => {
  assert.deepEqual(parseCompoundName('  Vanc 1 g in NS '), { name: 'Vanc 1 g in NS' });
  assert.ok('error' in (parseCompoundName('   ') as object));
  assert.ok('error' in (parseCompoundName(null) as object));
  assert.ok('error' in (parseCompoundName('x'.repeat(121)) as object));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/lib/server/compound-builder.test.ts`
Expected: FAIL — cannot find module `../compound-builder`.

- [ ] **Step 3: Implement**

`src/lib/compound-builder.ts`:

```ts
import { divide, multiply, parseRational, rational, toNumber, type Rational } from './rational';
import { convertQuantity, exactDecimal, parseQuantity } from './quantity';

/** Volumes in the builder are always millilitres; the field converts "1 L" on entry. */
export const VOLUME_UNIT = 'mL';

export type Role = 'active' | 'diluent';
export type Field = 'conc' | 'dose' | 'volume';

export interface Line {
  slotId: string;
  role: Role;
  label: string;
  /** Unit of the dose and of the numerator of the concentration ("mg"). */
  doseUnit: string;
  conc: Rational | null;
  dose: Rational | null;
  volume: Rational | null;
}

const positive = (value: Rational | null): value is Rational => !!value && value.n > 0;
const safe = (value: Rational | null): Rational | null =>
  value && Number.isSafeInteger(value.n) && Number.isSafeInteger(value.d) ? value : null;

/**
 * The line after `edited` changed: dose = conc × volume, volume = dose ÷ conc.
 * Editing the concentration recomputes the volume from the dose (the dose is
 * what the prescriber ordered), or the dose from the volume when there is none.
 * Anything that cannot be computed exactly leaves the line as it was.
 */
export function solveLine(line: Line, edited: Field): Line {
  if (line.role === 'diluent') return line;
  const { conc, dose, volume } = line;
  if (!positive(conc)) return line;

  const volumeFromDose = () => (positive(dose) ? safe(divide(dose, conc)) : null);
  const doseFromVolume = () => (positive(volume) ? safe(multiply(volume, conc)) : null);

  if (edited === 'dose') {
    const next = volumeFromDose();
    return next ? { ...line, volume: next } : line;
  }
  if (edited === 'volume') {
    const next = doseFromVolume();
    return next ? { ...line, dose: next } : line;
  }
  const nextVolume = volumeFromDose();
  if (nextVolume) return { ...line, volume: nextVolume };
  const nextDose = doseFromVolume();
  return nextDose ? { ...line, dose: nextDose } : line;
}

const add = (a: Rational, b: Rational): Rational | null =>
  safe(rational(a.n * b.d + b.n * a.d, a.d * b.d));

/** The explicit total when there is a positive one, else the sum of the volumes, else null. */
export function effectiveTotalVolume(lines: Line[], total: Rational | null): Rational | null {
  if (positive(total)) return total;
  let sum: Rational = { n: 0, d: 1 };
  for (const line of lines) if (line.volume) sum = add(sum, line.volume) ?? sum;
  return positive(sum) ? sum : null;
}

export interface FinalRow {
  slotId: string;
  label: string;
  role: Role;
  amount: Rational | null;
  unit: string;
}

/** An active component's final concentration; a diluent's volume added. */
export function finalConcentrations(lines: Line[], total: Rational | null): FinalRow[] {
  const volume = effectiveTotalVolume(lines, total);
  return lines.map((line) =>
    line.role === 'diluent'
      ? { slotId: line.slotId, label: line.label, role: line.role, amount: line.volume, unit: VOLUME_UNIT }
      : {
          slotId: line.slotId,
          label: line.label,
          role: line.role,
          amount: volume && line.dose ? safe(divide(line.dose, volume)) : null,
          unit: `${line.doseUnit}/${VOLUME_UNIT}`
        }
  );
}

// ── Storage: the mixed-number columns (whole / num / den) ───────────────────

export interface Mixed {
  whole: bigint | null;
  num: bigint | null;
  den: bigint | null;
}

const NO_VALUE: Mixed = { whole: null, num: null, den: null };

/** A positive rational as its stored columns; null (or non-positive) as all-null. */
export function toMixed(value: Rational | null): Mixed {
  if (!positive(value)) return { ...NO_VALUE };
  const whole = Math.floor(value.n / value.d);
  return { whole: BigInt(whole), num: BigInt(value.n - whole * value.d), den: BigInt(value.d) };
}

export function fromMixed(mixed: {
  whole: bigint | number | null;
  num: bigint | number | null;
  den: bigint | number | null;
}): Rational | null {
  if (mixed.whole == null && mixed.num == null) return null;
  const den = Number(mixed.den ?? 1);
  return rational(Number(mixed.whole ?? 0) * den + Number(mixed.num ?? 0), den);
}

/** The decimal text a `Decimal` column takes: exact when it terminates, else full precision. */
export const decimalOf = (value: Rational): string =>
  exactDecimal(value, 12) ?? String(toNumber(value));

// ── Reading a package's labeled concentration ───────────────────────────────

/**
 * A package's concentration per millilitre, only when it is unambiguous: one
 * ingredient whose strength is a ratio over a volume ("100 mg/mL", "1 g/10 mL").
 * Dry fills ("1 g"), combinations and percents return null — the technician
 * types the concentration they actually prepare.
 */
export function packageConcentration(
  ingredients: { name: string; strength: string | null }[]
): { conc: Rational; doseUnit: string } | null {
  if (ingredients.length !== 1) return null;
  const quantity = parseQuantity(ingredients[0].strength);
  if (!quantity || quantity.kind !== 'ratio' || !quantity.numeratorUnit) return null;
  const perMl = convertQuantity(quantity, `${quantity.numeratorUnit}/${VOLUME_UNIT}`);
  return perMl ? { conc: perMl.rational, doseUnit: quantity.numeratorUnit } : null;
}

// ── Wire formats ────────────────────────────────────────────────────────────

export interface LineUpdate {
  slotId: string;
  conc: Rational | null;
  dose: Rational | null;
  volume: Rational | null;
}
export interface LinesPayload {
  lines: LineUpdate[];
  total: Rational | null;
}

const BAD = Symbol('bad');
/** Blank is "no value"; anything present must be a positive rational. */
function amount(input: unknown): Rational | null | typeof BAD {
  if (input == null || input === '') return null;
  const parsed = parseRational(input);
  return parsed && parsed.n > 0 ? parsed : BAD;
}

/** The builder's save payload: `{ total, lines: [{ slotId, conc, dose, volume }] }`, fractions as "n/d". */
export function parseLinesPayload(text: unknown): LinesPayload | { error: string } {
  const unreadable = { error: 'Could not read the compound. Reload the page and try again.' };
  let raw: unknown;
  try {
    raw = JSON.parse(String(text));
  } catch {
    return unreadable;
  }
  if (typeof raw !== 'object' || raw === null) return unreadable;
  const { lines, total } = raw as { lines?: unknown; total?: unknown };
  if (!Array.isArray(lines)) return unreadable;

  const totalValue = amount(total);
  if (totalValue === BAD) return { error: 'Total volume must be a positive number.' };

  const out: LineUpdate[] = [];
  for (const entry of lines) {
    const item = (entry ?? {}) as Record<string, unknown>;
    if (typeof item.slotId !== 'string' || !item.slotId) return unreadable;
    const conc = amount(item.conc);
    const dose = amount(item.dose);
    const volume = amount(item.volume);
    if (conc === BAD || dose === BAD || volume === BAD)
      return { error: 'Concentration, dose and volume must be positive numbers.' };
    out.push({ slotId: item.slotId, conc, dose, volume });
  }
  return { lines: out, total: totalValue };
}

const MAX_NAME = 120;
export function parseCompoundName(value: unknown): { name: string } | { error: string } {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return { error: 'Give the compound a name.' };
  if (name.length > MAX_NAME) return { error: `Names are at most ${MAX_NAME} characters.` };
  return { name };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/lib/server/compound-builder.test.ts`
Expected: all tests PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/compound-builder.ts src/lib/server/compound-builder.test.ts
git commit -m "feat(compounds): pure builder logic with exact line solving"
```

---

### Task 3: Compound store

**Files:**
- Create: `src/lib/server/compound-store.ts`
- Test: `src/lib/server/compound-store.integration.test.ts`
- Modify: `package.json` (`test:db` script)

**Interfaces:**
- Consumes: Task 1 Prisma fields; Task 2 `Line`, `LinesPayload`, `Role`, `fromMixed`, `toMixed`, `decimalOf`, `VOLUME_UNIT`, `parseCompoundName`.
- Produces (all from `src/lib/server/compound-store.ts`):
  - `class CompoundError extends Error { status: number }`
  - `type StoredLine = Omit<Line, 'label'> & { packageId: string }`
  - `interface StoredCompound { id: string; name: string; status: string; locked: boolean; total: Rational | null; lines: StoredLine[] }`
  - `listCompounds(db, scopeId): Promise<{ id: string; name: string; status: string; components: number }[]>`
  - `loadCompound(db, scopeId, id): Promise<StoredCompound>` (throws `CompoundError` 404)
  - `createCompound(db, scopeId, name): Promise<string>` (returns id)
  - `renameCompound(db, scopeId, id, name): Promise<void>`
  - `deleteCompound(db, scopeId, id): Promise<void>`
  - `addComponent(db, scopeId, id, input: { packageId: string; role: Role; conc: Rational | null; doseUnit: string }): Promise<void>`
  - `saveLines(db, scopeId, id, payload: LinesPayload): Promise<void>`
  - `removeComponent(db, scopeId, id, slotId): Promise<void>`
  - `setSaved(db, scopeId, id, saved: boolean): Promise<void>`
  - `db` is `PrismaClient` everywhere (saveLines uses `db.$transaction`).

- [ ] **Step 1: Write the failing integration test**

`src/lib/server/compound-store.integration.test.ts` (opt-in, everything rolled back, uses an existing formulary package from the dev database and skips when there is none):

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../generated/client';
import { rational } from '../rational';
import { defaultScope } from './catalog-formulary';
import {
  addComponent,
  CompoundError,
  createCompound,
  deleteCompound,
  listCompounds,
  loadCompound,
  removeComponent,
  renameCompound,
  saveLines,
  setSaved
} from './compound-store';

const r = (n: number, d = 1) => rational(n, d)!;
const rejects = (work: Promise<unknown>, status: number) =>
  assert.rejects(work, (error) => error instanceof CompoundError && error.status === status);

/** Opt-in: every write is rolled back, even if an assertion fails. */
test(
  'PostgreSQL compound store',
  { skip: process.env.RUN_DB_TESTS !== '1', timeout: 60_000 },
  async (t) => {
    const db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5_000
      })
    });
    const rollback = new Error('ROLLBACK_COMPOUND_FIXTURES');
    try {
      await db.$transaction(
        async (tx) => {
          const nested = new Proxy(tx, {
            get(target, property) {
              if (property === '$transaction')
                return (work: (client: Prisma.TransactionClient) => unknown) => work(tx);
              return Reflect.get(target, property);
            }
          }) as unknown as PrismaClient;

          const scope = await defaultScope(nested);
          const link = await nested.formularyItemPackage.findFirst({
            where: { validTo: null, formularyItem: { scopeId: scope.id } },
            select: { packageId: true }
          });
          if (!link) return t.skip('no formulary packages in this database');

          const id = await createCompound(nested, scope.id, 'Test compound');
          await rejects(createCompound(nested, scope.id, 'Test compound'), 409);
          await renameCompound(nested, scope.id, id, 'Test compound 2');

          // a package outside the scope's formulary is refused
          await rejects(
            addComponent(nested, scope.id, id, {
              packageId: '00000000-0000-4000-8000-000000000000',
              role: 'active',
              conc: null,
              doseUnit: 'mg'
            }),
            404
          );

          await addComponent(nested, scope.id, id, {
            packageId: link.packageId,
            role: 'active',
            conc: r(100),
            doseUnit: 'mg'
          });
          await addComponent(nested, scope.id, id, {
            packageId: link.packageId,
            role: 'diluent',
            conc: null,
            doseUnit: 'mg'
          });

          let compound = await loadCompound(nested, scope.id, id);
          assert.equal(compound.lines.length, 2);
          assert.deepEqual(compound.lines[0].conc, r(100));
          assert.equal(compound.lines[1].role, 'diluent');

          const [active, diluent] = compound.lines;
          await saveLines(nested, scope.id, id, {
            total: r(30),
            lines: [
              { slotId: active.slotId, conc: r(100), dose: r(1500), volume: r(15) },
              { slotId: diluent.slotId, conc: null, dose: null, volume: r(15) }
            ]
          });
          compound = await loadCompound(nested, scope.id, id);
          assert.deepEqual(compound.total, r(30));
          assert.deepEqual(compound.lines[0].dose, r(1500));
          assert.deepEqual(compound.lines[0].volume, r(15));
          assert.deepEqual(compound.lines[1].volume, r(15));

          // exact fractions survive a round trip
          await saveLines(nested, scope.id, id, {
            total: null,
            lines: [{ slotId: active.slotId, conc: r(2500, 19), dose: r(1500), volume: r(57, 5) }]
          });
          compound = await loadCompound(nested, scope.id, id);
          assert.equal(compound.total, null);
          assert.deepEqual(compound.lines[0].conc, r(2500, 19)); // derived from dose ÷ volume

          // a slot from another compound is a 409, not a write
          await rejects(
            saveLines(nested, scope.id, id, {
              total: null,
              lines: [{ slotId: '00000000-0000-4000-8000-000000000000', conc: null, dose: null, volume: null }]
            }),
            409
          );

          // saving locks every mutator
          await setSaved(nested, scope.id, id, true);
          await rejects(renameCompound(nested, scope.id, id, 'Nope'), 409);
          await rejects(removeComponent(nested, scope.id, id, active.slotId), 409);
          await rejects(deleteCompound(nested, scope.id, id), 409);
          await rejects(
            saveLines(nested, scope.id, id, { total: null, lines: [] }),
            409
          );
          assert.equal((await loadCompound(nested, scope.id, id)).locked, true);

          await setSaved(nested, scope.id, id, false);
          await removeComponent(nested, scope.id, id, diluent.slotId);
          assert.equal((await loadCompound(nested, scope.id, id)).lines.length, 1);
          assert.ok((await listCompounds(nested, scope.id)).some((c) => c.id === id && c.components === 1));

          await deleteCompound(nested, scope.id, id);
          await rejects(loadCompound(nested, scope.id, id), 404);
          await rejects(loadCompound(nested, scope.id, 'not-a-uuid'), 404);

          // an empty compound cannot be saved
          const empty = await createCompound(nested, scope.id, 'Empty compound');
          await rejects(setSaved(nested, scope.id, empty, true), 409);

          throw rollback;
        },
        { timeout: 50_000 }
      );
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await db.$disconnect();
    }
  }
);
```

Also update `package.json` `test:db`:

```json
"test:db": "RUN_DB_TESTS=1 node --env-file=.env --import tsx --test src/lib/server/catalog-store.integration.test.ts src/lib/server/compound-store.integration.test.ts"
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db`
Expected: FAIL — cannot find module `./compound-store`.

- [ ] **Step 3: Implement**

`src/lib/server/compound-store.ts`:

```ts
import type { PrismaClient } from '../../generated/client';
import {
  decimalOf,
  fromMixed,
  parseCompoundName,
  toMixed,
  VOLUME_UNIT,
  type Line,
  type LinesPayload,
  type Role
} from '../compound-builder';
import { divide, fromNumber, type Rational } from '../rational';

/** A failure with a message fit to show the technician, and the status to send with it. */
export class CompoundError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export type StoredLine = Omit<Line, 'label'> & { packageId: string };
export interface StoredCompound {
  id: string;
  name: string;
  status: string;
  locked: boolean;
  total: Rational | null;
  lines: StoredLine[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const code = (error: unknown) => (error as { code?: string } | null)?.code;

const DEFAULTS = {
  kind: 'sterile',
  budCategory: 'unassigned',
  defaultStorage: 'controlled_room'
} as const;

async function formulaIn(db: PrismaClient, scopeId: string, id: string) {
  const formula = UUID.test(id)
    ? await db.compoundFormula.findFirst({ where: { id, scopeId }, select: { id: true, status: true } })
    : null;
  if (!formula) throw new CompoundError('That compound does not exist.', 404);
  return formula;
}

async function draftIn(db: PrismaClient, scopeId: string, id: string) {
  const formula = await formulaIn(db, scopeId, id);
  if (formula.status !== 'draft')
    throw new CompoundError('This compound is saved. Edit it to unlock it first.', 409);
  return formula;
}

const duplicate = (name: string) =>
  new CompoundError(`A compound named "${name}" already exists.`, 409);

export async function listCompounds(db: PrismaClient, scopeId: string) {
  const rows = await db.compoundFormula.findMany({
    where: { scopeId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, status: true, _count: { select: { formulaSlots: true } } }
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    components: row._count.formulaSlots
  }));
}

export async function loadCompound(
  db: PrismaClient,
  scopeId: string,
  id: string
): Promise<StoredCompound> {
  await formulaIn(db, scopeId, id);
  const formula = await db.compoundFormula.findFirstOrThrow({
    where: { id, scopeId },
    select: {
      id: true,
      name: true,
      status: true,
      totalVolumeWhole: true,
      totalVolumeNum: true,
      totalVolumeDen: true,
      formulaSlots: {
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          role: true,
          targetAmountWhole: true,
          targetAmountNum: true,
          targetAmountDen: true,
          targetAmountUom: true,
          volumeWhole: true,
          volumeNum: true,
          volumeDen: true,
          slotCandidates: { take: 1, select: { packageId: true, sourceConcMag: true } }
        }
      }
    }
  });

  const lines: StoredLine[] = formula.formulaSlots.map((slot) => {
    const dose = fromMixed({
      whole: slot.targetAmountWhole,
      num: slot.targetAmountNum,
      den: slot.targetAmountDen
    });
    const volume = fromMixed({
      whole: slot.volumeWhole,
      num: slot.volumeNum,
      den: slot.volumeDen
    });
    const candidate = slot.slotCandidates[0];
    // Dose and volume are exact, so their quotient is the exact concentration;
    // the stored decimal only stands in when one of them is not set yet.
    const stored = candidate?.sourceConcMag ? fromNumber(Number(candidate.sourceConcMag)) : null;
    const conc = slot.role === 'diluent' ? null : dose && volume ? divide(dose, volume) : stored;
    return {
      slotId: slot.id,
      packageId: candidate?.packageId ?? '',
      role: slot.role as Role,
      doseUnit: slot.targetAmountUom ?? 'mg',
      conc,
      dose,
      volume
    };
  });

  return {
    id: formula.id,
    name: formula.name,
    status: formula.status,
    locked: formula.status !== 'draft',
    total: fromMixed({
      whole: formula.totalVolumeWhole,
      num: formula.totalVolumeNum,
      den: formula.totalVolumeDen
    }),
    lines
  };
}

export async function createCompound(db: PrismaClient, scopeId: string, name: string) {
  const parsed = parseCompoundName(name);
  if ('error' in parsed) throw new CompoundError(parsed.error);
  try {
    const created = await db.compoundFormula.create({
      data: { scopeId, name: parsed.name, ...DEFAULTS },
      select: { id: true }
    });
    return created.id;
  } catch (error) {
    if (code(error) === 'P2002') throw duplicate(parsed.name);
    throw error;
  }
}

export async function renameCompound(db: PrismaClient, scopeId: string, id: string, name: string) {
  const parsed = parseCompoundName(name);
  if ('error' in parsed) throw new CompoundError(parsed.error);
  await draftIn(db, scopeId, id);
  try {
    await db.compoundFormula.update({ where: { id }, data: { name: parsed.name } });
  } catch (error) {
    if (code(error) === 'P2002') throw duplicate(parsed.name);
    throw error;
  }
}

export async function deleteCompound(db: PrismaClient, scopeId: string, id: string) {
  await draftIn(db, scopeId, id);
  try {
    await db.compoundFormula.delete({ where: { id } });
  } catch (error) {
    if (code(error) === 'P2003')
      throw new CompoundError('This compound has build plans and cannot be deleted.', 409);
    throw error;
  }
}

export async function addComponent(
  db: PrismaClient,
  scopeId: string,
  id: string,
  input: { packageId: string; role: Role; conc: Rational | null; doseUnit: string }
) {
  await draftIn(db, scopeId, id);
  const linked = UUID.test(input.packageId)
    ? await db.formularyItemPackage.findFirst({
        where: { packageId: input.packageId, validTo: null, formularyItem: { scopeId } },
        select: { packageId: true }
      })
    : null;
  if (!linked) throw new CompoundError('That package is not on this formulary.', 404);

  const last = await db.formulaSlot.aggregate({ where: { formulaId: id }, _max: { ordinal: true } });
  const conc = input.role === 'active' ? input.conc : null;
  await db.formulaSlot.create({
    data: {
      formulaId: id,
      role: input.role,
      ordinal: (last._max.ordinal ?? 0) + 1,
      targetAmountUom: input.doseUnit,
      volumeUom: VOLUME_UNIT,
      slotCandidates: {
        create: {
          packageId: input.packageId,
          sourceConcMag: conc ? decimalOf(conc) : null,
          sourceConcUom: conc ? `${input.doseUnit}/${VOLUME_UNIT}` : null
        }
      }
    }
  });
}

/** Replace every line's dose, volume and concentration, and the total, in one transaction. */
export async function saveLines(
  db: PrismaClient,
  scopeId: string,
  id: string,
  payload: LinesPayload
) {
  await draftIn(db, scopeId, id);
  await db.$transaction(async (tx) => {
    const slots = await tx.formulaSlot.findMany({
      where: { formulaId: id },
      select: {
        id: true,
        role: true,
        targetAmountUom: true,
        slotCandidates: { take: 1, select: { packageId: true } }
      }
    });
    const byId = new Map(slots.map((slot) => [slot.id, slot]));

    for (const line of payload.lines) {
      const slot = byId.get(line.slotId);
      if (!slot)
        throw new CompoundError('A component no longer exists. Reload the page and try again.', 409);
      const dose = toMixed(line.dose);
      const volume = toMixed(line.volume);
      await tx.formulaSlot.update({
        where: { id: slot.id },
        data: {
          targetAmountWhole: dose.whole,
          targetAmountNum: dose.num,
          targetAmountDen: dose.den,
          volumeWhole: volume.whole,
          volumeNum: volume.num,
          volumeDen: volume.den
        }
      });
      const candidate = slot.slotCandidates[0];
      if (candidate && slot.role === 'active')
        await tx.slotCandidate.update({
          where: { slotId_packageId: { slotId: slot.id, packageId: candidate.packageId } },
          data: {
            sourceConcMag: line.conc ? decimalOf(line.conc) : null,
            sourceConcUom: line.conc ? `${slot.targetAmountUom ?? 'mg'}/${VOLUME_UNIT}` : null
          }
        });
    }

    const total = toMixed(payload.total);
    await tx.compoundFormula.update({
      where: { id },
      data: {
        totalVolumeWhole: total.whole,
        totalVolumeNum: total.num,
        totalVolumeDen: total.den,
        totalVolumeUom: payload.total ? VOLUME_UNIT : null
      }
    });
  });
}

export async function removeComponent(db: PrismaClient, scopeId: string, id: string, slotId: string) {
  await draftIn(db, scopeId, id);
  const { count } = UUID.test(slotId)
    ? await db.formulaSlot.deleteMany({ where: { id: slotId, formulaId: id } })
    : { count: 0 };
  if (count === 0) throw new CompoundError('That component no longer exists.', 404);
}

/** Lock a draft as finished, or unlock a saved compound for editing. */
export async function setSaved(db: PrismaClient, scopeId: string, id: string, saved: boolean) {
  const formula = await formulaIn(db, scopeId, id);
  if (saved) {
    if (formula.status !== 'draft') throw new CompoundError('This compound is already saved.', 409);
    const components = await db.formulaSlot.count({ where: { formulaId: id } });
    if (!components) throw new CompoundError('Add a component before saving.', 409);
    await db.compoundFormula.update({ where: { id }, data: { status: 'saved' } });
    return;
  }
  if (formula.status !== 'saved') throw new CompoundError('This compound is not saved.', 409);
  await db.compoundFormula.update({ where: { id }, data: { status: 'draft' } });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:db`
Expected: PASS (or the compound test reports "skipped: no formulary packages in this database" — in that case load one package on `/` first and re-run; a skip is not a pass for this task). Then run `npm test` — the pure suites still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/compound-store.ts src/lib/server/compound-store.integration.test.ts package.json
git commit -m "feat(compounds): persist compounds through CompoundFormula and slots"
```

---

### Task 4: Compound list route

**Files:**
- Create: `src/routes/compounds/+page.server.ts`, `src/routes/compounds/+page.svelte`

**Interfaces:**
- Consumes: Task 3 `listCompounds`, `createCompound`, `CompoundError`; `defaultScope` from `$lib/server/catalog-formulary`; `prisma` from `$lib/server/prisma`.
- Produces: route `/compounds`; action `?/create` redirects (303) to `/compounds/<id>`. Task 5 relies on that URL shape.

- [ ] **Step 1: Write the server module**

`src/routes/compounds/+page.server.ts`:

```ts
import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import { CompoundError, createCompound, listCompounds } from '$lib/server/compound-store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	return { scope: { id: scope.id, name: scope.name }, compounds: await listCompounds(prisma, scope.id) };
};

export const actions: Actions = {
	create: async ({ request }) => {
		const name = (await request.formData()).get('name');
		const scope = await defaultScope(prisma);
		let id: string;
		try {
			id = await createCompound(prisma, scope.id, typeof name === 'string' ? name : '');
		} catch (error) {
			if (error instanceof CompoundError) return fail(error.status, { message: error.message });
			throw error;
		}
		redirect(303, `/compounds/${id}`);
	}
};
```

- [ ] **Step 2: Write the page**

`src/routes/compounds/+page.svelte`:

```svelte
<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { data, form } = $props();
	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
</script>

<svelte:head>
	<title>Compounds · RxDB</title>
</svelte:head>

<main>
	<header>
		<p class="eyebrow">
			<a href={resolve('/')}>RxDB</a> / <a href={resolve('/formulary')}>Formulary</a> / Compounds
		</p>
		<h1>Compounds</h1>
		<p class="meta">{data.scope.name}</p>
	</header>

	<form method="POST" action="?/create" class="new" use:enhance>
		<input name="name" placeholder="New compound name…" aria-label="New compound name" required />
		<button>+ Compound</button>
	</form>
	{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}

	{#if data.compounds.length}
		<ul class="list">
			{#each data.compounds as compound (compound.id)}
				<li>
					<a href={resolve('/compounds/[id]', { id: compound.id })}>{compound.name}</a>
					<span class="count">{plural(compound.components, 'component')}</span>
					{#if compound.status !== 'draft'}<span class="badge">Saved</span>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">
			No compounds yet. Name one above, then add components from
			<a href={resolve('/formulary')}>the formulary</a>.
		</p>
	{/if}
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}
	.eyebrow {
		margin: 0 0 0.5rem;
		color: #3464a5;
		font-size: 0.8rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.eyebrow a {
		color: inherit;
	}
	h1 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
		letter-spacing: -0.045em;
	}
	.meta {
		color: #5c6777;
	}
	.new {
		display: flex;
		gap: 0.5rem;
		margin: 1.5rem 0 0.5rem;
	}
	.new input {
		flex: 1;
		padding: 0.55rem 0.7rem;
		border: 1px solid #c9d1dc;
		border-radius: 8px;
		font: inherit;
	}
	.new button {
		padding: 0.55rem 0.9rem;
		border: 0;
		border-radius: 8px;
		background: #3464a5;
		color: #fff;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}
	.notice {
		color: #a3282a;
	}
	.list {
		margin: 1.25rem 0 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid #e3e7ee;
	}
	.list li {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding: 0.7rem 0;
		border-bottom: 1px solid #e3e7ee;
	}
	.list a {
		font-weight: 650;
	}
	.count {
		color: #5c6777;
		font-size: 0.85rem;
	}
	.badge {
		margin-left: auto;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #e6f2ea;
		color: #1f6b3a;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.empty {
		margin-top: 1.5rem;
		color: #5c6777;
	}
</style>
```

- [ ] **Step 3: Type-check**

Run: `npm run check 2>&1 | grep -i "compounds" | head`
Expected: no errors mentioning `src/routes/compounds`. (The `resolve('/compounds/[id]', …)` route type only exists once Task 5 adds that route; if `check` flags just that line, finish Task 5 before re-checking.)

- [ ] **Step 4: Verify in the dev server**

Start the `dev` server with `preview_start`, open `/compounds`. Create "Test A" → expect a redirect to `/compounds/<uuid>` (a 404 page until Task 5; that is the expected state). Create the same name again from `/compounds` → expect the "already exists" notice, not a 500. Check `preview_logs` for errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/compounds/+page.server.ts src/routes/compounds/+page.svelte
git commit -m "feat(compounds): compound list and create"
```

---

### Task 5: Builder page

**Files:**
- Create: `src/routes/compounds/[id]/+page.server.ts`, `src/routes/compounds/[id]/+page.svelte`
- Create: `src/lib/components/CompoundLineRow.svelte`, `src/lib/components/AddComponentPanel.svelte`, `src/lib/components/FinalConcentrations.svelte`

**Interfaces:**
- Consumes: Task 2 (`Line`, `Field`, `Role`, `solveLine`, `finalConcentrations`, `effectiveTotalVolume`, `packageConcentration`, `parseLinesPayload`, `VOLUME_UNIT`); Task 3 store functions; `formularyRows` from `$lib/server/formulary-view`; `QuantityField` (`value` text, `unit` lock, `oncommit(quantity | null)`, `variant="field"`, `showUnit`); `MixedFraction` (`value: Rational`, `unit`); `formatRational` from `$lib/rational`.
- Produces: route `/compounds/[id]`; actions `rename`, `add`, `saveLines`, `remove`, `setSaved`, `delete` (the last redirects to `/compounds`). Load returns `{ scope, compound: { id, name, status, locked, total: Rational | null, lines: (Line & { packageId: string })[] }, candidates: { packageId: string; title: string; ndc: string; conc: string | null; doseUnit: string | null }[] }` where `conc` is `"n/d"`.

- [ ] **Step 1: Write the server module**

`src/routes/compounds/[id]/+page.server.ts`:

```ts
import { error, fail, redirect } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import { formularyRows } from '$lib/server/formulary-view';
import {
	addComponent,
	CompoundError,
	deleteCompound,
	loadCompound,
	removeComponent,
	renameCompound,
	saveLines,
	setSaved
} from '$lib/server/compound-store';
import { packageConcentration, parseLinesPayload, type Role } from '$lib/compound-builder';
import { parseRational, serializeRational } from '$lib/rational';
import type { Actions, PageServerLoad } from './$types';

/** Run a store call; a CompoundError becomes a notice, anything else is a real failure. */
async function run(work: () => Promise<unknown>) {
	try {
		await work();
	} catch (cause) {
		if (cause instanceof CompoundError) return fail(cause.status, { message: cause.message });
		throw cause;
	}
}

export const load: PageServerLoad = async ({ params }) => {
	const scope = await defaultScope(prisma);
	let compound;
	try {
		compound = await loadCompound(prisma, scope.id, params.id);
	} catch (cause) {
		if (cause instanceof CompoundError) error(cause.status, cause.message);
		throw cause;
	}
	const rows = await formularyRows(prisma, scope.id);
	const byPackage = new Map(rows.map((row) => [row.packageId, row]));
	const title = (packageId: string) => {
		const row = byPackage.get(packageId);
		return row ? (row.displayTitle ?? row.description ?? row.formularyItem) : 'Package no longer on the formulary';
	};
	return {
		scope: { id: scope.id, name: scope.name },
		compound: {
			...compound,
			lines: compound.lines.map((line) => ({ ...line, label: title(line.packageId) }))
		},
		candidates: rows.map((row) => {
			const found = packageConcentration(row.ingredients);
			return {
				packageId: row.packageId,
				ndc: row.ndc,
				title: row.displayTitle ?? row.description ?? row.formularyItem,
				conc: found ? serializeRational(found.conc) : null,
				doseUnit: found?.doseUnit ?? null
			};
		})
	};
};

export const actions: Actions = {
	rename: async ({ params, request }) => {
		const name = (await request.formData()).get('name');
		const scope = await defaultScope(prisma);
		return run(() => renameCompound(prisma, scope.id, params.id, typeof name === 'string' ? name : ''));
	},
	add: async ({ params, request }) => {
		const data = await request.formData();
		let picked: { packageId?: unknown; conc?: unknown; doseUnit?: unknown } = {};
		try {
			picked = JSON.parse(String(data.get('candidate')));
		} catch {
			return fail(400, { message: 'Choose a package to add.' });
		}
		const role: Role = data.get('role') === 'diluent' ? 'diluent' : 'active';
		const conc = parseRational(picked.conc);
		const scope = await defaultScope(prisma);
		return run(() =>
			addComponent(prisma, scope.id, params.id, {
				packageId: typeof picked.packageId === 'string' ? picked.packageId : '',
				role,
				conc: conc && conc.n > 0 ? conc : null,
				doseUnit: typeof picked.doseUnit === 'string' && picked.doseUnit ? picked.doseUnit : 'mg'
			})
		);
	},
	saveLines: async ({ params, request }) => {
		const payload = parseLinesPayload((await request.formData()).get('payload'));
		if ('error' in payload) return fail(400, { message: payload.error });
		const scope = await defaultScope(prisma);
		return run(() => saveLines(prisma, scope.id, params.id, payload));
	},
	remove: async ({ params, request }) => {
		const slotId = (await request.formData()).get('slotId');
		const scope = await defaultScope(prisma);
		return run(() => removeComponent(prisma, scope.id, params.id, typeof slotId === 'string' ? slotId : ''));
	},
	setSaved: async ({ params, request }) => {
		const saved = (await request.formData()).get('saved') === 'true';
		const scope = await defaultScope(prisma);
		return run(() => setSaved(prisma, scope.id, params.id, saved));
	},
	delete: async ({ params }) => {
		const scope = await defaultScope(prisma);
		const failed = await run(() => deleteCompound(prisma, scope.id, params.id));
		if (failed) return failed;
		redirect(303, '/compounds');
	}
};
```

- [ ] **Step 2: Write `FinalConcentrations.svelte`**

`src/lib/components/FinalConcentrations.svelte`:

```svelte
<script lang="ts">
  import MixedFraction from './MixedFraction.svelte';
  import type { FinalRow } from '$lib/compound-builder';

  let { rows }: { rows: FinalRow[] } = $props();
</script>

<section class="final" aria-labelledby="final-heading">
  <h2 id="final-heading">Final concentrations</h2>
  <table>
    <tbody>
      {#each rows as row (row.slotId)}
        <tr>
          <th scope="row">{row.label}</th>
          <td>
            {#if row.amount}
              <strong><MixedFraction value={row.amount} unit={row.unit} /></strong>
            {:else}
              <span class="blank" aria-label="not enough information">—</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  h2 {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #3464a5;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    padding: 0.45rem 0;
    border-bottom: 1px solid #e3e7ee;
    text-align: left;
    font-weight: 500;
  }
  td {
    text-align: right;
  }
  .blank {
    color: #8b95a5;
  }
</style>
```

- [ ] **Step 3: Write `CompoundLineRow.svelte`**

Each of Conc / Dose / Vol is a `QuantityField` with the unit locked; the text mirrors the line value and is rewritten whenever the line value changes. `oncommit` reports the field and its parsed value up; the page solves and saves. The ⋯ menu (Remove) is driven by the page via `menuFor`, following the formulary page's `.row-menu` pattern.

`src/lib/components/CompoundLineRow.svelte`:

```svelte
<script lang="ts">
  import QuantityField from './QuantityField.svelte';
  import MixedFraction from './MixedFraction.svelte';
  import { formatRational, type Rational } from '$lib/rational';
  import { VOLUME_UNIT, type Field, type Line } from '$lib/compound-builder';

  let {
    line,
    locked = false,
    menuOpen = false,
    oncommit,
    ontoggleMenu,
    onremove
  }: {
    line: Line;
    locked?: boolean;
    menuOpen?: boolean;
    /** A field was committed; `value` is null when it was cleared. */
    oncommit: (field: Field, value: Rational | null) => void;
    ontoggleMenu: () => void;
    onremove: () => void;
  } = $props();

  const show = (value: Rational | null) => (value ? formatRational(value) : '');

  // Each box shows its line value; it follows the line whenever the line
  // changes (a solved Vol, a reload) and is the user's own text while typing.
  let concText = $state('');
  let doseText = $state('');
  let volumeText = $state('');
  $effect(() => {
    concText = show(line.conc);
  });
  $effect(() => {
    doseText = show(line.dose);
  });
  $effect(() => {
    volumeText = show(line.volume);
  });

  const concUnit = $derived(`${line.doseUnit}/${VOLUME_UNIT}`);
  const isDiluent = $derived(line.role === 'diluent');
</script>

<div class="line" class:diluent={isDiluent}>
  <div class="identity">
    <span class="label">{line.label}</span>
    {#if isDiluent}<span class="tag">Diluent</span>{/if}
  </div>

  <div class="fields">
    {#if !isDiluent}
      <div class="field">
        <span class="caption">Conc</span>
        {#if locked}
          {#if line.conc}<MixedFraction value={line.conc} unit={concUnit} />{:else}—{/if}
        {:else}
          <QuantityField
            bind:value={concText}
            unit={concUnit}
            variant="field"
            showUnit={false}
            exclusiveMin
            min={0}
            ariaLabel="Concentration, {line.label}"
            placeholder="—"
            oncommit={(quantity) => oncommit('conc', quantity?.rational ?? null)}
          />
          <span class="unit">{concUnit}</span>
        {/if}
      </div>
      <div class="field">
        <span class="caption">Dose</span>
        {#if locked}
          {#if line.dose}<MixedFraction value={line.dose} unit={line.doseUnit} />{:else}—{/if}
        {:else}
          <QuantityField
            bind:value={doseText}
            unit={line.doseUnit}
            variant="field"
            showUnit={false}
            exclusiveMin
            min={0}
            ariaLabel="Dose, {line.label}"
            placeholder="—"
            oncommit={(quantity) => oncommit('dose', quantity?.rational ?? null)}
          />
          <span class="unit">{line.doseUnit}</span>
        {/if}
      </div>
    {/if}
    <div class="field">
      <span class="caption">Vol</span>
      {#if locked}
        {#if line.volume}<MixedFraction value={line.volume} unit={VOLUME_UNIT} />{:else}—{/if}
      {:else}
        <QuantityField
          bind:value={volumeText}
          unit={VOLUME_UNIT}
          variant="field"
          showUnit={false}
          exclusiveMin
          min={0}
          ariaLabel="Volume, {line.label}"
          placeholder="—"
          oncommit={(quantity) => oncommit('volume', quantity?.rational ?? null)}
        />
        <span class="unit">{VOLUME_UNIT}</span>
      {/if}
    </div>
  </div>

  {#if !locked}
    <div class="row-menu" class:open={menuOpen}>
      <button
        type="button"
        class="menu-trigger"
        aria-label="Options for {line.label}"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onclick={ontoggleMenu}>⋯</button
      >
      {#if menuOpen}
        <div class="menu" role="menu">
          <button type="button" role="menuitem" onclick={onremove}>Remove component</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .line {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid #e3e7ee;
  }
  .identity {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  .tag {
    margin-left: 0.5rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: #eef2f8;
    color: #3464a5;
    font-size: 0.7rem;
    font-weight: 700;
  }
  .fields {
    display: flex;
    gap: 0;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 8.5rem;
    padding: 0 0.7rem;
    border-left: 1px solid #e3e7ee;
  }
  .field:first-child {
    border-left: 0;
  }
  .caption {
    color: #5c6777;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .field :global(.entry) {
    min-width: 4.5rem;
    height: 2rem;
  }
  .field :global(input) {
    text-align: right;
    border: 1px solid transparent;
    border-radius: 6px;
    background: #f6f8fb;
    padding: 0 0.4rem;
  }
  .field :global(input:focus) {
    border-color: #3464a5;
    background: #fff;
  }
  .unit {
    color: #5c6777;
    font-size: 0.8rem;
  }
  .row-menu {
    position: relative;
  }
  .menu-trigger {
    border: 0;
    background: transparent;
    font-size: 1.2rem;
    line-height: 1;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    cursor: pointer;
  }
  .menu-trigger:hover,
  .open .menu-trigger {
    background: #eef2f8;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 5;
    min-width: 11rem;
    padding: 0.25rem;
    border: 1px solid #c9d1dc;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: 0;
    background: transparent;
    text-align: left;
    font: inherit;
    color: #a3282a;
    cursor: pointer;
    border-radius: 6px;
  }
  .menu button:hover {
    background: #fbeeee;
  }
</style>
```

- [ ] **Step 4: Write `AddComponentPanel.svelte`**

One form for the whole result list; each result is a submit button carrying its package as a JSON `candidate` value, so there are no per-row inputs. The Active/Diluent choice is a single toggle above the list.

`src/lib/components/AddComponentPanel.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  type Candidate = {
    packageId: string;
    ndc: string;
    title: string;
    conc: string | null;
    doseUnit: string | null;
  };

  let { candidates }: { candidates: Candidate[] } = $props();

  let query = $state('');
  let role = $state<'active' | 'diluent'>('active');

  const LIMIT = 30;
  const matches = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return candidates
      .filter((candidate) => {
        const haystack = `${candidate.title} ${candidate.ndc}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .slice(0, LIMIT);
  });
  const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
</script>

<div class="panel">
  <div class="find">
    <input
      bind:value={query}
      type="search"
      placeholder="Drug name or NDC…"
      aria-label="Search the formulary"
      autocomplete="off"
      spellcheck="false"
    />
    <fieldset class="role">
      <legend class="sr">Add as</legend>
      <label><input type="radio" bind:group={role} value="active" /> Active</label>
      <label><input type="radio" bind:group={role} value="diluent" /> Diluent</label>
    </fieldset>
  </div>

  {#if !query.trim()}
    <p class="hint">Search the formulary, then pick the exact package to add.</p>
  {:else if !matches.length}
    <p class="hint">No formulary packages match. Load them from the search page first.</p>
  {:else}
    <form method="POST" action="?/add" use:enhance>
      <input type="hidden" name="role" value={role} />
      <ul>
        {#each matches as candidate (candidate.packageId)}
          <li>
            <button
              name="candidate"
              value={JSON.stringify({
                packageId: candidate.packageId,
                conc: candidate.conc,
                doseUnit: candidate.doseUnit
              })}
            >
              <span class="title">{candidate.title}</span>
              <span class="ndc">{formatNdc(candidate.ndc)}</span>
              <span class="plus" aria-hidden="true">⊕</span>
            </button>
          </li>
        {/each}
      </ul>
    </form>
  {/if}
</div>

<style>
  .panel {
    margin: 0.75rem 0;
    padding: 0.75rem;
    border: 1px solid #d5dcea;
    border-radius: 10px;
    background: #f8faff;
  }
  .find {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  .find > input {
    flex: 1;
    padding: 0.5rem 0.7rem;
    border: 1px solid #c9d1dc;
    border-radius: 8px;
    font: inherit;
  }
  .role {
    display: flex;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    border: 0;
    font-size: 0.85rem;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .hint {
    margin: 0.6rem 0 0;
    color: #5c6777;
    font-size: 0.9rem;
  }
  ul {
    margin: 0.6rem 0 0;
    padding: 0;
    list-style: none;
    max-height: 18rem;
    overflow: auto;
  }
  li button {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    width: 100%;
    padding: 0.45rem 0.5rem;
    border: 0;
    border-bottom: 1px solid #e3e7ee;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  li button:hover {
    background: #eef2f8;
  }
  .title {
    flex: 1;
  }
  .ndc {
    color: #5c6777;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .plus {
    color: #3464a5;
  }
</style>
```

- [ ] **Step 5: Write the builder page**

The page holds `lines` and `total` as writable derived state (reset whenever the server data changes), solves a committed field with `solveLine`, and saves the whole set through the `saveLines` form. The hidden `payload` is written just before `requestSubmit()`.

`src/routes/compounds/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import AddComponentPanel from '$lib/components/AddComponentPanel.svelte';
  import CompoundLineRow from '$lib/components/CompoundLineRow.svelte';
  import FinalConcentrations from '$lib/components/FinalConcentrations.svelte';
  import QuantityField from '$lib/components/QuantityField.svelte';
  import {
    effectiveTotalVolume,
    finalConcentrations,
    solveLine,
    VOLUME_UNIT,
    type Field,
    type Line
  } from '$lib/compound-builder';
  import { formatRational, serializeRational, type Rational } from '$lib/rational';

  let { data, form } = $props();

  const compound = $derived(data.compound);
  const locked = $derived(compound.locked);

  // Editable copies; they restart from the server's whenever it sends new data.
  let lines = $derived<Line[]>(compound.lines);
  let total = $derived<Rational | null>(compound.total);
  let totalText = $derived(compound.total ? formatRational(compound.total) : '');

  let pickerOpen = $state(false);
  let menuFor = $state<string | null>(null); // 'header' or a slotId
  let saveForm: HTMLFormElement | undefined = $state();
  let payloadInput: HTMLInputElement | undefined = $state();
  let removeForm: HTMLFormElement | undefined = $state();
  let removeSlot: HTMLInputElement | undefined = $state();

  const sum = $derived(effectiveTotalVolume(lines, null));
  const rows = $derived(finalConcentrations(lines, total));
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  function save() {
    if (!saveForm || !payloadInput) return;
    const text = (value: Rational | null) => (value ? serializeRational(value) : null);
    payloadInput.value = JSON.stringify({
      total: text(total),
      lines: lines.map((line) => ({
        slotId: line.slotId,
        conc: text(line.conc),
        dose: text(line.dose),
        volume: text(line.volume)
      }))
    });
    saveForm.requestSubmit();
  }

  function commit(slotId: string, field: Field, value: Rational | null) {
    const at = lines.findIndex((line) => line.slotId === slotId);
    if (at < 0 || locked) return;
    const next = { ...lines[at], [field]: value };
    lines = lines.map((line, index) => (index === at ? solveLine(next, field) : line));
    save();
  }

  function commitTotal(value: Rational | null) {
    if (locked) return;
    total = value;
    save();
  }

  function remove(slotId: string) {
    menuFor = null;
    if (!removeForm || !removeSlot) return;
    removeSlot.value = slotId;
    removeForm.requestSubmit();
  }
</script>

<svelte:head>
  <title>{compound.name} · Compounds · RxDB</title>
</svelte:head>

<svelte:window
  onclick={(event) => {
    if (menuFor && !(event.target as Element).closest('.row-menu')) menuFor = null;
  }}
  onkeydown={(event) => event.key === 'Escape' && (menuFor = null)}
/>

<main>
  <header>
    <p class="eyebrow">
      <a href={resolve('/')}>RxDB</a> / <a href={resolve('/compounds')}>Compounds</a> /
      {data.scope.name}
    </p>
    <div class="titlebar">
      {#if locked}
        <h1>{compound.name}</h1>
      {:else}
        <form method="POST" action="?/rename" use:enhance={() => async ({ update }) => update({ reset: false })}>
          <input class="name" name="name" value={compound.name} aria-label="Compound name" />
        </form>
      {/if}
      <span class="count">{plural(compound.lines.length, 'component')}</span>
      {#if locked}<span class="badge">Saved</span>{/if}

      <div class="actions">
        {#if locked}
          <form method="POST" action="?/setSaved" use:enhance>
            <input type="hidden" name="saved" value="false" />
            <button>Edit</button>
          </form>
        {:else}
          <button type="button" onclick={() => (pickerOpen = !pickerOpen)}>
            {pickerOpen ? '× Close' : '+ Component'}
          </button>
          <form method="POST" action="?/setSaved" use:enhance>
            <input type="hidden" name="saved" value="true" />
            <button class="primary" disabled={!compound.lines.length}>Save</button>
          </form>
          <div class="row-menu" class:open={menuFor === 'header'}>
            <button
              type="button"
              class="menu-trigger"
              aria-label="Compound options"
              aria-haspopup="menu"
              aria-expanded={menuFor === 'header'}
              onclick={() => (menuFor = menuFor === 'header' ? null : 'header')}>⋯</button
            >
            {#if menuFor === 'header'}
              <div class="menu" role="menu">
                <form
                  method="POST"
                  action="?/delete"
                  use:enhance={({ cancel }) => {
                    if (!confirm(`Delete "${compound.name}" and its components?`)) cancel();
                  }}
                >
                  <button role="menuitem">Delete compound</button>
                </form>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    {#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
  </header>

  {#if pickerOpen && !locked}
    <AddComponentPanel candidates={data.candidates} />
  {/if}

  <!-- Hidden helpers: one form saves every line, one removes a component. -->
  <form
    bind:this={saveForm}
    method="POST"
    action="?/saveLines"
    use:enhance={() => async ({ update }) => update({ reset: false })}
    hidden
  >
    <input bind:this={payloadInput} type="hidden" name="payload" />
  </form>
  <form bind:this={removeForm} method="POST" action="?/remove" use:enhance hidden>
    <input bind:this={removeSlot} type="hidden" name="slotId" />
  </form>

  {#if !compound.lines.length}
    <p class="empty">
      No components yet — use <b>+ Component</b> to search the formulary and add the exact package.
    </p>
  {:else}
    <section aria-label="Components">
      {#each lines as line (line.slotId)}
        <CompoundLineRow
          {line}
          {locked}
          menuOpen={menuFor === line.slotId}
          oncommit={(field, value) => commit(line.slotId, field, value)}
          ontoggleMenu={() => (menuFor = menuFor === line.slotId ? null : line.slotId)}
          onremove={() => remove(line.slotId)}
        />
      {/each}
    </section>

    <div class="totals">
      <span class="caption">Total volume</span>
      {#if locked}
        <strong>{total ? formatRational(total) : sum ? formatRational(sum) : '—'} {VOLUME_UNIT}</strong>
      {:else}
        <QuantityField
          bind:value={totalText}
          unit={VOLUME_UNIT}
          variant="field"
          showUnit={false}
          exclusiveMin
          min={0}
          ariaLabel="Total volume"
          placeholder={sum ? formatRational(sum) : '0'}
          oncommit={(quantity) => commitTotal(quantity?.rational ?? null)}
        />
        <span class="unit">{VOLUME_UNIT}</span>
      {/if}
    </div>

    <FinalConcentrations {rows} />
  {/if}
</main>

<style>
  main {
    max-width: 880px;
    margin: 0 auto;
    padding: 3rem 1.5rem 5rem;
  }
  .eyebrow {
    margin: 0 0 0.5rem;
    color: #3464a5;
    font-size: 0.8rem;
    font-weight: 750;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .eyebrow a {
    color: inherit;
  }
  .titlebar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  h1,
  .name {
    margin: 0;
    font-size: clamp(1.6rem, 4vw, 2.2rem);
    font-weight: 750;
    letter-spacing: -0.03em;
  }
  .name {
    min-width: 16rem;
    padding: 0.1rem 0.3rem;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    font-family: inherit;
  }
  .name:hover,
  .name:focus {
    border-color: #c9d1dc;
    background: #fff;
  }
  .count {
    color: #5c6777;
    font-size: 0.9rem;
  }
  .badge {
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    background: #e6f2ea;
    color: #1f6b3a;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-left: auto;
  }
  .actions button:not(.menu-trigger) {
    padding: 0.45rem 0.85rem;
    border: 1px solid #c9d1dc;
    border-radius: 8px;
    background: #fff;
    font: inherit;
    cursor: pointer;
  }
  .actions button.primary {
    border-color: #3464a5;
    background: #3464a5;
    color: #fff;
    font-weight: 650;
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .notice {
    color: #a3282a;
  }
  .empty {
    margin: 2rem 0;
    color: #5c6777;
  }
  .totals {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.9rem 0;
    border-bottom: 1px solid #e3e7ee;
  }
  .totals :global(.entry) {
    min-width: 5rem;
    height: 2rem;
  }
  .totals :global(input) {
    text-align: right;
    border: 1px solid #c9d1dc;
    border-radius: 6px;
    padding: 0 0.4rem;
  }
  .caption {
    color: #5c6777;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .unit {
    color: #5c6777;
    font-size: 0.8rem;
  }
  .row-menu {
    position: relative;
  }
  .menu-trigger {
    border: 0;
    background: transparent;
    font-size: 1.3rem;
    line-height: 1;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    cursor: pointer;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 5;
    min-width: 11rem;
    padding: 0.25rem;
    border: 1px solid #c9d1dc;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: 0;
    background: transparent;
    text-align: left;
    font: inherit;
    color: #a3282a;
    cursor: pointer;
    border-radius: 6px;
  }
  .menu button:hover {
    background: #fbeeee;
  }
</style>
```

- [ ] **Step 6: Type-check**

Run: `npm run check 2>&1 | grep -iE "compounds|CompoundLineRow|AddComponentPanel|FinalConcentrations|compound-builder" | head -20`
Expected: no errors. Fix any (e.g. a missing `exclusiveMin`/`min` type, or a Svelte `bind:value` on `$derived` text — if Svelte rejects `bind:value={totalText}` on a derived, change `let totalText = $derived(...)` to `let totalText = $state(...)` plus `$effect(() => { totalText = compound.total ? formatRational(compound.total) : ''; })`).

- [ ] **Step 7: Verify end to end in the dev server**

`preview_start` the dev server, make sure at least one package is loaded in the formulary, then in `/compounds`:
1. Create "Build check" → builder opens, empty state shown, Save disabled.
2. **+ Component**, search a drug with a per-mL strength (e.g. an injectable solution), add it as Active → row shows Conc prefilled. Type Dose `1500` → Vol appears (dose ÷ conc), final concentration row fills in.
3. Add a diluent (toggle **Diluent**) → row has only Vol. Type Vol `15` → Final table shows its volume; set Total volume `30` → active row shows dose ÷ 30.
4. Add a dry-fill package (strength like "1 g") → Conc blank. Type Conc `100 mg/mL`, Dose `1 g` → Dose shows 1000 mg and Vol 10 mL.
5. Type `abc` / `0` / `-1` in a field → previous value kept, no save, no 500 (`read_console_messages`, `preview_logs`).
6. Reload the page → values persist exactly (try Conc `2500/19`, Dose `1500` → Vol `11.4`).
7. ⋯ on a row → Remove component; ⋯ in the header → Delete compound (confirm) → back on `/compounds`.
8. Save → fields become read-only values and an Edit button; reload stays locked; Edit unlocks.
9. In a second tab, delete the compound, then edit a field in the first → a notice, not a 500.
Take a screenshot of the builder with two components as proof.

- [ ] **Step 8: Commit**

```bash
git add src/routes/compounds src/lib/components/CompoundLineRow.svelte src/lib/components/AddComponentPanel.svelte src/lib/components/FinalConcentrations.svelte
git commit -m "feat(compounds): compound builder page"
```

---

### Task 6: Entry point and spec sync

**Files:**
- Modify: `src/routes/formulary/+page.svelte` (header link, ~line 386)
- Modify: `docs/superpowers/specs/2026-10-01-compound-builder-design.md`

**Interfaces:**
- Consumes: routes from Tasks 4–5.
- Produces: a discoverable link, and a spec that matches what was built.

- [ ] **Step 1: Add the header link**

In `src/routes/formulary/+page.svelte`, in the `<p class="eyebrow">` block, after the `Manage loaded items →` link and its `·` add:

```svelte
			<a href={resolve('/compounds')}>Compounds</a> ·
```

so the line reads `… Manage loaded items →</a> · <a href={resolve('/compounds')}>Compounds</a> · <a href={resolve('/settings')}>Settings</a>`.

- [ ] **Step 2: Bring the spec in line with the implementation**

In the spec, make these two edits:
- Under **Server — `compound-store.ts`**, replace "`addComponent` reads the package's labeled concentration from the formulary view row and creates slot + candidate in one transaction." with "`addComponent` takes the package's labeled concentration from its caller — the page load derives it per formulary row with `packageConcentration` — and creates slot + candidate in one nested write."
- Under **Testing**, replace "`compound-store.test.ts` with a fake Prisma: …" with "`compound-store.integration.test.ts` (opt-in via `npm run test:db`, rolled back): create/add/save/remove, saved-lock refusal, duplicate name, out-of-scope package and slot ids."

- [ ] **Step 3: Full verification**

Run: `npm test && npm run check 2>&1 | tail -5 && npm run test:db`
Expected: unit tests pass; `check` reports no errors in files this plan touched; the DB test passes. Then `preview_start` the dev server and confirm the `Compounds` link on `/formulary` opens `/compounds`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/formulary/+page.svelte docs/superpowers/specs/2026-10-01-compound-builder-design.md
git commit -m "feat(compounds): link the builder from the formulary and sync the spec"
```
