import { loggedFetch } from './log';
import { balanceIon, ionDisplayName } from '../ions';
import { naturalCompare } from '../natural-sort';
import { type PackageFacts, parsePackageFacts } from './catalog-facts';
import type { PropertyOverride } from '../property-override-fields';
import { hyphenCandidates, labelerCandidates, toNdc11 } from '../ndc';
import {
	ingredientKeyOf,
	type IngredientKind,
	parseSplIngredients,
	type SplIngredient,
	type SplProduct,
	strengthText,
	withoutUnspecified
} from '../spl-ingredients';
import { type CheckedStrength, checkProductStrengths, type MoietyFactor } from '../spl-strength-checks';
import { appearancesByPackage, type PillAppearance } from '../spl-characteristics';
import { correctDoseForm, type DoseFormCorrection } from '../dose-form-correction';
import { reconstitutionFromLabel } from '../reconstitution';
import { type LabelBlock, labelSectionBlocks } from '../spl-sections';
import { dryFillStrength, isDryFillForm, pharmacyBulkFillMl } from '../ingredient-content';
import {
	type KitComposition,
	kitComposition,
	partContent,
	productsOfComposition
} from '../kit-parts';
import { parseUnitOfUse } from '../ndc-packaging';

const RXNAV = 'https://rxnav.nlm.nih.gov/REST';
const OPENFDA_NDC = 'https://api.fda.gov/drug/ndc.json';
const OPENFDA_LABEL = 'https://api.fda.gov/drug/label.json';
const DAILYMED_SPL = 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json';
const DAILYMED_DOCUMENT = 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls';
const DAILYMED_INFO = 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm';

/** DailyMed flags compliance-inactivated NDCs only on its HTML label page. */
export function inactivatedOnDailyMed(html: string, candidates: string[]): boolean {
	const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
	return candidates.some((code) =>
		new RegExp(`(^|[^\\d-])${code.replaceAll('-', '\\-')} \\(inactivated\\)`, 'i').test(text)
	);
}

export const MAX_CONCEPTS = 10;

export type SourcePayload = { source: string; nativeId: string; url: string; payload: unknown };
export type RxProperty = { name: string; value: string };
export type RxRelated = { rxcui: string; name: string; tty: string | null };
/** Everything RxNav says about a concrete drug concept beyond its identity. */
export type RxConceptDetails = {
	synonym: string | null;
	species: { human: boolean; vet: boolean } | null;
	ingredients: RxRelated[];
	brands: RxRelated[];
	doseForms: RxRelated[];
	/** Dose-form and group concepts the drug was reached through. */
	parents: RxRelated[];
	/** Brand/generic counterparts (SCD <-> SBD, GPCK <-> BPCK). */
	counterparts: RxRelated[];
	/** Branded concepts rolled up into this generic node, with the NDCs each contributed. */
	brandedProducts: (RxRelated & { ndcs: string[] })[];
	properties: RxProperty[];
	ndcCount: number;
};
export type RxConcept = {
	rxcui: string;
	name: string;
	tty: string | null;
	ndcs: string[];
	evidence: SourcePayload[];
	vetOnly: boolean | null;
	details?: RxConceptDetails;
};
export type LabelIngredient = {
	name: string;
	unii: string | null;
	kind: 'active' | 'inactive' | 'ionic';
	basis: string | null;
	strength: string | null;
	moieties: { name: string; unii: string | null }[];
	productCode: string | null;
	/** Why `strength` differs from what the label coded — see $lib/spl-strength-checks.ts. */
	strengthNotes?: string[];
	/** The kit part the ingredient is in: `GRAPE FLAVORED DILUENT (145 mL)`. */
	part?: string;
	/** Label-declared elemental content supplied by one or more salt ingredients. */
	ionicContent?: {
		element: string;
		massMg: number;
		mEq: number;
		sourceIngredients: string[];
		nonAdditive: true;
	};
};
/** Full provider detail for one package, beyond the facts that drive catalog rules. */
export type PackageDetails = {
	product: {
		productType: string | null;
		routes: string[];
		marketingCategory: string | null;
		applicationNumber: string | null;
		deaSchedule: string | null;
		marketingStartDate: string | null;
		listingExpirationDate: string | null;
		finished: boolean | null;
		pharmClasses: string[];
		/** Read-side only: set when pharm-class rules were applied to `pharmClasses`. */
		pharmClassResolution?: {
			source: string[];
			applied: { ruleId: string; mode: string; classes: string[] }[];
		};
		rxcuis: string[];
		uniis: string[];
		manufacturers: string[];
		splId: string | null;
	} | null;
	packaging: {
		marketingStartDate: string | null;
		sample: boolean | null;
		/** Every package of the same product the directory lists. */
		siblings: { ndc: string; description: string | null }[];
	} | null;
	label: {
		effectiveTime: string | null;
		version: string | null;
		setId: string | null;
		/** Set when the label was found through a sibling package's NDC. */
		siblingNdc?: string | null;
		/** `blocks` is the SPL's own structure for the section; `text` is openFDA's flattening. */
		sections: { key: string; title: string; text: string; blocks?: LabelBlock[] }[];
	} | null;
	spl: {
		version: string | null;
		publishedDate: string | null;
		doseForm: string | null;
		ingredients: LabelIngredient[];
		appearances: PillAppearance[];
		otherLabels: { setId: string; title: string | null }[];
		/** Set when this NDC has no SPL of its own and a sibling package's was used. */
		siblingNdc?: string | null;
	} | null;
	rxnav: {
		status: string | null;
		rxcui: string | null;
		conceptName: string | null;
		conceptStatus: string | null;
		history: {
			activeRxcui: string | null;
			originalRxcui: string | null;
			start: string | null;
			end: string | null;
		}[];
		properties: RxProperty[];
		packaging: string[];
	} | null;
};
/** A provider call that failed on the package's latest fetch. */
export type ProviderError = {
	source: 'openFDA' | 'DailyMed' | 'RxNav';
	status: number | null;
	message: string;
};

export type ExternalPackage = PackageFacts & {
	propertyOverrides?: Record<string, PropertyOverride>;
	/** Why a user kept this NDC off the formulary, set through the `manualExclusion` override. */
	manualExclusion?: string | null;
	listed: boolean | null;
	marketingEndDate: string | null;
	splPresent: boolean | null;
	splInactivated?: boolean | null;
	isVeterinary: boolean | null;
	complete: boolean;
	/** Providers that failed on the latest fetch; values they own may be stale or missing. */
	providerErrors?: ProviderError[];
	ndc: string;
	description: string | null;
	/** Imported form, or its evidence-backed correction; see `doseFormCorrection`. */
	doseForm: string | null;
	/** Set when `doseForm` was corrected; `from` keeps the imported value. */
	doseFormCorrection: DoseFormCorrection | null;
	brandName: string | null;
	genericName: string | null;
	labelerName: string | null;
	labelerCode: string | null;
	productCode: string | null;
	ingredients: { name: string; strength: string | null }[];
	rxcuiStatus: string | null;
	splSetId: string | null;
	splTitle: string | null;
	splXml: string | null;
	labelIngredients: LabelIngredientName[];
	details: PackageDetails | null;
	evidence: SourcePayload[];
};

const LABEL_SECTIONS: [string, string][] = [
	['boxed_warning', 'Boxed warning'],
	['indications_and_usage', 'Indications and usage'],
	['dosage_and_administration', 'Dosage and administration'],
	['dosage_forms_and_strengths', 'Dosage forms and strengths'],
	['contraindications', 'Contraindications'],
	['warnings_and_cautions', 'Warnings and precautions'],
	['adverse_reactions', 'Adverse reactions'],
	['drug_interactions', 'Drug interactions'],
	['use_in_specific_populations', 'Use in specific populations'],
	['description', 'Description'],
	['clinical_pharmacology', 'Clinical pharmacology'],
	['how_supplied', 'How supplied'],
	['storage_and_handling', 'Storage and handling'],
	['instructions_for_use', 'Instructions for use'],
	['package_label_principal_display_panel', 'Principal display panel']
];

const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Route words in short product names and dosage-form labels. */
export function routesFromProductText(text: string): string[] {
	const routes: [RegExp, string][] = [
		[/\b(?:intravenous|\bIV\b)\b/i, 'INTRAVENOUS'],
		[/\b(?:intramuscular|\bIM\b)\b/i, 'INTRAMUSCULAR'],
		[/\b(?:subcutaneous|\bSC\b|\bSQ\b)\b/i, 'SUBCUTANEOUS'],
		[/\binjection\s*,\s*powder\s*,?\s*for\s+solution\b/i, 'INJECTION'],
		[/\b(?:oral(?:\s+(?:use|administration))?|by mouth|per os|\bPO\b)\b/i, 'ORAL'],
		[/\b(?:topical|cutaneous|transdermal|onto the skin)\b/i, 'TOPICAL'],
		[/\b(?:intranasal|nasal\s+(?:spray|solution|gel|drops|administration|route|use))\b/i, 'NASAL'],
		[/\b(?:inhalation|inhaled|nebuliz(?:ed|ation))\b/i, 'RESPIRATORY (INHALATION)'],
		[
			/\b(?:ophthalmic\s+(?:solution|suspension|ointment|gel|drops|administration|route|use)|into the eye|ocular\s+(?:administration|route|use))\b/i,
			'OPHTHALMIC'
		],
		[/\b(?:otic|into the ear)\b/i, 'OTIC'],
		[
			/\b(?:rectal\s+(?:suppository|enema|solution|cream|gel|administration|route|use)|per rectum)\b/i,
			'RECTAL'
		],
		[
			/\b(?:vaginal\s+(?:tablet|cream|gel|insert|suppository|administration|route|use)|intravaginal)\b/i,
			'VAGINAL'
		],
		[/\b(?:buccal|oromucosal)\b/i, 'BUCCAL'],
		[/\bsublingual\b/i, 'SUBLINGUAL'],
		[/\bintradermal\b/i, 'INTRADERMAL'],
		[/\bintrathecal\b/i, 'INTRATHECAL'],
		[/\bintra-?articular\b/i, 'INTRA-ARTICULAR'],
		[/\bintraperitoneal\b/i, 'INTRAPERITONEAL'],
		[/\b(?:intraocular\s+(?:injection|administration|route|use)|into the eye)\b/i, 'INTRAOCULAR'],
		[/\burethral\s+(?:gel|solution|administration|route|use)\b/i, 'URETHRAL']
	];
	return routes.flatMap(([pattern, route]) => (pattern.test(text) ? [route] : []));
}

