/**
 * Search and load orchestration: read-through collection shared by search and
 * package detail, staged concept trees, and promoting a staged node into the
 * formulary.
 *
 * @module
 */
import { logger } from '../infrastructure/log';
import {
	filtersQuery,
	type ConceptMatch,
	type SearchFacets,
	type SearchFilters
} from '../../catalog/search-relevance';
import { env } from '$env/dynamic/private';
import {
	gsrsMoieties,
	gsrsMoietyFactor,
	gsrsSalt,
	prismaSubstanceTable
} from '../medication/substance-store';
import { jobNote, jobStage } from '../infrastructure/jobs';
import { cmsBilling, ensureCrosswalk } from '../providers/cms-billing';
import { prisma } from '$lib/server/infrastructure/database';
import { toNdc11 } from '../../catalog/ndc';
import { discoverRxNav, discoverRxNavPage } from '../providers/rxnav';
import { enrichPackages } from './enrich-packages';
import { searchFdaProducts } from '../providers/openfda';
import { expireProviderResponses } from '../providers/transport';
import type { ExternalPackage, RxConcept, StagedConcept, StagedPackage } from '../../catalog/types';
import type { PackageHints } from './enrich-packages';
import { collectPackages } from './collection';
import { productSet, setPackageNdcs } from './product-sets';
import { exclusionReason } from '../../catalog/package-facts';
import {
	loadConceptSnapshots,
	latestPropertyOverrides,
	loadPackageSnapshots,
	loadStoredConcepts,
	stageCollection
} from './snapshot-store';
import { refreshPackageEligibility } from './entity-store';
import {
	DEFAULT_FORMULARY,
	defaultScope,
	findDefaultScope,
	loadedOrigins,
	type LoadTarget,
	loadToFormulary
} from '../formulary/membership';

const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
const APPROXIMATE_SEARCH_TTL_MS = 5 * 60 * 1000;
const recentSearches = new Map<string, { expiresAt: number; promise: Promise<SyncSummary> }>();
export type SyncSummary = {
	concepts: number;
	/** NDCs the page's concepts list; their packages are fetched per concept. */
	ndcs: number;
	/** Packages enriched with the search itself (a direct NDC hit only). */
	packages: number;
	excluded: number;
	partial: boolean;
	/** Ranked RxNav roots available across all pages, and this page's offset. */
	total: number;
	offset: number;
	/** Why each concept on the page is listed, by RxCUI. */
	matches: Record<string, ConceptMatch>;
	facets: SearchFacets | null;
	/** RxNav's spelling of a query it could only match approximately. */
	suggestion: string | null;
	approximate: boolean;
	staged: { concepts: RxConcept[]; packages: ExternalPackage[] };
};

/** Read-through package collection shared by search and package detail. Fetched
 * data is staged as provenance; nothing enters the catalog until it is loaded. */
export async function syncExternalPackages(
	ndcs: string[],
	{ force = false, hints = {} }: { force?: boolean; hints?: PackageHints } = {}
) {
	if (force) expireProviderResponses();
	const packages = await collectPackages(
		ndcs,
		{
			load: (ndcs) => loadPackageSnapshots(prisma, ndcs),
			loadOverrides: (ndcs) => latestPropertyOverrides(prisma, ndcs),
			fetch: (ndcs) =>
				enrichPackages(ndcs, env.OPENFDA_API_KEY2, undefined, {
					...hints,
					moietiesOf: gsrsMoieties(prismaSubstanceTable(prisma)),
					moietyFactorOf: gsrsMoietyFactor(prismaSubstanceTable(prisma)),
					saltOf: gsrsSalt(prismaSubstanceTable(prisma))
				}),
			save: (items) => stageCollection(prisma, [], items)
		},
		new Date(),
		{ force }
	);
	// Marketing dates can cross midnight while otherwise fresh facts stay cached.
	await refreshPackageEligibility(prisma, packages);
	return packages;
}

