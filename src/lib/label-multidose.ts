import { hyphenCandidates, type Ndc11 } from './ndc.js';

// ── Multi-dose resolution from SPL label text ────────────────────────────────
// Pass 2 of the ladder, for packages the NDC directory describes only as
// "VIAL". The answer lives in the HOW SUPPLIED section, which tabulates one row
// per package NDC:
//
//   "NDC ... 25021-321-04 1 mg per 4 mL Single-Dose Vial 10 vials per carton
//            25021-321-10 2.5 mg per 10 mL Multi-Dose Vial 10 vials per carton"
//
// Note that both tokens occur in that one document. A document-level regex
// would therefore answer *both* NDCs wrong in one direction or the other, so
// classification must be anchored on each package's own NDC and read only the
// text immediately following it.

const MULTI = /multi(?:ple)?[-\s]?dose/i;
const SINGLE = /single[-\s]?(?:dose|use)|unit[-\s]?dose/i;

/**
 * How far around an NDC occurrence to read. Layouts put the qualifier after the
 * NDC ("<ndc> 2.5 mg per 10 mL Multi-Dose Vial") more often than before it
 * ("10 mL Multi-Dose Vial, NDC <ndc>"), so the window is lopsided but not
 * one-sided.
 */
const LOOK_BACK = 40;
const LOOK_AHEAD = 140;

/**
 * Any package NDC, in any hyphenation. These delimit rows in a HOW SUPPLIED
 * table: a qualifier on the far side of another NDC describes *that* package,
 * so windows are clipped at the nearest one rather than run to a fixed width.
 * Stealing the neighbouring row's qualifier is the failure mode that matters —
 * it turns "unknown" into a confident wrong answer about a vial.
 */
const ANY_NDC = /\d{4,5}-\d{3,4}-\d{1,2}/g;

/**
 * The text around one NDC occurrence, clipped so it cannot cross into an
 * adjacent package's row, split at the anchor so each side can be weighed.
 */
function rowAround(text: string, anchorAt: number, anchorEnd: number) {
	const start = Math.max(0, anchorAt - LOOK_BACK);
	const end = Math.min(text.length, anchorEnd + LOOK_AHEAD);

	let from = start;
	let to = end;
	ANY_NDC.lastIndex = start;
	for (let match = ANY_NDC.exec(text); match && match.index < end; match = ANY_NDC.exec(text)) {
		if (match.index + match[0].length <= anchorAt) from = match.index + match[0].length;
		else if (match.index >= anchorEnd) {
			to = match.index;
			break;
		}
	}

	return {
		before: text.slice(from, anchorAt),
		after: text.slice(anchorEnd, to),
		// True when another package's NDC precedes ours inside the window.
		follows: from !== start
	};
}

/** Collapse whitespace so windows measure real text, not label formatting. */
const normalize = (text: string) => text.replace(/\s+/g, ' ');

function classifySide(side: string): boolean | null {
	const multi = side.search(MULTI);
	const single = side.search(SINGLE);

	if (multi === -1 && single === -1) return null;
	if (multi === -1) return false;
	if (single === -1) return true;
	// Both in one row: the qualifier nearest the NDC is the operative one.
	return multi < single;
}

function classifyRow({ before, after, follows }: ReturnType<typeof rowAround>): boolean | null {
	// Trailing qualifiers are the dominant layout, so `after` decides first.
	const trailing = classifySide(after);
	if (trailing !== null) return trailing;

	// Text preceding the NDC is only ours when no other package's NDC comes
	// first. In a table (`<ndc-a> ...desc-a... <ndc-b> ...desc-b...`) the text
	// before our NDC is the *previous* row's description; reading it would
	// report a neighbour's presentation as this package's.
	return follows ? null : classifySide(before);
}

/**
 * Resolve one package's multi-dose status from label text.
 *
 * Returns null when the text doesn't settle it — the label may not mention this
 * NDC, or may mention neither qualifier. Callers must keep that distinct from
 * `false`; "unknown" and "single-dose" are not the same claim about a vial.
 */
export function multiDoseFromLabel(text: string, ndc: Ndc11): boolean | null {
	const haystack = normalize(text);

	// Anchor on any hyphenation the label might have used for this package.
	const verdicts: (boolean | null)[] = [];
	for (const candidate of hyphenCandidates(ndc)) {
		let from = 0;
		for (;;) {
			const at = haystack.indexOf(candidate, from);
			if (at === -1) break;
			const end = at + candidate.length;
			from = end;
			verdicts.push(classifyRow(rowAround(haystack, at, end)));
		}
	}

	const decided = verdicts.filter((verdict): verdict is boolean => verdict !== null);
	if (decided.length) {
		// A package quoted in several places must be described consistently;
		// if the label contradicts itself we decline to pick a side.
		return decided.every((verdict) => verdict === decided[0]) ? decided[0] : null;
	}

	// A label that names our package and still declines to qualify it has told
	// us nothing we may generalize from: the qualifiers it does carry belong to
	// the other packages it tabulated.
	if (verdicts.length) return null;

	// The label never names this package at all. Fall back to the document only
	// when it is unanimous — one describing solely single-dose presentations
	// settles a package it forgot to tabulate.
	const anyMulti = MULTI.test(haystack);
	const anySingle = SINGLE.test(haystack);
	if (anyMulti !== anySingle) return anyMulti;
	return null;
}
