/**
 * A package's strength as what the container holds, never a bare concentration.
 *
 * Directory strengths for liquids and constituted powders are concentrations
 * (`100 mg/mL`), which say nothing about how much drug a package is. A package
 * row reads its gross contents instead: the concentration times the volume the
 * container actually holds.
 *
 * - Liquids: the unit of use's volume (`100 mL in 1 VIAL`) → `10 g/100 mL`.
 * - Dry-fill powders: the volume the reconstituted vial yields, as the label
 *   settled it (`resolvedVolume.finalVolumeMl`); the packaging volume of a powder
 *   is often diluent added or bottle capacity (see `labels/dry-fill-volume.ts`),
 *   so it is never used. A powder reads as its mass alone: `10 g`.
 *
 * When no trustworthy volume exists the concentration is kept and the result
 * is marked `unresolved`, so callers can flag it rather than show it as if it
 * were a package's contents.
 *
 * @module
 */
import { parseStrengthParts } from './strength';
import { mlPer } from './units';

export type GrossStrengthSource = {
	size: { kind: 'volume' | 'mass' | 'count'; value: number; unit: string | null } | null;
	isDryFill?: boolean | null;
	resolvedVolume?: { finalVolumeMl: number | null } | null;
};

export type GrossStrength = {
	strength: string;
	/** `gross` was resolved; `unresolved` is still a concentration; `as-is` needed nothing. */
	basis: 'gross' | 'unresolved' | 'as-is';
};

const amount = (value: number) => String(Number(value.toPrecision(6)));

/** The package's volume in mL that a concentration can be multiplied by, or null. */
export function packageVolumeMl(source: GrossStrengthSource): number | null {
	if (source.isDryFill) return source.resolvedVolume?.finalVolumeMl || null;
	const { size } = source;
	if (size?.kind !== 'volume') return null;
	const scale = mlPer(size.unit);
	return scale && size.value > 0 ? size.value * scale : null;
}

/** `100 mg/mL` in a 100 mL vial → `10000 mg/100 mL`; a dry-fill powder → `10000 mg`. */
export function grossStrength(strength: string | null, source: GrossStrengthSource): GrossStrength | null {
	if (!strength) return null;
	const parsed = parseStrengthParts(strength);
	const perMl = parsed ? mlPer(parsed.perUnit) : null;
	if (!parsed || perMl === null) return { strength, basis: 'as-is' };
	const volume = packageVolumeMl(source);
	if (!volume) return { strength, basis: 'unresolved' };
	const total = (Number(parsed.value) * volume) / (Number(parsed.per) * perMl);
	const unit = parsed.unit;
	return {
		strength: source.isDryFill ? `${amount(total)} ${unit}` : `${amount(total)} ${unit}/${amount(volume)} mL`,
		basis: 'gross'
	};
}

/** Each ingredient restated as gross contents, and whether any stayed a bare concentration. */
export function grossIngredients<T extends { strength: string | null }>(
	ingredients: T[],
	source: GrossStrengthSource
): { ingredients: T[]; concentrationOnly: boolean } {
	let concentrationOnly = false;
	const out = ingredients.map((ingredient) => {
		const gross = grossStrength(ingredient.strength, source);
		if (!gross) return ingredient;
		if (gross.basis === 'unresolved') concentrationOnly = true;
		return { ...ingredient, strength: gross.strength };
	});
	return { ingredients: out, concentrationOnly };
}