async function runExternalSearchSync(
	query: string,
	offset: number,
	filters: SearchFilters
): Promise<SyncSummary> {
	const directNdc = toNdc11(query);
	// BUD is an established abbreviation for beyond-use dating in this app's
	// compounding domain. Sending the bare acronym to RxNav's approximate-term
	// endpoint produces unrelated lexical matches (including botanical terms).
	const isBeyondUseDateQuery = /^B\.?U\.?D\.?$/i.test(query.trim());
	let discoveryFailed = false;
	const nothing = {
		concepts: [],
		total: 0,
		reused: [] as string[],
		matches: {},
		facets: null,
		suggestion: null,
		approximate: false
	};
	const { concepts, total, reused, matches, facets, suggestion, approximate } = isBeyondUseDateQuery
		? nothing
		: await discoverRxNavPage(
				query,
				offset,
				(rxcuis) => loadStoredConcepts(prisma, rxcuis),
				filters
			).catch((error) => {
				if (!directNdc) throw error;
				discoveryFailed = true;
				return nothing;
			});
	// Later pages list only RxNav concepts; a direct NDC hit belongs to page one.
	const includeDirect = directNdc && offset === 0;
	// Reused snapshots are not restaged: that would renew their freshness without a fetch.
	await stageCollection(
		prisma,
		concepts.filter((concept) => !reused.includes(concept.rxcui)),
		[]
	);
	// Concept packages are the slow part (several providers per NDC), so the
	// search returns without them; they are warmed in rank order meanwhile.
	warmConceptPackages(concepts);
	const packages = includeDirect ? await syncExternalPackages([directNdc]) : [];
	const excluded = packages.filter((item) => exclusionReason(item) !== null).length;
	return {
		concepts: concepts.filter((concept) => !concept.vetOnly).length,
		ndcs: concepts.reduce((sum, concept) => sum + concept.ndcs.length, 0),
		packages: packages.filter(
			(item) =>
				!exclusionReason(item) &&
				(item.listed || item.splPresent || item.rxcuiStatus?.toUpperCase() === 'ACTIVE')
		).length,
		excluded,
		partial: discoveryFailed || packages.some((item) => !item.complete),
		total,
		offset,
		matches,
		facets,
		suggestion,
		approximate,
		// Direct packages stay unclaimed: no concept on this page has fetched them.
		staged: { concepts, packages }
	};
}

const inflightPackages = new Map<string, Promise<ExternalPackage[]>>();

/** A concept's packages, sharing one in-flight collection between the warm-up,
 * an expanded search row and a load. Settled work is served by the snapshot cache. */
export function conceptPackages(concept: Pick<RxConcept, 'rxcui' | 'ndcs' | 'details'>) {
	let pending = inflightPackages.get(concept.rxcui);
	if (!pending) {
		pending = syncExternalPackages(concept.ndcs, { hints: conceptHints(concept) }).finally(() =>
			inflightPackages.delete(concept.rxcui)
		);
		inflightPackages.set(concept.rxcui, pending);
	}
	return pending;
}

/** What discovery already learned about a concept's NDCs. */
function conceptHints(concept: Pick<RxConcept, 'details'>): PackageHints {
	const forms = concept.details?.doseForms;
	// Concepts staged before details existed carry no forms; let enrichment ask.
	if (!forms) return {};
	const form = forms.find((item) => item.tty === 'DF') ?? forms.find((item) => item.tty === 'DFG');
	return form ? { doseForm: form.name } : {};
}

/** Fire-and-forget, one concept at a time so an expanded row is not starved. */
function warmConceptPackages(concepts: RxConcept[]) {
	void (async () => {
		for (const concept of concepts) {
			if (concept.vetOnly || !concept.ndcs.length) continue;
			await conceptPackages(concept).catch((error) =>
				logger('package-warmup').warn('Concept package warm-up failed', {
					rxcui: concept.rxcui,
					error
				})
			);
		}
	})();
}

/** One staged concept's packages, shaped for the search tree; null if never staged. */
export async function stagedConceptPackages(rxcui: string) {
	const concept = (await loadConceptSnapshots(prisma, [rxcui])).get(rxcui);
	if (!concept) return null;
	const packages = concept.vetOnly ? [] : await conceptPackages(concept);
	const tree = await stagedTree({ concepts: [concept], packages });
	return {
		packages: tree.concepts[0]?.packages ?? [],
		excluded: packages.filter((item) => exclusionReason(item) !== null).length,
		partial: packages.some((item) => !item.complete)
	};
}

export function syncExternalSearch(
	query: string,
	offset = 0,
	filters: SearchFilters = {}
): Promise<SyncSummary> {
	const key = `${toNdc11(query) ?? query.trim().toLocaleLowerCase()}@${offset}${filtersQuery(filters)}`;
	const cached = recentSearches.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.promise;
	for (const [entry, value] of recentSearches) {
		if (value.expiresAt <= Date.now()) recentSearches.delete(entry);
	}
	if (recentSearches.size >= 128) recentSearches.delete(recentSearches.keys().next().value!);
	const promise = runExternalSearchSync(query, offset, filters).catch((error) => {
		recentSearches.delete(key);
		throw error;
	});
	const entry = { expiresAt: Date.now() + SEARCH_TTL_MS, promise };
	recentSearches.set(key, entry);
	// An approximate match is often a word still being typed; don't hold it for hours.
	void promise.then(
		(summary) => {
			if (summary.approximate || summary.partial)
				entry.expiresAt = Date.now() + APPROXIMATE_SEARCH_TTL_MS;
		},
		() => {}
	);
	return promise;
}