/** Route statements in long label prose. Incidental mentions of a body site,
 * infection, or another medicine do not establish how this product is given. */
export function routesFromLabelText(text: string): string[] {
	const routes: [RegExp, string][] = [
		[
			/\b(?:by mouth|per os|orally administered|administer(?:ed)? orally|for oral use|oral administration)\b/i,
			'ORAL'
		],
		[
			/\b(?:intravenously|by intravenous (?:infusion|injection)|intravenous (?:administration|infusion|injection|use|route))\b/i,
			'INTRAVENOUS'
		],
		[
			/\b(?:intramuscularly|by intramuscular injection|intramuscular (?:administration|injection|use|route))\b/i,
			'INTRAMUSCULAR'
		],
		[
			/\b(?:subcutaneously|by subcutaneous injection|subcutaneous (?:administration|injection|use|route))\b/i,
			'SUBCUTANEOUS'
		],
		[
			/\b(?:apply|applied|administer(?:ed)?|use)\b.{0,50}\b(?:topically|to the skin|onto the skin)\b|\bfor topical use\b/i,
			'TOPICAL'
		],
		[
			/\b(?:intranasally|administer(?:ed)? intranasally|for intranasal use|nasal administration|into (?:the )?nostrils)\b/i,
			'NASAL'
		],
		[
			/\b(?:inhaled|inhalation|nebuliz(?:ed|ation)|administer(?:ed)? by inhalation)\b/i,
			'RESPIRATORY (INHALATION)'
		],
		[
			/\b(?:ophthalmic administration|for ophthalmic use|administer(?:ed)? into (?:the )?eye|instill(?:ed)? into (?:the )?eye)\b/i,
			'OPHTHALMIC'
		],
		[
			/\b(?:otic administration|for otic use|administer(?:ed)? into (?:the )?ear|instill(?:ed)? into (?:the )?ear)\b/i,
			'OTIC'
		],
		[
			/\b(?:rectally|per rectum|rectal administration|for rectal use|administer(?:ed)? rectally)\b/i,
			'RECTAL'
		],
		[
			/\b(?:vaginally|intravaginally|vaginal administration|for vaginal use|administer(?:ed)? vaginally)\b/i,
			'VAGINAL'
		],
		[/\b(?:buccally|administer(?:ed)? buccally|for buccal use)\b/i, 'BUCCAL'],
		[/\b(?:sublingually|administer(?:ed)? sublingually|for sublingual use)\b/i, 'SUBLINGUAL'],
		[/\bintradermally\b/i, 'INTRADERMAL'],
		[/\bintrathecally\b/i, 'INTRATHECAL'],
		[/\bintra-?articularly\b/i, 'INTRA-ARTICULAR'],
		[/\bintraperitoneally\b/i, 'INTRAPERITONEAL'],
		[/\bintraocularly\b/i, 'INTRAOCULAR'],
		[/\b(?:for|via|by)\s+(?:the\s+)?urethral\s+(?:route|administration|use)\b/i, 'URETHRAL']
	];
	return routes.flatMap(([pattern, route]) => (pattern.test(text) ? [route] : []));
}

/** Fold the common FDA/RxNav spellings into one route vocabulary while
 * retaining unfamiliar provider values for review instead of dropping them. */
function normalizeRoutes(values: string[]): string[] {
	const aliases: [RegExp, string][] = [
		[/^(?:INTRAVENOUS|IV|INTRAVENOUS INFUSION)$/i, 'INTRAVENOUS'],
		[/^(?:INTRAMUSCULAR|IM)$/i, 'INTRAMUSCULAR'],
		[/^(?:SUBCUTANEOUS|SUBCUTAN|SC|SQ)$/i, 'SUBCUTANEOUS'],
		[/^(?:ORAL|BY MOUTH|PER OS|PO)$/i, 'ORAL'],
		[/^(?:TOPICAL|CUTANEOUS|TRANSDERMAL)$/i, 'TOPICAL'],
		[/^(?:NASAL|INTRANASAL)$/i, 'NASAL'],
		[
			/^(?:RESPIRATORY \(INHALATION\)|INHALATION|INHALATIONAL|INHALATION ROUTE)$/i,
			'RESPIRATORY (INHALATION)'
		],
		[/^(?:OPHTHALMIC|OCULAR)$/i, 'OPHTHALMIC'],
		[/^(?:OTIC|AURICULAR)$/i, 'OTIC'],
		[/^(?:RECTAL|PER RECTUM)$/i, 'RECTAL'],
		[/^(?:VAGINAL|INTRAVAGINAL)$/i, 'VAGINAL'],
		[/^(?:BUCCAL|OROMUCOSAL)$/i, 'BUCCAL'],
		[/^SUBLINGUAL$/i, 'SUBLINGUAL'],
		[/^INTRADERMAL$/i, 'INTRADERMAL'],
		[/^INTRATHECAL$/i, 'INTRATHECAL'],
		[/^INTRA[- ]?ARTICULAR$/i, 'INTRA-ARTICULAR']
	];
	const normalized = new Map<string, string>();
	for (const raw of values) {
		const value = raw.trim().replace(/\s+/g, ' ');
		if (!value) continue;
		const canonical = aliases.find(([pattern]) => pattern.test(value))?.[1] ?? value.toUpperCase();
		if (!normalized.has(canonical.toUpperCase()))
			normalized.set(canonical.toUpperCase(), canonical);
	}
	return [...normalized.values()];
}

/** Only use an SPL product form when its product or package identifiers name
 * this NDC. Some DailyMed search hits are multi-product SPLs with no package
 * match; borrowing their first form assigns a sibling's form to this NDC. */
/**
 * The SPL products that are this NDC: those listing the package itself, else those
 * with its product code. A label often lists only some package sizes of a product,
 * and the unlisted ones are still that product, not every product on the label.
 */
function splProductsForNdc(products: ReturnType<typeof parseSplIngredients>, ndc: string) {
	const listed = products.filter((item) =>
		[item.productCode, ...item.packageCodes].some((code) => code && toNdc11(code) === ndc)
	);
	if (listed.length) return listed;
	const codes = productCodesOf(ndc);
	return products.filter((item) => item.productCode && codes.includes(item.productCode));
}

function labelIngredientOf(
	ingredient: SplIngredient,
	checked: CheckedStrength,
	product: SplProduct,
	doseForm: string | null,
	dryFill: boolean,
	fillVolumeMl: number | null,
	bulkFillMl: number | null
): LabelIngredient {
	const productCode = product.productCode;
	const part = product.part
		? `${product.name ?? 'Kit part'}${product.part.amount !== null ? ` (${product.part.amount}${product.part.amountUnit ? ` ${product.part.amountUnit}` : ''})` : ''}`
		: null;
	// A kit part states its strength per its own measure: `1 g/1 g` of a 7.5 g
	// bottle of powder is 7.5 g. Read as written it says nothing about content.
	const content =
		product.part && ingredient.kind === 'active' ? partContent(checked, product.part) : null;
	if (content) {
		return {
			name: ingredient.name,
			unii: ingredient.unii,
			kind: ingredient.kind,
			basis: ingredient.basis,
			strength: `${content.value} ${content.unit}`,
			moieties: ingredient.moieties,
			productCode,
			strengthNotes: [
				...checked.corrections.map((correction) => correction.note),
				`Stated as ${strengthText(checked)} of the ${(product.doseForm ?? 'part').toLowerCase()}; the kit holds ${product.part!.amount} ${product.part!.amountUnit ?? ''}`.trim()
			],
			...(part ? { part } : {})
		};
	}
	const statedStrength = strengthText(checked);
	const totalStrength =
		!dryFill &&
		fillVolumeMl !== null &&
		checked.strength !== null &&
		checked.per !== null &&
		checked.per > 0 &&
		/^(?:mL|L)$/i.test(checked.perUnit ?? '')
			? `${Number(((checked.strength * fillVolumeMl * (checked.perUnit!.toLowerCase() === 'l' ? 0.001 : 1)) / checked.per).toPrecision(12))}${checked.strengthUnit ? ` ${checked.strengthUnit}` : ''}`
			: null;
	return {
		name: ingredient.name,
		unii: ingredient.unii,
		kind: ingredient.kind,
		basis: ingredient.basis,
		strength: dryFill
			? dryFillStrength(
					statedStrength,
					// The package's form, corrected where the SPL miscoded the powder as
					// its liquid; a kit's is `KIT`, so its part's form speaks for it.
					doseForm && !/\bKIT\b/i.test(doseForm) ? doseForm : product.doseForm,
					bulkFillMl,
					fillVolumeMl
				)
			: (totalStrength ?? statedStrength),
		moieties: ingredient.moieties,
		productCode,
		...(checked.corrections.length
			? { strengthNotes: checked.corrections.map((correction) => correction.note) }
			: {}),
		...(part ? { part } : {})
	};
}

