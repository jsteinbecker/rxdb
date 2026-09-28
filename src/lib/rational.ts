// ── Exact rational quantities ────────────────────────────────────────────────
//
// A concentration is a division, and the ones a pharmacy works with rarely
// divide evenly: 1.5 g reconstituted to 11.4 mL is 1500/11.4 = 2500/19 mg/mL, a
// number no decimal writes down. Kept as the division itself — a numerator and
// a denominator, reduced — it stays exact, and reads back in the mixed proper
// form a person can check against the label: "131 11/19 mg/mL".

/** A rational number in lowest terms. `d` is always positive; sign lives on `n`. */
export interface Rational {
  n: number;
  d: number;
}

const gcd = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
};

/** `n/d` reduced, with the sign carried by the numerator. Null when `d` is 0
 *  or either part is not a finite integer. */
export function rational(n: number, d: number = 1): Rational | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  if (!Number.isInteger(n) || !Number.isInteger(d)) return null;
  const sign = d < 0 ? -1 : 1;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
}

/** Whether a value is a usable rational: finite, positive denominator. */
export const isRational = (value: unknown): value is Rational =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as Rational).n) &&
  Number.isFinite((value as Rational).d) &&
  (value as Rational).d > 0;

export const toNumber = (r: Rational): number => r.n / r.d;

/** How far a convergent may sit from the value before it is not that value. */
const TOLERANCE = 1e-9;
/** Denominators past this stop being a fraction anyone reconstitutes to. */
const MAX_DENOMINATOR = 1_000_000;

/**
 * The fraction a decimal was standing in for: continued-fraction convergents,
 * stopped at the first that reproduces the input within `TOLERANCE`.
 * 131.57894736842105 comes back as 2500/19, 22.5 as 45/2.
 */
export function fromNumber(value: number, maxDenominator = MAX_DENOMINATOR): Rational | null {
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return rational(value, 1);

  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let b = x;

  for (let i = 0; i < 64; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDenominator) break;
    [h0, h1, k0, k1] = [h1, h2, k1, k2];
    if (Math.abs(x - h1 / k1) <= TOLERANCE * Math.max(1, x)) break;
    const frac = b - a;
    if (frac === 0) break;
    b = 1 / frac;
  }

  return rational(sign * h1, k1);
}

/** A quantity divided by another, kept exact: `fromRatio(1500, 11.4)` is 2500/19. */
export function fromRatio(numerator: number, denominator: number): Rational | null {
  const a = fromNumber(numerator);
  const b = fromNumber(denominator);
  if (!a || !b || b.n === 0) return null;
  return rational(a.n * b.d, a.d * b.n);
}

export const multiply = (r: Rational, by: Rational): Rational | null =>
  rational(r.n * by.n, r.d * by.d);

export const divide = (r: Rational, by: Rational): Rational | null =>
  by.n === 0 ? null : rational(r.n * by.d, r.d * by.n);

export const compare = (a: Rational, b: Rational): number => a.n * b.d - b.n * a.d;
export const equals = (a: Rational, b: Rational): boolean => compare(a, b) === 0;

/** Mixed proper form: "131 11/19", "150", "11/19", "-2 1/3". */
export function formatRational(r: Rational): string {
  const sign = r.n < 0 ? '-' : '';
  const n = Math.abs(r.n);
  if (r.d === 1) return `${sign}${n}`;
  const whole = Math.floor(n / r.d);
  const rem = n - whole * r.d;
  if (!whole) return `${sign}${rem}/${r.d}`;
  return `${sign}${whole} ${rem}/${r.d}`;
}

/** `n/d`, always improper — the canonical wire and storage spelling. */
export const serializeRational = (r: Rational): string => `${r.n}/${r.d}`;

const NUMBER = String.raw`\d*\.?\d+`;
const MIXED_RE = new RegExp(
  String.raw`^([+-]?)\s*(?:(\d+)\s+)?(${NUMBER})(?:\s*\/\s*(${NUMBER}))?$`
);

/**
 * A rational from anything a person or a stored row can hand over: a mixed
 * form ("131 11/19"), an improper fraction ("2500/19"), the label's own
 * division ("1500/11.4"), or a plain decimal ("131.58", ".5", "1,000").
 */
export function parseRational(input: unknown): Rational | null {
  if (isRational(input)) return rational(input.n, input.d);
  if (typeof input === 'number') return fromNumber(input);
  if (typeof input !== 'string') return null;

  const m = input
    .trim()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .match(MIXED_RE);
  if (!m) return null;
  const [, sign, wholeText, aText, bText] = m;

  const part = bText
    ? fromRatio(parseFloat(aText), parseFloat(bText))
    : fromNumber(parseFloat(aText));
  if (!part) return null;

  const whole = wholeText ? fromNumber(parseInt(wholeText, 10)) : null;
  // "131 11/19" is a sum only with a proper remainder: "131 22/19" is two
  // numbers written next to each other.
  if (whole && (!bText || Math.abs(toNumber(part)) >= 1)) return null;

  const magnitude = whole ? rational(whole.n * part.d + part.n * whole.d, whole.d * part.d) : part;
  if (!magnitude) return null;
  return sign === '-' ? rational(-magnitude.n, magnitude.d) : magnitude;
}
