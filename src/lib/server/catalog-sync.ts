import { env } from '$env/dynamic/private';
import { prisma } from '$lib/server/prisma';
import { toNdc11 } from '../ndc';
import {
	discoverRxNav,
	discoverRxNavPage,
	enrichPackages,
	type ExternalPackage,
	type RxConcept
} from './catalog-providers';
import { collectPackages } from './catalog-collection';
import { exclusionReason } from './catalog-facts';
import {
	loadConceptSnapshots,
	loadPackageSnapshots,
	refreshPackageEligibility,
	stageCollection
} from './catalog-store';
import {
	DEFAULT_FORMULARY,
	findDefaultScope,
	defaultScope,
	loadedOrigins,
	loadToFormulary,
	type LoadTarget
} from './catalog-formulary';

const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
const recentSearches = new Map<string, { expiresAt: number; promise: Promise<SyncSummary> }>();
export type SyncSummary = {
	concepts: number;
	packages: number;
	excluded: number;
	partial: boolean;
	/** Ranked RxNav roots available across all pages, and this page's offset. */
	total: number;
	offset: number;
	staged: { concepts: RxConcept[]; packages: ExternalPackage[] };
};

/** Read-through package collection shared by search and package detail. Fetched
 * data is staged as provenance; nothing enters the catalog until it is loaded. */
export async function syncExternalPackages(ndcs: string[], { force = false } = {}) {
	const packages = await collectPackages(
		ndcs,
		{
			load: (ndcs) => loadPackageSnapshots(prisma, ndcs),
			fetch: (ndcs) => enrichPackages(ndcs, env.OPENFDA_API_KEY),
			save: (items) => stageCollection(prisma, [], items)
		},
		new Date(),
		{ force }
	);
	// Marketing dates can cross midnight while otherwise fresh facts stay cached.
	await refreshPackageEligibility(prisma, packages);
	return packages;
}

async function runExternalSearchSync(query: string, offset: number): Promise<SyncSummary> {
	const directNdc = toNdc11(query);
	// BUD is an established abbreviation for beyond-use dating in this app's
	// compounding domain. Sending the bare acronym to RxNav's approximate-term
	// endpoint produces unrelated lexical matches (including botanical terms).
	const isBeyondUseDateQuery = /^B\.?U\.?D\.?$/i.test(query.trim());
	let discoveryFailed = false;
	const { concepts, total } = isBeyondUseDateQuery
		? { concepts: [], total: 0 }
		: await discoverRxNavPage(query, offset).catch((error) => {
				if (!directNdc) throw error;
				discoveryFailed = true;
				return { concepts: [], total: 0 };
			});
	// Later pages list only RxNav concepts; a direct NDC hit belongs to page one.
	const includeDirect = directNdc && offset === 0;
	await stageCollection(prisma, concepts, []);
	const packages = await syncExternalPackages([
		...(includeDirect ? [directNdc] : []),
		...concepts.flatMap((concept) => concept.ndcs)
	]);
	const excluded = packages.filter((item) => exclusionReason(item) !== null).length;
	return {
		concepts: concepts.filter((concept) => !concept.vetOnly).length,
		packages: packages.filter(
			(item) =>
				!exclusionReason(item) &&
				(item.listed || item.splPresent || item.rxcuiStatus?.toUpperCase() === 'ACTIVE')
		).length,
		excluded,
		partial: discoveryFailed || packages.some((item) => !item.complete),
		total,
		offset,
		staged: { concepts, packages }
	};
}

export function syncExternalSearch(query: string, offset = 0): Promise<SyncSummary> {
	const key = `${toNdc11(query) ?? query.trim().toLocaleLowerCase()}@${offset}`;
	const cached = recentSearches.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.promise;
	for (const [entry, value] of recentSearches) {
		if (value.expiresAt <= Date.now()) recentSearches.delete(entry);
	}
	if (recentSearches.size >= 128) recentSearches.delete(recentSearches.keys().next().value!);
	const promise = runExternalSearchSync(query, offset)
		.catch((error) => {
			recentSearches.delete(key);
			throw error;
		});
	recentSearches.set(key, { expiresAt: Date.now() + SEARCH_TTL_MS, promise });
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
	if (target.kind === 'concept') {
		concept = force
			? null
			: ((await loadConceptSnapshots(prisma, [target.rxcui])).get(target.rxcui) ?? null);
		if (!concept) {
			const found = await discoverRxNav(target.rxcui);
			concept = found.find((item) => item.rxcui === target.rxcui) ?? null;
			if (concept) await stageCollection(prisma, [concept], []);
		}
		if (!concept) throw new Error(`RxCUI ${target.rxcui} could not be found.`);
		if (concept.vetOnly) throw new Error('Veterinary-only concepts cannot be loaded.');
		ndcs = concept.ndcs;
	} else ndcs = [target.ndc];
	const packages = await syncExternalPackages(ndcs, { force });
	const result = await loadToFormulary(prisma, scope.id, target, concept, packages);
	await refreshPackageEligibility(prisma, packages);
	return { ...result, scope: { id: scope.id, name: scope.name } };
}

/** Mark which staged nodes are already on the formulary. */
export async function loadedState(concepts: RxConcept[], packages: ExternalPackage[]) {
	const scope =
		(await prisma.scope.findFirst({ where: { kind: 'formulary', name: DEFAULT_FORMULARY } })) ??
		(await findDefaultScope(prisma));
	if (!scope) return { scope: null, loaded: new Set<string>() };
	const loaded = await loadedOrigins(prisma, scope.id, [
		...concepts.map((concept) => ({ kind: 'concept' as const, rxcui: concept.rxcui })),
		...packages.map((item) => ({ kind: 'package' as const, ndc: item.ndc }))
	]);
	return { scope: { id: scope.id, name: scope.name }, loaded };
}

export type StagedPackage = Omit<ExternalPackage, 'evidence' | 'splXml'> & {
	exclusionReason: string | null;
	loaded: boolean;
};
export type StagedConcept = Omit<RxConcept, 'evidence'> & {
	loaded: boolean;
	packages: StagedPackage[];
};

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
					loaded: loaded.has(`${scope?.id}:ndc:${item.ndc}`)
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
		return { ...rest, loaded: loaded.has(`${scope?.id}:rxcui:${concept.rxcui}`), packages };
	});
	return {
		scope,
		concepts,
		packages: [...byNdc.values()].filter((item) => !claimed.has(item.ndc))
	};
}
