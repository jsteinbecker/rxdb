// ── Which company a package is "from", for grouping ──────────────────────────
// Labeler names arrive spelled however each SPL or directory row spelled them:
// `Teva Pharmaceuticals USA, Inc.`, `TEVA PHARMACEUTICALS INC`, `Teva, Inc.` are
// one company, and a hierarchy keyed on the raw string splits it three ways.
//
// Group by the distinctive part of the name: drop trailing words that only say
// what kind of legal entity or which national arm it is (Inc, LLC, USA…) and
// generic industry words (Pharmaceuticals, Laboratories…). Stripping is by
// whole trailing words and never empties the name, so anything that tells two
// firms apart — `Amneal Biosciences` vs `Amneal Pharmaceuticals`,
// `Fresenius Kabi` — is kept. "Pfizer Laboratories Div Pfizer Inc" names its
// division first; the part before `Div` is used.

/** Trailing words that say nothing about which company it is. */
const INCIDENTAL = new Set([
	// Legal form
	'inc',
	'incorporated',
	'llc',
	'lc',
	'ltd',
	'limited',
	'corp',
	'corporation',
	'co',
	'company',
	'plc',
	'lp',
	'llp',
	'gmbh',
	'ag',
	'sa',
	'sas',
	'srl',
	'spa',
	'bv',
	'nv',
	'ab',
	'as',
	'oy',
	'kg',
	'kk',
	'pty',
	'pvt',
	'private',
	'pte',
	// National arm
	'usa',
	'us',
	'america',
	'americas',
	'north',
	'na',
	'international',
	'intl',
	'global',
	// Industry words
	'pharmaceuticals',
	'pharmaceutical',
	'pharmaceutica',
	'pharma',
	'pharmaceutics',
	'laboratories',
	'laboratory',
	'labs',
	'lab',
	'industries',
	'holdings',
	// Connectives left dangling once the words after them go
	'and',
	'&',
	'of',
	'the'
]);

/** Words as compared: lower case, periods and stray punctuation removed. */
const token = (word: string) => word.toLowerCase().replace(/[.,'’()]/g, '');

/**
 * The name to group a labeler under, in its source words:
 * `Teva Pharmaceuticals USA, Inc.` → `Teva`, `Fresenius Kabi USA, LLC` →
 * `Fresenius Kabi`. Returns the input trimmed when nothing can be stripped.
 */
export function labelerGroup(name: string): string {
	const division = name.split(/\s+(?:div(?:\.|ision)?(?:\s+of)?)\s+/i)[0];
	const words = division
		.trim()
		.replace(/^the\s+/i, '')
		.split(/[\s,]+/)
		.map((word) => word.replace(/^[.,'’()]+|[,'’()]+$/g, ''))
		.filter((word) => token(word));
	while (words.length > 1 && INCIDENTAL.has(token(words.at(-1)!))) words.pop();
	return words.join(' ').replace(/\.$/, '') || name.trim();
}

/** Group key: two labelers with the same key are treated as one company. */
export const labelerKey = (name: string) => token(labelerGroup(name)).replace(/\s+/g, ' ');
