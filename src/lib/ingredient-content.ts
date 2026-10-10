// Collection-only mass and dosage-form parsers ported from MedPool.
import { mgPer } from './units';

// `<value><unit>` immediately before the `/`, e.g. "12 g" in "12 g/60mL", or the
// whole string when there is no denominator at all ("12 G").
const NUMERATOR = /^\s*([\d.]+)\s*([A-Za-z]+)\s*(?:\/|$)/;

/**
 * Total mass of one ingredient per container, in mg. Returns null when the
 * strength isn't a recognized mass unit (e.g. an "IU" potency, or a value
 * openFDA left blank) — callers must treat that as "can't compare", never as
 * zero.
 */
export function parseIngredientMassMg(strength: string): number | null {
	const match = NUMERATOR.exec(strength);
	if (!match) return null;
	const value = Number(match[1]);
	const scale = mgPer(match[2]);
	if (!Number.isFinite(value) || value <= 0 || scale === null) return null;
	return value * scale;
}

// `1%`, `0.9 % w/v`: grams per 100 mL, the only percent that is a mass per volume.
const PERCENT_WV = /^\s*([\d.]+)\s*%\s*(?:\(?\s*w\s*\/\s*v\s*\)?)?\s*$/i;

/**
 * An ingredient's mass in mg, calculated where its strength allows: a plain
 * mass as stated, or a w/v percent multiplied out over the container volume
 * (1% in 20 mL is 10 mg/mL × 20 mL = 200 mg). Null when no mass can be worked
 * out — an IU potency, a percent with no volume — never zero.
 */
export function ingredientMassMg(strength: string | null, volumeMl: number | null = null): number | null {
	if (!strength) return null;
	const stated = parseIngredientMassMg(strength);
	if (stated !== null) return stated;
	const percent = PERCENT_WV.exec(strength);
	if (!percent || volumeMl === null || !(volumeMl > 0)) return null;
	const value = Number(percent[1]);
	return Number.isFinite(value) && value > 0 ? value * 10 * volumeMl : null;
}

// Matches openFDA `dosage_form` values where the numerator is a fixed fill
// content rather than a true concentration: any lyophilized product, and any
// powder that must be reconstituted before use. A plain "POWDER" with no
// "FOR SOLUTION/SUSPENSION" qualifier (e.g. an oral powder measured by scoop)
// is deliberately excluded — there the denominator may be a real serving size.
const DRY_FILL_FORM = /LYOPHILIZED|POWDER,\s*FOR\s+(SOLUTION|SUSPENSION|INJECTION)/i;

/** Whether a dosage form's declared strengths are fill content, not concentration. */
export const isDryFillForm = (dosageForm: string): boolean => DRY_FILL_FORM.test(dosageForm);

// Dose forms and dose-form groups whose products are given by injection — the
// only ones packaged in a vial or syringe whose content there is anything to
// assert. Matched against RxNorm DF/DFG wording, which writes the same product
// as `Injection` at one tier and `Injectable Solution` at another.
const INJECTABLE_FORM =
	/\bInject(?:ion|able)\b|\bPrefilled Syringe\b|\bPen Injector\b|\bAuto-Injector\b|\bCartridge\b/i;

/** Whether a dose form is dispensed in a vial whose content can be asserted. */
export const isVialForm = (doseForm: string): boolean => INJECTABLE_FORM.test(doseForm ?? '');

/** A dry-fill has no liquid volume before reconstitution. Preserve the label's
 * numerator as the per-vial amount; a per-volume denominator here is not the
 * package's physical capacity. The unmodified source remains in evidence.
 *
 * Exception: a pharmacy bulk package whose volume is well beyond the
 * denominator codes the *reconstituted concentration*, not the fill — Hospira
 * vancomycin 0409-5017 is `500 mg/5 mL` in a 100 mL bulk vial (10 g). Stripping
 * the denominator there would claim 500 mg per vial, so the concentration is
 * kept. Pass `bulkFillMl` only for pharmacy bulk packages: a single-dose vial's
 * volume can be headspace larger than the reconstitution volume.
 *
 * A per-millilitre denominator (`12 mg/mL`, `12 mg/1 mL`) is never a fill: it
 * is the reconstituted concentration. Anavip 66621-0790 lists `12 mg/mL` in a
 * `10 mL in 1 VIAL` — 120 mg per vial, not 12. With the package volume
 * (`fillVolumeMl`) known it is multiplied out; without it the concentration
 * is kept rather than asserting a per-vial amount the label doesn't give. */
export function absoluteFillStrength(
	strength: string | null,
	bulkFillMl: number | null = null,
	fillVolumeMl: number | null = null
): string | null {
	if (!strength) return strength;
	const match = strength.match(/^(.+?)\s*\/\s*(\d+(?:\.\d+)?)?\s*(mL|L|uL|µL)\s*$/i);
	if (!match) return strength;
	if (match[3].toLowerCase() === 'ml' && Number(match[2] ?? 1) === 1) {
		const amount = match[1].trim().match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
		if (fillVolumeMl === null || fillVolumeMl <= 0 || !amount) return strength;
		return `${Number((Number(amount[1]) * fillVolumeMl).toPrecision(12))} ${amount[2]}`;
	}
	if (bulkFillMl !== null) {
		const unit = match[3].toLowerCase();
		const perMl = Number(match[2] ?? 1) * (unit === 'l' ? 1000 : unit === 'ml' ? 1 : 0.001);
		if (perMl > 0 && bulkFillMl >= 2 * perMl) return strength;
	}
	return match[1].trim();
}

/**
 * A powder constituted into a liquid given by mouth (or any non-injectable
 * route): vancomycin "for Oral Solution", amoxicillin "for Oral Suspension".
 */
export const isOralDryFillForm = (dosageForm: string | null | undefined): boolean =>
	isDryFillForm(dosageForm ?? '') && !/\bINJECT/i.test(dosageForm ?? '');

/**
 * A tablet, capsule or other solid swallowed (or dissolved in the mouth) as
 * is. It is never constituted, so any dilution or volume a label seems to
 * offer for it belongs to a sibling product and is discarded.
 */
export const isOralSolidForm = (dosageForm: string | null | undefined): boolean =>
	/\b(?:TABLET|CAPSULE|CAPLET|LOZENGE|TROCHE|PASTILLE|PELLET|WAFER|GUM)S?\b/i.test(dosageForm ?? '') &&
	!/\bINJECT/i.test(dosageForm ?? '');

/**
 * The strength a dry-fill package should carry. An oral powder's per-volume
 * strength is always the constituted concentration — "250 mg/5mL" is what
 * every 5 mL of ANI's 80 mL vancomycin bottle will hold once mixed, not the
 * 250 mg the bottle contains (it holds 4 g) — so it is kept as stated. An
 * injectable dry fill follows `absoluteFillStrength`.
 */
export function dryFillStrength(
	strength: string | null,
	doseForm: string | null | undefined,
	bulkFillMl: number | null = null,
	fillVolumeMl: number | null = null
): string | null {
	return isOralDryFillForm(doseForm) ? strength : absoluteFillStrength(strength, bulkFillMl, fillVolumeMl);
}

/** The package volume in mL when the package is a pharmacy bulk package. */
export function pharmacyBulkFillMl(
	description: string | null | undefined,
	fillVolumeMl: number | null
): number | null {
	return fillVolumeMl !== null && /PHARMACY BULK/i.test(description ?? '') ? fillVolumeMl : null;
}
