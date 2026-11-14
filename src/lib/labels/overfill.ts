/**
 * The amount a container delivers, when its label says the printed content
 * includes an overfill.
 *
 * Cathflo Activase prints `2.2 mg` of alteplase per vial, and that is what the
 * directory, the SPL and the title carry. The label explains the number: "Each
 * vial … contains 2.2 mg of Alteplase (which includes a 10% overfill) … Each
 * reconstituted vial will deliver 2 mg". A pharmacist asks for the 2 mg vial.
 *
 * The delivered amount is derived, never displayed in place of the printed
 * one (docs/strength-basis-rules.md §4). It is stored beside the printed
 * strength so search can find the package by the dose it gives.
 *
 * Read conservatively: the label must use the word overfill (or overage), name
 * one delivered amount in the printed unit, and that amount must sit just
 * under the printed content. Anything else is no evidence.
 *
 * Pure and shared, like $lib/labels/dual-chamber.ts.
 *
 * @module
 */

import { parseStrengthParts } from '../medication/strength';

const OVERFILL = /\bover(?:fill|age)\b/i;
/** "will deliver 2 mg", "delivers approximately 100 mg", "to deliver 50 mg". */
const DELIVERS =
	/\bdeliver(?:s|ed)?\s+(?:approximately\s+|about\s+|a\s+total\s+of\s+)?(\d+(?:\.\d+)?)\s*(mg|mcg|g|units?)\b/gi;
/** An overfill is a few percent of the content; a larger gap is a different statement. */
const MAX_OVERFILL = 1.3;

const UNITS: Record<string, string> = { mg: 'mg', mcg: 'mcg', g: 'g', unit: 'unit', units: 'unit' };

/**
 * `2 mg` for a printed `2.2 mg/2mL` whose label states the overfill and the
 * delivered amount, else null.
 */
export function deliveredAmount(printed: string | null, labelText: string | null): string | null {
	const content = parseStrengthParts(printed);
	if (!content || !labelText || !OVERFILL.test(labelText)) return null;
	const printedValue = Number(content.value);
	const printedUnit = UNITS[content.unit.toLowerCase()];
	const fits = new Set<number>();
	for (const match of labelText.matchAll(DELIVERS)) {
		const value = Number(match[1]);
		if (UNITS[match[2].toLowerCase()] !== printedUnit) continue;
		if (value < printedValue && printedValue <= value * MAX_OVERFILL) fits.add(value);
	}
	// Two candidates under one printed number: the label is about more than this vial.
	if (fits.size !== 1) return null;
	return `${[...fits][0]} ${content.unit}`;
}
