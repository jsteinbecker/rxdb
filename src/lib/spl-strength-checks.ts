import type { SplIngredient, SplProduct, StatedStrength } from './spl-ingredients';
import { strengthText } from './spl-ingredients';
import { convertStrength, roundSignificant } from './strength-conversion';
import { mgPer, mlPer, toMg } from './units';

// ── Label strengths that cannot be true as coded ─────────────────────────────
// SPL states every strength as a numerator/denominator ratio whose denominator
// should be the unit of presentation — 1 VIAL, 1 TABLET, 1 mL. Labelers get it
// wrong in two recurring ways, and both survive schema validation:
//
//   1. The denominator is coded as a mass: `513 mg in 1 mg`. Physically
//      impossible, and what the labeler meant is "per vial", which the
//      packaging level (`513 mg in 1 VIAL`) confirms. Every ingredient sharing
//      that miscoded denominator — the excipients too — means the same thing.
//   2. The basis says moiety (ACTIM) but the number is the salt's mass: 513 mg
//      of vancomycin hydrochloride is 500 mg of vancomycin. RxNorm normalizes
//      to the moiety, so a small excess over RxNorm's strength, on an
//      ingredient whose name is the moiety plus a counterion, is the signature.
//   3. The same mix-up with a heavy counterion (lysine acetate, cysteine
//      hydrochloride), where RxNorm often copied the label's number and so
//      cannot arbitrate. The FDA directory naming the salt at the very mass the
//      label calls moiety strength is the signature; GSRS molecular weights
//      give the moiety's share.
//
// Corrections are returned alongside the stated values, never instead of them:
// the caller shows the corrected strength and a note naming what the label said.

export type StrengthCorrectionKind = 'presentation-unit' | 'salt-equivalent' | 'moiety-equivalent';

export interface StrengthCorrection {
  kind: StrengthCorrectionKind;
  note: string;
  /** A salt correction's number as the label printed it, the salt's own mass. */
  stated?: number;
}

export interface CheckedStrength extends StatedStrength {
  corrections: StrengthCorrection[];
}

const massMg = (value: number | null, unit: string | null): number | null =>
  value === null ? null : toMg(value, unit);

const isMass = (unit: string | null): boolean => mgPer(unit) !== null;

const VOLUME = /^(?:mL|L|uL|µL)$/i;

const round = (value: number): number => Number(value.toPrecision(12));

/**
 * Maximum salt-to-moiety mass ratio treated as a salt/base mix-up. Common
 * pharmaceutical salts sit well inside it (vancomycin HCl ≈ 1.025,
 * diphenhydramine HCl ≈ 1.14); anything larger is more likely a real
 * difference in strength than a basis error.
 */
const MAX_SALT_RATIO = 1.3;
/** Below this the two strengths agree within rounding. */
const MIN_SALT_RATIO = 1.005;

/** One `name value UNIT[/UNIT]` component of an RxNorm clinical drug name. */
export interface RxStrength {
  name: string;
  value: number;
  unit: string;
  /** The denominator's amount: 100 in `900 MG/100ML`, 1 when unstated. */
  per: number;
  perUnit: string | null;
}

/**
 * The strengths in an RxNorm SCD/SBD name: `vancomycin 500 MG Injection`,
 * `amoxicillin 250 MG / clavulanate 62.5 MG Oral Tablet`.
 */
export function rxNormStrengths(name: string | null | undefined): RxStrength[] {
  if (!name) return [];
  const out: RxStrength[] = [];
  for (const part of name.replace(/\[[^\]]*\]/g, '').split(/\s+\/\s+/)) {
    const match = part.match(/^\s*(.+?)\s+([\d.]+)\s*([A-Za-z]+)(?:\/([\d.]*)\s*([A-Za-z]+))?\b/);
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    const per = match[4] ? Number(match[4]) : 1;
    if (!Number.isFinite(per) || per <= 0) continue;
    out.push({ name: match[1].trim(), value, unit: match[3], per, perUnit: match[5] ?? null });
  }
  return out;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `VANCOMYCIN HYDROCHLORIDE` less `VANCOMYCIN` → `hydrochloride`. */
function counterionOf(salt: string, moiety: string): string | null {
  const rest = salt.toLowerCase().replace(moiety.toLowerCase(), '').replace(/\s+/g, ' ').trim();
  return rest || null;
}

