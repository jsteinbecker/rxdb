/**
 * The strict decimal strength grammar shared by every strength parser, and the
 * exact identity strengths are compared and classified by.
 *
 * @module
 */
import { mgPer, mlPer } from './units';

/** A normalized strength keeps decimal text until a consumer chooses its numeric representation. */
export type StrengthParts = {
	value: string;
	unit: string;
	per: string;
	perUnit: string;
};

const NUMBER = String.raw`(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)`;
const UNIT = String.raw`(?:[a-zµμ][a-z0-9µμ]*|%|\[[a-z]+\]|\{[a-z]+\})`;
const DENOMINATOR_UNIT = String.raw`(?:[a-zµμ][a-z0-9µμ]*|\[[a-z]+\]|\{[a-z]+\})`;
/** Also embedded by the clinical-name parser, so its strength grammar cannot drift. */
export const STRENGTH_PATTERN = String.raw`${NUMBER}\s*${UNIT}(?:(?:\s*\/\s*|\s+per\s+)(?:${NUMBER}\s*${DENOMINATOR_UNIT}?|${DENOMINATOR_UNIT}))?`;
const STRENGTH = new RegExp(
	String.raw`^\s*(${NUMBER})\s*(${UNIT})(?:(?:\s*\/\s*|\s+per\s+)(?:(${NUMBER})\s*(${DENOMINATOR_UNIT})?|(${DENOMINATOR_UNIT})))?\s*$`,
	'i'
);

/**
 * Dosage units and containers SPL listings use as a strength's denominator:
 * `5 g/1 VIAL` is 5 g in each vial, the same as `5 g/1` or `5 g`.
 */
const COUNT_UNITS = new Set([
	'1',
	'ampule',
	'ampul',
	'bag',
	'bottle',
	'capsule',
	'cartridge',
	'container',
	'each',
	'ea',
	'kit',
	'lozenge',
	'package',
	'packet',
	'patch',
	'pouch',
	'suppository',
	'syringe',
	'tablet',
	'troche',
	'tube',
	'unit',
	'vial',
	'wafer'
]);

/**
 * SPL appends a container's qualifier to the denominator (`5 g/1 VIAL, PHARMACY
 * BULK PACKAGE`, `1 g/1 VIAL, SINGLE-DOSE`), sometimes with its spaces lost
 * (`5g/1VIAL,PHARMACYBULKPACKAGE`). The packaging is already its own fact, so the
 * strength keeps only what precedes the comma.
 */
const withoutQualifier = (text: string) => text.replace(/\s*,\s*[a-z][a-z\s-]*$/i, '');

/** Reject ambiguous syntax and non-positive values, rather than parsing a valid prefix. */
export function parseStrengthParts(text: string | null | undefined): StrengthParts | null {
	const parts = parseStrict(text == null ? text : withoutQualifier(text));
	if (!parts || !COUNT_UNITS.has(parts.perUnit.toLowerCase()) || Number(parts.per) !== 1)
		return parts;
	return { ...parts, perUnit: '' };
}

/** The canonical spelling of a unit: `ML` → `mL`, `MG` → `mg`; others lowercase. */
export function unitLabel(unit: string): string {
	const lower = unit.toLowerCase();
	if (mlPer(lower) !== null) return lower === 'l' ? 'L' : lower.replace(/l$/, 'L');
	if (/^\[.*\]$|^\{.*\}$/.test(unit)) return unit;
	return lower;
}

function parseStrict(text: string | null | undefined): StrengthParts | null {
	const match = text?.match(STRENGTH);
	if (!match) return null;
	const value = match[1].replaceAll(',', '');
	const per = (match[3] ?? '1').replaceAll(',', '');
	if (
		!Number.isFinite(Number(value)) ||
		Number(value) <= 0 ||
		!Number.isFinite(Number(per)) ||
		Number(per) <= 0
	)
		return null;
	return { value, unit: match[2], per, perUnit: match[4] ?? match[5] ?? '' };
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

/** Exact decimal components; provider decimals never pass through a rounded number. */
function decimalRatio(value: string | number): [bigint, bigint] {
	const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value).replace(/^\./, '0.'))!;
	const fraction = match[2] ?? '';
	const exponent = Number(match[3] ?? 0);
	const numerator = BigInt(match[1] + fraction) * 10n ** BigInt(Math.max(exponent, 0));
	const denominator = 10n ** BigInt(fraction.length + Math.max(-exponent, 0));
	return [numerator, denominator];
}

function normalizedAmount(value: string, unit: string) {
	const [n, d] = decimalRatio(value);
	const mass = mgPer(unit);
	const scale = mass ?? mlPer(unit);
	const [sn, sd] = scale === null ? [1n, 1n] : decimalRatio(scale);
	return {
		n: n * sn,
		d: d * sd,
		unit: mass !== null ? 'mg' : scale !== null ? 'mL' : unit.toLowerCase() || '1'
	};
}

/** Shared exact identity for comparisons and classification keys; does not format a display label. */
export function strengthIdentity(text: string | null): string | null {
	const parsed = parseStrengthParts(text);
	if (!parsed) return null;
	const top = normalizedAmount(parsed.value, parsed.unit);
	const bottom = normalizedAmount(parsed.per, parsed.perUnit);
	const n = top.n * bottom.d;
	const d = top.d * bottom.n;
	const divisor = gcd(n, d);
	return `${n / divisor}/${d / divisor} ${top.unit}/${bottom.unit}`;
}
