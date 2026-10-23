/**
 * Which route, and with what?
 *
 * A reconstitution instruction is only half an answer without its purpose.
 * Ceftriaxone 1 g takes 2.1 mL of 1% lidocaine for a 350 mg/mL intramuscular
 * injection and 9.6 mL of Sterile Water for Injection for a 100 mg/mL
 * intravenous one: same vial, two instructions, and picking the wrong one is a
 * wrong-route error. Labels say which in the sentence ("For Intramuscular
 * Administration: reconstitute..."), in a heading above it, or in a table's
 * section row or column header. These helpers read the vocabulary; where to
 * look is the parsers' business.
 *
 * Pure and offline, like the parsers that call it.
 *
 * @module
 */

export const RECONSTITUTION_ROUTES = ['IM', 'IV', 'SC'] as const;
export type ReconstitutionRoute = (typeof RECONSTITUTION_ROUTES)[number];

/**
 * Abbreviations are matched case-sensitively: "iv" is too often something else,
 * and labels write the routes in capitals.
 */
const ROUTE_PATTERNS: [ReconstitutionRoute, RegExp, RegExp][] = [
	['IM', /\bintramuscular(?:ly)?\b/i, /\bI\.M\.|\bIM\b/],
	['IV', /\bintravenous(?:ly)?\b/i, /\bI\.V\.|\bIV\b/],
	['SC', /\bsubcutaneous(?:ly)?\b/i, /\bS\.C\.|\bSC\b|\bSQ\b/]
];

/** Routes a stretch of label text names, in canonical order. */
export function routesIn(text: string): ReconstitutionRoute[] {
	return ROUTE_PATTERNS.filter(
		([, word, abbreviation]) => word.test(text) || abbreviation.test(text)
	).map(([route]) => route);
}

/**
 * Diluent codes, most specific first. Each match is blanked out before the
 * next pattern runs, so "Bacteriostatic Water for Injection" is BWFI and not
 * also SWFI, and "0.45% Sodium Chloride" is not also NS.
 *
 * Lidocaine keeps its strength ("lidocaine 1%") because 1% and 2% are not
 * interchangeable; everything else is a fixed code.
 */
const DILUENT_PATTERNS: [string | ((match: RegExpExecArray) => string), RegExp][] = [
	['BWFI', /bacteriostatic\s+water(?:\s+for\s+injection)?/gi],
	['BNS', /bacteriostatic\s+(?:0\.9\s*%\s*)?sodium\s+chloride(?:\s+injection)?/gi],
	['SWFI', /(?:sterile\s+)?water\s+for\s+injection|\bS?WFI\b/gi],
	['½NS', /0\.45\s*%\s*sodium\s+chloride(?:\s+injection)?/gi],
	['NS', /(?:0\.9\s*%\s*)?sodium\s+chloride(?:\s+injection)?|normal\s+saline|\bNS\b/gi],
	['D5W', /5\s*%\s*dextrose(?:\s+injection)?|dextrose\s+5\s*%|\bD5W\b/gi],
	['LR', /lactated\s+ringer'?s?(?:\s+injection)?|\bLR\b/gi],
	[
		(match) => {
			const percent = match[1] ?? match[2];
			return percent ? `lidocaine ${percent}%` : 'lidocaine';
		},
		/(?:(\d+(?:\.\d+)?)\s*%\s*)?lidocaine(?:\s+(?:hydrochloride|hcl))?(?:\s+injection)?(?:,?\s*(\d+(?:\.\d+)?)\s*%)?/gi
	]
];

/** Diluents a stretch of label text names, in the order it names them. */
export function diluentsIn(text: string): string[] {
	const found: { at: number; code: string }[] = [];
	let remaining = text;
	for (const [code, pattern] of DILUENT_PATTERNS) {
		remaining = remaining.replace(pattern, (...args) => {
			const match = args.slice(0, -2) as unknown as RegExpExecArray;
			const at = args[args.length - 2] as number;
			found.push({ at, code: typeof code === 'string' ? code : code(match) });
			return ' '.repeat(match[0].length);
		});
	}
	return [...new Set(found.sort((a, b) => a.at - b.at).map((entry) => entry.code))];
}

/** A stored route list, canonical order, or undefined when empty. */
export const routeList = (
	routes: Iterable<ReconstitutionRoute>
): ReconstitutionRoute[] | undefined => {
	const set = new Set(routes);
	const ordered = RECONSTITUTION_ROUTES.filter((route) => set.has(route));
	return ordered.length ? ordered : undefined;
};

/** A stored diluent list, first-mention order, or undefined when empty. */
export const diluentList = (diluents: Iterable<string>): string[] | undefined => {
	const unique = [...new Set(diluents)];
	return unique.length ? unique : undefined;
};
