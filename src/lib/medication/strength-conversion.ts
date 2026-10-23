/**
 * Converting a strength between substances by molecular weight.
 *
 * 500 mg of a salt carries less drug than 500 mg of its free base; moving a
 * strength from one measured substance to the other scales it by the ratio of
 * their molecular weights, adjusted for how many units of the first make up
 * one of the second. Done in exact decimals (BigInt-scaled) so the stored
 * factor is reproducible; rounding for display is a separate step.
 *
 * @module
 */

/** A decimal number as `digits × 10^-scale`. */
type Decimal = { digits: bigint; scale: number };

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function parse(text: string): Decimal | null {
	const match = DECIMAL.exec(text.trim());
	if (!match) return null;
	const [, sign, whole, fraction = ''] = match;
	const digits = BigInt(whole + fraction);
	return { digits: sign ? -digits : digits, scale: fraction.length };
}

/** Parses a positive finite decimal from a number or its text, else null. */
function positive(value: number | string): Decimal | null {
	const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
	// Numbers like 1e-7 print in exponent form; widen them.
	const plain = /e/i.test(text) ? Number(text).toFixed(20).replace(/0+$/, '') : text;
	const decimal = parse(plain.replace(/\.$/, ''));
	return decimal && decimal.digits > 0n ? decimal : null;
}

const pow10 = (n: number) => 10n ** BigInt(n);

/** Digits of a decimal rendered with up to `places` fractional digits, trailing zeros trimmed. */
function render(digits: bigint, scale: number): string {
	const negative = digits < 0n;
	const text = (negative ? -digits : digits).toString().padStart(scale + 1, '0');
	const whole = text.slice(0, text.length - scale);
	const fraction = text.slice(text.length - scale).replace(/0+$/, '');
	return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Significant digits kept in a stored factor; far beyond any MW's precision. */
const FACTOR_PLACES = 18;

/** `numerator / denominator` to `places` fractional digits, rounded half up. */
function divide(a: Decimal, b: Decimal, places: number): string {
	// a/b = (a.digits / b.digits) × 10^(b.scale - a.scale)
	const shift = places + b.scale - a.scale;
	const numerator = shift >= 0 ? a.digits * pow10(shift) : a.digits;
	const denominator = shift >= 0 ? b.digits : b.digits * pow10(-shift);
	let quotient = numerator / denominator;
	const remainder = numerator % denominator;
	if (remainder * 2n >= denominator) quotient += 1n;
	return render(quotient, places);
}

/**
 * The factor that converts a strength measured as the `from` substance to one
 * measured as the `to` substance: `MW(to) / (n · MW(from))`, where `n` is the
 * units of `from` per unit of `to`. Null for a molecular weight or `n` ≤ 0.
 */
export function conversionFactor(
	mwFrom: number | string,
	mwTo: number | string,
	n: number | string = 1
): string | null {
	const from = positive(mwFrom);
	const to = positive(mwTo);
	const count = positive(n);
	if (!from || !to || !count) return null;
	const denominator = { digits: from.digits * count.digits, scale: from.scale + count.scale };
	return divide(to, denominator, FACTOR_PLACES);
}

/** `value × factor`, exactly, to at most `FACTOR_PLACES` decimals. Null when either is not a number. */
export function convertStrength(value: number | string, factor: string): string | null {
	const amount = positive(value);
	const ratio = positive(factor);
	if (!amount || !ratio) return null;
	const scale = amount.scale + ratio.scale;
	return divide(
		{ digits: amount.digits * ratio.digits, scale },
		{ digits: 1n, scale: 0 },
		Math.min(scale, FACTOR_PLACES)
	);
}

/** Rounds a decimal string to `significant` significant digits (default 4), for display. */
export function roundSignificant(value: string, significant = 4): string {
	const decimal = parse(value);
	if (!decimal || decimal.digits === 0n) return value;
	const negative = decimal.digits < 0n;
	const abs = negative ? -decimal.digits : decimal.digits;
	const length = abs.toString().length;
	const drop = length - significant;
	if (drop <= 0) return value;
	const unit = pow10(drop);
	let rounded = abs / unit;
	if ((abs % unit) * 2n >= unit) rounded += 1n;
	// `rounded × 10^drop × 10^-scale`
	const scale = decimal.scale - drop;
	const result = scale >= 0 ? render(rounded, scale) : (rounded * pow10(-scale)).toString();
	return negative ? `-${result}` : result;
}
