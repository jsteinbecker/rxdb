/**
 * What the label's prose says the pill looks like.
 *
 * The `<characteristic>` observations $lib/labels/spl-characteristics.ts decodes are
 * a coded summary; the labeler's own sentence in How Supplied or Dosage Forms
 * & Strengths is the original. It is usually richer — "light orange, oval,
 * biconvex, film-coated tablets debossed with 'M' over '25' on one side and
 * scored on the other" carries a two-line imprint, a face assignment and a
 * shade the coded `ORANGE` / `M;25` flattens — and where the two disagree the
 * prose is the one a pharmacist checks the bottle against.
 *
 * So this parses that prose into the same `PillAppearance` shape and lets it
 * win field by field over the coded observations. It is deliberately
 * tolerant: labelers write these sentences in every order, quote imprints
 * with any of four quote styles (or none), list several strengths in one
 * sentence, and put the NDCs that tell the strengths apart anywhere after.
 * Everything is pure; the same call runs on the server and in the browser.
 *
 * @module
 */
import { baseColor, COLOR_WORDS, imprintFaces, type PillAppearance } from './spl-characteristics';
import { splitShapeProportion } from '../imprints/shapes';

/** Label sections that describe the dosage unit, most authoritative first. */
export const APPEARANCE_SECTIONS = [
	'how_supplied',
	'dosage_forms_and_strengths',
	'storage_and_handling'
] as const;

/** Section keys → the name shown when a description came from one. */
export const SECTION_TITLES: Record<string, string> = {
	how_supplied: 'How Supplied',
	dosage_forms_and_strengths: 'Dosage Forms & Strengths',
	storage_and_handling: 'How Supplied'
};

/** One appearance sentence, decoded. Every field is optional, as in `PillAppearance`. */
export interface TextAppearance {
	/** The sentence (or clause) it was read from, tidied. */
	source: string;
	/** The section key it came from. */
	section: string;
	/** The dosage unit the sentence describes. */
	unit: 'tablet' | 'capsule' | 'softgel' | 'caplet' | 'lozenge' | 'other' | null;
	/** Strengths named alongside, normalised: `10 mg`, `2.5/25 mg`. */
	strengths: string[];
	/** NDC product codes (labeler-product, digits only, unpadded) listed for it. */
	ndcProducts: string[];
	colors: string[];
	colorText: string | null;
	shape: string | null;
	shapeText: string | null;
	sizeMm: number | null;
	score: number | null;
	/** SPL-style: faces joined by `;`, lines on one face joined by a space. */
	imprint: string | null;
	/** The label says the faces are blank, which is a fact too. */
	plain: boolean;
	/** The ink, for a printed imprint: `black`. */
	ink: string | null;
	/** Film-coated, sugar-coated, enteric-coated… */
	coating: string | null;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** Words that qualify a colour without changing its vocabulary term. */
const COLOR_MODIFIERS = new Set([
	'light',
	'dark',
	'pale',
	'deep',
	'bright',
	'medium',
	'mottled',
	'speckled',
	'opaque',
	'translucent',
	'transparent',
	'clear'
]);

/** Shape words → canonical shape terms `shapeGeometry` draws. Longer phrases first. */
const SHAPE_PHRASES: [RegExp, string][] = [
	[/\bcapsule[- ]shaped\b|\bcaplet[- ]shaped\b|\bcaplets?\b/, 'CAPSULE'],
	[/\bmodified[- ](?:capsule|oval)\b/, 'OVAL'],
	[/\boblong\b/, 'OBLONG'],
	[/\b(?:oval|ovaloid|ovoid|elliptical|ellipsoid|ellipse|almond[- ]shaped|almond)\b/, 'OVAL'],
	[/\bround(?:ed)?\b|\bcircular\b|\bdisc[- ]shaped\b/, 'ROUND'],
	[/\b(?:triangular|triangle|tri[- ]?angled)\b/, 'TRIANGLE'],
	[/\b(?:diamond|rhomboid|rhombus|lozenge[- ]shaped)\b/, 'DIAMOND'],
	[/\b(?:pentagonal|pentagon|five[- ]sided)\b/, 'PENTAGON'],
	[/\b(?:hexagonal|hexagon|six[- ]sided)\b/, 'HEXAGON'],
	[/\b(?:heptagonal|heptagon|seven[- ]sided)\b/, 'HEPTAGON'],
	[/\b(?:octagonal|octagon|eight[- ]sided)\b/, 'OCTAGON'],
	[/\bsquare\b/, 'SQUARE'],
	[/\b(?:rectangular|rectangle)\b/, 'RECTANGLE'],
	[/\b(?:heart[- ]shaped|heart)\b/, 'HEART'],
	[/\b(?:kidney[- ]shaped|kidney|bean[- ]shaped)\b/, 'KIDNEY'],
	[/\b(?:tear[- ]?drop|tear[- ]shaped)\b/, 'TEAR'],
	[/\b(?:semi[- ]?circular|semi[- ]?circle|half[- ]moon|d[- ]shaped)\b/, 'SEMI-CIRCLE'],
	[/\btrapezoid(?:al)?\b/, 'TRAPEZOID'],
	[/\bbullet[- ]shaped\b/, 'BULLET'],
	[/\bclover\b/, 'CLOVER'],
	[/\bbarrel[- ]shaped\b|\bbarrel\b/, 'BARREL'],
	[/\begg[- ]shaped\b/, 'EGG']
];

/** Profile words a labeler pairs with the outline; kept in `shapeText`. */
const PROFILE_WORDS =
	/\b(?:bi-?convex|convex|flat[- ]faced|flat|bevel(?:l?ed)?[- ]edged?|bevel(?:l?ed)?|beveled|concave|shallow|deep|curved|standard|modified)\b/g;

/** Hard-capsule sizes → overall closed length in mm (Capsugel nominal). */
const CAPSULE_SIZES: Record<string, number> = {
	'000': 26.1,
	'00el': 25.3,
	'00': 23.3,
	'0el': 23.1,
	'0': 21.7,
	'1': 19.4,
	'2': 18.0,
	'3': 15.9,
	'4': 14.3,
	'5': 11.1
};

const NUMBER_WORDS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	single: 1,
	double: 2
};

