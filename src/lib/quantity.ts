// ── Typed quantities ─────────────────────────────────────────────────────────
//
// What QuantityField reads: a number the way it is said out loud, with or
// without its unit — "150", "131 11/19", "2500/19 mg/mL", "0.9%", "1.5 g",
// "250 mg/5 mL", "20,000 UNT/vial". The number and the unit are told apart by
// where the letters start: everything before the first letter (or %) is the
// number, everything after it is the unit. No quantity is written with a letter
// inside its value, and both halves may contain a slash.
//
// The value is kept as an exact rational (see ./rational) so what was typed is
// what is meant — 131 11/19 is 2500/19, not 131.5789….

import {divide, formatRational, multiply, parseRational, type Rational, toNumber} from './rational';

/**
 * What a quantity measures, by its unit: a bare `number`, a `percent`, an
 * `amount` (1 g, 10 units), a `volume` (10 mL), or a `ratio` of two units
 * (mg/mL, UNT/vial, mEq/L).
 */
export type QuantityKind = 'number' | 'percent' | 'amount' | 'volume' | 'ratio';

export interface Quantity {
	rational: Rational;
	value: number;
	unit: string | null;
	numeratorUnit: string | null;
	denominatorUnit: string | null;
	kind: QuantityKind;
}

const UNIT_CANONICAL: Record<string, string> = {
	mcg: 'mcg',
	ug: 'mcg',
	µg: 'mcg',
	μg: 'mcg',
	mg: 'mg',
	g: 'g',
	gm: 'g',
	kg: 'kg',
	ml: 'mL',
	cc: 'mL',
	dl: 'dL',
	l: 'L',
	meq: 'mEq',
	mmol: 'mmol',
	unt: 'unit',
	unit: 'unit',
	units: 'unit',
	iu: 'IU',
	vial: 'vial',
	vials: 'vial',
	'%': '%'
};

/** RxNorm cases units freely ("MG/ML", "UNT"); fold the known ones onto one spelling. */
export const canonicalUnit = (unit: string | null | undefined): string | null => {
	const trimmed = unit?.trim();
	return trimmed ? (UNIT_CANONICAL[trimmed.toLowerCase()] ?? trimmed) : null;
};

/** Each part of "MG/ML" canonical: "mg/mL". Null for an empty label. */
export function canonicalUnitLabel(label: string | null | undefined): string | null {
	if (!label?.trim()) return null;
	const [numerator, denominator] = splitOnce(label, '/');
	const n = canonicalUnit(numerator);
	const d = denominator === null ? null : canonicalUnit(denominator);
	return d ? `${n ?? ''}/${d}` : n;
}

const splitOnce = (text: string, separator: string): [string, string | null] => {
	const at = text.indexOf(separator);
	return at === -1 ? [text, null] : [text.slice(0, at), text.slice(at + separator.length)];
};

// Exact factors onto one base unit per dimension, so a conversion never
// passes through a rounded decimal.
const MASS_TO_MG: Record<string, Rational> = {
	mcg: { n: 1, d: 1000 },
	mg: { n: 1, d: 1 },
	g: { n: 1000, d: 1 },
	kg: { n: 1_000_000, d: 1 }
};
const VOLUME_TO_ML: Record<string, Rational> = {
	mL: { n: 1, d: 1 },
	dL: { n: 100, d: 1 },
	L: { n: 1000, d: 1 }
};

const dimension = (unit: string | null): 'mass' | 'volume' | null =>
	unit == null ? null : unit in MASS_TO_MG ? 'mass' : unit in VOLUME_TO_ML ? 'volume' : null;

/** How many `to` one `from` is, or null when they measure different things. */
function unitFactor(from: string | null, to: string | null): Rational | null {
	if (from === to) return { n: 1, d: 1 };
	if (from == null || to == null) return null;
	const table = from in MASS_TO_MG ? MASS_TO_MG : from in VOLUME_TO_ML ? VOLUME_TO_ML : null;
	if (!table || !(to in table)) return null;
	return divide(table[from], table[to]);
}