/**
 * Check and, where the coding is provably wrong, correct each ingredient's
 * strength. Returned in the same order as `product.ingredients`.
 */
export function checkProductStrengths(
  product: Pick<SplProduct, 'ingredients' | 'presentation'>,
  options: {
    rxNormName?: string | null;
    /** GSRS salt-to-moiety factors by the salt's UNII; see `MoietyFactor`. */
    moietyFactors?: ReadonlyMap<string, MoietyFactor>;
    /** The FDA directory's active ingredients, as it names and measures them. */
    directory?: readonly { name: string; strength: string | null }[];
  } = {}
): CheckedStrength[] {
  const checked: CheckedStrength[] = product.ingredients.map((ingredient) => ({
    strength: ingredient.strength,
    strengthUnit: ingredient.strengthUnit,
    per: ingredient.per,
    perUnit: ingredient.perUnit,
    corrections: []
  }));

  correctMassDenominators(product, checked);
  correctSaltAsMoiety(product.ingredients, checked, options.rxNormName ?? null);
  correctHeavySaltAsMoiety(product.ingredients, checked, options.moietyFactors, options.directory);
  return checked;
}

/** Rule 1 — `X mg in 1 mg`. */
function correctMassDenominators(
  product: Pick<SplProduct, 'ingredients' | 'presentation'>,
  checked: CheckedStrength[]
): void {
  const massDenominated = checked.filter(
    (row) => row.per !== null && row.per > 0 && isMass(row.perUnit) && isMass(row.strengthUnit)
  );
  if (!massDenominated.length) return;

  // Impossible when any one ingredient outweighs the product it is "in", or
  // when the ingredients together do. The second catches the excipients of a
  // product whose active alone was the tell — 0.05 mg in 1 mg is possible in
  // isolation, but not beside 513 mg in the same 1 mg.
  const denominatorMg = (row: CheckedStrength) => massMg(row.per, row.perUnit)!;
  const total = massDenominated.reduce(
    (sum, row) => sum + massMg(row.strength, row.strengthUnit)! / denominatorMg(row),
    0
  );
  const impossible =
    total > 1 ||
    massDenominated.some((row) => massMg(row.strength, row.strengthUnit)! > denominatorMg(row));
  if (!impossible) return;

  const form = product.presentation?.form ?? null;
  const per = product.presentation?.per ?? 1;
  const presentationUnit = form ?? 'unit';
  for (const row of massDenominated) {
    const stated = `${row.per} ${row.perUnit}`;
    row.per = per;
    row.perUnit = presentationUnit;
    row.corrections.push({
      kind: 'presentation-unit',
      note: `Corrected unit of presentation to ${per} ${presentationUnit} from improper coding as ${stated}`
    });
  }
}

/** Rule 2 — a salt's mass stated as moiety strength. */
function correctSaltAsMoiety(
  ingredients: SplIngredient[],
  checked: CheckedStrength[],
  rxNormName: string | null
): void {
  const rx = rxNormStrengths(rxNormName);
  if (!rx.length) return;

  ingredients.forEach((ingredient, index) => {
    const row = checked[index];
    if (ingredient.kind !== 'active' || ingredient.basis !== 'moiety') return;
    if (ingredient.moieties.length !== 1 || row.strength === null) return;
    const moiety = ingredient.moieties[0];
    if (sameName(ingredient.name, moiety.name)) return;
    if (!ingredient.name.toLowerCase().includes(moiety.name.toLowerCase())) return;

    const reference = rx.find((entry) => sameName(entry.name, moiety.name));
    if (!reference) return;

    // Only compare like with like: RxNorm's per-mL against a per-mL label
    // strength, its per-unit against a per-unit (or per-container) one.
    const labelPerVolume = VOLUME.test(row.perUnit ?? '');
    if (reference.perUnit) {
      if (reference.per !== 1 || !labelPerVolume || row.per !== 1 || !sameName(reference.perUnit, row.perUnit!)) return;
    } else if (labelPerVolume || isMass(row.perUnit)) return;

    const labelMg = massMg(row.strength, row.strengthUnit);
    const rxMg = massMg(reference.value, reference.unit);
    if (labelMg === null || rxMg === null || rxMg <= 0) return;
    const ratio = labelMg / rxMg;
    if (ratio <= MIN_SALT_RATIO || ratio > MAX_SALT_RATIO) return;

    const stated = strengthText({ ...row, per: null, perUnit: null })!;
    const printed = row.strength;
    const corrected = round(rxMg / (mgPer(row.strengthUnit) ?? 1));
    row.strength = corrected;
    const counterion = counterionOf(ingredient.name, moiety.name);
    row.corrections.push({
      kind: 'salt-equivalent',
      stated: printed,
      note:
        `Strength corrected from stated value of ${stated}, equivalent to ` +
        `${corrected} ${row.strengthUnit} ${moiety.name.toLowerCase()}` +
        (counterion ? ` as the ${counterion} salt` : ' as its salt')
    });
  });
}

