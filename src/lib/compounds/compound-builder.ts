/**
 * The compound builder's arithmetic: each line's dose = concentration × volume
 * solved exactly in rationals, the total volume, final concentrations, and the
 * save payload. Edits that cannot be honoured exactly are refused rather than
 * rounded.
 *
 * @module
 */
import {
	add,
	divide as div,
	isRational,
	multiply as mul,
	parseRational,
	rational,
	toNumber,
	type Rational
} from '../medication/rational';
import { convertQuantity, exactDecimal, parseQuantity } from '../medication/quantity';

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

/** Safe rational representation shared with all quantity arithmetic. */
export const isSafeRational = isRational;

/** `undefined`: nothing to compute; `null`: it cannot be computed exactly. */
type Computed = Rational | null | undefined;

function solve(line: Line, edited: Field): { line: Line; refused: boolean } {
	const unchanged = { line, refused: false };
	if (line.role === 'diluent') return unchanged;
	const { conc, dose, volume } = line;
	if (!positive(conc)) return unchanged;

	const volumeFromDose = (): Computed => (positive(dose) ? div(dose, conc) : undefined);
	const doseFromVolume = (): Computed => (positive(volume) ? mul(volume, conc) : undefined);
	const outcome = (key: 'volume' | 'dose', value: Computed) =>
		value === undefined
			? unchanged
			: value === null
				? { line, refused: true }
				: { line: { ...line, [key]: value }, refused: false };

	if (edited === 'dose') return outcome('volume', volumeFromDose());
	if (edited === 'volume') return outcome('dose', doseFromVolume());
	// Editing the concentration keeps the dose and moves the volume — or, with
	// no dose yet, keeps the volume and moves the dose.
	const volumeNow = volumeFromDose();
	return volumeNow !== undefined ? outcome('volume', volumeNow) : outcome('dose', doseFromVolume());
}

/**
 * The line after `edited` changed: dose = conc × volume, volume = dose ÷ conc.
 * Anything that cannot be computed exactly leaves the line as it was.
 */
export const solveLine = (line: Line, edited: Field): Line => solve(line, edited).line;

/**
 * `value` stored into `field` and the dependent field solved — or null when
 * the edit cannot be honoured (not a safe fraction, or the solve is not
 * exact), so the caller keeps what was there rather than saving a number that
 * no longer agrees with its neighbours.
 */
export function applyEdit(line: Line, field: Field, value: Rational | null): Line | null {
	if (value && !isSafeRational(value)) return null;
	const { line: solved, refused } = solve({ ...line, [field]: value }, field);
	return refused ? null : solved;
}

/** The explicit total when there is a positive one, else the sum of the volumes, else null. */
export function effectiveTotalVolume(lines: Line[], total: Rational | null): Rational | null {
	if (positive(total)) return total;
	let sum: Rational = { n: 0, d: 1 };
	for (const line of lines) {
		if (!line.volume) continue;
		const next = add(sum, line.volume);
		if (!next) return null;
		sum = next;
	}
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
			? {
					slotId: line.slotId,
					label: line.label,
					role: line.role,
					amount: line.volume,
					unit: VOLUME_UNIT
				}
			: {
					slotId: line.slotId,
					label: line.label,
					role: line.role,
					amount: volume && line.dose ? div(line.dose, volume) : null,
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
	const value = rational(Number(mixed.whole ?? 0) * den + Number(mixed.num ?? 0), den);
	// The slot columns default to 0/1 when unset; stored values are always positive.
	return positive(value) ? value : null;
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
	if (typeof input !== 'string') return BAD;
	const parsed = parseRational(input);
	return parsed && parsed.n > 0 && isSafeRational(parsed) ? parsed : BAD;
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
