/**
 * Multi-provider package interpretation: openFDA, DailyMed, RxNav and GSRS are
 * asked about a batch of NDCs, and their answers are assembled into packages with
 * their label ingredients, moieties, routes and forms.
 *
 * @module
 */
import { routesFromProductText, routesFromLabelText, normalizeRoutes } from '../../labels/routes';
import {
	OPENFDA_NDC,
	OPENFDA_LABEL,
	fdaUrl,
	labelerNameOf,
	type FdaProduct
} from '../providers/openfda';
import {
	DAILYMED_SPL,
	DAILYMED_DOCUMENT,
	DAILYMED_INFO,
	inactivatedOnDailyMed
} from '../providers/dailymed';
import { RXNAV } from '../providers/rxnav';
import { mapLimit } from '../providers/concurrency';
import { getJson, getText, providerFailures } from '../providers/transport';
import type {
	ExternalPackage,
	LabelIngredient,
	LabelIngredientName,
	PackageDetails
} from '../../catalog/types';
import { cationsNamedIn } from '../../medication/ions';
import {
	type IonDeclaration,
	ionDeclarationsFromLabel,
	ionRows,
	type SaltFacts
} from '../medication/ion-content';
import { parsePackageFacts } from '../../catalog/package-facts';
import { hyphenCandidates, toNdc11 } from '../../catalog/ndc';
import {
	ingredientKeyOf,
	parseSplIngredients,
	type SplIngredient,
	type SplProduct,
	strengthText,
	withoutUnspecified
} from '../../labels/spl-ingredients';
import {
	type CheckedStrength,
	checkProductStrengths,
	type MoietyFactor
} from '../../labels/spl-strength-checks';
import { appearancesByPackage } from '../../labels/spl-characteristics';
import { correctDoseForm } from '../../labels/dose-form-correction';
import { reconstitutionFromLabel } from '../../labels/reconstitution';
import { labelSectionBlocks, sectionPlainText } from '../../labels/spl-sections';
import { labelScope } from '../../labels/label-relevance';
import {
	dryFillStrength,
	isDryFillForm,
	pharmacyBulkFillMl
} from '../../medication/ingredient-content';
import {
	type KitComposition,
	kitComposition,
	partContent,
	productsOfComposition
} from '../../labels/kit-parts';
import { parseUnitOfUse } from '../../catalog/ndc-packaging';

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
	// The row as the label printed it, before any salt correction.
	const salt = checked.corrections.find((correction) => correction.stated !== undefined);
	const printed = salt?.stated;
	const asPrinted = printed === undefined ? null : { ...checked, strength: printed };
	const labelStrengthOf = (strength: string | null) =>
		strength ? { labelStrength: { strength, unii: ingredient.unii, correction: salt!.kind } } : {};
	// A kit part states its strength per its own measure: `1 g/1 g` of a 7.5 g
	// bottle of powder is 7.5 g. Read as written it says nothing about content.
	const content =
		product.part && ingredient.kind === 'active' ? partContent(checked, product.part) : null;
	if (content) {
		const printedContent = asPrinted && partContent(asPrinted, product.part);
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
			...labelStrengthOf(printedContent ? `${printedContent.value} ${printedContent.unit}` : null),
			...(part ? { part } : {})
		};
	}
	const strengthOf = (row: CheckedStrength) => {
		const statedStrength = strengthText(row);
		const totalStrength =
			!dryFill &&
			fillVolumeMl !== null &&
			row.strength !== null &&
			row.per !== null &&
			row.per > 0 &&
			/^(?:mL|L)$/i.test(row.perUnit ?? '')
				? `${Number(((row.strength * fillVolumeMl * (row.perUnit!.toLowerCase() === 'l' ? 0.001 : 1)) / row.per).toPrecision(12))}${row.strengthUnit ? ` ${row.strengthUnit}` : ''}`
				: null;
		return dryFill
			? dryFillStrength(
					statedStrength,
					// The package's form, corrected where the SPL miscoded the powder as
					// its liquid; a kit's is `KIT`, so its part's form speaks for it.
					doseForm && !/\bKIT\b/i.test(doseForm) ? doseForm : product.doseForm,
					bulkFillMl,
					fillVolumeMl
				)
			: (totalStrength ?? statedStrength);
	};
	return {
		name: ingredient.name,
		unii: ingredient.unii,
		kind: ingredient.kind,
		basis: ingredient.basis,
		strength: strengthOf(checked),
		moieties: ingredient.moieties,
		productCode,
		...(checked.corrections.length
			? { strengthNotes: checked.corrections.map((correction) => correction.note) }
			: {}),
		...labelStrengthOf(asPrinted && strengthOf(asPrinted)),
		...(part ? { part } : {})
	};
}