/** How a salt's mass becomes its moiety's, per GSRS. */
export interface MoietyFactor {
  moietyUnii: string;
  /** Exact decimal `moietyCount · MW(moiety) / MW(salt)`. */
  factor: string;
}

/** A strength as mg per mL, or per one unit when it has no volume; null when unreadable. */
function concentration(
  value: number | null,
  unit: string | null,
  per: number | null,
  perUnit: string | null
): { mg: number; perVolume: boolean } | null {
  const mg = massMg(value, unit);
  if (mg === null || per === null || !(per > 0)) return null;
  const ml = mlPer(perUnit);
  return ml === null ? { mg: mg / per, perVolume: false } : { mg: mg / (per * ml), perVolume: true };
}

/** `1.2 g/100mL`, `.024 g/100mL`, `500 mg/1` as the FDA directory writes them. */
function directoryConcentration(text: string | null) {
  const match = /^\s*(\d*\.?\d+)\s*([a-zµ]+)\s*(?:\/\s*(\d*\.?\d+)?\s*([a-zµ]*))?\s*$/i.exec(text ?? '');
  if (!match) return null;
  return concentration(Number(match[1]), match[2], match[3] ? Number(match[3]) : 1, match[4] || null);
}

/** Within this the directory and label state the same mass. */
const SAME_MASS = 0.005;

/** Rule 3 — a heavy salt's mass stated as moiety strength, confirmed by the directory. */
function correctHeavySaltAsMoiety(
  ingredients: SplIngredient[],
  checked: CheckedStrength[],
  factors: ReadonlyMap<string, MoietyFactor> | undefined,
  directory: readonly { name: string; strength: string | null }[] | undefined
): void {
  if (!factors?.size || !directory?.length) return;
  ingredients.forEach((ingredient, index) => {
    const row = checked[index];
    if (ingredient.kind !== 'active' || ingredient.basis !== 'moiety' || !ingredient.unii) return;
    if (ingredient.moieties.length !== 1 || row.strength === null) return;
    if (row.corrections.some((correction) => correction.kind === 'salt-equivalent')) return;
    const moiety = ingredient.moieties[0];
    const known = factors.get(ingredient.unii);
    if (!known || known.moietyUnii !== moiety.unii) return;
    const factor = Number(known.factor);
    // Small counterions are rule 2's, where RxNorm can arbitrate.
    if (!(factor > 0) || 1 / factor <= MAX_SALT_RATIO) return;

    const label = concentration(row.strength, row.strengthUnit, row.per, row.perUnit);
    if (!label || label.mg <= 0) return;
    const listed = directory.find((entry) => sameName(entry.name, ingredient.name));
    const stated = directoryConcentration(listed?.strength ?? null);
    if (!stated || stated.perVolume !== label.perVolume) return;
    if (Math.abs(stated.mg - label.mg) > SAME_MASS * label.mg) return;

    const converted = convertStrength(row.strength, known.factor);
    if (!converted) return;
    const before = strengthText({ ...row, per: null, perUnit: null })!;
    const printed = row.strength;
    row.strength = Number(roundSignificant(converted));
    const counterion = counterionOf(ingredient.name, moiety.name);
    row.corrections.push({
      kind: 'moiety-equivalent',
      stated: printed,
      note:
        `Strength corrected from stated value of ${before}, the mass of the ` +
        `${counterion ? `${counterion} salt` : 'salt'}, to its equivalent of ` +
        `${row.strength} ${row.strengthUnit} ${moiety.name.toLowerCase()}`
    });
  });
}