/** The SPL document's own `<title>`, flattened: "Vancomycin Hydrochloride for Oral Solution, USP". */
function splDocumentTitle(xml: string | null): string | null {
	const raw = xml?.match(/<document\b[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const text = raw
		?.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
	return text || null;
}

/** GSRS's SODIUM CATION. */
const SODIUM_ION_UNII = 'LYR4M0NH37';

/** Extract a label-stated total sodium amount for the exact package NDC. */
function sodiumContentFromLabel(
	text: string | null,
	ndc: string,
	saltIngredients: string[]
): LabelIngredient | null {
	if (!text || !saltIngredients.length) return null;
	const plain = text
		.replace(/<[^>]*>/g, ' ')
		.replace(/&#x([\da-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/\s+/g, ' ');
	// "contains 2.5 mEq (57.5 mg) of sodium" or "contains 57.5 mg (2.5 mEq) of sodium".
	const declarations =
		/(?:contains|provides)\s+(?:([\d,.]+)\s*mEq\s*\(\s*([\d,.]+)\s*mg\s*\)|([\d,.]+)\s*mg\s*\(\s*([\d,.]+)\s*mEq\s*\))\s*(?:of\s+)?sodium\b/gi;
	const matches = [...plain.matchAll(declarations)];
	for (let index = 0; index < matches.length; index++) {
		const match = matches[index];
		const start = (match.index ?? 0) + match[0].length;
		const end = Math.min(matches[index + 1]?.index ?? start + 240, start + 240);
		const ndcMatch = plain.slice(start, end).match(/\bNDC\s*[:#]?\s*([\d-]{10,})/i);
		if (!ndcMatch || toNdc11(ndcMatch[1]) !== ndc) continue;
		const mEq = Number((match[1] ?? match[4]).replaceAll(',', ''));
		const massMg = Number((match[2] ?? match[3]).replaceAll(',', ''));
		if (!Number.isFinite(mEq) || mEq <= 0 || !Number.isFinite(massMg) || massMg <= 0) continue;
		const balance = balanceIon('sodium', massMg, mEq);
		return {
			name: ionDisplayName('sodium'),
			unii: SODIUM_ION_UNII,
			kind: 'ionic',
			basis: 'ion constituent (label total)',
			strength: `${massMg} mg (${mEq} mEq)`,
			moieties: [],
			productCode: null,
			...(balance && !balance.balanced
				? {
						strengthNotes: [
							`The label states ${massMg} mg and ${mEq} mEq of sodium, which disagree: ${massMg} mg is ${balance.expectedMEq} mEq`
						]
					}
				: {}),
			ionicContent: {
				element: 'sodium',
				massMg,
				mEq,
				sourceIngredients: saltIngredients,
				nonAdditive: true
			}
		};
	}
	return null;
}

/** A provider answered with a non-OK status; `status` 429 is a rate limit. */
class ProviderHttpError extends Error {
	constructor(
		url: string,
		readonly status: number
	) {
		super(`${new URL(url).hostname} responded ${status}`);
	}
}

// ── Shared provider responses ────────────────────────────────────────────────
// Packages of one product, and products of one labeler, ask the providers the
// same questions: the same SPL document, label, labeler query and RxNav
// relations. Each URL is fetched once and its promise shared for a short while,
// across NDCs, batches and requests. Keyed by the fetch in use, so a test that
// swaps `globalThis.fetch` starts with an empty cache.
const RESPONSE_TTL_MS = 10 * 60 * 1000;
// A concept's relations and properties change only with an RxNorm release.
const RXNAV_CONCEPT_TTL_MS = 6 * 60 * 60 * 1000;
const ttlOf = (url: string) =>
	/\/REST\/rxcui\/\d+\/(related|properties|allProperties)\.json/.test(url)
		? RXNAV_CONCEPT_TTL_MS
		: RESPONSE_TTL_MS;
const RESPONSE_LIMIT = 600;
type CachedResponse = { at: number; ttl: number; value: Promise<unknown> };
const responseCaches = new WeakMap<typeof fetch, Map<string, CachedResponse>>();
let responsesNotBefore = 0;

function responseCache(): Map<string, CachedResponse> {
	let cache = responseCaches.get(globalThis.fetch);
	if (!cache) responseCaches.set(globalThis.fetch, (cache = new Map()));
	return cache;
}

/** Forced refreshes must reach the providers: ignore responses cached before now. */
export function expireProviderResponses(now = Date.now()) {
	responsesNotBefore = now;
}

function shared<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
	const cache = responseCache();
	const now = Date.now();
	const hit = cache.get(key);
	if (hit && hit.at >= responsesNotBefore && now - hit.at < hit.ttl) return hit.value as Promise<T>;
	cache.delete(key);
	if (cache.size >= RESPONSE_LIMIT) {
		for (const [entry, value] of cache) {
			if (cache.size < RESPONSE_LIMIT && now - value.at < value.ttl) break;
			cache.delete(entry);
		}
	}
	const value = load();
	cache.set(key, { at: now, ttl, value });
	// A failure is not an answer; the next caller asks again.
	value.catch(() => {
		if (cache.get(key)?.value === value) cache.delete(key);
	});
	return value;
}

function getJson(url: string, emptyOn404 = false): Promise<unknown> {
	return shared(`json:${emptyOn404 ? '404:' : ''}${url}`, ttlOf(url), async () => {
		const response = await loggedFetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(12_000)
		});
		if (response.status === 404 && emptyOn404) return { results: [] };
		if (!response.ok) throw new ProviderHttpError(url, response.status);
		return response.json();
	});
}

function getText(url: string): Promise<string> {
	return shared(`text:${url}`, RESPONSE_TTL_MS, async () => {
		const response = await loggedFetch(url, {
			headers: { Accept: '*/*' },
			signal: AbortSignal.timeout(12_000)
		});
		if (!response.ok) throw new ProviderHttpError(url, response.status);
		return response.text();
	});
}

/** One failed provider per source, so the page can say which facts are missing and why. */
export function providerFailures(
	results: [ProviderError['source'], PromiseSettledResult<unknown>][]
): ProviderError[] {
	const failures = new Map<ProviderError['source'], ProviderError>();
	for (const [source, result] of results) {
		if (result.status !== 'rejected' || failures.has(source)) continue;
		const error = result.reason;
		const status = error instanceof ProviderHttpError ? error.status : null;
		const message =
			status === 429
				? 'rate limit exceeded'
				: error instanceof Error && error.name === 'TimeoutError'
					? 'timed out'
					: status !== null
						? `responded ${status}`
						: 'did not answer';
		failures.set(source, { source, status, message });
	}
	return [...failures.values()];
}

function fdaUrl(base: string, search: string, apiKey?: string): string {
	const params = new URLSearchParams({ search, limit: '100' });
	if (apiKey) params.set('api_key', apiKey);
	return `${base}?${params}`;
}

async function mapLimit<T, R>(
	items: T[],
	limit: number,
	task: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await task(items[index]);
			}
		})
	);
	return results;
}

export async function discoverRxNav(query: string): Promise<RxConcept[]> {
	return (await discoverRxNavPage(query)).concepts;
}

// The ranked graph behind a query, so later pages fetch only their own NDCs.
const RANKING_TTL_MS = 60 * 60 * 1000;
const rankings = new Map<string, { at: number; ranking: Promise<RxRanking> }>();
type RxRanking = Awaited<ReturnType<typeof rankRxNav>>;

function rankingOf(query: string): Promise<RxRanking> {
	const key = query.trim().toLocaleLowerCase();
	const now = Date.now();
	const hit = rankings.get(key);
	if (hit && now - hit.at < RANKING_TTL_MS && hit.at >= responsesNotBefore) return hit.ranking;
	for (const [entry, value] of rankings)
		if (now - value.at >= RANKING_TTL_MS) rankings.delete(entry);
	if (rankings.size >= 64) rankings.delete(rankings.keys().next().value!);
	const ranking = rankRxNav(query);
	rankings.set(key, { at: now, ranking });
	ranking.catch(() => {
		if (rankings.get(key)?.ranking === ranking) rankings.delete(key);
	});
	return ranking;
}

/** What the catalog already knows about a concept from an earlier search. */
export type StoredConcept = { concept: RxConcept; fresh: boolean };

/** A concept with nothing a formulary could load: veterinary only, or no NDCs. */
const isEmptyConcept = (concept: Pick<RxConcept, 'vetOnly' | 'ndcs'>) =>
	concept.vetOnly === true || !concept.ndcs.length;

/**
 * One ranked page of RxNav concepts; `total` counts every discovered root.
 *
 * `stored` looks up concepts staged by earlier searches, at no provider cost. Those
 * known to have nothing to load rank below the rest before paging, and a fresh one
 * on the page is used as stored instead of being fetched again (`reused` lists them,
 * so the caller does not stage them as new).
 */
export async function discoverRxNavPage(
	query: string,
	offset = 0,
	stored?: (rxcuis: string[]) => Promise<Map<string, StoredConcept>>
): Promise<{ concepts: RxConcept[]; total: number; reused: string[] }> {
	const ranking = await rankingOf(query);
	const known = stored ? await stored(ranking.roots.map((root) => root.rxcui)) : new Map<string, StoredConcept>();
	const empty = (rxcui: string) => {
		const entry = known.get(rxcui);
		return entry && isEmptyConcept(entry.concept) ? 1 : 0;
	};
	// Stable: the ranking's own order holds within each group.
	const roots = [...ranking.roots].sort((a, b) => empty(a.rxcui) - empty(b.rxcui));
	const reuse = new Map([...known].flatMap(([rxcui, entry]) => (entry.fresh ? [[rxcui, entry.concept] as const] : [])));
	const page = await pageOfRanking(offset, { ...ranking, roots }, reuse);
	return {
		...page,
		// Within the page too, anything with nothing to load goes last.
		concepts: [...page.concepts].sort((a, b) => Number(isEmptyConcept(a)) - Number(isEmptyConcept(b))),
		reused: page.concepts.filter((concept) => reuse.has(concept.rxcui)).map((concept) => concept.rxcui)
	};
}

