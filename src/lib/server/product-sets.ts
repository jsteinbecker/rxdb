import { toNdc11 } from '$lib/ndc';
import type { FdaProduct } from './catalog-providers';

/**
 * Curated product sets: formulary items for products RxNorm never links to a
 * concept (Sterile Water for Injection has no SCD, and most of its NDCs carry
 * no RxCUI). A set names its members by an openFDA NDC-directory search plus a
 * strict predicate, so only listed, approved products of that exact kind are
 * taken; each member package then goes through the normal provider sync and
 * eligibility ladder like any other load.
 */
export type ProductSet = {
	key: string;
	name: string;
	/** openFDA NDC-directory search that over-collects; `qualifies` narrows it. */
	search: string;
	qualifies: (product: FdaProduct) => boolean;
	/** What a searcher types for it: matched whole, or as a prefix of five letters or more. */
	aliases: string[];
	/** Phrases that name it inside a longer query (`sterile water 10 mL vial`). */
	phrases: RegExp[];
	/** A query naming a different product that merely mentions these words. */
	excludes?: RegExp;
	/** One line for the search result: what loading it adds. */
	description: string;
};

const APPROVED = new Set(['NDA', 'ANDA', 'NDA AUTHORIZED GENERIC']);
const NOT_PLAIN_WATER = /bacteriostatic|diluent|diluting|irrigat|inhalation/i;

/** A listed, NDA/ANDA, prescription, single-ingredient water injection labeled as sterile water. */
export function isSterileWaterForInjection(product: FdaProduct): boolean {
	const ingredients = product.active_ingredients ?? [];
	const names = `${product.brand_name ?? ''} ${product.generic_name ?? ''}`;
	return (
		product.product_type === 'HUMAN PRESCRIPTION DRUG' &&
		APPROVED.has(product.marketing_category?.toUpperCase() ?? '') &&
		product.finished !== false &&
		ingredients.length === 1 &&
		ingredients[0].name?.toUpperCase() === 'WATER' &&
		/^INJECTION/i.test(product.dosage_form ?? '') &&
		/sterile water/i.test(names) &&
		!NOT_PLAIN_WATER.test(names) &&
		!(product.route ?? []).some((route) => /IRRIGATION|INHALATION/i.test(route)) &&
		Array.isArray(product.openfda?.spl_set_id) &&
		product.openfda.spl_set_id.length > 0
	);
}

export const PRODUCT_SETS: ProductSet[] = [
	{
		key: 'swfi',
		name: 'Sterile Water for Injection',
		search: 'active_ingredients.name:"WATER"',
		qualifies: isSterileWaterForInjection,
		aliases: [
			'water',
			'sterile water',
			'sterile water for injection',
			'sterile water injection',
			'water for injection',
			'swfi',
			'wfi'
		],
		phrases: [/\bsterile water\b/, /\bwater for injection\b/, /\bs?wfi\b/],
		// Dextrose in water, bacteriostatic water and irrigation water are other products.
		excludes: /bacteriostatic|diluent|irrigat|inhal|dextrose|saline|sodium|\bd\d+w\b/,
		description:
			'Has no RxNorm clinical drug. Adds every listed, approved sterile water injection package from the openFDA NDC directory.'
	}
];

export const productSet = (key: string) => PRODUCT_SETS.find((set) => set.key === key) ?? null;

const normalized = (text: string) =>
	text
		.toLocaleLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/** Curated sets a search query names, so search can offer them though no source returns them. */
export function setsMatching(query: string): ProductSet[] {
	const q = normalized(query);
	if (!q) return [];
	return PRODUCT_SETS.filter(
		(set) =>
			!set.excludes?.test(q) &&
			(set.aliases.some((alias) => alias === q || (q.length >= 5 && alias.startsWith(q))) ||
				set.phrases.some((phrase) => phrase.test(q)))
	);
}

/** The 11-digit package NDCs of qualifying products, sample packages left out. */
export function setPackageNdcs(set: ProductSet, products: FdaProduct[]): string[] {
	const ndcs = products
		.filter(set.qualifies)
		.flatMap((product) => product.packaging ?? [])
		.filter((item) => !item.sample)
		.map((item) => toNdc11(item.package_ndc ?? ''))
		.filter((ndc): ndc is string => ndc !== null);
	return [...new Set(ndcs)].sort();
}
