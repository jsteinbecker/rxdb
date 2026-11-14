/**
 * NDC format plumbing.
 *
 * RxNorm hands us normalized 11-digit unhyphenated NDCs (`25021032104`).
 * openFDA indexes packages by their *labeled* hyphenated form, which may be
 * 4-4-2, 5-3-2, or 5-4-1 (`25021-321-04`). The 11-digit form is lossy: it
 * zero-pads whichever segment was short, so we cannot recover the original
 * hyphenation from it alone.
 *
 * Rather than spend a round-trip resolving each NDC, we expand an 11-digit NDC
 * into the (at most three) hyphenations that could have normalized to it and
 * OR all of them into the batch query. Non-existent candidates simply match
 * nothing. Results come back carrying their own `package_ndc`, which we
 * normalize back to 11 digits to key the response — so the mapping is exact
 * even though the query is speculative.
 *
 * @module
 */

/** Canonical key for an NDC everywhere in this app: 11 digits, no hyphens. */
export type Ndc11 = string;

const DIGITS_ONLY = /^\d{11}$/;

/** True for the canonical 11-digit unhyphenated form RxNorm returns. */
export const isNdc11 = (ndc: string): boolean => DIGITS_ONLY.test(ndc);

/** `50633011011` → `50633-0110-11`, the 5-4-2 form the app displays; anything else as given. */
export const formatNdc = (ndc: string): string =>
	isNdc11(ndc) ? `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}` : ndc;

/**
 * Normalize a hyphenated NDC (4-4-2, 5-3-2, 5-4-1, or already 5-4-2) to the
 * canonical 11-digit form by zero-padding each segment to 5-4-2.
 * Returns null for anything that isn't three numeric segments of a known shape.
 */
export function toNdc11(hyphenated: string): Ndc11 | null {
	const trimmed = hyphenated.trim();
	if (isNdc11(trimmed)) return trimmed;

	const segments = trimmed.split('-');
	if (segments.length !== 3) return null;
	if (segments.some((segment) => !/^\d+$/.test(segment))) return null;

	const [labeler, product, pkg] = segments;
	if (
		!['4-4-2', '5-3-2', '5-4-1', '5-4-2'].includes(
			segments.map((segment) => segment.length).join('-')
		)
	)
		return null;

	return labeler.padStart(5, '0') + product.padStart(4, '0') + pkg.padStart(2, '0');
}

/**
 * Every hyphenation that could normalize to this 11-digit NDC. A segment only
 * yields a shorter candidate when it actually carries a leading zero to drop,
 * so a fully-padded NDC produces just the 5-4-2 form.
 */
export function hyphenCandidates(ndc11: Ndc11): string[] {
	if (!isNdc11(ndc11)) return [];

	const labeler = ndc11.slice(0, 5);
	const product = ndc11.slice(5, 9);
	const pkg = ndc11.slice(9, 11);

	const candidates = [`${labeler}-${product}-${pkg}`];
	if (labeler.startsWith('0')) candidates.push(`${labeler.slice(1)}-${product}-${pkg}`);
	if (product.startsWith('0')) candidates.push(`${labeler}-${product.slice(1)}-${pkg}`);
	if (pkg.startsWith('0')) candidates.push(`${labeler}-${product}-${pkg.slice(1)}`);
	return candidates;
}

/** Canonical key for a labeler: the first 5 digits of the 11-digit NDC. */
export type LabelerCode = string;

/** The labeler segment of an 11-digit NDC, or null if it isn't one. */
export const labelerCode = (ndc11: Ndc11): LabelerCode | null =>
	isNdc11(ndc11) ? ndc11.slice(0, 5) : null;

/**
 * Every labeler segment that could have normalized to this 5-digit code.
 *
 * The same lossiness `hyphenCandidates` works around applies one segment up:
 * openFDA indexes `product_ndc` by the *labeled* segment, so Eli Lilly's `0002`
 * is stored as four digits and a query for the padded `00002` matches nothing.
 * Only a leading zero can have been added, so there are at most two candidates.
 */
export function labelerCandidates(code: LabelerCode): string[] {
	if (!/^\d{5}$/.test(code)) return [];
	return code.startsWith('0') ? [code, code.slice(1)] : [code];
}

/** Canonical key for a product: the first 9 digits (labeler + product) of an 11-digit NDC. */
export type ProductCode = string;

/**
 * The product segment of an 11-digit NDC, or null if it isn't one.
 *
 * Packages of one product differ only in how the same unit of use is boxed:
 * `0409-1234-01` and `0409-1234-25` are a lone 5 mL vial and a tray of
 * twenty-five of them. That shared innermost container is what lets a package
 * whose own description never resolved borrow a size from its siblings — see
 * `inferSiblingSizes` in $lib/presentations.ts.
 */
export const productCode = (ndc11: Ndc11): ProductCode | null =>
	isNdc11(ndc11) ? ndc11.slice(0, 9) : null;

/**
 * The 10-digit hyphenation printed on the package, recovered from the labeled
 * `product_ndc` openFDA returned (`0409-4887`). The package segment takes the
 * remaining digits. Null when the product code is missing or does not
 * normalize back to this NDC; callers can then fall back to `hyphenCandidates`.
 */
export function labeledNdc(ndc11: Ndc11, labeledProduct: string | null | undefined): string | null {
	if (!isNdc11(ndc11) || !labeledProduct || !/^\d+-\d+$/.test(labeledProduct)) return null;
	const pkgLength = 10 - labeledProduct.replace('-', '').length;
	if (pkgLength < 1 || pkgLength > 2) return null;
	const labeled = `${labeledProduct}-${ndc11.slice(11 - pkgLength)}`;
	return toNdc11(labeled) === ndc11 ? labeled : null;
}