async function rankRxNav(query: string) {
	const ndc = toNdc11(query);
	const numeric = /^\d[\d-]*$/.test(query);
	const rxcuiQuery = /^\d{1,7}$/.test(query);
	const seedUrl = rxcuiQuery
		? `${RXNAV}/rxcui/${query}.json`
		: numeric
			? `${RXNAV}/rxcui.json?idtype=NDC&id=${encodeURIComponent(ndc ?? query)}`
			: `${RXNAV}/rxcui.json?name=${encodeURIComponent(query)}&search=1&allsrc=1`;
	const seedPayload = (await getJson(seedUrl)) as {
		idGroup?: { rxnormId?: string[]; name?: string };
	};
	let ids =
		rxcuiQuery && seedPayload.idGroup?.name ? [query] : (seedPayload.idGroup?.rxnormId ?? []);
	let approximate: SourcePayload | undefined;
	if (!ids.length && !numeric) {
		const url = `${RXNAV}/approximateTerm.json?term=${encodeURIComponent(query)}&maxEntries=${MAX_CONCEPTS}&option=1`;
		const payload = (await getJson(url)) as {
			approximateGroup?: { candidate?: { rxcui?: string }[] };
		};
		ids = [
			...new Set(
				payload.approximateGroup?.candidate?.flatMap((candidate) => candidate.rxcui ?? []) ?? []
			)
		];
		approximate = { source: 'rxnav', nativeId: `approximate:${query}`, url, payload };
	}

	const seedEvidence: SourcePayload[] = [
		{ source: 'rxnav', nativeId: `search:${query}`, url: seedUrl, payload: seedPayload },
		...(approximate ? [approximate] : [])
	];
	type Concept = { rxcui: string; name: string; tty: string | null };
	const concrete = new Set(['SCD', 'SBD', 'GPCK', 'BPCK']);
	const forms = new Set(['SCDF', 'SBDF', 'SCDFP', 'SBDFP']);
	const groups = new Set(['SCDG', 'SBDG', 'SCDGP']);
	const allTtys = [...concrete, ...forms, ...groups];
	const evidence = [...seedEvidence];
	const memo = new Map<string, Promise<Concept[]>>();
	function related(rxcui: string, values: string[], parameter = 'tty'): Promise<Concept[]> {
		// RxNav expects multiple term types as a space-separated value. Encoding
		// literal `+` characters produces `%2B`, which the API rejects with 400.
		const url = `${RXNAV}/rxcui/${encodeURIComponent(rxcui)}/related.json?${parameter}=${encodeURIComponent(values.join(' '))}`;
		let pending = memo.get(url);
		if (!pending) {
			pending = (async () => {
				const payload = (await getJson(url)) as {
					relatedGroup?: { conceptGroup?: { tty?: string; conceptProperties?: Concept[] }[] };
				};
				evidence.push({
					source: 'rxnav',
					nativeId: `related:${rxcui}:${values.join('+')}`,
					url,
					payload
				});
				return (payload.relatedGroup?.conceptGroup ?? []).flatMap((group) =>
					(group.conceptProperties ?? []).map((item) => ({
						...item,
						tty: item.tty ?? group.tty ?? null
					}))
				);
			})();
			memo.set(url, pending);
		}
		return pending;
	}
	const discovered = await mapLimit([...new Set(ids)].slice(0, MAX_CONCEPTS), 4, async (rxcui) => {
		const url = `${RXNAV}/rxcui/${encodeURIComponent(rxcui)}/properties.json`;
		const payload = (await getJson(url)) as { properties?: Concept };
		evidence.push({ source: 'rxnav', nativeId: `properties:${rxcui}`, url, payload });
		const seed = payload.properties;
		const neighbors = [...(await related(rxcui, allTtys))];
		if (!neighbors.length && !concrete.has(seed?.tty ?? '')) {
			const bases = await related(rxcui, ['IN', 'MIN']);
			for (const base of bases.filter((base) => base.rxcui !== rxcui).slice(0, MAX_CONCEPTS)) {
				neighbors.push(...(await related(base.rxcui, allTtys)));
			}
		}
		return seed ? [seed, ...neighbors] : neighbors;
	});
	const concepts = new Map(discovered.flat().map((concept) => [concept.rxcui, concept]));
	// Traverse actual group/form membership, rather than ingredient-neighbor paths.
	const parentsOf = new Map<string, Set<string>>();
	const counterpartsOf = new Map<string, Concept[]>();
	const visited = new Set<string>();
	for (let depth = 0; depth < 2; depth++) {
		const parents = [...concepts.values()]
			.filter((c) => (forms.has(c.tty ?? '') || groups.has(c.tty ?? '')) && !visited.has(c.rxcui))
			.slice(0, 64 - visited.size);
		await mapLimit(parents, 4, async (parent) => {
			visited.add(parent.rxcui);
			for (const child of await related(parent.rxcui, ['inverse_isa'], 'rela')) {
				if (forms.has(child.tty ?? '') || concrete.has(child.tty ?? '')) {
					concepts.set(child.rxcui, child);
					const seen = parentsOf.get(child.rxcui) ?? new Set<string>();
					seen.add(parent.rxcui);
					for (const grand of parentsOf.get(parent.rxcui) ?? []) seen.add(grand);
					parentsOf.set(child.rxcui, seen);
				}
			}
		});
	}
	const cross: Record<string, string[]> = {
		SCD: ['SBD', 'BPCK'],
		GPCK: ['SBD', 'BPCK'],
		SBD: ['SCD', 'GPCK'],
		BPCK: ['SCD', 'GPCK']
	};
	const drugs = [...concepts.values()].filter((c) => concrete.has(c.tty ?? ''));
	await mapLimit(drugs.slice(0, 64), 4, async (drug) => {
		for (const counterpart of await related(drug.rxcui, cross[drug.tty!])) {
			if (!concrete.has(counterpart.tty ?? '')) continue;
			concepts.set(counterpart.rxcui, counterpart);
			// Both sides of a pair may be queried, so skip links already recorded.
			for (const [from, to] of [
				[drug, counterpart],
				[counterpart, drug]
			]) {
				const list = counterpartsOf.get(from.rxcui) ?? [];
				if (!list.some((c) => c.rxcui === to.rxcui)) counterpartsOf.set(from.rxcui, [...list, to]);
			}
		}
	});
	// Branded concepts are rolled up into their generic counterpart: the SCD/GPCK
	// is the node, and each SBD/BPCK contributes its NDCs and brand name to it.
	const branded = new Set(['SBD', 'BPCK']);
	const genericOf = (concept: Concept) =>
		branded.has(concept.tty ?? '')
			? counterpartsOf
					.get(concept.rxcui)
					?.find((other) => other.tty === (concept.tty === 'SBD' ? 'SCD' : 'GPCK'))
			: undefined;
	const members = new Map<string, Concept[]>();
	for (const concept of concepts.values()) {
		if (!concrete.has(concept.tty ?? '')) continue;
		const root = genericOf(concept) ?? concept;
		const list = members.get(root.rxcui) ?? [];
		if (root !== concept) list.push(concept);
		members.set(root.rxcui, list);
		if (!concepts.has(root.rxcui)) concepts.set(root.rxcui, root);
	}
	// Rank before paging: an exact RxCUI, then generic nodes (a brand stands alone only when
	// RxNorm has no generic), then names led by the query, single-ingredient
	// drugs, non-packs, and finally a numeric-aware name order so strengths sort.
	const needle = query.trim().toLocaleLowerCase();
	const score = (concept: Concept) => {
		const name = concept.name.toLocaleLowerCase();
		return [
			// An RxCUI lookup must keep its own concept on the first page.
			Number(concept.rxcui !== query.trim()),
			Number(branded.has(concept.tty ?? '')),
			Number(!name.startsWith(needle)),
			Number(name.includes(' / ')),
			Number(concept.tty === 'GPCK' || concept.tty === 'BPCK')
		];
	};
	const roots = [...members.keys()]
		.map((rxcui) => concepts.get(rxcui)!)
		.sort((a, b) => {
			const [x, y] = [score(a), score(b)];
			const i = x.findIndex((value, index) => value !== y[index]);
			return i >= 0 ? x[i] - y[i] : naturalCompare(a.name, b.name);
		});
	return { roots, members, concepts, parentsOf, counterpartsOf, evidence, related };
}

type RankedConcept = { rxcui: string; name: string; tty: string | null };

