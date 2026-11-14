/**
 * Package text for display: dose forms in pharmacy shorthand (`TAB FC ER`) and
 * package descriptions and product names in readable case.
 *
 * @module
 */
import { canonicalSplForm, splFormsFor } from '../medication/concept-fill';

/** Pharmacy shorthand for each part of an SPL dose form. */
const FORM_PARTS: Record<string, string> = {
	TABLET: 'TAB',
	CAPSULE: 'CAP',
	'FILM COATED': 'FC',
	COATED: 'CTD',
	'SUGAR COATED': 'SC',
	'EXTENDED RELEASE': 'ER',
	'DELAYED RELEASE': 'DR',
	'ORALLY DISINTEGRATING': 'ODT',
	CHEWABLE: 'CHEW',
	EFFERVESCENT: 'EFF',
	MULTILAYER: 'ML',
	'LIQUID FILLED': 'LF',
	INJECTION: 'INJ',
	SOLUTION: 'SOLN',
	SUSPENSION: 'SUSP',
	POWDER: 'PWD',
	CONCENTRATE: 'CONC',
	EMULSION: 'EMUL',
	LIQUID: 'LIQ',
	GRANULE: 'GRAN',
	OINTMENT: 'OINT',
	CREAM: 'CRM',
	LOTION: 'LOT',
	SUPPOSITORY: 'SUPP',
	AEROSOL: 'AER',
	METERED: 'MTR',
	IRRIGANT: 'IRRIG',
	ELIXIR: 'ELIX',
	SYRUP: 'SYR',
	SHAMPOO: 'SHAMP'
};

/**
 * A dose form in pharmacy shorthand, base form first: `TABLET, FILM COATED,
 * EXTENDED RELEASE` → `TAB FC ER`. RxNorm names (`Extended Release Oral
 * Tablet`) read as their SPL form, so both spellings abbreviate alike.
 */
export function doseFormAbbreviation(doseForm: string): string {
	const spl = canonicalSplForm(splFormsFor(doseForm)?.[0] ?? doseForm);
	const parts = spl
		.split(/\s*[,/]\s*/)
		.map((part) => part.replace(/^FOR\s+/, ''))
		.filter(Boolean)
		.map(
			(part) =>
				FORM_PARTS[part] ??
				part
					.split(' ')
					.map((word) => FORM_PARTS[word] ?? word)
					.join(' ')
		);
	// An orally disintegrating tablet is just an ODT.
	if (parts[0] === 'TAB' && parts.includes('ODT')) parts.shift();
	return parts.join(' ');
}

/** Abbreviations that stay upper-case when a name or description is recased. */
const KEEP_UPPER = new Set([
	'XL',
	'XR',
	'ER',
	'SR',
	'CR',
	'DR',
	'LA',
	'CD',
	'ODT',
	'IR',
	'HCT',
	'USP',
	'NDC',
	'HDPE',
	'LDPE',
	'PVC',
	'IV',
	'IM',
	'II',
	'III',
	'DS',
	'ES',
	'PM',
	'HP'
]);
const SPECIAL: Record<string, string> = { HCL: 'HCl', HBR: 'HBr' };

/** All-caps words in a package description read lower-case: `30 tablet, film coated in 1 bottle`. */
export function packageDescriptionCase(description: string): string {
	return description
		.replace(/\b[A-Z][A-Z-]+\b/g, (word) => (KEEP_UPPER.has(word) ? word : word.toLowerCase()))
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * A product name in title case when its source shouted or whispered it
 * (`METOPROLOL TARTRATE`, `clonazepam`); a name already in mixed case is the
 * labeler's own spelling and stays.
 */
export function productNameCase(name: string): string {
	if (name !== name.toUpperCase() && name !== name.toLowerCase()) return name;
	return name.replace(/[A-Za-z]+/g, (word, offset: number, whole: string) => {
		const upper = word.toUpperCase();
		if (SPECIAL[upper]) return SPECIAL[upper];
		if (KEEP_UPPER.has(upper) && offset > 0) return upper;
		// Letters after a digit (`10mg`) or apostrophe stay lower.
		if (/[\d'’]$/.test(whole.slice(0, offset))) return word.toLowerCase();
		return upper[0] + word.slice(1).toLowerCase();
	});
}
