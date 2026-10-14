import type { StrengthBasis } from './spl-ingredients';

/** A substance named by name and FDA UNII. */
export type SubstanceRef = { name: string; unii: string };

/** How a strength was moved from one measured substance to another. */
export type StrengthConversion = {
	from: { unii: string; mw: number };
	to: { unii: string; mw: number };
	/** Units of `from` per `to`; 1 unless the stoichiometry says otherwise. */
	n: number;
	/** Exact decimal `MW(to) / (n · MW(from))`. */
	factor: string;
	/** The strength before conversion, as the label stated it. */
	original: string;
	/** When GSRS answered; null when the molecular weights were entered by hand. */
	gsrsFetchedAt: string | null;
	mwEdited: boolean;
};

/** One ingredient row as the user says it should read. */
export type IngredientCorrection = {
  /** Omitted when the substance is unchanged. */
  substance?: SubstanceRef;
  basis: StrengthBasis;
  /** Required when `basis` is not `ingredient`. */
  moiety?: SubstanceRef;
  strength: { value: string; unit: string; per: string; perUnit: string };
  conversion?: StrengthConversion;
};

/** `details.spl.ingredients.<index>.correction`. */
export const INGREDIENT_CORRECTION_KEY = /^details\.spl\.ingredients\.(\d+)\.correction$/;
export const ingredientCorrectionKey = (index: number) =>
  `details.spl.ingredients.${index}.correction`;
export const ingredientStrengthKey = (index: number) =>
  `details.spl.ingredients.${index}.strength`;

const BASES: readonly StrengthBasis[] = ['ingredient', 'moiety', 'reference'];
const UNII = /^[A-Z0-9]{10}$/;
const DECIMAL = /^\d+(?:\.\d+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown, max = 300): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= max;

function readSubstance(value: unknown): SubstanceRef | null {
  if (!isRecord(value) || !isText(value.name) || typeof value.unii !== 'string') return null;
  const unii = value.unii.trim().toUpperCase();
  return UNII.test(unii) ? { name: value.name.trim(), unii } : null;
}

function readSide(value: unknown): { unii: string; mw: number } | null {
  if (!isRecord(value) || typeof value.unii !== 'string' || !UNII.test(value.unii)) return null;
  const mw = value.mw;
  return typeof mw === 'number' && Number.isFinite(mw) && mw > 0 ? { unii: value.unii, mw } : null;
}

function readConversion(value: unknown): StrengthConversion | null {
  if (!isRecord(value)) return null;
  const from = readSide(value.from);
  const to = readSide(value.to);
  const { n, factor, original, gsrsFetchedAt, mwEdited } = value;
  if (!from || !to) return null;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  if (typeof factor !== 'string' || !DECIMAL.test(factor) || Number(factor) <= 0) return null;
  if (typeof original !== 'string') return null;
  if (gsrsFetchedAt !== null && typeof gsrsFetchedAt !== 'string') return null;
  if (typeof mwEdited !== 'boolean') return null;
  return { from, to, n, factor, original, gsrsFetchedAt, mwEdited };
}

/** The correction a stored override value holds, or null when it is malformed. */
export function parseIngredientCorrection(value: string): IngredientCorrection | null {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const basis = raw.basis as StrengthBasis;
  if (!BASES.includes(basis)) return null;

  const substance = raw.substance === undefined ? undefined : readSubstance(raw.substance);
  if (substance === null) return null;
  const moiety = raw.moiety === undefined ? undefined : readSubstance(raw.moiety);
  if (moiety === null) return null;
  if (basis !== 'ingredient' && !moiety) return null;

  const strength = raw.strength;
  if (
    !isRecord(strength) ||
    typeof strength.value !== 'string' ||
    !DECIMAL.test(strength.value) ||
    !(Number(strength.value) > 0) ||
    !isText(strength.unit, 50) ||
    typeof strength.per !== 'string' ||
    !DECIMAL.test(strength.per) ||
    !(Number(strength.per) > 0) ||
    typeof strength.perUnit !== 'string' ||
    strength.perUnit.length > 50
  )
    return null;

  const conversion = raw.conversion === undefined ? undefined : readConversion(raw.conversion);
  if (conversion === null) return null;

  return {
    ...(substance && { substance }),
    basis,
    ...(moiety && { moiety }),
    strength: {
      value: strength.value,
      unit: strength.unit.trim(),
      per: strength.per,
      perUnit: strength.perUnit.trim()
    },
    ...(conversion && { conversion })
  };
}

export const serializeIngredientCorrection = (correction: IngredientCorrection): string =>
  JSON.stringify(correction);

/** A strength as a label reads it: `500 mg`, or `25 mg/1 g` per a measured amount. */
export function formatStrength(strength: IngredientCorrection['strength']): string {
  const head = `${strength.value} ${strength.unit}`;
  return strength.per === '1' && !strength.perUnit
    ? head
    : `${head}/${strength.per}${strength.perUnit ? ` ${strength.perUnit}` : ''}`;
}