const kindOf = (numeratorUnit: string | null, denominatorUnit: string | null): QuantityKind =>
	denominatorUnit
		? 'ratio'
		: numeratorUnit === '%'
			? 'percent'
			: dimension(numeratorUnit) === 'volume'
				? 'volume'
				: numeratorUnit
					? 'amount'
					: 'number';

function build(
	value: Rational,
	numeratorUnit: string | null,
	denominatorUnit: string | null
): Quantity {
	return {
		rational: value,
		value: toNumber(value),
		unit: numeratorUnit
			? denominatorUnit
				? `${numeratorUnit}/${denominatorUnit}`
				: numeratorUnit
			: null,
		numeratorUnit,
		denominatorUnit,
		kind: kindOf(numeratorUnit, denominatorUnit)
	};
}

/**
 * What a typed quantity says, or null when it does not say one yet.
 *
 * Null is the ordinary state mid-keystroke — "131 " and "131 11/" are on the
 * way to a number rather than mistakes — so callers show the last good reading
 * rather than an error while someone is still typing.
 */
export function parseQuantity(text: unknown): Quantity | null {
	if (typeof text === 'number') {
		const value = parseRational(text);
		return value ? build(value, null, null) : null;
	}
	if (typeof text !== 'string') return null;
	const trimmed = text.trim();
	if (!trimmed) return null;

	const letter = trimmed.search(/[A-Za-zµμ%]/);
	const numberText = letter === -1 ? trimmed : trimmed.slice(0, letter);
	const unitText = letter === -1 ? '' : trimmed.slice(letter).trim();

	let value = parseRational(numberText.trim());
	if (!value) return null;
	if (!unitText) return build(value, null, null);

	const [numeratorText, denominatorText] = splitOnce(unitText, '/');
	if (!/^[A-Za-zµμ%][\w µμ%.-]*$/.test(numeratorText.trim())) return null;
	const numeratorUnit = canonicalUnit(numeratorText);
	if (denominatorText === null) return build(value, numeratorUnit, null);

	// "250 mg/5 mL" states its denominator with an amount: 50 mg per mL.
	const denominator = denominatorText.trim().match(/^([\d.,\s/]*?)\s*([A-Za-zµμ][\w µμ.-]*)$/);
	if (!denominator) return null;
	if (denominator[1].trim()) {
		const per = parseRational(denominator[1].trim());
		if (!per || per.n === 0) return null;
		const scaled = divide(value, per);
		if (!scaled) return null;
		value = scaled;
	}
	return build(value, numeratorUnit, canonicalUnit(denominator[2]));
}

/**
 * A percent as the ratio it stands for: w/w and v/v exactly, and — when
 * `weightInVolume` allows — w/v on pharmacy's 1 mL ≈ 1 g reading (0.9% = 9 mg/mL).
 */
function percentAsRatio(
	percent: Rational,
	numeratorUnit: string | null,
	denominatorUnit: string | null,
	weightInVolume: boolean
): Quantity | null {
	const top = dimension(numeratorUnit);
	const bottom = dimension(denominatorUnit);
	const hundredth = divide(percent, { n: 100, d: 1 });
	if (!hundredth || !top || !bottom) return null;
	if (top === bottom)
		return build(hundredth, top === 'mass' ? 'g' : 'mL', top === 'mass' ? 'g' : 'mL');
	if (weightInVolume && top === 'mass' && bottom === 'volume') return build(hundredth, 'g', 'mL');
	return null;
}

export interface ConvertOptions {
	/** Read a percent against a mass/volume unit as w/v (0.9% = 9 mg/mL). Default true. */
	weightInVolume?: boolean;
}

/**
 * `quantity` restated in `unit` — "1.5 g" as 1500 mg, "0.9%" as 9 mg/mL,
 * "1 g/L" as 1 mg/mL — or null when it cannot be. A bare number is taken to
 * be in `unit` already.
 */