async function pageOfRanking(
	offset: number,
	{
		roots,
		members,
		concepts,
		parentsOf,
		counterpartsOf,
		evidence,
		related
	}: {
		roots: RankedConcept[];
		members: Map<string, RankedConcept[]>;
		concepts: Map<string, RankedConcept>;
		parentsOf: Map<string, Set<string>>;
		counterpartsOf: Map<string, RankedConcept[]>;
		evidence: SourcePayload[];
		related: (rxcui: string, values: string[], parameter?: string) => Promise<RankedConcept[]>;
	},
	reuse = new Map<string, RxConcept>()
): Promise<{ concepts: RxConcept[]; total: number }> {
	const isVetOnly = async (rxcui: string) => {
		const url = `${RXNAV}/rxcui/${encodeURIComponent(rxcui)}/allProperties.json?prop=attributes`;
		const payload = (await getJson(url).catch(() => null)) as {
			propConceptGroup?: { propConcept?: { propName: string }[] };
		} | null;
		const names = new Set(payload?.propConceptGroup?.propConcept?.map((p) => p.propName) ?? []);
		return names.has('RXNAV_VET_DRUG') && !names.has('RXNAV_HUMAN_DRUG');
	};
	const ndcsOf = async (rxcui: string) => {
		const url = `${RXNAV}/rxcui/${encodeURIComponent(rxcui)}/ndcs.json`;
		const payload = (await getJson(url)) as { ndcGroup?: { ndcList?: { ndc?: string[] } } };
		evidence.push({ source: 'rxnav', nativeId: `ndcs:${rxcui}`, url, payload });
		return [
			...new Set(
				(payload.ndcGroup?.ndcList?.ndc ?? [])
					.map(toNdc11)
					.filter((value): value is string => value !== null)
			)
		];
	};
	const page = await mapLimit(roots.slice(offset, offset + MAX_CONCEPTS), 4, async (drug) => {
		// Staged by an earlier search and still fresh: nothing to ask RxNav again.
		const reused = reuse.get(drug.rxcui);
		if (reused) return { ...reused, evidence: [] };
		// A brand's three lookups are independent, so they run together; brands go
		// one at a time to keep RxNav concurrency where it was.
		const brandedProducts = await mapLimit(members.get(drug.rxcui) ?? [], 1, async (brand) => {
			const [vetOnly, ndcs, brandNames] = await Promise.all([
				isVetOnly(brand.rxcui),
				ndcsOf(brand.rxcui).catch(() => []),
				related(brand.rxcui, ['BN']).catch(() => [])
			]);
			return {
				rxcui: brand.rxcui,
				name: brand.name,
				tty: brand.tty,
				// A veterinary-only brand must not pool into a human generic node.
				ndcs: vetOnly ? [] : ndcs,
				brandNames: brandNames.filter((c) => c.tty === 'BN')
			};
		});
		const url = `${RXNAV}/rxcui/${encodeURIComponent(drug.rxcui)}/ndcs.json`;
		const attributesUrl = `${RXNAV}/rxcui/${encodeURIComponent(drug.rxcui)}/allProperties.json?prop=${encodeURIComponent('names attributes codes')}`;
		const [payload, attributes, components] = await Promise.all([
			getJson(url) as Promise<{ ndcGroup?: { ndcList?: { ndc?: string[] } } }>,
			getJson(attributesUrl).catch(() => null) as Promise<{
				propConceptGroup?: { propConcept?: { propName: string; propValue?: string }[] };
			} | null>,
			related(drug.rxcui, ['IN', 'MIN', 'PIN', 'BN', 'DF', 'DFG']).catch(() => [])
		]);
		const props = attributes?.propConceptGroup?.propConcept ?? [];
		const names = new Set(props.map((p) => p.propName));
		const vetOnly = attributes?.propConceptGroup
			? names.has('RXNAV_VET_DRUG') && !names.has('RXNAV_HUMAN_DRUG')
			: null;
		const allNdcs = [
			...new Set(
				// Branded NDCs first: they are few, and the per-node cap must not drop them.
				[
					...brandedProducts.flatMap((brand) => brand.ndcs),
					...(payload.ndcGroup?.ndcList?.ndc ?? [])
				]
					.map(toNdc11)
					.filter((value): value is string => value !== null)
			)
		];
		const ofTty = (...ttys: string[]) =>
			components
				.filter((c) => ttys.includes(c.tty ?? ''))
				.map(({ rxcui, name, tty }) => ({ rxcui, name, tty }));
		const details: RxConceptDetails = {
			synonym:
				props.find((p) => p.propName === 'RxNorm Synonym' || p.propName === 'PSN')?.propValue ??
				null,
			species: attributes?.propConceptGroup
				? { human: names.has('RXNAV_HUMAN_DRUG'), vet: names.has('RXNAV_VET_DRUG') }
				: null,
			ingredients: ofTty('IN', 'MIN', 'PIN'),
			brands: [
				...new Map(
					[...ofTty('BN'), ...brandedProducts.flatMap((brand) => brand.brandNames)].map(
						({ rxcui, name, tty }) => [rxcui, { rxcui, name, tty }] as const
					)
				).values()
			],
			doseForms: ofTty('DF', 'DFG'),
			parents: [...(parentsOf.get(drug.rxcui) ?? [])].flatMap((id) => {
				const parent = concepts.get(id);
				return parent ? [{ rxcui: parent.rxcui, name: parent.name, tty: parent.tty }] : [];
			}),
			counterparts: (counterpartsOf.get(drug.rxcui) ?? []).map(({ rxcui, name, tty }) => ({
				rxcui,
				name,
				tty
			})),
			properties: props.flatMap((p) =>
				p.propValue ? [{ name: p.propName, value: p.propValue }] : []
			),
			brandedProducts: brandedProducts.map(({ brandNames: _names, ...brand }) => {
				void _names;
				return brand;
			}),
			ndcCount: allNdcs.length
		};
		return {
			...drug,
			vetOnly,
			details,
			ndcs: vetOnly ? [] : allNdcs,
			evidence: [
				...evidence,
				{ source: 'rxnav', nativeId: `ndcs:${drug.rxcui}`, url, payload },
				...(attributes
					? [
							{
								source: 'rxnav',
								nativeId: `species:${drug.rxcui}`,
								url: attributesUrl,
								payload: attributes
							}
						]
					: [])
			]
		};
	});
	return { concepts: page, total: roots.length };
}

/** The ingredients a label lists for this NDC, actives first, once each. A
 * multi-product SPL repeats its ingredients in every product block, and its
 * siblings may differ, so read only the products naming this NDC — or every
 * product when none does (a search hit that lists no matching package). */
export function labelIngredientsOf(
	products: SplProduct[],
	own: SplProduct[]
): LabelIngredientName[] {
	const seen = new Map<string, LabelIngredientName>();
	for (const ingredient of (own.length ? own : products).flatMap((item) => item.ingredients)) {
		const name = withoutUnspecified(ingredient.name.trim());
		const key = `${ingredient.kind}:${ingredientKeyOf(name)}`;
		if (name && !seen.has(key)) seen.set(key, { name, kind: ingredient.kind });
	}
	const all = [...seen.values()];
	return [
		...all.filter((item) => item.kind === 'active'),
		...all.filter((item) => item.kind === 'inactive')
	];
}

/** Enrich each discovered NDC with all live evidence sources. Failures remain
 * local to a package so one unavailable provider does not discard RxNav data. */
/** Steers which DailyMed SPL an NDC is interpreted from (reload & reinterpret). */
/** `kind` is null only on snapshots cached before it was recorded. */
export type LabelIngredientName = { name: string; kind: IngredientKind | null };

export type SplPreference = { prefer?: string | null; avoid?: string[] };

/** What a caller already knows about a batch's NDCs, so enrichment need not ask again. */
export type PackageHints = {
	/** RxNorm's dose form for the concept the NDCs belong to (DF, else DFG). */
	doseForm?: string | null;
	/** Every active moiety of a UNII per GSRS; completes a label missing one of a salt's ions. */
	moietiesOf?: (unii: string) => Promise<{ unii: string; name: string }[] | null>;
	/** GSRS's salt-to-moiety mass factor for a UNII; corrects a heavy salt's mass labeled as moiety. */
	moietyFactorOf?: (unii: string) => Promise<MoietyFactor | null>;
};

/**
 * The directory's strength for each salt the label check converted to its
 * moiety (rule 3), scaled by the same GSRS factor and kept per the
 * directory's own denominator: `1.2 g/100mL` lysine acetate → `0.850589 g/100mL`.
 * Keyed by the directory's lowercased name.
 */
function directoryMoietyStrengths(
	products: SplProduct[],
	rxNormName: string | null,
	moietyFactors: Map<string, MoietyFactor>,
	directory: { name: string; strength: string | null }[]
): Map<string, string> {
	const out = new Map<string, string>();
	if (!moietyFactors.size) return out;
	for (const product of products) {
		const checked = checkProductStrengths(product, { rxNormName, moietyFactors, directory });
		product.ingredients.forEach((ingredient, index) => {
			if (!checked[index].corrections.some((c) => c.kind === 'moiety-equivalent')) return;
			const factor = Number(moietyFactors.get(ingredient.unii!)!.factor);
			const listed = directory.find((entry) => entry.name.toLowerCase() === ingredient.name.toLowerCase());
			const match = /^\s*(\d*\.?\d+)(\s*[^\d/\s]+.*)$/.exec(listed?.strength ?? '');
			if (!listed || !match) return;
			out.set(listed.name.toLowerCase(), `${Number((Number(match[1]) * factor).toPrecision(6))}${match[2]}`);
		});
	}
	return out;
}

/** The GSRS factors for every moiety-basis salt among `products`, by the salt's UNII. */
async function moietyFactorsOf(
	products: { ingredients: SplIngredient[] }[],
	moietyFactorOf: PackageHints['moietyFactorOf']
): Promise<Map<string, MoietyFactor>> {
	const factors = new Map<string, MoietyFactor>();
	if (!moietyFactorOf) return factors;
	const uniis = new Set(
		products
			.flatMap((product) => product.ingredients)
			.filter((i) => i.kind === 'active' && i.basis === 'moiety' && i.unii && i.moieties.length === 1)
			.map((i) => i.unii!)
	);
	await Promise.all(
		[...uniis].map(async (unii) => {
			const factor = await moietyFactorOf(unii).catch(() => null);
			if (factor) factors.set(unii, factor);
		})
	);
	return factors;
}

/**
 * Adds the moieties a label left out of a salt. Nephron's sodium chloride
 * lists only CHLORIDE ION; GSRS knows SODIUM CATION too. Only when every
 * moiety the label did list is one GSRS agrees with, so a label that names a
 * different moiety is left as written. Mutates `products`.
 */