/** Promote one staged node into the formulary, refetching if its snapshot expired. */
export async function loadStagedNode(
	target: LoadTarget,
	scopeId?: string,
	{ force = false }: { force?: boolean } = {}
) {
	const scope = scopeId
		? await prisma.scope.findUniqueOrThrow({ where: { id: scopeId } })
		: await defaultScope(prisma);
	let concept: RxConcept | null = null;
	let ndcs: string[];
	const set = target.kind === 'set' ? productSet(target.key) : null;
	if (target.kind === 'set') {
		if (!set) throw new Error(`There is no curated product set "${target.key}".`);
		jobStage(`Finding ${set.name} products in the openFDA NDC directory`);
		ndcs = setPackageNdcs(set, await searchFdaProducts(set.search, env.OPENFDA_API_KEY2));
		if (!ndcs.length) throw new Error(`openFDA listed no qualifying ${set.name} packages.`);
		jobNote(`${set.name}: ${ndcs.length} NDC${ndcs.length === 1 ? '' : 's'}`);
	} else if (target.kind === 'concept') {
		concept = force
			? null
			: ((await loadConceptSnapshots(prisma, [target.rxcui])).get(target.rxcui) ?? null);
		if (!concept) {
			jobStage(`Looking up RxCUI ${target.rxcui} in RxNav`);
			const found = await discoverRxNav(target.rxcui);
			concept = found.find((item) => item.rxcui === target.rxcui) ?? null;
			if (concept) await stageCollection(prisma, [concept], []);
		}
		if (!concept) throw new Error(`RxCUI ${target.rxcui} could not be found.`);
		if (concept.vetOnly) throw new Error('Veterinary-only concepts cannot be loaded.');
		ndcs = concept.ndcs;
		jobNote(`${concept.name}: ${ndcs.length} NDC${ndcs.length === 1 ? '' : 's'}`);
	} else ndcs = [target.ndc];
	jobStage(
		force
			? `Re-fetching ${ndcs.length} package${ndcs.length === 1 ? '' : 's'} from openFDA, DailyMed & RxNav`
			: `Collecting ${ndcs.length} package${ndcs.length === 1 ? '' : 's'}`
	);
	// Joins a search warm-up already collecting this concept's packages.
	const packages =
		concept && !force
			? await conceptPackages(concept)
			: await syncExternalPackages(ndcs, { force });
	jobNote(`${packages.length} of ${ndcs.length} packages returned by sources`);
	jobStage('Linking packages to the formulary');
	const result = await loadToFormulary(prisma, scope.id, target, concept, packages, set?.name);
	jobStage('Checking package eligibility');
	await refreshPackageEligibility(prisma, packages);
	if (typeof result.packagesLinked === 'number')
		jobNote(`${result.packagesLinked} packages linked`);
	jobStage('Looking up CMS billing codes');
	// A refresh re-checks cms.gov for a newer quarter; an add uses the daily check.
	await ensureCrosswalk(prisma, { force });
	const billed = await cmsBilling(prisma, packages);
	jobNote(`${billed.size} of ${packages.length} packages in the CMS NDC–HCPCS crosswalk`);
	return { ...result, cmsBilled: billed.size, scope: { id: scope.id, name: scope.name } };
}

/** Mark which staged nodes are already on the formulary. */
export async function loadedState(concepts: RxConcept[], packages: ExternalPackage[]) {
	const scope =
		(await prisma.scope.findFirst({ where: { kind: 'formulary', name: DEFAULT_FORMULARY } })) ??
		(await findDefaultScope(prisma));
	if (!scope) return { scope: null, loaded: new Map<string, string>() };
	const loaded = await loadedOrigins(prisma, scope.id, [
		...concepts.map((concept) => ({ kind: 'concept' as const, rxcui: concept.rxcui })),
		...packages.map((item) => ({ kind: 'package' as const, ndc: item.ndc }))
	]);
	return { scope: { id: scope.id, name: scope.name }, loaded };
}

/** Shape a sync into a concept → package tree annotated with formulary state. */
export async function stagedTree(staged: SyncSummary['staged']) {
	const { scope, loaded } = await loadedState(staged.concepts, staged.packages);
	const byNdc = new Map(
		staged.packages.map((item) => {
			const { evidence: _evidence, splXml: _xml, ...facts } = item;
			void _evidence;
			void _xml;
			return [
				item.ndc,
				{
					...facts,
					exclusionReason: exclusionReason(item),
					loaded: loaded.has(`${scope?.id}:ndc:${item.ndc}`),
					formularyItemId: loaded.get(`${scope?.id}:ndc:${item.ndc}`) ?? null
				} satisfies StagedPackage
			] as const;
		})
	);
	const claimed = new Set<string>();
	const concepts: StagedConcept[] = staged.concepts.map((concept) => {
		const { evidence: _evidence, ...rest } = concept;
		void _evidence;
		const packages = concept.ndcs.flatMap((ndc) => {
			const item = byNdc.get(ndc);
			if (item) claimed.add(ndc);
			return item ? [item] : [];
		});
		const key = `${scope?.id}:rxcui:${concept.rxcui}`;
		return {
			...rest,
			loaded: loaded.has(key),
			formularyItemId: loaded.get(key) ?? null,
			packages
		};
	});
	return {
		scope,
		concepts,
		packages: [...byNdc.values()].filter((item) => !claimed.has(item.ndc))
	};
}
