/**
 * Unit factors shared by every parser, so no two agree on what "gm" or "µg"
 * means. Keys are lowercase; look units up through `mgPer`/`mlPer`.
 * `quantity.ts` keeps its own exact rational factors for arithmetic.
 *
 * @module
 */

const MG_PER: Readonly<Record<string, number>> = {
	ng: 1e-6,
	mcg: 1e-3,
	ug: 1e-3,
	µg: 1e-3,
	μg: 1e-3,
	mg: 1,
	milligram: 1,
	milligrams: 1,
	g: 1e3,
	gm: 1e3,
	gram: 1e3,
	grams: 1e3,
	kg: 1e6
};

const ML_PER: Readonly<Record<string, number>> = {
	ul: 1e-3,
	µl: 1e-3,
	ml: 1,
	dl: 100,
	l: 1e3
};

/** Milligrams in one of `unit`, or null when it is not a mass unit. */
export const mgPer = (unit: string | null | undefined): number | null =>
	(unit && MG_PER[unit.toLowerCase()]) || null;

/** Millilitres in one of `unit`, or null when it is not a volume unit. */
export const mlPer = (unit: string | null | undefined): number | null =>
	(unit && ML_PER[unit.toLowerCase()]) || null;

/** `value` of a mass unit in milligrams, or null when the unit is not a mass. */
export function toMg(value: number, unit: string | null | undefined): number | null {
	const factor = mgPer(unit);
	return factor === null ? null : value * factor;
}