/** The row as the correction states it, for the read-only summary. */
export function describeCorrection(correction: IngredientCorrection, fallbackName: string): string {
  const name = correction.substance?.name ?? fallbackName;
  const basis =
    correction.basis === 'ingredient'
      ? ''
      : ` (as ${correction.moiety?.name ?? 'moiety'}${correction.basis === 'reference' ? ', reference' : ''})`;
  return `${name} · ${formatStrength(correction.strength)}${basis}`;
}

type CorrectableIngredient = {
  name: string;
  unii: string | null;
  basis: string | null;
  strength: string | null;
  moieties: { name: string; unii: string | null }[];
};

/**
 * Writes a correction onto an ingredient row, and onto the catalog's own
 * ingredient list entry for it, which drives the volume rules.
 */
export function applyIngredientCorrection(
  target: CorrectableIngredient,
  listed: { name: string; strength: string | null }[],
  correction: IngredientCorrection
): void {
  const previous = target.name.toLowerCase();
  const strength = formatStrength(correction.strength);
  if (correction.substance) {
    target.name = correction.substance.name;
    target.unii = correction.substance.unii;
    // The old substance's moieties do not describe the new one.
    target.moieties = [];
  }
  target.basis = correction.basis;
  if (correction.moiety) target.moieties = [{ ...correction.moiety }];
  target.strength = strength;
  for (const entry of listed)
    if (entry.name.toLowerCase() === previous) {
      entry.name = correction.substance?.name ?? entry.name;
      entry.strength = listedStrength(entry.strength, correction) ?? strength;
    }
}

/**
 * The catalog's own strength under the correction when it states a
 * denominator the label row lacks (`.24 g/100mL` beside the label's `1.2 g`):
 * scaled by the conversion and kept per its own volume, so the row still sums
 * with its siblings. Null when the corrected label strength should stand.
 */
function listedStrength(text: string | null, correction: IngredientCorrection): string | null {
  const { strength } = correction;
  if (strength.per !== '1' || strength.perUnit) return null;
  const match = /^(\d*\.?\d+)\s*([^\d/\s]+)\s*\/\s*(.+)$/.exec((text ?? '').trim());
  if (!match) return null;
  const factor = correction.conversion ? Number(correction.conversion.factor) : 1;
  const value = Number(match[1]) * factor;
  if (!(value > 0)) return null;
  return `${Number(value.toPrecision(6))} ${match[2]}/${match[3].trim()}`;
}

/** Reads a strength string like `500 mg`, `25 mg/1 g` or `25 mg/mL`; null when it is not one. */
export function parseStrengthText(text: string | null): IngredientCorrection['strength'] | null {
  const match = /^(\d+(?:\.\d+)?)\s*([^\d/\s][^/]*?)\s*(?:\/\s*(\d+(?:\.\d+)?)?\s*(.*))?$/.exec(
    (text ?? '').trim()
  );
  if (!match) return null;
  const [, value, unit, per, perUnit] = match;
  const hasPer = match[0].includes('/');
  return {
    value,
    unit: unit.trim(),
    per: hasPer ? (per ?? '1') : '1',
    perUnit: hasPer ? (perUnit ?? '').trim() : ''
  };
}

/**
 * What an ingredient row reads as, in the correction's own shape (no
 * conversion): the form an equivalent NDC's row is compared in.
 */
export function ingredientAsCorrection(
  ingredient: CorrectableIngredient
): IngredientCorrection | null {
  const strength = parseStrengthText(ingredient.strength);
  if (!strength) return null;
  const basis = (BASES as readonly string[]).includes(ingredient.basis ?? '')
    ? (ingredient.basis as StrengthBasis)
    : 'ingredient';
  const unii = ingredient.unii?.toUpperCase() ?? '';
  const moiety = ingredient.moieties[0];
  const moietyRef = moiety?.unii && UNII.test(moiety.unii.toUpperCase())
    ? { name: moiety.name, unii: moiety.unii.toUpperCase() }
    : undefined;
  if (basis !== 'ingredient' && !moietyRef) return null;
  return {
    ...(UNII.test(unii) && { substance: { name: ingredient.name, unii } }),
    basis,
    ...(moietyRef && { moiety: moietyRef }),
    strength
  };
}

/** Whether two corrections state the same substance, basis, moiety and strength. */
export function sameIngredientRow(a: IngredientCorrection, b: IngredientCorrection): boolean {
  return (
    a.substance?.unii === b.substance?.unii &&
    a.basis === b.basis &&
    a.moiety?.unii === b.moiety?.unii &&
    formatStrength(a.strength) === formatStrength(b.strength)
  );
}