export function convertQuantity(
	quantity: Quantity,
	unit: string | null | undefined,
	{ weightInVolume = true }: ConvertOptions = {}
): Quantity | null {
	const target = canonicalUnitLabel(unit);
	if (!target) return quantity.unit ? null : quantity;
	const [targetTop, targetBottom] = splitOnce(target, '/');
	if (!quantity.unit) return build(quantity.rational, targetTop || null, targetBottom);
	if (quantity.unit === target) return quantity;

	if (targetTop === '%' && !targetBottom) {
		// A ratio as its percent: the inverse of reading a percent as a ratio.
		if (quantity.kind !== 'ratio') return null;
		const basis = percentAsRatio(
			{ n: 100, d: 1 },
			quantity.numeratorUnit,
			quantity.denominatorUnit,
			weightInVolume
		);
		const inBasis = basis && convertQuantity(quantity, basis.unit, { weightInVolume });
		const percent = inBasis && multiply(inBasis.rational, { n: 100, d: 1 });
		return percent ? build(percent, '%', null) : null;
	}

	let source: Quantity | null = quantity;
	if (quantity.kind === 'percent')
		source = percentAsRatio(quantity.rational, targetTop, targetBottom, weightInVolume);
	if (!source || !!source.denominatorUnit !== !!targetBottom) return null;

	const top = unitFactor(source.numeratorUnit, targetTop);
	const bottom = targetBottom ? unitFactor(source.denominatorUnit, targetBottom) : { n: 1, d: 1 };
	const scaled = top && bottom && multiply(source.rational, top);
	const value = scaled && divide(scaled, bottom!);
	return value ? build(value, targetTop, targetBottom) : null;
}

/** "131 11/19 mg/mL", "0.9%", "150". */
export function formatQuantity(quantity: Quantity): string {
	const number = exactDecimal(quantity.rational) ?? formatRational(quantity.rational);
	if (!quantity.unit) return number;
	return quantity.unit === '%' ? `${number}%` : `${number} ${quantity.unit}`;
}

/**
 * The decimal string a quantity is stored as where storage takes a plain
 * number: exact when the division comes out, otherwise to full precision.
 */
export const quantityDecimal = (quantity: Quantity): string =>
	exactDecimal(quantity.rational, 12) ?? String(quantity.value);

/** The whole part and the proper remainder a field renders stacked. */
export interface MixedParts {
	whole: string | null;
	numerator: string | null;
	denominator: string | null;
}

/** How far a decimal may run and still be the form the number is read in. */
const MAX_EXACT_PLACES = 4;

/**
 * The decimal a fraction is exactly equal to, or null when it has none.
 *
 * A stacked fraction is the honest form of a division that does not come out —
 * 2500/19 — but the wrong form for one that does: nobody reads 9/10 %, they
 * read 0.9%. Only denominators built from 2s and 5s terminate, and only the
 * short ones are worth reading as a decimal; everything else stays stacked.
 */
export function exactDecimal(r: Rational, maxPlaces = MAX_EXACT_PLACES): string | null {
	let d = r.d;
	let twos = 0;
	let fives = 0;
	while (d % 2 === 0) {
		d /= 2;
		twos++;
	}
	while (d % 5 === 0) {
		d /= 5;
		fives++;
	}
	if (d !== 1) return null;

	const places = Math.max(twos, fives);
	if (places > maxPlaces) return null;
	const value = r.n / r.d;
	return places === 0 ? String(value) : value.toFixed(places);
}

/** `2500/19` split for display as `131` over the stacked `11/19`. */
export function mixedParts(r: Rational): MixedParts {
	const decimal = exactDecimal(r);
	if (decimal !== null) return { whole: decimal, numerator: null, denominator: null };

	const sign = r.n < 0 ? '-' : '';
	const n = Math.abs(r.n);
	const whole = Math.floor(n / r.d);
	const rem = n - whole * r.d;
	return {
		whole: whole ? `${sign}${whole}` : sign ? `${sign}0` : null,
		numerator: String(rem),
		denominator: String(r.d)
	};
}