export async function completeMoieties(
	products: { ingredients: SplIngredient[] }[],
	moietiesOf: NonNullable<PackageHints['moietiesOf']>
): Promise<void> {
	const ingredients = products
		.flatMap((product) => product.ingredients)
		.filter((ingredient) => ingredient.kind === 'active' && ingredient.unii && ingredient.moieties.length);
	const known = new Map<string, Promise<{ unii: string; name: string }[] | null>>();
	for (const ingredient of ingredients) {
		const unii = ingredient.unii!;
		if (!known.has(unii)) known.set(unii, moietiesOf(unii).catch(() => null));
		const gsrs = (await known.get(unii)) ?? [];
		const listed = new Set(ingredient.moieties.map((moiety) => moiety.unii));
		if (gsrs.length <= listed.size || ![...listed].every((unii) => gsrs.some((m) => m.unii === unii)))
			continue;
		for (const moiety of gsrs)
			if (!listed.has(moiety.unii)) ingredient.moieties.push({ ...moiety, source: 'gsrs' });
	}
}

/** The labeled product codes an 11-digit NDC's first nine digits could stand for. */
function productCodesOf(ndc: string): string[] {
	const labeler = ndc.slice(0, 5);
	const product = ndc.slice(5, 9);
	return [
		...new Set([
			`${labeler}-${product}`,
			...(labeler.startsWith('0') ? [`${labeler.slice(1)}-${product}`] : []),
			...(product.startsWith('0') ? [`${labeler}-${product.slice(1)}`] : [])
		])
	];
}

// A labeler's name outlives any one product; keep it for the process.
const LABELER_TTL_MS = 24 * 60 * 60 * 1000;
const labelerNames = new Map<string, { at: number; name: Promise<string | null> }>();

function labelerNameOf(labelerCode: string, apiKey?: string): Promise<string | null> {
	const hit = labelerNames.get(labelerCode);
	if (hit && Date.now() - hit.at < LABELER_TTL_MS) return hit.name;
	const url = fdaUrl(
		OPENFDA_NDC,
		labelerCandidates(labelerCode)
			.map((code) => `product_ndc:${code}-*`)
			.join(' OR '),
		apiKey
	);
	const name = (getJson(url, true) as Promise<{ results?: FdaProduct[] }>).then(
		(payload) => payload.results?.find((row) => row.labeler_name)?.labeler_name ?? null
	);
	labelerNames.set(labelerCode, { at: Date.now(), name });
	name.then(
		(value) => {
			// An empty answer may be an indexing gap; let the next package ask again.
			if (value === null) labelerNames.delete(labelerCode);
		},
		() => labelerNames.delete(labelerCode)
	);
	return name;
}

