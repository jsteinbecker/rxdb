/**
 * Curated product sets: formulary items for products RxNorm never links to a
 * concept (Sterile Water for Injection), matched by search and resolved to their
 * package NDCs.
 *
 * @module
 */
import { toNdc11 } from '#lib/catalog/ndc.ts';
import type { FdaProduct } from '../providers/openfda';

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
/**
 * Saline flush syringes are often listed outside an NDA/ANDA (some makers list
 * them as unapproved drugs, the device-cleared ones under a 510(k)), so their set
 * also takes those categories.
 */
const FLUSH_CATEGORIES = new Set([...APPROVED, 'UNAPPROVED DRUG OTHER', 'PREMARKET NOTIFICATION']);
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

const names = (product: FdaProduct) => `${product.brand_name ?? ''} ${product.generic_name ?? ''}`;
const ingredientNames = (product: FdaProduct) =>
	(product.active_ingredients ?? []).map((ingredient) => ingredient.name?.toUpperCase() ?? '');
const hasSplSet = (product: FdaProduct) =>
	Array.isArray(product.openfda?.spl_set_id) && product.openfda.spl_set_id.length > 0;
const isFinishedRx = (product: FdaProduct, categories: Set<string>) =>
	product.product_type === 'HUMAN PRESCRIPTION DRUG' &&
	categories.has(product.marketing_category?.toUpperCase() ?? '') &&
	product.finished !== false &&
	/^INJECTION/i.test(product.dosage_form ?? '') &&
	!(product.route ?? []).some((route) => /IRRIGATION|INHALATION/i.test(route)) &&
	hasSplSet(product);
/** Words that make a bacteriostatic or saline product something else: a kit diluent, a flush, an irrigant. */
const NOT_PLAIN_DILUENT = /diluent|diluting|irrigat|inhalation|flush|kit/i;

/** Bacteriostatic Water for Injection: water with benzyl alcohol, for multi-dose diluting. */
export function isBacteriostaticWater(product: FdaProduct): boolean {
	const ingredients = ingredientNames(product);
	return (
		isFinishedRx(product, APPROVED) &&
		ingredients.length === 1 &&
		ingredients[0] === 'WATER' &&
		/bacteriostatic/i.test(names(product)) &&
		!NOT_PLAIN_DILUENT.test(names(product))
	);
}

/** Bacteriostatic 0.9% Sodium Chloride: saline with benzyl alcohol. */
export function isBacteriostaticSodiumChloride(product: FdaProduct): boolean {
	const ingredients = ingredientNames(product);
	return (
		isFinishedRx(product, APPROVED) &&
		ingredients.length === 1 &&
		ingredients[0] === 'SODIUM CHLORIDE' &&
		/bacteriostatic/i.test(names(product)) &&
		!NOT_PLAIN_DILUENT.test(names(product))
	);
}

/** 0.9%, however openFDA spells it ("9 mg/mL", "9 mg/1mL", ".9 g/100mL"); unstated counts. */
const isNormalSalineStrength = (strength?: string) =>
	!strength?.trim() ||
	/^(?:9 mg\/1? ?mL|0?\.9 g\/100 ?mL|90 mg\/10 ?mL|0?\.9 ?%)$/i.test(strength.trim());

/** A prefilled 0.9% sodium chloride flush syringe. */
export function isSalineFlush(product: FdaProduct): boolean {
	const ingredients = product.active_ingredients ?? [];
	const text = `${names(product)} ${(product.packaging ?? []).map((item) => item.description ?? '').join(' ')}`;
	return (
		isFinishedRx(product, FLUSH_CATEGORIES) &&
		ingredients.length === 1 &&
		ingredients[0].name?.toUpperCase() === 'SODIUM CHLORIDE' &&
		isNormalSalineStrength(ingredients[0].strength) &&
		/flush/i.test(names(product)) &&
		/syringe/i.test(text) &&
		!/bacteriostatic/i.test(names(product))
	);
}

