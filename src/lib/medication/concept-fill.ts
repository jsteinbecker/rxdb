/**
 * Filling package gaps from the formulary concept.
 *
 * Most packages on the formulary have never been enriched, so they carry no
 * ingredients and often only the dose form RxNorm gave their concept ("Oral
 * Tablet") instead of the label's ("TABLET, FILM COATED"). Grouped as-is, they
 * fall into a "Not specified" ingredient and a second dose-form vocabulary.
 *
 * Every package was pooled under an RxNorm clinical drug whose name already
 * states what is in it: `amoxicillin 500 MG Oral Capsule`. That is enough to
 * place the package without asking any provider:
 *
 * - Ingredients and strengths are read off the concept's name.
 * - A dose form RxNorm supplied is restated in the label (SPL) vocabulary: the
 *   form most of the item's own-labelled packages carry, among those the RxNorm
 *   form allows, else a fixed equivalent. An "Oral Tablet" may become
 *   "TABLET, FILM COATED" when its siblings say so, never a capsule.
 *
 * Facts a package states itself are never replaced; filled values are marked
 * `inferred` so a page can say where they came from.
 *
 * @module
 */

import type { FormularyRow } from '../formulary/hierarchy';
import { parseClinicalName } from './clinical-name';

type Ingredient = { name: string; strength: string | null };

/** The formulary fill adapter requires an unbranded clinical name with a dose form. */
export function parseScdName(name: string): { ingredients: Ingredient[]; doseForm: string } | null {
	const parsed = parseClinicalName(name);
	if (!parsed || parsed.brand || !parsed.doseForm) return null;
	const doseForm = parsed.doseForm
		.replace(/\((?:Bulk|\d+(?:\.\d+)?\s*(?:HR|HOURS?|DAYS?|WEEKS?|MONTHS?))\)/gi, '')
		.replace(/\s+/g, ' ')
		.trim();
	return doseForm
		? {
				ingredients: parsed.ingredients.map(({ name, text }) => ({
					name,
					strength: text
				})),
				doseForm
			}
		: null;
}

/**
 * RxNorm dose forms in the label vocabulary: the form to use when nothing
 * better is known, then every label form it may stand for.
 */
const RXNORM_TO_SPL: Record<string, [string, ...string[]]> = {
	'oral tablet': ['TABLET', 'TABLET, FILM COATED', 'TABLET, COATED', 'TABLET, SUGAR COATED'],
	'extended release oral tablet': [
		'TABLET, EXTENDED RELEASE',
		'TABLET, FILM COATED, EXTENDED RELEASE',
		'TABLET, MULTILAYER, EXTENDED RELEASE'
	],
	'delayed release oral tablet': ['TABLET, DELAYED RELEASE'],
	'chewable tablet': ['TABLET, CHEWABLE'],
	'disintegrating oral tablet': ['TABLET, ORALLY DISINTEGRATING'],
	'sublingual tablet': ['TABLET'],
	'oral capsule': ['CAPSULE', 'CAPSULE, GELATIN COATED', 'CAPSULE, LIQUID FILLED'],
	'extended release oral capsule': ['CAPSULE, EXTENDED RELEASE', 'CAPSULE, COATED PELLETS'],
	'delayed release oral capsule': ['CAPSULE, DELAYED RELEASE', 'CAPSULE, DELAYED RELEASE PELLETS'],
	'oral suspension': ['SUSPENSION', 'POWDER, FOR SUSPENSION'],
	'oral solution': ['SOLUTION', 'POWDER, FOR SOLUTION'],
	'injectable solution': ['INJECTION, SOLUTION', 'INJECTION', 'INJECTION, POWDER, FOR SOLUTION'],
	'injectable suspension': ['INJECTION, SUSPENSION', 'INJECTION, POWDER, FOR SUSPENSION'],
	injection: [
		'INJECTION',
		'INJECTION, SOLUTION',
		'INJECTION, POWDER, FOR SOLUTION',
		'INJECTION, POWDER, FOR SUSPENSION',
		'INJECTION, EMULSION'
	]
};

/**
 * The label forms an RxNorm dose form may stand for, or null when it is not one.
 * Label forms are upper-case and RxNorm's are not, which keeps the label's own
 * `INJECTION` apart from RxNorm's `Injection`.
 */
export function splFormsFor(doseForm: string): [string, ...string[]] | null {
	const form = doseForm.trim();
	if (form === form.toUpperCase()) return null;
	return RXNORM_TO_SPL[form.toLowerCase()] ?? null;
}

/**
 * One spelling per label form, for comparing them: the lyophilized process and
 * the legacy `FOR SUSPENSION` shorthand do not change what the package is.
 */
export function canonicalSplForm(doseForm: string): string {
	return doseForm
		.toUpperCase()
		.replace(/\bLYOPHILIZED\b/g, '')
		.replace(/^FOR (SUSPENSION|SOLUTION)\b/, 'POWDER, FOR $1')
		.replace(/\s*,\s*/g, ', ')
		.replace(/(?:,\s*)+/g, ', ')
		.replace(/\s+/g, ' ')
		.replace(/^,\s*|,\s*$/g, '')
		.trim();
}

/** The most common of `forms` among `candidates`, or null on no evidence or a tie. */
function plurality(forms: string[], candidates: string[]): string | null {
	const allowed = new Set(candidates);
	const counts = new Map<string, number>();
	for (const form of forms) if (allowed.has(form)) counts.set(form, (counts.get(form) ?? 0) + 1);
	const ranked = [...counts].sort((a, b) => b[1] - a[1]);
	if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return null;
	return ranked[0][0];
}

/** Rows with their missing ingredients and RxNorm-only dose forms filled from their concept. */
export function fillFromConcept(rows: FormularyRow[]): FormularyRow[] {
	const byItem = new Map<string, FormularyRow[]>();
	for (const row of rows) {
		const siblings = byItem.get(row.formularyItemId);
		if (siblings) siblings.push(row);
		else byItem.set(row.formularyItemId, [row]);
	}
	const filled = new Map<FormularyRow, FormularyRow>();
	for (const siblings of byItem.values()) {
		// Label forms the item's packages state themselves: the evidence for the rest.
		const labelled = siblings.flatMap((row) =>
			row.doseForm && !splFormsFor(row.doseForm) ? [canonicalSplForm(row.doseForm)] : []
		);
		for (const row of siblings) {
			// Per row: a bulk dry fill names its own content pseudo-SCD, not the item's concept.
			const concept = parseScdName(row.formularyItem);
			let next = row;
			if (concept && !row.ingredients.some((item) => item.name?.trim())) {
				next = {
					...next,
					ingredients: concept.ingredients,
					inferred: { ...next.inferred, ingredients: true }
				};
			}
			const rxnormForm = row.doseForm
				? splFormsFor(row.doseForm)
					? row.doseForm
					: null
				: concept?.doseForm;
			const candidates = rxnormForm ? splFormsFor(rxnormForm) : null;
			if (candidates) {
				const doseForm = plurality(labelled, candidates.map(canonicalSplForm)) ?? candidates[0];
				next = { ...next, doseForm, inferred: { ...next.inferred, doseForm: true } };
			}
			filled.set(row, next);
		}
	}
	return rows.map((row) => filled.get(row) ?? row);
}
