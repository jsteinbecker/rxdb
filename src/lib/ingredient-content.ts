// Collection-only mass and dosage-form parsers ported from MedPool.
const UNIT_TO_MG: Record<string, number> = {
	mcg: 0.001,
	ug: 0.001,
	mg: 1,
	g: 1000,
	gm: 1000,
	kg: 1_000_000
};

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
	const scale = UNIT_TO_MG[match[2].toLowerCase()];
	if (!Number.isFinite(value) || value <= 0 || scale === undefined) return null;
	return value * scale;
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