/** Heparin lock flush, 10 or 100 units/mL (not a therapeutic heparin). */
export function isHeparinLockFlush(product: FdaProduct): boolean {
	const ingredients = product.active_ingredients ?? [];
	const strength = ingredients[0]?.strength ?? '';
	return (
		isFinishedRx(product, APPROVED) &&
		ingredients.length === 1 &&
		/^HEPARIN SODIUM$/i.test(ingredients[0].name ?? '') &&
		/flush/i.test(names(product)) &&
		/^(?:10|100) (?:\[USP'U\]|USP units?|units?)\/1? ?mL$/i.test(strength.trim())
	);
}

/** Cathflo Activase, alteplase 2 mg for catheter clearance; not Activase 50/100 mg. */
export function isCathflo(product: FdaProduct): boolean {
	const ingredients = ingredientNames(product);
	return (
		product.product_type === 'HUMAN PRESCRIPTION DRUG' &&
		product.marketing_category?.toUpperCase() === 'BLA' &&
		product.finished !== false &&
		ingredients.length === 1 &&
		ingredients[0] === 'ALTEPLASE' &&
		/cathflo/i.test(names(product)) &&
		hasSplSet(product)
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
	},
	{
		key: 'bwfi',
		name: 'Bacteriostatic Water for Injection',
		search: 'active_ingredients.name:"WATER" AND brand_name:"bacteriostatic"',
		qualifies: isBacteriostaticWater,
		aliases: ['bacteriostatic water', 'bacteriostatic water for injection', 'bwfi', 'bact water'],
		phrases: [/\bbacteriostatic water\b/, /\bbwfi\b/],
		excludes: /sodium|saline|chloride/,
		description:
			'Has no RxNorm clinical drug. Adds every listed, approved bacteriostatic water package from the openFDA NDC directory.'
	},
	{
		key: 'bns',
		name: 'Bacteriostatic 0.9% Sodium Chloride',
		search: 'active_ingredients.name:"SODIUM CHLORIDE" AND brand_name:"bacteriostatic"',
		qualifies: isBacteriostaticSodiumChloride,
		aliases: [
			'bacteriostatic saline',
			'bacteriostatic sodium chloride',
			'bacteriostatic normal saline',
			'bacteriostatic ns',
			'bns'
		],
		phrases: [/\bbacteriostatic (?:0 9 )?(?:sodium chloride|saline|normal saline|ns)\b/, /\bbns\b/],
		description:
			'Often has no RxCUI. Adds every listed, approved bacteriostatic sodium chloride package from the openFDA NDC directory.'
	},
	{
		key: 'saline-flush',
		name: '0.9% Sodium Chloride Flush Syringe',
		search:
			'active_ingredients.name:"SODIUM CHLORIDE" AND (brand_name:"flush" OR generic_name:"flush")',
		qualifies: isSalineFlush,
		// No 'sodium chloride flush' alias: a prefix match would offer it for a plain 'sodium chloride' search.
		aliases: [
			'saline flush',
			'ns flush',
			
			
			'flush syringe'
		],
		phrases: [/\b(?:saline|ns|sodium chloride|normal saline) flush\b/, /\bflush syringes?\b/],
		excludes: /heparin|bacteriostatic/,
		description:
			'Prefilled flushes are often unapproved or device-cleared and lack an RxNorm clinical drug. Adds every listed saline flush syringe package from the openFDA NDC directory.'
	},
	{
		key: 'heparin-flush',
		name: 'Heparin Lock Flush',
		search:
			'active_ingredients.name:"HEPARIN SODIUM" AND (brand_name:"flush" OR generic_name:"flush")',
		qualifies: isHeparinLockFlush,
		aliases: ['heparin flush', 'heparin lock flush', 'hep flush', 'heparin lock'],
		phrases: [/\bheparin (?:lock )?flush\b/, /\bhep flush\b/],
		description:
			'Adds every listed, approved heparin lock flush (10 and 100 units/mL) package from the openFDA NDC directory, kept apart from therapeutic heparin.'
	},
	{
		key: 'cathflo',
		name: 'Alteplase 2 mg (Cathflo Activase)',
		search: 'active_ingredients.name:"ALTEPLASE" AND brand_name:"cathflo"',
		qualifies: isCathflo,
		aliases: [
			'cathflo',
			'cathflo activase',
			'alteplase 2 mg',
			'alteplase 2mg',
			'tpa 2 mg',
			'tpa 2mg'
		],
		phrases: [/\bcathflo\b/, /\balteplase 2 ?mg\b/, /\btpa 2 ?mg\b/],
		description:
			'Its label prints 2.2 mg with overfill for a 2 mg dose, and its RxNorm link is unreliable. Adds the Cathflo Activase packages from the openFDA NDC directory.'
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
