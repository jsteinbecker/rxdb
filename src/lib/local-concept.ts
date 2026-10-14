// Pure helpers for local superseding concepts: RxNorm-style naming, parsing an
// RxNorm SCD name back into ingredients, and diffing two ingredient lists.
// Strengths are compared as exact rationals, never floats.

import { divide, equals, fromNumber, multiply, toNumber, type Rational } from './rational.ts';
import { mgPer, mlPer } from './units.ts';

export type LocalIngredient = {
  substanceUnii: string;
  substanceName: string;
  basis: 'as_labeled' | 'active_moiety';
  moietyUnii: string | null;
  moietyName: string | null;
  strengthNumMag: string;
  strengthNumUom: string;
  strengthDenMag: string;
  strengthDenUom: string;
};

/** One ingredient as an RxNorm name writes it; `unit` like 'MG/ML' or 'MEQ/ML'. */
export type ConceptIngredient = { name: string; value: string; unit: string };

export type IngredientDiff = {
  name: string;
  change: 'added' | 'removed' | 'changed' | 'same';
  rxnorm: ConceptIngredient | null;
  local: ConceptIngredient | null;
}[];

/** SPL names that RxNorm spells differently. */
const ALIASES: Readonly<Record<string, string>> = {
  'aspartic acid': 'aspartate',
  'glutamic acid': 'glutamate'
};

/** The name two sources agree on: lower case, single-spaced, RxNorm's spelling. */
export function ingredientKey(name: string): string {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
  return ALIASES[key] ?? key;
}

export function ingredientDisplayName(row: LocalIngredient): string {
  return ingredientKey(
    row.basis === 'active_moiety' ? (row.moietyName ?? row.substanceName) : row.substanceName
  );
}

/** RxNorm's number spelling: no trailing zeros, leading zero kept. */
export function rxnormNumber(value: string): string {
  let s = value.trim();
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s.startsWith('.')) s = '0' + s;
  return s === '' ? '0' : s;
}

const num = (text: string): Rational | null => {
  const n = parseFloat(text);
  return Number.isFinite(n) ? fromNumber(n) : null;
};

type Dimension = 'mass' | 'meq' | 'other';

/** A strength reduced to a quantity per millilitre (or per unit when no volume). */
type Normalized = { dimension: Dimension; base: string; perMl: boolean; q: Rational };

/** `value` of numerator unit `numUnit` over `denMag` of `denUnit`, normalized. */
function normalize(
  value: string,
  numUnit: string,
  denMag: string,
  denUnit: string
): Normalized | null {
  const v = num(value);
  const d = num(denMag || '1');
  if (!v || !d) return null;
  const nu = numUnit.trim().toLowerCase();
  const du = denUnit.trim().toLowerCase();

  let dimension: Dimension;
  let base: string;
  let numFactor: number;
  if (mgPer(nu) !== null) {
    dimension = 'mass';
    base = 'mg';
    numFactor = mgPer(nu)!;
  } else if (nu === 'meq') {
    dimension = 'meq';
    base = 'meq';
    numFactor = 1;
  } else {
    dimension = 'other';
    base = nu;
    numFactor = 1;
  }

  let denFactor = 1;
  let perMl = false;
  if (du) {
    if (mlPer(du) === null) {
      // a non-volume denominator is its own dimension
      dimension = 'other';
      base = `${base}/${du}`;
    } else {
      perMl = true;
      denFactor = mlPer(du)!;
    }
  }

  const nf = fromNumber(numFactor);
  const df = fromNumber(denFactor);
  if (!nf || !df) return null;
  const top = multiply(v, nf);
  const bottom = multiply(d, df);
  if (!top || !bottom) return null;
  const q = divide(top, bottom);
  return q && { dimension, base, perMl, q };
}

/** Shortest decimal for a rational, written the RxNorm way. */
function decimal(q: Rational): string {
  return rxnormNumber(String(Number(toNumber(q).toPrecision(12))));
}

export function asConceptIngredient(row: LocalIngredient): ConceptIngredient {
  const name = ingredientDisplayName(row);
  const n = normalize(
    row.strengthNumMag,
    row.strengthNumUom,
    row.strengthDenMag,
    row.strengthDenUom
  );
  if (!n) {
    return {
      name,
      value: rxnormNumber(row.strengthNumMag),
      unit: `${row.strengthNumUom}/${row.strengthDenUom}`.toUpperCase()
    };
  }
  return {
    name,
    value: decimal(n.q),
    unit: (n.perMl ? `${n.base}/mL` : n.base).toUpperCase()
  };
}

export function localConceptName(input: {
  ingredients: LocalIngredient[];
  doseForm: string;
  brandName?: string | null;
}): string {
  const parts = input.ingredients
    .map(asConceptIngredient)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((i) => `${i.name} ${rxnormNumber(i.value)} ${i.unit}`);
  const base = `${parts.join(' / ')} ${input.doseForm}`;
  return input.brandName ? `${base} [${input.brandName}]` : base;
}

const SEGMENT = /^(.*?) (\d*\.?\d+) ([A-Z[\]]+\/[A-Z]+|[A-Z[\]]+)(?: (.*))?$/i;

/** Inverse of `localConceptName`; null when the name carries no strengths. */
export function parseScdName(name: string): {
  ingredients: ConceptIngredient[];
  doseForm: string | null;
  brand: string | null;
} | null {
  let rest = name.trim();
  let brand: string | null = null;
  const b = rest.match(/ \[([^\]]+)\]$/);
  if (b) {
    brand = b[1];
    rest = rest.slice(0, b.index).trim();
  }
  const segments = rest.split(' / ');
  const ingredients: ConceptIngredient[] = [];
  let doseForm: string | null = null;
  for (let i = 0; i < segments.length; i++) {
    const m = segments[i].match(SEGMENT);
    if (!m) return null;
    ingredients.push({ name: m[1], value: m[2], unit: m[3].toUpperCase() });
    if (i === segments.length - 1) doseForm = m[4] ?? null;
  }
  return { ingredients, doseForm, brand };
}

/** Normalizes a 'MG/ML', 'MG/100ML' or 'G/100 ML' unit string. */
function normalizeConcept(c: ConceptIngredient): Normalized | null {
  const m = c.unit.trim().match(/^([^/]+)(?:\/(\d*\.?\d*)\s*(.+))?$/);
  if (!m) return null;
  return normalize(c.value, m[1], m[3] ? m[2] || '1' : '1', m[3] ?? '');
}

export function sameStrength(a: ConceptIngredient, b: ConceptIngredient): boolean {
  const x = normalizeConcept(a);
  const y = normalizeConcept(b);
  if (!x || !y) return a.value === b.value && a.unit.toUpperCase() === b.unit.toUpperCase();
  return (
    x.dimension === y.dimension && x.base === y.base && x.perMl === y.perMl && equals(x.q, y.q)
  );
}

export function diffIngredients(
  rxnorm: ConceptIngredient[],
  local: ConceptIngredient[]
): IngredientDiff {
  const localByKey = new Map(local.map((l) => [ingredientKey(l.name), l]));
  const seen = new Set<string>();
  const out: IngredientDiff = [];
  for (const r of rxnorm) {
    const key = ingredientKey(r.name);
    const l = localByKey.get(key) ?? null;
    seen.add(key);
    out.push({
      name: r.name,
      change: !l ? 'removed' : sameStrength(r, l) ? 'same' : 'changed',
      rxnorm: r,
      local: l
    });
  }
  for (const l of local) {
    if (!seen.has(ingredientKey(l.name))) {
      out.push({ name: l.name, change: 'added', rxnorm: null, local: l });
    }
  }
  return out;
}
