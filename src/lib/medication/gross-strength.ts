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
 * - Otherwise the formulary item (SCD) settles it: a quantity it names
 *   (`250ML Injection`), or its whole amount over the concentration
 *   (`10000 MG` at `100 mg/mL` → 100 mL); and an oral powder for suspension's
 *   bottle volume is its constituted volume.
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
	/** The formulary item (SCD) name, e.g. `vancomycin 10000 MG Injection`: its quantity or total settles the volume. */
	itemName?: string | null;
	/** The package's dose form, e.g. `POWDER, FOR SUSPENSION`. */
	doseForm?: string | null;
};

export type GrossStrength = {
	strength: string;
	/** `gross` was resolved; `unresolved` is still a concentration; `as-is` needed nothing. */
	basis: 'gross' | 'unresolved' | 'as-is';
};

const amount = (value: number) => String(Number(value.toPrecision(6)));

const MG_PER: Record<string, number> = { mcg: 0.001, ug: 0.001, mg: 1, g: 1000 };

/** A volume the formulary item (SCD) states: `250ML Injection`, `2000 MG/400ML`. */
export function itemVolumeMl(name: string | null | undefined): number | null {
	const match = name?.match(/(?:^|[\s/])(\d[\d,]*(?:\.\d+)?)\s*(mL|L)\b/i);
	if (!match) return null;
	const value = Number(match[1].replaceAll(',', '')) * (mlPer(match[2]) ?? 0);
	return value > 0 ? value : null;
}

/** A whole amount the formulary item names (`10000 MG Injection`), not a concentration, in mg. */
function itemTotalMg(name: string | null | undefined): number | null {
	const amounts = [...(name ?? '').matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(mcg|ug|mg|g)\b(?!\s*\/)/gi)];
	if (amounts.length !== 1) return null;
	const [, value, unit] = amounts[0];
	return Number(value.replaceAll(',', '')) * MG_PER[unit.toLowerCase()];
}

/** The constituted volume is what an oral powder-for-suspension bottle is labeled with (`75 mL in 1 BOTTLE`). */
const isOralSuspensionPowder = (doseForm: string | null | undefined) =>
	!!doseForm && /for suspension/i.test(doseForm) && !/injection/i.test(doseForm);

function sizeVolumeMl(size: GrossStrengthSource['size']): number | null {
	if (size?.kind !== 'volume') return null;
	const scale = mlPer(size.unit);
	return scale && size.value > 0 ? size.value * scale : null;
}

/**
 * The package's volume in mL that a concentration can be multiplied by, or null.
 * `concentrationMgPerMl` lets a formulary item's total (`10000 MG`) imply it.
 */
export function packageVolumeMl(source: GrossStrengthSource, concentrationMgPerMl?: number | null): number | null {
	const fromItem = () => {
		const volume = itemVolumeMl(source.itemName);
		if (volume) return volume;
		const total = itemTotalMg(source.itemName);
		return total && concentrationMgPerMl ? total / concentrationMgPerMl : null;
	};
	if (source.isDryFill)
		return (
			source.resolvedVolume?.finalVolumeMl ||
			fromItem() ||
			(isOralSuspensionPowder(source.doseForm) ? sizeVolumeMl(source.size) : null)
		);
	return sizeVolumeMl(source.size) || fromItem();
}

/** `100 mg/mL` in a 100 mL vial → `10000 mg/100 mL`; a dry-fill powder → `10000 mg`. */
export function grossStrength(strength: string | null, source: GrossStrengthSource): GrossStrength | null {
	if (!strength) return null;
	const parsed = parseStrengthParts(strength);
	const perMl = parsed ? mlPer(parsed.perUnit) : null;
	if (!parsed || perMl === null) return { strength, basis: 'as-is' };
	const mgScale = MG_PER[parsed.unit.toLowerCase()];
	const mgPerMl = mgScale ? (Number(parsed.value) * mgScale) / (Number(parsed.per) * perMl) : null;
	const volume = packageVolumeMl(source, mgPerMl);
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