export async function enrichPackages(
	ndcs: string[],
	apiKey?: string,
	splPreferences: Map<string, SplPreference> = new Map(),
	hints: PackageHints = {}
): Promise<ExternalPackage[]> {
	const unique = [...new Set(ndcs.map(toNdc11).filter((ndc): ndc is string => ndc !== null))];
	// One package of each product goes first: its openFDA product, label and SPL
	// answers are cached, so its siblings then reuse them instead of racing it.
	const leaders = new Map<string, string>();
	for (const ndc of unique) if (!leaders.has(ndc.slice(0, 9))) leaders.set(ndc.slice(0, 9), ndc);
	const batch = unique;
	const enrichOne = async (ndc: string) => {
		const candidates = hyphenCandidates(ndc);
		const search = (field: string) => candidates.map((value) => `${field}:"${value}"`).join(' OR ');
		// Product level, so every package of the product shares one answer.
		const productCodes = productCodesOf(ndc);
		const productUrl = fdaUrl(
			OPENFDA_NDC,
			productCodes.map((value) => `product_ndc:"${value}"`).join(' OR '),
			apiKey
		);
		const labelUrl = fdaUrl(OPENFDA_LABEL, search('openfda.package_ndc'), apiKey);
		const statusUrl = `${RXNAV}/ndcstatus.json?ndc=${encodeURIComponent(ndc)}`;
		let splUrl = `${DAILYMED_SPL}?ndc=${encodeURIComponent(candidates[0] ?? ndc)}`;
		const speciesUrl = `${RXNAV}/ndcproperties.json?id=${encodeURIComponent(ndc)}`;
		const [fda, label, status, spl, species] = await Promise.allSettled([
			getJson(productUrl, true),
			getJson(labelUrl, true),
			getJson(statusUrl),
			// DailyMed matches only the labeled hyphenation, so try each one.
			(async () => {
				let failure: unknown = null;
				let empty: unknown = null;
				for (const candidate of candidates) {
					const url = `${DAILYMED_SPL}?ndc=${encodeURIComponent(candidate)}`;
					try {
						const payload = (await getJson(url)) as { data?: unknown[] };
						if (payload.data?.length) {
							splUrl = url;
							return payload;
						}
						empty ??= payload;
					} catch (error) {
						failure ??= error;
					}
				}
				if (failure) throw failure;
				return empty ?? { data: [] };
			})(),
			getJson(speciesUrl)
		]);

		let fdaPayload =
			fda.status === 'fulfilled' ? (fda.value as { results?: FdaProduct[] }) : undefined;
		let effectiveNdcUrl = productUrl;
		const listsPackage = (row: FdaProduct) =>
			row.packaging?.some((item) => toNdc11(item.package_ndc ?? '') === ndc) ?? false;
		let product =
			fdaPayload?.results?.find(listsPackage) ??
			fdaPayload?.results?.find((row) => productCodes.includes(row.product_ndc ?? ''));
		// openFDA occasionally files a package under a product row whose
		// product_ndc spelling differs; the package-level search still finds it.
		if (fdaPayload?.results?.length && !(product && listsPackage(product))) {
			const ndcUrl = fdaUrl(OPENFDA_NDC, search('packaging.package_ndc'), apiKey);
			try {
				const byPackage = (await getJson(ndcUrl, true)) as { results?: FdaProduct[] };
				const packageProduct = byPackage.results?.find(listsPackage);
				if (packageProduct) {
					fdaPayload = byPackage;
					product = packageProduct;
					effectiveNdcUrl = ndcUrl;
				}
			} catch {
				// Keep the product-level answer.
			}
		}
		const labelPayload = label.status === 'fulfilled' ? label.value : null;
		let matchedLabel =
			(
				labelPayload as {
					results?: (Record<string, unknown> & { openfda?: { package_ndc?: string[] } })[];
				} | null
			)?.results?.find((row) =>
				row.openfda?.package_ndc?.some((value) => toNdc11(value) === ndc)
			) ?? null;
		const statusPayload =
			status.status === 'fulfilled' ? (status.value as { ndcStatus?: NdcStatusPayload }) : null;
		const splPayload =
			spl.status === 'fulfilled'
				? (spl.value as {
						data?: {
							setid?: string;
							title?: string;
							spl_version?: number | string;
							published_date?: string;
						}[];
					})
				: null;
		// Prefer the label whose product data actually lists this package.
		const preference = splPreferences.get(ndc);
		let splRows = splPayload?.data ?? [];
		// Packages of the same product share its label. When neither DailyMed nor
		// openFDA links this NDC itself, borrow the SPL a sibling package resolves to.
		const siblingNdcs = [
			...new Set([
				...(product?.packaging ?? []).flatMap((item) =>
					item.package_ndc && toNdc11(item.package_ndc) !== ndc ? [item.package_ndc] : []
				),
				...batch
					.filter((other) => other !== ndc && other.slice(0, 9) === ndc.slice(0, 9))
					.flatMap((other) => hyphenCandidates(other))
			])
		];
		let splSiblingNdc: string | null = null;
		if (!splRows.length && !preference?.prefer && !matchedLabel) {
			for (const sibling of siblingNdcs.slice(0, 6)) {
				const url = `${DAILYMED_SPL}?ndc=${encodeURIComponent(sibling)}`;
				const payload = (await getJson(url).catch(() => null)) as typeof splPayload;
				if (payload?.data?.length) {
					splRows = payload.data;
					splSiblingNdc = toNdc11(sibling);
					break;
				}
			}
		}
		const splHit = preference?.prefer
			? (splRows.find((row) => row.setid === preference.prefer) ?? { setid: preference.prefer })
			: (splRows.find((row) => !preference?.avoid?.includes(row.setid ?? '')) ??
				(preference?.avoid?.length ? undefined : splRows[0]));
		const documentUrl = splHit?.setid
			? `${DAILYMED_DOCUMENT}/${encodeURIComponent(splHit.setid)}.xml`
			: null;
		const xml = documentUrl ? await getText(documentUrl).catch(() => null) : null;
		// Biologics (BLA) carry an empty `openfda` block, so the package_ndc
		// search misses their label — Anavip 66621-0790. Fall back to the SPL's
		// set id, which openFDA indexes for every label.
		if (!matchedLabel && splHit?.setid) {
			const bySetId = (await getJson(
				fdaUrl(OPENFDA_LABEL, `set_id:"${splHit.setid}"`, apiKey),
				true
			).catch(() => null)) as { results?: Record<string, unknown>[] } | null;
			matchedLabel = bySetId?.results?.find((row) => row.set_id === splHit.setid) ?? null;
		}
		let labelSiblingNdc: string | null = null;
		if (!matchedLabel && !splHit?.setid && siblingNdcs.length) {
			const siblingLabel = (await getJson(
				fdaUrl(
					OPENFDA_LABEL,
					siblingNdcs
						.slice(0, 6)
						.map((value) => `openfda.package_ndc:"${value}"`)
						.join(' OR '),
					apiKey
				),
				true
			).catch(() => null)) as {
				results?: (Record<string, unknown> & { openfda?: { package_ndc?: string[] } })[];
			} | null;
			matchedLabel = siblingLabel?.results?.[0] ?? null;
			labelSiblingNdc =
				toNdc11(
					matchedLabel?.openfda?.package_ndc?.find((value) =>
						siblingNdcs.some((sibling) => toNdc11(sibling) === toNdc11(value))
					) ?? ''
				) ?? null;
		}
		const labelerName =
			product?.labeler_name ?? (await labelerNameOf(ndc.slice(0, 5), apiKey).catch(() => null));
		const packaging = product?.packaging?.find((item) => toNdc11(item.package_ndc ?? '') === ndc);

		const sourceIngredients = (product?.active_ingredients ?? []).flatMap((ingredient) =>
			ingredient.name
				? [{ name: withoutUnspecified(ingredient.name), strength: ingredient.strength ?? null }]
				: []
		);
		const speciesPayload =
			species.status === 'fulfilled'
				? (species.value as {
						ndcPropertyList?: {
							ndcProperty?: {
								propertyConceptList?: {
									propertyConcept?: { propName: string; propValue: string }[];
								};
							}[];
						};
					})
				: null;
		const ndcProperty = speciesPayload?.ndcPropertyList?.ndcProperty?.[0] as
			NdcPropertyRow | undefined;
		const packageDescription =
			packaging?.description ??
			ndcProperty?.packagingList?.packaging?.find((value) => value.trim()) ??
			null;
		const labelTypes = (speciesPayload?.ndcPropertyList?.ndcProperty ?? [])
			.flatMap((row) => row.propertyConceptList?.propertyConcept ?? [])
			.filter((p) => p.propName === 'LABEL_TYPE')
			.map((p) => p.propValue);
		if (product?.product_type) labelTypes.push(product.product_type);
		const listed = packaging ? true : !product && fdaPayload?.results?.length === 0 ? false : null;
		const splPresent =
			splPayload && Array.isArray(splPayload.data) ? splPayload.data.length > 0 : null;
		const listedByFDA = listed === true;
		const presentInSPL = splPresent === true;
		// Only unlisted NDCs can be compliance-inactivated, so skip the page otherwise.
		const splInactivated =
			splHit?.setid && listed !== true
				? await getText(`${DAILYMED_INFO}?setid=${encodeURIComponent(splHit.setid)}`)
						.then((html) => inactivatedOnDailyMed(html, candidates))
						.catch(() => null)
				: listed === true
					? false
					: null;
		const splProducts = xml ? parseSplIngredients(xml) : [];
		if (hints.moietiesOf) await completeMoieties(splProducts, hints.moietiesOf);
		const moietyFactors = await moietyFactorsOf(splProducts, hints.moietyFactorOf);
		const sectionBlocks = xml ? labelSectionBlocks(xml) : {};
		const hyphenated = new Set(candidates);
		const ownProducts = splProductsForNdc(splProducts, ndc);
		const labelRow = matchedLabel as
			| (Record<string, unknown> & { effective_time?: string; version?: string; set_id?: string })
			| null;
		const labelText = (key: string) => strings(labelRow?.[key]).join('\n') || null;
		// A kit's parts for this NDC: its drug and its diluent, and only this
		// carton's when the SPL lists a sibling size's parts under it too.
		const kitParts = kitComposition(ownProducts, ndc, {
			howSupplied: labelText('how_supplied'),
			description: packageDescription
		});
		// An NDC that is itself a kit's part (Wilshire's 52536-096-05 powder
		// bottle) is listed nowhere but inside its kit's carton.
		const partOf = ownProducts.find(
			(item) =>
				item.part &&
				item.packageCodes.some(
					(code) => toNdc11(code) === ndc && code.startsWith(`${item.productCode}-`)
				)
		);
		const kit: KitComposition | null = kitParts
			? {
					...kitParts,
					...(partOf
						? {
								partOf: partOf.packageCodes.filter(
									(code) => !code.startsWith(`${partOf.productCode}-`)
								)
							}
						: {})
				}
			: null;
		const labelProducts = kit ? productsOfComposition(ownProducts, kit) : ownProducts;
		const appearances = [...appearancesByPackage(labelProducts)].flatMap(([code, list]) =>
			hyphenated.has(code) || toNdc11(code) === ndc || !ownProducts.length ? list : []
		);
		// RxNorm exposes normalized route and dose form properties on an NDC
		// mapping even when the FDA product row is missing those fields.
		const rxPropertyValues = (name: string) =>
			(speciesPayload?.ndcPropertyList?.ndcProperty ?? [])
				.flatMap((row) => row.propertyConceptList?.propertyConcept ?? [])
				.filter((property) => property.propName.toUpperCase() === name.toUpperCase())
				.map((property) => property.propValue.trim());
		const rxRoutes = [...new Set(rxPropertyValues('ROUTE').filter(Boolean))];
		const statusRow = statusPayload?.ndcStatus;
		const openfda = product?.openfda ?? {};
		// Route statements commonly live in dosage/administration or dosage-form
		// sections, rather than on the principal display panel. The openFDA label
		// row is already matched to this package NDC above.
		const labelRouteText = [
			labelText('package_label_principal_display_panel'),
			labelText('dosage_and_administration'),
			labelText('dosage_forms_and_strengths'),
			labelText('how_supplied')
		]
			.filter((text): text is string => Boolean(text))
			.join('\n');
		const rxNormForm =
			hints.doseForm === undefined && ndcProperty?.rxcui
				? ((await getJson(
						`${RXNAV}/rxcui/${encodeURIComponent(ndcProperty.rxcui)}/related.json?tty=DF%20DFG`
					).catch(() => null)) as {
						relatedGroup?: { conceptGroup?: { conceptProperties?: { name?: string }[] }[] };
					} | null)
				: null;
		const rxNormDoseForm =
			hints.doseForm ??
			rxNormForm?.relatedGroup?.conceptGroup
				?.flatMap((group) => group.conceptProperties ?? [])
				.find((concept) => concept.name)?.name ??
			null;
		const rxNormTitle = statusRow?.conceptName ?? null;
		const productRouteText = [
			rxNormTitle,
			rxNormDoseForm,
			splHit?.title,
			ownProducts.find((item) => item.doseForm)?.doseForm ?? null,
			product?.dosage_form ?? null,
			labelText('package_label_principal_display_panel'),
			labelText('dosage_forms_and_strengths')
		]
			.filter((text): text is string => Boolean(text))
			.join('\n');
		const structuredRoutes = [...(product?.route ?? []), ...rxRoutes];
		const labelRoutes = [
			...routesFromProductText(productRouteText),
			...routesFromLabelText(labelRouteText)
		];
		const doseFormCorrection = correctDoseForm({
			doseForm: product?.dosage_form ?? null,
			identity: {
				generic_name: product?.generic_name,
				brand_name: product?.brand_name,
				spl_title: splHit?.title,
				// The document's own heading names the article even when every coded
				// field calls it the liquid: Amneal's vancomycin 69238-2261 is coded
				// SOLUTION, titled "Vancomycin Hydrochloride for Oral Solution, USP".
				spl_document_title: splDocumentTitle(xml),
				package_label_principal_display_panel: labelText('package_label_principal_display_panel'),
				dosage_forms_and_strengths: labelText('dosage_forms_and_strengths')
			},
			instructions: Object.fromEntries(
				[
					'dosage_and_administration',
					'how_supplied',
					'storage_and_handling',
					'instructions_for_use'
				].map((key) => [key, labelText(key)])
			),
			reconstitutionRows: labelRow ? reconstitutionFromLabel(labelRow).length : 0,
			siblingForms: splProducts
				.filter((item) => !ownProducts.includes(item))
				.map((item) => item.doseForm)
		});
		const doseForm =
			doseFormCorrection?.to ??
			product?.dosage_form ??
			ownProducts.find((item) => item.doseForm)?.doseForm ??
			rxNormDoseForm ??
			null;
		const activeKitProducts = kit
			? labelProducts.filter(
					(item) => item.part && item.ingredients.some((ingredient) => ingredient.kind === 'active')
				)
			: [];
		const dryFill =
			isDryFillForm(doseForm ?? '') ||
			activeKitProducts.some((item) => isDryFillForm(item.doseForm ?? ''));
		// A kit part is described by its own SPL packaging when the directory
		// has no row for it: "7.5 g in 1 BOTTLE (52536-096-05)".
		const partCode = partOf?.packageCodes.find((code) => toNdc11(code) === ndc);
		const description =
			packageDescription ??
			(partOf?.presentation?.amount != null && partOf.presentation.amountUnit
				? `${partOf.presentation.amount} ${partOf.presentation.amountUnit} in 1 ${partOf.presentation.form ?? 'BOTTLE'}${partCode ? ` (${partCode})` : ''}`
				: null);
		const unitSize = description && !kit ? parseUnitOfUse(description) : null;
		const fillVolumeMl =
			unitSize?.kind === 'volume' ? unitSize.value * (unitSize.unit === 'L' ? 1000 : 1) : null;
		const bulkFillMl = pharmacyBulkFillMl(description, fillVolumeMl);
		// The directory lists no ingredients for a kit; its drug part's content
		// stands in, so the kit has a mass to match the label's rows against.
		// A kit with more than one drug part (a pen and its alcohol pad) has no
		// single content to stand in, and keeps the directory's empty list.
		const kitIngredients =
			sourceIngredients.length || activeKitProducts.length !== 1
				? []
				: activeKitProducts.flatMap((item) => {
						const checked = checkProductStrengths(item, {
							rxNormName: rxNormTitle,
							moietyFactors,
							directory: sourceIngredients
						});
						return item.ingredients.flatMap((ingredient, index) => {
							if (ingredient.kind !== 'active') return [];
							const content = partContent(checked[index], item.part);
							return [
								{
									name: ingredient.name,
									strength: content
										? `${content.value} ${content.unit}`
										: strengthText(checked[index])
								}
							];
						});
					});
		// The directory names the salt at the mass the label miscoded as moiety
		// strength; carry the label's correction over so the rows sum as moiety.
		const moietyStrengths = directoryMoietyStrengths(
			labelProducts,
			rxNormTitle,
			moietyFactors,
			sourceIngredients
		);
		const listedIngredients = [...sourceIngredients, ...kitIngredients].map((ingredient) => ({
			...ingredient,
			strength: moietyStrengths.get(ingredient.name.toLowerCase()) ?? ingredient.strength
		}));
		const ingredients = listedIngredients.map((ingredient) => ({
			...ingredient,
			strength: dryFill
				? dryFillStrength(ingredient.strength, doseForm, bulkFillMl, fillVolumeMl)
				: ingredient.strength
		}));
		const saltIngredients = [
			...new Set(
				labelProducts
					.flatMap((item) => item.ingredients)
					.filter(
						(ingredient) => ingredient.kind === 'active' && /\bsodium\b/i.test(ingredient.name)
					)
					.map((ingredient) => ingredient.name)
			)
		];
		const ionicContent = sodiumContentFromLabel(labelText('how_supplied'), ndc, saltIngredients);
		const hasProductFacts = Boolean(
			product || rxRoutes.length || labelRoutes.length || doseForm || openfda.rxcui || rxNormTitle
		);
		const details: PackageDetails = {
			product: hasProductFacts
				? {
						productType: product?.product_type ?? null,
						// Structured routes are authoritative; label prose only fills a gap.
						// Metoprolol tartrate tablet labels describe IV dosing of the
						// separate injection, which would otherwise read as INTRAVENOUS.
						routes: normalizeRoutes(structuredRoutes.length ? structuredRoutes : labelRoutes),
						marketingCategory: product?.marketing_category ?? null,
						applicationNumber: product?.application_number ?? null,
						deaSchedule: product?.dea_schedule ?? null,
						marketingStartDate: product?.marketing_start_date ?? null,
						listingExpirationDate: product?.listing_expiration_date ?? null,
						finished: product?.finished ?? null,
						pharmClasses: [
							...new Set([
								...(product?.pharm_class ?? []),
								...strings(openfda.pharm_class_epc),
								...strings(openfda.pharm_class_moa),
								...strings(openfda.pharm_class_pe),
								...strings(openfda.pharm_class_cs)
							])
						],
						rxcuis: strings(openfda.rxcui),
						uniis: strings(openfda.unii),
						manufacturers: strings(openfda.manufacturer_name),
						splId: product?.spl_id ?? null
					}
				: null,
			packaging: product
				? {
						marketingStartDate: packaging?.marketing_start_date ?? null,
						sample: packaging?.sample ?? null,
						siblings: (product?.packaging ?? []).flatMap((item) => {
							const sibling = toNdc11(item.package_ndc ?? '');
							return sibling && sibling !== ndc
								? [{ ndc: sibling, description: item.description ?? null }]
								: [];
						})
					}
				: null,
			label: labelRow
				? {
						effectiveTime: labelRow.effective_time ?? null,
						version: labelRow.version ?? null,
						setId: labelRow.set_id ?? null,
						siblingNdc: labelSiblingNdc ?? splSiblingNdc,
						sections: LABEL_SECTIONS.flatMap(([key, title]) => {
							const text = strings(labelRow[key]).join('\n\n').trim();
							const blocks = sectionBlocks[key];
							return text || blocks ? [{ key, title, text, ...(blocks ? { blocks } : {}) }] : [];
						})
					}
				: null,
			spl: splHit
				? {
						version: splHit.spl_version != null ? String(splHit.spl_version) : null,
						publishedDate: splHit.published_date ?? null,
						doseForm: ownProducts.find((item) => item.doseForm)?.doseForm ?? null,
						ingredients: [
							...labelProducts.flatMap((item) => {
								const checked = checkProductStrengths(item, {
							rxNormName: rxNormTitle,
							moietyFactors,
							directory: sourceIngredients
						});
								return item.ingredients.map((ingredient, index) =>
									labelIngredientOf(
										ingredient,
										checked[index],
										item,
										doseForm,
										dryFill,
										fillVolumeMl,
										bulkFillMl
									)
								);
							}),
							...(ionicContent ? [ionicContent] : [])
						],
						appearances,
						siblingNdc: splSiblingNdc,
						otherLabels: splRows
							.slice(1)
							.flatMap((row) => (row.setid ? [{ setId: row.setid, title: row.title ?? null }] : []))
					}
				: null,
			rxnav:
				statusRow || ndcProperty
					? {
							status: statusRow?.status ?? null,
							rxcui: statusRow?.rxcui ?? ndcProperty?.rxcui ?? null,
							conceptName: statusRow?.conceptName ?? null,
							conceptStatus: statusRow?.conceptStatus ?? null,
							history: (statusRow?.ndcHistory ?? []).map((row) => ({
								activeRxcui: row.activeRxcui || null,
								originalRxcui: row.originalRxcui || null,
								start: row.startDate || null,
								end: row.endDate || null
							})),
							properties: (ndcProperty?.propertyConceptList?.propertyConcept ?? []).map((p) => ({
								name: p.propName,
								value: p.propValue
							})),
							packaging: ndcProperty?.packagingList?.packaging ?? []
						}
					: null
		};
		const facts = parsePackageFacts(
			ndc,
			description,
			doseForm,
			ingredients,
			matchedLabel,
			xml,
			rxNormTitle,
			kit
		);
		return {
			...facts,
			listed,
			marketingEndDate: packaging?.marketing_end_date ?? product?.marketing_end_date ?? null,
			splPresent,
			splInactivated,
			isVeterinary: labelTypes.length ? labelTypes.some((value) => /ANIMAL/i.test(value)) : null,
			complete:
				listed !== null &&
				splPresent !== null &&
				statusPayload?.ndcStatus !== undefined &&
				speciesPayload?.ndcPropertyList !== undefined &&
				Array.isArray((labelPayload as { results?: unknown[] } | null)?.results) &&
				[fda, label, status, spl, species].every((result) => result.status === 'fulfilled') &&
				(!documentUrl || xml !== null) &&
				// A successful empty response is not a resolved package. Keep sparse,
				// unlisted NDCs on the short retry TTL unless a matched product or
				// package-specific label evidence supplied usable product facts.
				(Boolean(packaging) ||
					Boolean(matchedLabel) ||
					Boolean(ownProducts.length) ||
					Boolean(labelProducts.length)),
			providerErrors: providerFailures([
				['openFDA', fda],
				['openFDA', label],
				['DailyMed', spl],
				['RxNav', status],
				['RxNav', species]
			]),
			ndc,
			// Stated as the salt's mass, restated as the moiety's; see `unitOfUseCorrection`.
			description: facts.unitOfUseCorrection?.description ?? description,
			doseForm,
			doseFormCorrection,
			brandName: product?.brand_name ?? null,
			genericName: product?.generic_name ?? null,
			labelerName,
			labelerCode: ndc.slice(0, 5),
			productCode: product?.product_ndc ?? null,
			// A kit's are its drug part's content; the directory lists none.
			ingredients: listedIngredients,
			rxcuiStatus: statusPayload?.ndcStatus?.status ?? null,
			splSetId: splHit?.setid ?? null,
			splTitle: splHit?.title ?? null,
			splXml: xml,
			labelIngredients: labelIngredientsOf(splProducts, ownProducts),
			details,
			evidence: [
				...(speciesPayload
					? [
							{
								source: 'rxnav',
								nativeId: `ndcspecies:${ndc}`,
								url: speciesUrl,
								payload: speciesPayload
							}
						]
					: []),
				...(fda.status === 'fulfilled'
					? [
							{
								source: 'openfda-ndc',
								nativeId: ndc,
								url: effectiveNdcUrl,
								payload: fdaPayload ?? fda.value
							}
						]
					: []),
				...(label.status === 'fulfilled'
					? [{ source: 'openfda-label', nativeId: ndc, url: labelUrl, payload: labelPayload }]
					: []),
				...(status.status === 'fulfilled'
					? [
							{
								source: 'rxnav',
								nativeId: `ndcstatus:${ndc}`,
								url: statusUrl,
								payload: status.value
							}
						]
					: []),
				...(spl.status === 'fulfilled'
					? [{ source: 'dailymed-spl', nativeId: ndc, url: splUrl, payload: spl.value }]
					: []),
				...(xml && documentUrl
					? [
							{
								source: 'dailymed-spl',
								nativeId: `xml:${splHit?.setid}`,
								url: documentUrl,
								payload: xml
							}
						]
					: [])
			].map((item) => {
				const url = new URL(item.url);
				url.searchParams.delete('api_key');
				return { ...item, url: url.href };
			})
		};
	};
	const leading = new Set(leaders.values());
	const first = await mapLimit([...leading], 3, enrichOne);
	const rest = await mapLimit(
		batch.filter((ndc) => !leading.has(ndc)),
		3,
		enrichOne
	);
	const byNdc = new Map([...first, ...rest].map((item) => [item.ndc, item]));
	return batch.flatMap((ndc) => {
		const item = byNdc.get(ndc);
		return item ? [item] : [];
	});
}

type NdcStatusPayload = {
	status?: string;
	rxcui?: string;
	conceptName?: string;
	conceptStatus?: string;
	ndcHistory?: {
		activeRxcui?: string;
		originalRxcui?: string;
		startDate?: string;
		endDate?: string;
	}[];
};

type NdcPropertyRow = {
	rxcui?: string;
	packagingList?: { packaging?: string[] };
	propertyConceptList?: { propertyConcept?: { propName: string; propValue: string }[] };
};

type FdaProduct = {
	product_ndc?: string;
	route?: string[];
	marketing_category?: string;
	application_number?: string;
	dea_schedule?: string;
	marketing_start_date?: string;
	listing_expiration_date?: string;
	finished?: boolean;
	pharm_class?: string[];
	spl_id?: string;
	openfda?: Record<string, unknown>;
	labeler_name?: string;
	brand_name?: string;
	generic_name?: string;
	dosage_form?: string;
	product_type?: string;
	marketing_end_date?: string;
	packaging?: {
		package_ndc?: string;
		description?: string;
		marketing_start_date?: string;
		marketing_end_date?: string;
		sample?: boolean;
	}[];
	active_ingredients?: { name?: string; strength?: string }[];
};
