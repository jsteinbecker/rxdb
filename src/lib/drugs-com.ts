import { imprintFaces } from './spl-characteristics';

// ── Drugs.com addresses for a package ────────────────────────────────────────
// Built, never fetched. Drugs.com answers automated clients with 403 and its
// pill photos are licensed, so the app only hands the reader a link; their
// browser opens it. Two forms are stable enough to construct:
//
//   search.php?searchterm=<NDC>   leads with the package's own NDC panel
//                                 (labeler, strength, shape, colour, imprint)
//                                 and its pill-identifier matches.
//   imprints.php?imprint=<text>   the pill identifier's results for an
//                                 imprint, each with its photos.
//
// A product's own pill page (`/imprints/210-15991.html`) carries an internal
// ID that only their search reveals, so it is not built here.

const DRUGS_COM = 'https://www.drugs.com';

/** The NDC search, which Drugs.com resolves to the package. Accepts 5-4-2 with padding. */
export function drugsComNdcUrl(ndc11: string): string | null {
	if (!/^\d{11}$/.test(ndc11)) return null;
	const hyphenated = `${ndc11.slice(0, 5)}-${ndc11.slice(5, 9)}-${ndc11.slice(9)}`;
	return `${DRUGS_COM}/search.php?searchterm=${hyphenated}`;
}

// A segment that is only a layout word is the labeler transcribing "E over
// 410" into SPL (`E;over;410`), not text on the pill.
const LAYOUT_WORD = /^(?:over|above|below|under)$/i;

/**
 * An imprint as Drugs.com writes it. SPL separates faces and lines with
 * semicolons; Drugs.com writes the same imprint space-separated (`IP 464`).
 */
export function drugsComImprint(imprint: string | null): string {
	return imprintFaces(imprint)
		.filter((face) => !LAYOUT_WORD.test(face))
		.join(' ');
}

/** The pill identifier for an imprint. */
export function drugsComImprintUrl(imprint: string | null): string | null {
	const text = drugsComImprint(imprint);
	return text ? `${DRUGS_COM}/imprints.php?imprint=${encodeURIComponent(text).replace(/%20/g, '+')}` : null;
}
