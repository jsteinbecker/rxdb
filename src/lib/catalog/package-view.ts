/**
 * The read projection of a package: fallbacks resolved once, so its title and its
 * grouping consume exactly the same facts.
 *
 * @module
 */
import type { ExternalPackage } from './types';
import { correctedIngredients, packageDisplayTitle } from './package-title';

export type ProductReadFacts = {
	doseForm: string | null;
	brandName: string | null;
	labelerName: string | null;
};

export type PackageReadFallbacks = {
	description?: string | null;
	linkedProduct?: ProductReadFacts | null;
	directoryProduct?: ProductReadFacts | null;
	directoryLabeler?: string | null;
	doseType?: string | null;
};

const knownLabeler = (name: string | null | undefined) =>
	name && !/^unknown labeler$/i.test(name) ? name : null;

/** Resolve read fallbacks once; title and grouping consume exactly the same package facts. */
export function packageView(
	item: ExternalPackage | undefined,
	fallback: PackageReadFallbacks = {}
) {
	const linked = fallback.linkedProduct;
	const listed = fallback.directoryProduct;
	const facts = {
		...item,
		description: item?.description ?? fallback.description ?? null,
		doseForm:
			item?.doseForm ??
			item?.details?.spl?.doseForm ??
			linked?.doseForm ??
			listed?.doseForm ??
			null,
		brandName: item?.brandName ?? linked?.brandName ?? listed?.brandName ?? null,
		genericName: item?.genericName ?? null,
		labelerName:
			item?.labelerName ??
			knownLabeler(linked?.labelerName) ??
			knownLabeler(listed?.labelerName) ??
			fallback.directoryLabeler ??
			null,
		size: item?.size ?? null,
		isMultiDose:
			item?.isMultiDose ?? (fallback.doseType ? fallback.doseType === 'multi-dose' : null)
	};
	return {
		facts,
		ingredients: correctedIngredients(facts),
		displayTitle: packageDisplayTitle(facts)
	};
}
