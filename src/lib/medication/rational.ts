/**
 * Exact rational quantities.
 *
 * A concentration is a division, and the ones a pharmacy works with rarely
 * divide evenly: 1.5 g reconstituted to 11.4 mL is 1500/11.4 = 2500/19 mg/mL, a
 * number no decimal writes down. Kept as the division itself — a numerator and
 * a denominator, reduced — it stays exact, and reads back in the mixed proper
 * form a person can check against the label: "131 11/19 mg/mL".
 *
 * @module
 */

/** A rational number in lowest terms. `d` is always positive; sign lives on `n`. */
export interface Rational {
	n: number;
	d: number;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const gcd = (a: bigint, b: bigint): bigint => {
	while (b) [a, b] = [b, a % b];
	return a || 1n;
};

/** Reduce exact intermediates before checking the public number representation. */
function fromBig(n: bigint, d: bigint): Rational | null {
	if (d === 0n) return null;
	if (d < 0n) [n, d] = [-n, -d];
	const g = gcd(n < 0n ? -n : n, d);
	[n, d] = [n / g, d / g];
	return (n < 0n ? -n : n) > MAX_SAFE || d > MAX_SAFE ? null : { n: Number(n), d: Number(d) };
}

/** `n/d` reduced. Reject unsafe inputs: their original integer is already lost. */
export function rational(n: number, d: number = 1): Rational | null {
	if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) return null;
	return fromBig(BigInt(n), BigInt(d));
}

/** Whether a value has safe integer parts and a positive denominator. */
export const isRational = (value: unknown): value is Rational =>
	typeof value === 'object' &&
	value !== null &&
	Number.isSafeInteger((value as Rational).n) &&
	Number.isSafeInteger((value as Rational).d) &&
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
		if (!Number.isSafeInteger(h2) || !Number.isSafeInteger(k2) || k2 > maxDenominator) break;
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
	return a && b ? divide(a, b) : null;
}

/** Exact operations return null when inputs or the reduced result are unsafe. */
export const multiply = (a: Rational, b: Rational): Rational | null =>
	isRational(a) && isRational(b)
		? fromBig(BigInt(a.n) * BigInt(b.n), BigInt(a.d) * BigInt(b.d))
		: null;

export const divide = (a: Rational, b: Rational): Rational | null =>
	isRational(a) && isRational(b)
		? fromBig(BigInt(a.n) * BigInt(b.d), BigInt(a.d) * BigInt(b.n))
		: null;

export const add = (a: Rational, b: Rational): Rational | null =>
	isRational(a) && isRational(b)
		? fromBig(BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d), BigInt(a.d) * BigInt(b.d))
		: null;

/** Compare safe rationals without rounding cross-products; returns -1, 0 or 1. */
export function compare(a: Rational, b: Rational): number {
	if (!isRational(a) || !isRational(b)) throw new RangeError('Cannot compare unsafe rationals.');
	const difference = BigInt(a.n) * BigInt(b.d) - BigInt(b.n) * BigInt(a.d);
	return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
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
	if (wholeText && !whole) return null;
	// "131 11/19" is a sum only with a proper remainder: "131 22/19" is two
	// numbers written next to each other.
	if (whole && (!bText || Math.abs(toNumber(part)) >= 1)) return null;

	const magnitude = whole ? add(whole, part) : part;
	if (!magnitude) return null;
	return sign === '-' ? rational(-magnitude.n, magnitude.d) : magnitude;
}