/** An SPL's text with its markup and entities gone, one space between words. */
function splPlainText(xml: string): string {
	return xml
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;|&#160;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ');
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

export type SplPreference = { prefer?: string | null; avoid?: string[] };

/** What a caller already knows about a batch's NDCs, so enrichment need not ask again. */
export type PackageHints = {
	/** RxNorm's dose form for the concept the NDCs belong to (DF, else DFG). */
	doseForm?: string | null;
	/** Every active moiety of a UNII per GSRS; completes a label missing one of a salt's ions. */
	moietiesOf?: (unii: string) => Promise<{ unii: string; name: string }[] | null>;
	/** GSRS's salt-to-moiety mass factor for a UNII; corrects a heavy salt's mass labeled as moiety. */
	moietyFactorOf?: (unii: string) => Promise<MoietyFactor | null>;
	/** GSRS's formula and molecular weight for a UNII; how much of each ion a salt delivers. */
	saltOf?: (unii: string) => Promise<SaltFacts | null>;
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
	directory: { name: string; strength: string | null }[],
	labelText: string | null
): Map<string, string> {
	const out = new Map<string, string>();
	if (!moietyFactors.size) return out;
	for (const product of products) {
		const checked = checkProductStrengths(product, {
			rxNormName,
			moietyFactors,
			directory,
			labelText
		});
		product.ingredients.forEach((ingredient, index) => {
			if (!checked[index].corrections.some((c) => c.kind === 'moiety-equivalent')) return;
			const factor = Number(moietyFactors.get(ingredient.unii!)!.factor);
			const listed = directory.find(
				(entry) => entry.name.toLowerCase() === ingredient.name.toLowerCase()
			);
			const match = /^\s*(\d*\.?\d+)(\s*[^\d/\s]+.*)$/.exec(listed?.strength ?? '');
			if (!listed || !match) return;
			out.set(
				listed.name.toLowerCase(),
				`${Number((Number(match[1]) * factor).toPrecision(6))}${match[2]}`
			);
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
			.filter(
				(i) => i.kind === 'active' && i.basis === 'moiety' && i.unii && i.moieties.length === 1
			)
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

/** GSRS's formula and weight for every active salt named for a cation, by UNII. */
async function saltsOf(
	products: { ingredients: SplIngredient[] }[],
	saltOf: PackageHints['saltOf']
): Promise<Map<string, SaltFacts>> {
	const salts = new Map<string, SaltFacts>();
	if (!saltOf) return salts;
	const uniis = new Set(
		products
			.flatMap((product) => product.ingredients)
			.filter((i) => i.kind === 'active' && i.unii && cationsNamedIn(i.name).length)
			.map((i) => i.unii!)
	);
	await Promise.all(
		[...uniis].map(async (unii) => {
			const salt = await saltOf(unii).catch(() => null);
			if (salt) salts.set(unii, salt);
		})
	);
	return salts;
}

/** The label's rows followed by the ions its salts deliver. */
function withIonRows(
	ingredients: LabelIngredient[],
	salts: Map<string, SaltFacts>,
	moietyFactors: Map<string, MoietyFactor>,
	declared: IonDeclaration[]
): LabelIngredient[] {
	const factors = new Map([...moietyFactors].map(([unii, { factor }]) => [unii, Number(factor)]));
	return [...ingredients, ...ionRows(ingredients, salts, factors, declared)];
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
		.filter(
			(ingredient) => ingredient.kind === 'active' && ingredient.unii && ingredient.moieties.length
		);
	const known = new Map<string, Promise<{ unii: string; name: string }[] | null>>();
	for (const ingredient of ingredients) {
		const unii = ingredient.unii!;
		if (!known.has(unii))
			known.set(
				unii,
				moietiesOf(unii).catch(() => null)
			);
		const gsrs = (await known.get(unii)) ?? [];
		const listed = new Set(ingredient.moieties.map((moiety) => moiety.unii));
		if (
			gsrs.length <= listed.size ||
			![...listed].every((unii) => gsrs.some((m) => m.unii === unii))
		)
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
		// Without ndcstatus=all RxNav answers {} for NDCs it does not list as RxNorm
		// NDCs (status ALIEN, e.g. ACD-A 14537-817-75), leaving the package incomplete.
		const speciesUrl = `${RXNAV}/ndcproperties.json?id=${encodeURIComponent(ndc)}&ndcstatus=all`;
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
		// A product found without this package (even by the package-level search) is the
		// directory saying the package is not listed; only an outage leaves it unknown.
		const listed = packaging ? true : product || fdaPayload?.results?.length === 0 ? false : null;
		const splPresent =
			splPayload && Array.isArray(splPayload.data) ? splPayload.data.length > 0 : null;
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
		// The label's words, the evidence for whose mass a salt's number is.
		const splText = xml ? splPlainText(xml) : null;
		const sectionBlocks = xml ? labelSectionBlocks(xml) : {};
		// Who else this label speaks to — the suspension beside these tablets,
		// the other vial sizes — so the page can set their passages aside.
		// Stored with the label rather than applied here, so a snapshot keeps
		// the full text once and the filter can change without a re-fetch.
		const scope = labelScope(splProducts, ndc, [
			...(product?.packaging ?? []).map((item) => ({
				ndc: item.package_ndc ?? '',
				description: item.description ?? null
			})),
			{ ndc, description: packageDescription }
		]);
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
		const siblingProducts = splProducts.filter((item) => !ownProducts.includes(item));
		const codesOf = (items: typeof splProducts) =>
			items
				.flatMap((item) => [item.productCode, ...item.packageCodes])
				.filter((code) => !!code) as string[];
		const doseFormCorrection = correctDoseForm({
			// RxNorm's `Injection` stands in when the directory has no form, and is
			// just as silent on whether the vial holds a powder.
			doseForm:
				product?.dosage_form ??
				ownProducts.find((item) => item.doseForm)?.doseForm ??
				rxNormDoseForm ??
				null,
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
			siblingForms: siblingProducts.map((item) => item.doseForm),
			// The article as supplied, and whose it is when the label has siblings.
			supplied: {
				description: sectionPlainText(sectionBlocks.description) ?? labelText('description'),
				how_supplied: sectionPlainText(sectionBlocks.how_supplied) ?? labelText('how_supplied')
			},
			ownCodes: codesOf(ownProducts),
			siblingCodes: codesOf(siblingProducts),
			scope
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
							directory: sourceIngredients,
							labelText: splText
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
			sourceIngredients,
			splText
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
		const ionSalts = await saltsOf(labelProducts, hints.saltOf);
		const ionDeclarations = ionDeclarationsFromLabel(
			['how_supplied', 'description', 'dosage_and_administration'].map(labelText),
			ndc
		);
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
						scope,
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
						ingredients: withIonRows(
							[
								...labelProducts.flatMap((item) => {
									const checked = checkProductStrengths(item, {
										rxNormName: rxNormTitle,
										moietyFactors,
										directory: sourceIngredients,
										labelText: splText
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
								})
							],
							ionSalts,
							moietyFactors,
							ionDeclarations
						),
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
			// A kit's are its drug part's content; the directory lists none. The
			// directory's own numbers, not the moiety restatement used to match
			// label rows: the names are the salts', so the strengths must be too.
			ingredients: [...sourceIngredients, ...kitIngredients],
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
