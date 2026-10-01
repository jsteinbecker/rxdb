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