// ── Normalisation and segmentation ───────────────────────────────────────────

/** Unify quotes, dashes and whitespace so the patterns only meet one spelling. */
export function tidy(text: string): string {
	return text
		.replace(/[‘’‚‛′`´]/g, "'")
		.replace(/[“”„‟″]|''/g, '"')
		.replace(/[‐-―−]/g, '-')
		.replace(/ |\s+/g, ' ')
		.trim();
}

/**
 * Put back sentence stops that openFDA's flattening lost: a table row or a
 * list item runs straight into the next sentence ("…bottles of 100 tablets
 * The 50 mg tablets are pink…"). A capitalised sentence opener after a
 * lowercase word or a number, outside quotes, starts a new sentence.
 */
function restoreStops(text: string): string {
	return splitOutsideQuotes(text, '"')
		.map((part, i) =>
			i % 2
				? part
				: part.replace(
						/([a-z0-9)\]])\s+(?=(?:The|These|Each|Both|All|Other|They|It)\s+(?:\d|[a-z]))/g,
						'$1. '
					)
		)
		.join('"');
}

/** Whether a stretch of text names a dosage unit. */
const UNIT_RE =
	/\b(soft[- ]?gel(?:atin)?s?(?: capsules?)?|softgels?|tablets?|tabs?\b|caplets?|capsules?|lozenges?|troches?|chewables?|pastilles?|wafers?|pellets?)\b/i;

/** Cues that a sentence describes what the unit looks like, not how it is stored. */
const APPEARANCE_CUE =
	/\b(debossed|embossed|engraved|imprinted|printed|inscribed|bearing|marked|monogrammed|scored|bisect|plain|coated|biconvex|opaque|\d+(?:\.\d+)?\s*mm)\b/i;

/**
 * Split a section into sentences, keeping decimals, abbreviations (`No.`,
 * `approx.`, `U.S.P.`) and quoted imprints (`"M.10"`) intact.
 */
export function sentences(text: string): string[] {
	const out: string[] = [];
	let current = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		current += ch;
		if (ch === '"') quoted = !quoted;
		if (quoted || (ch !== '.' && ch !== ';' && ch !== '•')) continue;
		const next = text.slice(i + 1, i + 3);
		if (ch === '.') {
			const before = current.slice(0, -1);
			// 2.5, 0.5 — a decimal, not a sentence end.
			if (/\d$/.test(before) && /^\d/.test(next)) continue;
			// No., approx., e.g., U.S.P., Inc.
			if (/\b(?:no|nos|approx|e\.g|i\.e|vs|fig|ca|wt|sq|in|oz)$/i.test(before)) continue;
			// USP., Inc., Ltd. end a sentence when a capital follows.
			if (/\b(?:inc|ltd|co|corp|usp|u\.s|u\.s\.p|mfd)$/i.test(before) && !/^\s[A-Z]/.test(next))
				continue;
			if (/\b[A-Z]$/.test(before) && /^[A-Z]?\./.test(next)) continue;
			if (next && !/^\s/.test(next)) continue;
		}
		// A semicolon only splits a list of descriptions, handled by `clauses`.
		if (ch === ';') continue;
		out.push(current.trim());
		current = '';
	}
	if (current.trim()) out.push(current.trim());
	return out.filter(Boolean);
}

const STRENGTH_RE =
	/(\d+(?:[.,]\d+)?(?:\s*(?:mg|mcg|µg|g)?\s*\/\s*\d+(?:[.,]\d+)?)*)\s*(mg|mcg|µg|micrograms?|milligrams?|grams?|g|units?|IU|mEq|%)(?![a-z])/gi;

/** Normalise one strength match: `2.5 mg/25 mg` → `2.5/25 mg`. */
function normaliseStrength(amount: string, unit: string): string {
	const u = unit
		.toLowerCase()
		.replace(/^micrograms?$|^µg$/, 'mcg')
		.replace(/^milligrams?$/, 'mg')
		.replace(/^grams?$/, 'g')
		.replace(/^units?$/, 'unit');
	const numbers = amount
		.split('/')
		.map((part) => part.replace(/[a-zµ\s]/gi, '').replace(',', '.'))
		.filter(Boolean)
		.map((part) => String(Number(part)));
	return `${numbers.join('/')} ${u}`;
}

/** Every strength a stretch of text names. */
export function strengthsIn(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(STRENGTH_RE)) {
		// "8 mm" is a size; mm never matches the unit list, but "mg/mL" would.
		found.add(normaliseStrength(match[1], match[2]));
	}
	return [...found];
}

/** NDC labeler-product codes in a stretch of text, digits only and unpadded: `378-10`. */
export function ndcProductsIn(text: string): string[] {
	const out = new Set<string>();
	for (const match of text.matchAll(/\b(\d{4,5})-(\d{3,4})(?:-(\d{1,2}))?\b/g)) {
		out.add(`${Number(match[1])}-${Number(match[2])}`);
	}
	return [...out];
}

/**
 * A sentence listing several strengths' appearances, split one per strength.
 *
 * "The 5 mg tablets are white…; the 10 mg tablets are yellow…" and
 * "5 mg: white, round…, 10 mg: yellow, oval…" both become two clauses.
 * A sentence naming one strength (or none) is returned whole.
 */
export function clauses(sentence: string): string[] {
	const bySemicolon = splitOutsideQuotes(sentence, ';').filter((part) => part.trim());
	const pieces =
		bySemicolon.length > 1 && bySemicolon.filter((p) => describes(p)).length > 1
			? bySemicolon
			: [sentence];
	return pieces.flatMap(tableRows).flatMap((piece) => {
		// "10 mg: …" headings, or "Tablets, 10 mg - …".
		const starts = [
			...piece.matchAll(
				/(?:^|[,(]\s*|\s)(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)*\s*(?:mg|mcg|g)\b)\s*(?::|-\s)/gi
			)
		].map((m) => m.index! + m[0].indexOf(m[1]));
		if (starts.length < 2) return [piece.trim()];
		const parts = starts.map((start, i) =>
			piece
				.slice(start, starts[i + 1])
				.replace(/[,;\s]+$/, '')
				.trim()
		);
		return parts.every(describes) ? parts : [piece.trim()];
	});
}

/**
 * A How Supplied table flattened to text has no sentence breaks between its
 * rows: "10 mg … 58151-155-77 white tablets debossed with "10" … 20 mg …
 * 58151-156-77 white tablets debossed with "20" …". When a piece holds more
 * than one imprint description, each row after the first starts at the first
 * strength (or failing that, NDC) after the previous row's imprint verb.
 */
function tableRows(piece: string): string[] {
	const blanked = stripQuotedKeepingLength(piece);
	const verbs = [...blanked.matchAll(/\b(?:debossed|imprinted|engraved|printed|embossed)\b/gi)].map(
		(m) => m.index!
	);
	if (verbs.length < 2) return [piece];
	const cuts: number[] = [];
	for (let i = 1; i < verbs.length; i++) {
		const between = blanked.slice(verbs[i - 1], verbs[i]);
		const start =
			/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g)\b/i.exec(between) ??
			/\b\d{4,5}-\d{3,4}(?:-\d{1,2})?\b/.exec(between);
		// No strength or NDC between them: the same row's second verb
		// ("debossed "E" on one side and debossed "411" on the other").
		if (!start) continue;
		cuts.push(verbs[i - 1] + start.index);
	}
	if (!cuts.length) return [piece];
	const rows = [0, ...cuts].map((start, i) => piece.slice(start, cuts[i]).trim());
	return rows.every(describes) ? rows : [piece];
}

/** Quoted text replaced by spaces, so indexes still line up with the original. */
const stripQuotedKeepingLength = (text: string): string =>
	text.replace(/"[^"]*"/g, (m) => ' '.repeat(m.length));

function splitOutsideQuotes(text: string, sep: string): string[] {
	const out: string[] = [];
	let quoted = false;
	let current = '';
	for (const ch of text) {
		if (ch === '"') quoted = !quoted;
		if (ch === sep && !quoted) {
			out.push(current);
			current = '';
		} else current += ch;
	}
	out.push(current);
	return out;
}

/** Whether a clause reads like an appearance description. */
const describes = (text: string): boolean =>
	(APPEARANCE_CUE.test(text) || colorPhrase(stripQuoted(text)) !== null) &&
	(UNIT_RE.test(text) || /\b(?:debossed|imprinted|engraved)\b/i.test(text));

/** Text with quoted imprints blanked, so `"RED"` is never read as a colour. */
const stripQuoted = (text: string): string => text.replace(/"[^"]*"/g, ' "" ');

// ── Field extractors ─────────────────────────────────────────────────────────

/** The dosage unit a clause describes. */
function unitOf(text: string): TextAppearance['unit'] {
	const match = UNIT_RE.exec(text)?.[1].toLowerCase() ?? '';
	if (!match) return null;
	if (/soft/.test(match)) return 'softgel';
	if (/caplet/.test(match)) return 'caplet';
	if (/capsule/.test(match)) return 'capsule';
	if (/tab|chewable/.test(match)) return 'tablet';
	if (/lozenge|troche|pastille/.test(match)) return 'lozenge';
	return 'other';
}

/** Remove ink phrases ("printed in black ink") so the ink is not read as the body. */
function withoutInk(text: string): { text: string; ink: string | null } {
	let ink: string | null = null;
	const cleaned = text
		.replace(
			/\b(?:in|with|using)\s+((?:(?:light|dark|edible|pharmaceutical|food[- ]grade)\s+)*([a-z-]+))\s+(?:edible\s+)?ink\b/gi,
			(_, __, color: string) => {
				ink ??= COLOR_WORDS[color.toLowerCase()] ?? null;
				return ' ';
			}
		)
		.replace(
			// "Printed black “TEVA” on cap", "imprinted in white": the imprint's colour, no "ink".
			/\b(?:imprinted|printed|marked|debossed)\s+(?:(?:in|with|using)\s+)?((?:(?:light|dark)\s+)?([a-z-]+))\b/gi,
			(whole, _, color: string) => {
				const mapped = COLOR_WORDS[color.toLowerCase()];
				if (!mapped) return whole;
				ink ??= mapped;
				return ' ';
			}
		)
		.replace(/\b([a-z-]+)\s+(?:edible\s+)?ink\b/gi, (whole, color: string) => {
			const mapped = COLOR_WORDS[color.toLowerCase()];
			if (!mapped) return whole;
			ink ??= mapped;
			return ' ';
		})
		.replace(
			// "imprint in black", "with black lettering", "a red band": marks on the
			// pill, not its body.
			/\b(?:(?:imprint(?:ed|ing)?|print(?:ed|ing)?|lettering|logo|markings?)\s+(?:(?:in|of)\s+)?((?:(?:light|dark)\s+)?([a-z-]+))|((?:(?:light|dark)\s+)?([a-z-]+))\s+(?:imprint|print(?:ing)?|lettering|letters|logo|markings?|text|bands?|stripes?|lines?))\b/gi,
			(whole, _a, after: string | undefined, _b, before: string | undefined) => {
				const color = (after ?? before ?? '').toLowerCase();
				const mapped = COLOR_WORDS[color];
				if (!mapped) return whole;
				// A band or stripe is drawn by nobody, but it is still not the body.
				if (!/band|stripe|line/i.test(whole)) ink ??= mapped;
				return ' ';
			}
		);
	return { text: withoutFill(cleaned), ink };
}

/**
 * Remove what a capsule is filled with ("containing a white to off-white
 * powder", "filled with yellow liquid") — the contents' colour is not the shell's.
 */
function withoutFill(text: string): string {
	return text.replace(
		/\b(?:contain(?:s|ing)?|filled\s+with|fill(?:ed)?\s+of)\b[^.;]*?\b(?:powder|granules?|granulate|pellets?|beads?|mini-?tablets?|liquid|solution|suspension|oil|gel|paste|fill|blend|microspheres?)\b/gi,
		' '
	);
}

/**
 * Words that start the imprint part of a description. A colour stated before
 * the first of them describes the body; one after it usually describes the marks.
 */
const IMPRINT_VERB =
	/\b(?:imprinted|printed|debossed|embossed|engraved|monogrammed|marked|bearing|inscribed|with\s+(?:the\s+)?imprint)\b/i;

/** The colour phrase of the body: read before the imprint verb when it says one there. */
function bodyColorPhrase(text: string): ColorPhrase | null {
	const at = text.search(IMPRINT_VERB);
	if (at > 0) {
		const before = colorPhrase(text.slice(0, at));
		if (before) return before;
	}
	return colorPhrase(text);
}

interface ColorPhrase {
	colors: string[];
	text: string;
}

/**
 * The colour words in a clause, in order, as the vocabulary terms and the
 * phrase the labeler wrote.
 *
 * Understands two-tone capsules in any of the usual phrasings — "a blue cap
 * and a white body", "blue/white capsules", "cap: blue; body: white", "with
 * a white body and blue cap" (body-first is reordered cap-first) — and
 * ranges ("white to off-white") collapse to their first term, since the
 * renderer can only draw one.
 */
export function colorPhrase(text: string): ColorPhrase | null {
	const lower = text.toLowerCase();
	const word = (w: string): string | undefined => COLOR_WORDS[w];

	// Cap and body stated separately.
	const capBody = (part: 'cap' | 'body') =>
		new RegExp(
			`(?:\\b((?:(?:${modsAlt})[- ])*(?:${colorWordsAlt})(?:[- ](?:${colorWordsAlt}))?)(?:\\s+(?:opaque|transparent|translucent|colou?red))*\\s+${part}\\b)|(?:\\b${part}\\s*(?:is|:|of|colou?r(?:ed)?)?\\s*(?:(?:${modsAlt})\\s+)*(${colorWordsAlt}))`,
			'i'
		);
	const cap = capBody('cap').exec(lower);
	const body = capBody('body').exec(lower);
	if (cap && body) {
		const capWords = (cap[1] ?? cap[2]).split(/[- ]/);
		const bodyWords = (body[1] ?? body[2]).split(/[- ]/);
		const capColor = shaded(capWords, capWords.map(word).filter(Boolean).at(-1));
		const bodyColor = shaded(bodyWords, bodyWords.map(word).filter(Boolean).at(-1));
		if (capColor && bodyColor) {
			return {
				colors: [capColor, bodyColor],
				text: `${tidyPhrase(cap[0])} and ${tidyPhrase(body[0])}`
			};
		}
	}

	// "blue/white", "blue and white", "white to off-white", "light blue".
	const re = new RegExp(
		`\\b((?:(?:${modsAlt})[- ])*(?:${colorWordsAlt})(?:[- ]colou?red)?)((?:\\s*(?:\\/|and|or|to|-|,)\\s*(?:(?:${modsAlt})[- ])*(?:${colorWordsAlt})(?:[- ]colou?red)?)*)\\b`,
		'gi'
	);
	for (const match of lower.matchAll(re)) {
		const phrase = match[0];
		// "and" between colours inside a list of attributes is two-tone only
		// for a capsule; "to"/"or" is a range of one colour.
		const isRange = /\b(?:to|or)\b/.test(phrase);
		const terms = phrase
			.split(/\s*(?:\/|\band\b|\bor\b|\bto\b|,)\s*|-(?=(?:[a-z]+)$)/)
			.map((part) => part.split(/[- ]/))
			.map((all) => {
				const words = all.filter((w) => !COLOR_MODIFIERS.has(w) && !/^colou?red$/.test(w));
				const joined = words.join('-');
				return shaded(
					all,
					COLOR_WORDS[joined] ??
						words
							.map((w) => COLOR_WORDS[w])
							.filter(Boolean)
							.at(-1)
				);
			})
			.filter((term): term is string => !!term);
		if (!terms.length) continue;
		const colors = isRange ? [terms[0]] : [...new Set(terms)];
		return { colors, text: tidyPhrase(phrase) };
	}
	return null;
}

const colorWordsAlt = Object.keys(COLOR_WORDS)
	.sort((a, b) => b.length - a.length)
	.map((w) => w.replace(/[-]/g, '[- ]?'))
	.join('|');
const modsAlt = [...COLOR_MODIFIERS].join('|');

/** A term marked dark when its phrase says so; `swatchOf` draws the shade. */
const shaded = (words: string[], term: string | undefined): string | undefined =>
	term && words.some((w) => w === 'dark' || w === 'deep') ? `dark ${term}` : term;

const tidyPhrase = (phrase: string): string => phrase.replace(/\s+/g, ' ').trim();

/** The outline and its profile words: `{ shape: 'OVAL', text: 'oval, biconvex' }`. */
export function shapePhrase(
	text: string,
	unit: TextAppearance['unit']
): { shape: string | null; text: string | null } {
	const lower = stripQuoted(text).toLowerCase();
	let shape: string | null = null;
	let at = -1;
	let word = '';
	for (const [re, term] of SHAPE_PHRASES) {
		const match = re.exec(lower);
		if (!match) continue;
		// "caplet" as the unit noun with another outline stated is not a shape.
		if (
			term === 'CAPSULE' &&
			/^caplets?$/.test(match[0]) &&
			SHAPE_PHRASES.some(([r, t]) => t !== 'CAPSULE' && r.test(lower))
		)
			continue;
		// "round" in "rounded edges" or "all-round" is not the outline.
		if (
			term === 'ROUND' &&
			/rounded\s+(?:edges?|corners?|ends?)/.test(lower.slice(match.index, match.index + 20))
		)
			continue;
		if (at === -1 || match.index < at) {
			shape = term;
			at = match.index;
			word = match[0];
		}
	}
	if (!shape && (unit === 'capsule' || unit === 'caplet')) shape = 'CAPSULE';
	const profiles = [...lower.matchAll(PROFILE_WORDS)]
		.map((m) => m[0])
		.filter((p) => p !== 'standard' && p !== 'modified' && p !== 'deep');
	const parts = [word, ...new Set(profiles)].filter(Boolean);
	return { shape, text: parts.length ? parts.join(', ') : null };
}

/** Longest dimension in mm, from "10.5 mm x 5.3 mm", "7/16 inch", or a capsule size. */
export function sizeOf(text: string, unit: TextAppearance['unit']): number | null {
	const lower = stripQuoted(text).toLowerCase();
	const dims: number[] = [];
	// 10.5 x 5.3 mm, 10.5 mm × 5.3 mm × 4 mm, 10.5 by 5.3 mm
	for (const m of lower.matchAll(
		/(\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:x|×|by)\s*(\d+(?:\.\d+)?)(?:\s*(?:mm\s*)?(?:x|×|by)\s*(\d+(?:\.\d+)?))?\s*(mm|millimet(?:er|re)s?|cm|inch(?:es)?|in\b|")/g
	)) {
		const scale = unitScale(m[4]);
		dims.push(...[m[1], m[2], m[3]].filter(Boolean).map((n) => Number(n) * scale));
	}
	for (const m of lower.matchAll(
		/(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(mm|millimet(?:er|re)s?|cm|inch(?:es)?\b|in\.|")/g
	)) {
		const n = m[1].includes('/')
			? Number(m[1].split('/')[0]) / Number(m[1].split('/')[1])
			: Number(m[1]);
		dims.push(n * unitScale(m[2]));
	}
	const plausible = dims.filter((d) => d >= 2 && d <= 35);
	if (plausible.length) return Math.round(Math.max(...plausible) * 10) / 10;
	if (unit === 'capsule') {
		const size =
			/\bsize\s*(?:#\s*)?(000|00\s*el|00|0\s*el|0|[1-5])\b|\b#\s*(000|00|0|[1-5])\b/.exec(lower);
		const key = (size?.[1] ?? size?.[2])?.replace(/\s+/g, '');
		if (key && CAPSULE_SIZES[key]) return CAPSULE_SIZES[key];
	}
	return null;
}

const unitScale = (u: string): number => (u.startsWith('cm') ? 10 : /^(?:in|")/.test(u) ? 25.4 : 1);

/** Pieces the score divides the tablet into, or 1 when the label says unscored. */
export function scoreOf(text: string): number | null {
	const lower = stripQuoted(text).toLowerCase();
	if (/\b(?:un-?scored|not scored|no score|without (?:a )?score|non-?scored)\b/.test(lower))
		return 1;
	if (
		/\b(?:quadri-?sect(?:ed|ing)?|quarter-?scored|cross-?scored|cross[- ]score|double[- ]bisect|scored into (?:four|4|quarters))\b/.test(
			lower
		)
	)
		return 4;
	if (
		/\b(?:tri-?sect(?:ed|ing)?|scored into (?:three|3|thirds)|two (?:score|break)[- ]?lines)\b/.test(
			lower
		)
	)
		return 3;
	const lines = /\b(one|two|three|single|double|\d)\s+(?:score|break(?:ing)?)[- ]?lines?\b/.exec(
		lower
	);
	if (lines) {
		const n = NUMBER_WORDS[lines[1]] ?? Number(lines[1]);
		if (n === 1) return 2;
		if (n === 2) return /cross|perpendicular/.test(lower) ? 4 : 3;
	}
	if (
		/\b(?:bisect(?:ed|ing)?|scored|score[- ]?line|break[- ]?line|half[- ]?scored|partial(?:ly)? scored|functional score|deep score)\b/.test(
			lower
		)
	)
		return 2;
	return null;
}

/** Where on the pill a mark sits. */
type Place = 'one' | 'other' | 'same' | 'both' | 'cap' | 'body' | null;

function placeOf(after: string): Place {
	const lead = /^\s*(?:above|over|below|under|beneath|next to|beside|followed by)\b/i.exec(after);
	if (lead) return placeOf(after.slice(lead[0].length).replace(/^\s*(?=on\b)/, ' ')) ?? 'same';
	const s = after
		.toLowerCase()
		.replace(/\s+of\s+the\s+(?:tablet|caplet|capsule|pill)\b/g, '')
		.slice(0, 60);
	if (
		/^\s*(?:on|across)?\s*(?:each|both)\s+(?:sides?|faces?|halves|the cap and (?:the )?body)/.test(
			s
		)
	)
		return 'both';
	if (
		/^\s*(?:,\s*)?(?:and\s+)?(?:on|over|across)?\s*(?:the\s+)?(?:(?:other|reverse|opposite|back|second|lower|bottom)\s+(?:side|face|surface)|other\b|reverse|back|underside)/.test(
			s
		)
	)
		return 'other';
	if (
		/^\s*(?:on|over|across)?\s*(?:the\s+)?(?:one|single|first|front|upper|top|obverse)\s+(?:side|face|surface)|^\s*on\s+(?:the\s+)?front\b/.test(
			s
		)
	)
		return 'one';
	if (/^\s*(?:on|over|across)?\s*(?:the\s+)?cap\b/.test(s)) return 'cap';
	if (/^\s*(?:on|over|across)?\s*(?:the\s+)?body\b/.test(s)) return 'body';
	if (/^\s*(?:above|over|below|under|beneath|next to|beside|followed by|with)\b/.test(s))
		return 'same';
	return null;
}

/** An imprint token as it would appear on the pill: quotes, brackets and trailing dots dropped. */
const cleanMark = (mark: string): string =>
	mark
		.replace(/^["'\s]+|["'\s,.]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();

interface Imprint {
	imprint: string | null;
	plain: boolean;
	scoreSide: boolean;
}

/**
 * The imprint, as SPL writes it: faces split on `;`, lines on one face kept
 * together with a space.
 *
 * Reads quoted marks first (`debossed with "M" over "25" on one side and
 * "G" on the other`), then unquoted ones after an imprint verb (`engraved
 * with 93 on one side and 7180 on the other`). Placement phrases decide the
 * face — `on one side`/`on the cap` is the first, `on the other`/`on the
 * body` the second, `above`/`over`/`below` the same face as the mark before.
 * A face that is "plain" or "scored" is dropped rather than imprinted.
 */
export function imprintOf(text: string): Imprint {
	const lower = text.toLowerCase();
	const plainBoth =
		/\b(?:plain|blank|no (?:imprint|markings?|debossing))\b(?:\s+on)?\s+both\s+(?:sides|faces)|\bno (?:imprint|markings?)\b|\bunimprinted\b|\bwithout (?:any )?(?:imprint|markings?)\b/.test(
			lower
		);
	const scoreSide =
		/\b(?:scored|bisect(?:ed)?|score)\s+on\s+the\s+(?:other|reverse|opposite)\b|(?:other|reverse)\s+side\s+(?:is\s+)?(?:scored|bisected)/.test(
			lower
		);

	const verb =
		/\b(?:debossed|de-bossed|embossed|engraved|imprinted|printed|inscribed|marked|monogrammed|bearing|stamped|identified)\b/i;
	const at = verb.exec(text);
	const region = at ? text.slice(at.index) : text;

	type Mark = { text: string; place: Place };
	const marks: Mark[] = [];

	// Quoted marks, each followed by its placement phrase.
	const quoted = [...region.matchAll(/"([^"]{1,40})"/g)];
	if (quoted.length && (at || /\b(?:with|on)\b/i.test(region))) {
		for (const q of quoted) {
			const after = region.slice(q.index! + q[0].length);
			const before = region.slice(Math.max(0, q.index! - 30), q.index!);
			let place = placeOf(after);
			// "…on one side with "X"" puts the place before the mark.
			if (!place) {
				const pre =
					/(?:on\s+(?:the\s+)?(one|other|reverse|front|back|cap|body)\s*(?:side|face|half)?\s*(?:with|and)?\s*)$/i.exec(
						before
					);
				if (pre)
					place = /other|reverse|back/.test(pre[1].toLowerCase())
						? 'other'
						: pre[1].toLowerCase() === 'cap'
							? 'cap'
							: pre[1].toLowerCase() === 'body'
								? 'body'
								: 'one';
			}
			marks.push({ text: cleanMark(q[1]), place });
		}
	} else if (at) {
		// Unquoted: the run of imprint-looking tokens after the verb.
		const rest = region
			.slice(at[0].length)
			.replace(/\b(?:the|a)\s+(?:score|bisect(?:ion)?|break)(?:\s+line)?\b/gi, '')
			.replace(/\s+of\s+the\s+(?:tablet|caplet|capsule|pill)\b/gi, '')
			.replace(/\s+/g, ' ');
		const tokenRe =
			/(?:\s+(?:with|in|as|the|letters?|numbers?|numerals?|characters?|text|code|word|logo of|a)\b)*\s*([A-Z0-9][A-Za-z0-9&+\-\/.]*(?:\s+(?!on\b|and\b|in\b|over\b|above\b|below\b|with\b)[A-Z0-9][A-Za-z0-9&+\-\/.]*)*)/y;
		let cursor = 0;
		while (cursor < rest.length && marks.length < 6) {
			tokenRe.lastIndex = cursor;
			const m = tokenRe.exec(rest);
			if (!m || !m[1] || /^(?:on|one|other|and|plain|both|a)$/i.test(m[1])) break;
			const mark = cleanMark(m[1]);
			// A sentence's next word ("They", "Bottles") is not an imprint.
			if (/^(?:[A-Z][a-z]{2,})$/.test(mark) && !/^(?:Logo)$/.test(mark) && marks.length) break;
			const after = rest.slice(m.index + m[0].length);
			marks.push({ text: mark, place: placeOf(after) });
			// Skip the placement and joining words between two marks.
			const filler =
				/^(?:\s*(?:,|and|above|over|below|under|beneath|with|on\s+(?:the\s+)?(?:one|other|reverse|opposite|front|back|cap|body|upper|lower|each|both)(?:\s+(?:side|face|half|surface)s?)?))+\s*/i.exec(
					after
				);
			const step = filler ? filler[0].length : 0;
			if (!step) break;
			cursor = m.index + m[0].length + step;
			if (/^(?:plain|scored|bisect|blank|nothing)/i.test(rest.slice(cursor))) break;
		}
	}

	const real = marks.filter(
		(m) => m.text && !/^(?:plain|blank|none|nothing|scored)$/i.test(m.text)
	);
	if (!real.length) return { imprint: null, plain: plainBoth, scoreSide };

	// Group into faces: a run of marks ends at the first one whose placement is
	// stated ("X" over "Y" on one side), and the whole run takes that placement.
	const faceA: string[] = [];
	const faceB: string[] = [];
	let run: string[] = [];
	let lastFace = faceA;
	for (const mark of real) {
		run.push(mark.text);
		if (mark.place === null || mark.place === 'same') continue;
		if (mark.place === 'both') {
			faceA.push(...run);
			faceB.push(...run);
		} else {
			lastFace = mark.place === 'other' || mark.place === 'body' ? faceB : faceA;
			lastFace.push(...run);
		}
		run = [];
	}
	if (run.length) {
		// Trailing unplaced marks: "X" and "Y" with "on the other side"
		// somewhere is SPL's own two-face convention; otherwise they share
		// the face before them.
		if (
			!faceA.length &&
			!faceB.length &&
			run.length === 2 &&
			/\b(?:on the other|reverse|opposite side)\b/i.test(region)
		) {
			faceA.push(run[0]);
			faceB.push(run[1]);
		} else lastFace.push(...run);
	}
	const faces = [faceA, faceB].filter((f) => f.length).map((f) => f.join(' '));
	return { imprint: faces.join(';') || null, plain: false, scoreSide };
}

function coatingOf(text: string): string | null {
	const m =
		/\b((?:film|sugar|enteric|aqueous|polymer|gelatin)[- ]coated|coated|uncoated|chewable|orally disintegrating|extended[- ]release|delayed[- ]release)\b/i.exec(
			text
		);
	return m ? m[1].toLowerCase() : null;
}

// ── Whole-section parsing ────────────────────────────────────────────────────

/** Decode one appearance clause. `null` when it says nothing drawable. */
export function parseAppearanceClause(clause: string, section = ''): TextAppearance | null {
	const text = tidy(clause);
	const unit = unitOf(text);
	const { text: noInk, ink } = withoutInk(stripQuoted(text));
	// Colour is read before the imprint verb where possible: "white tablets
	// debossed with GREEN" must not read GREEN, and the quoted marks are blank.
	const color = bodyColorPhrase(noInk);
	const shape = shapePhrase(text, unit);
	const imprint = imprintOf(text);
	let score = scoreOf(text);
	if (imprint.scoreSide && (score === null || score < 2)) score = 2;

	const found: TextAppearance = {
		source: text,
		section,
		unit,
		strengths: strengthsIn(stripQuoted(text)),
		ndcProducts: ndcProductsIn(text),
		colors: color?.colors ?? [],
		colorText: color?.text ?? null,
		shape: shape.shape,
		shapeText: shape.text,
		sizeMm: sizeOf(text, unit),
		score,
		imprint: imprint.imprint,
		plain: imprint.plain,
		ink,
		coating: coatingOf(text)
	};
	const substantive =
		found.colors.length > 0 ||
		found.imprint !== null ||
		found.sizeMm !== null ||
		(found.shape !== null && found.unit !== 'capsule');
	return substantive ? found : null;
}

/**
 * Every appearance description in a section's text, with the NDCs and
 * strengths that follow each attached to it.
 *
 * How Supplied typically reads "…tablets debossed with X. Bottles of 30
 * NDC 1234-5678-01; Bottles of 90 NDC 1234-5678-09. …tablets debossed with Y.
 * Bottles of 30 NDC 1234-5679-01." — so an NDC belongs to the nearest
 * description before it, and a strength stated only in a heading ("10 mg
 * Tablets") belongs to the description that follows.
 */
export function parseAppearanceSection(text: string, section = ''): TextAppearance[] {
	const out: TextAppearance[] = [];
	let pendingStrengths: string[] = [];
	// The section's own numbered heading is not part of the first sentence.
	const body = restoreStops(tidy(text)).replace(
		/^(?:\d+(?:\.\d+)*\s+)?[A-Z][A-Z\s/&,-]{6,}?(?=\s+[A-Z][a-z])/,
		''
	);
	for (const sentence of sentences(body)) {
		const parsed = clauses(sentence)
			.filter(describes)
			.map((clause) => parseAppearanceClause(clause, section))
			.filter((entry): entry is TextAppearance => entry !== null);
		if (!parsed.length) {
			// NDCs after a description are its packages.
			const ndcs = ndcProductsIn(sentence);
			const last = out.at(-1);
			if (last && ndcs.length) last.ndcProducts = [...new Set([...last.ndcProducts, ...ndcs])];
			const strengths = strengthsIn(sentence);
			if (strengths.length && !ndcs.length) pendingStrengths = strengths;
			continue;
		}
		for (const entry of parsed) {
			if (!entry.strengths.length && pendingStrengths.length === 1)
				entry.strengths = pendingStrengths;
		}
		pendingStrengths = [];
		out.push(...parsed);
	}
	return out;
}

// ── Matching and merging ─────────────────────────────────────────────────────

/** What is known about the package an appearance is being drawn for. */
export interface AppearanceContext {
	/** The package NDC, any hyphenation. */
	ndc?: string | null;
	/** Strengths of the package's active ingredients: `10 mg/1`, `2.5 MG`. */
	strengths?: (string | null | undefined)[];
	/** The package's dose form, to prefer a capsule description for a capsule. */
	doseForm?: string | null;
}

const alnum = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The labeler-product part of an NDC in any format: `00378-0010-01` → `378-10`. */
export function ndcProductOf(ndc: string | null | undefined): string | null {
	if (!ndc) return null;
	const parts = ndc.split('-');
	if (parts.length >= 2) return `${Number(parts[0])}-${Number(parts[1])}`;
	const digits = ndc.replace(/\D/g, '');
	if (digits.length === 11) return `${Number(digits.slice(0, 5))}-${Number(digits.slice(5, 9))}`;
	return null;
}

/** Package strengths normalised the same way the parser normalises them. */
function contextStrengths(context: AppearanceContext): Set<string> {
	const out = new Set<string>();
	const all: string[] = [];
	for (const raw of context.strengths ?? []) {
		if (!raw) continue;
		const s = raw
			.replace(/\s*\/\s*1\b/g, '')
			.replace(/\/\s*(?:1\s*)?(?:tablet|capsule|each|unit)\b/gi, '');
		for (const found of strengthsIn(s)) {
			out.add(found);
			all.push(found);
		}
	}
	// A combination product's description says "2.5/25 mg".
	if (all.length > 1) {
		const units = new Set(all.map((s) => s.split(' ')[1]));
		if (units.size === 1) out.add(`${all.map((s) => s.split(' ')[0]).join('/')} ${[...units][0]}`);
	}
	return out;
}

/**
 * How well a description fits an appearance and its package; higher is
 * better, and below 0 means it describes something else.
 */
function fit(
	description: TextAppearance,
	appearance: PillAppearance | null,
	context: AppearanceContext
): number {
	let score = 0;
	const product = ndcProductOf(context.ndc);
	if (product && description.ndcProducts.length)
		score += description.ndcProducts.includes(product) ? 50 : -40;

	if (appearance?.imprint && description.imprint) {
		const a = imprintFaces(appearance.imprint).map(alnum).sort().join('|');
		const b = description.imprint.split(';').map(alnum).sort().join('|');
		const tokensA = new Set(alnum(appearance.imprint.replace(/;/g, '')).split(''));
		if (a === b || alnum(appearance.imprint) === alnum(description.imprint)) score += 40;
		else {
			const bJoined = alnum(description.imprint);
			const aJoined = alnum(appearance.imprint);
			if (bJoined.includes(aJoined) || aJoined.includes(bJoined)) score += 25;
			else if ([...bJoined].filter((c) => tokensA.has(c)).length < bJoined.length / 2) score -= 30;
		}
	}

	const strengths = contextStrengths(context);
	if (strengths.size && description.strengths.length) {
		score += description.strengths.some((s) => strengths.has(s)) ? 20 : -20;
	}

	if (appearance?.colors.length && description.colors.length) {
		score += description.colors.some((c) => appearance.colors.map(baseColor).includes(baseColor(c)))
			? 8
			: -4;
	}
	if (appearance?.shape && description.shape) {
		// A corrected `LONG CAPSULE` still matches prose that says capsule-shaped.
		score += splitShapeProportion(appearance.shape).base === description.shape ? 4 : 0;
	}
	const form = (context.doseForm ?? '').toUpperCase();
	if (form && description.unit) {
		const capsuleForm = /CAPSULE/.test(form);
		const capsuleText = description.unit === 'capsule' || description.unit === 'softgel';
		if (
			capsuleForm !== capsuleText &&
			description.unit !== 'caplet' &&
			description.unit !== 'other'
		)
			score -= 15;
	}
	return score;
}

/** The best description for an appearance, or `null` when none clearly fits. */
export function matchDescription(
	descriptions: TextAppearance[],
	appearance: PillAppearance | null,
	context: AppearanceContext = {}
): TextAppearance | null {
	if (!descriptions.length) return null;
	const ranked = descriptions
		.map((description, order) => ({
			description,
			order,
			score: fit(description, appearance, context)
		}))
		.sort((a, b) => b.score - a.score || a.order - b.order);
	const [best, second] = ranked;
	if (best.score < 0) return null;
	// One description and nothing against it: it is this product's.
	if (descriptions.length === 1) return best.description;
	// Several and a tie: the label describes several products and nothing says which.
	if (second && second.score === best.score) {
		// Identical descriptions in two sections (How Supplied and DF&S) are not a conflict.
		const same = (x: TextAppearance, y: TextAppearance) =>
			x.imprint === y.imprint && x.colors.join() === y.colors.join() && x.shape === y.shape;
		return same(best.description, second.description) ? best.description : null;
	}
	return best.score >= 15 ? best.description : null;
}

/** All descriptions in a package's label sections, How Supplied first. */
export function labelDescriptions(
	sections: { key: string; text: string }[] | null | undefined
): TextAppearance[] {
	const out: TextAppearance[] = [];
	for (const key of APPEARANCE_SECTIONS) {
		for (const section of sections ?? []) {
			if (section.key === key && section.text)
				out.push(...parseAppearanceSection(section.text, key));
		}
	}
	return out;
}

/**
 * An appearance with the label's prose laid over its coded observations.
 *
 * The prose wins wherever it states a field: it is what the labeler wrote,
 * and the coded observation is a lossy transcription of it. Fields the prose
 * leaves out keep the coded value, and the photo reference always stays.
 */
export function mergeAppearance(
	appearance: PillAppearance | null,
	text: TextAppearance
): PillAppearance {
	const base: PillAppearance = appearance ?? {
		productCode: null,
		colors: [],
		colorText: null,
		shape: null,
		shapeCode: null,
		shapeText: null,
		sizeMm: null,
		score: null,
		imprint: null,
		image: null
	};
	// Fields corrected by hand stay as corrected.
	const kept = new Set(base.overridden ?? []);
	if (kept.has('colors')) text = { ...text, colors: [], colorText: null };
	if (kept.has('shape')) text = { ...text, shape: null, shapeText: null };
	if (kept.has('sizeMm')) text = { ...text, sizeMm: null };
	if (kept.has('score')) text = { ...text, score: null };
	if (kept.has('imprint')) text = { ...text, imprint: null, plain: false };
	const shapeChanged = text.shape !== null && text.shape !== base.shape;
	return {
		...base,
		colors: text.colors.length ? text.colors : base.colors,
		colorText: text.colorText ?? base.colorText,
		shape: text.shape ?? base.shape,
		shapeCode: shapeChanged ? null : base.shapeCode,
		shapeText: text.shapeText ?? (shapeChanged ? null : base.shapeText),
		sizeMm: text.sizeMm ?? base.sizeMm,
		score: text.score ?? base.score,
		imprint: text.imprint ?? (text.plain ? null : base.imprint),
		labelText: { section: text.section, text: text.source }
	};
}

/**
 * The appearances to draw for a package: each coded one refined by the
 * label's prose description of it, or — when the label coded none — the
 * prose description alone, if exactly one fits the package.
 */
export function refineAppearances(
	appearances: PillAppearance[],
	sections: { key: string; text: string }[] | null | undefined,
	context: AppearanceContext = {}
): PillAppearance[] {
	const descriptions = labelDescriptions(sections);
	if (!descriptions.length) return appearances;
	if (!appearances.length) {
		const only = matchDescription(descriptions, null, context);
		return only ? [mergeAppearance(null, only)] : [];
	}
	return appearances.map((appearance) => {
		const match = matchDescription(descriptions, appearance, context);
		return match ? mergeAppearance(appearance, match) : appearance;
	});
}
