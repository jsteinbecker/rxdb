/**
 * RxNav discovery: relationship traversal from a search to concepts and their
 * packages, ranking, facets and concept pages.
 *
 * @module
 */
import { getJson, providerResponsesExpired } from './transport';
import { mapLimit } from './concurrency';
import { naturalCompare } from '../../shared/natural-sort';
import { toNdc11 } from '../../catalog/ndc';
import type { RxConcept, RxConceptDetails, SourcePayload } from '../../catalog/types';
import {
	isCombination,
	knownWords,
	nameFacets,
	parseQuery,
	relevance,
	singleIngredientQuery,
	type ConceptMatch,
	type FacetCount,
	type SearchFacets,
	type SearchFilters
} from '../../catalog/search-relevance';

export const RXNAV = 'https://rxnav.nlm.nih.gov/REST';
export const MAX_CONCEPTS = 10;
/** Approximate candidates scoring below this share of the best one are dropped. */
const APPROXIMATE_CUTOFF = 0.7;

export async function discoverRxNav(query: string): Promise<RxConcept[]> {
	return (await discoverRxNavPage(query, 0, undefined, { weak: true, combos: true })).concepts;
}

/** The ranked graph behind a query, so later pages fetch only their own NDCs. */
const RANKING_TTL_MS = 60 * 60 * 1000;
const rankings = new Map<string, { at: number; ranking: Promise<RxRanking> }>();
type RxRanking = Awaited<ReturnType<typeof rankRxNav>>;

function rankingOf(query: string): Promise<RxRanking> {
	const key = query.trim().toLocaleLowerCase();
	const now = Date.now();
	const hit = rankings.get(key);
	if (hit && now - hit.at < RANKING_TTL_MS && !providerResponsesExpired(hit.at)) return hit.ranking;
	for (const [entry, value] of rankings)
		if (now - value.at >= RANKING_TTL_MS) rankings.delete(entry);
	if (rankings.size >= 64) rankings.delete(rankings.keys().next().value!);
	const ranking = rankRxNav(query);
	rankings.set(key, { at: now, ranking });
	ranking.then(
		(result) => {
			// A fuzzy ranking is often a word still being typed: keep it only briefly.
			const entry = rankings.get(key);
			if (result.approximate && entry?.ranking === ranking)
				entry.at = now - RANKING_TTL_MS + APPROXIMATE_TTL_MS;
		},
		() => {
			if (rankings.get(key)?.ranking === ranking) rankings.delete(key);
		}
	);
	return ranking;
}

const APPROXIMATE_TTL_MS = 5 * 60 * 1000;

/** RxNav's closest spelling of a query it could not find, or null. */
async function spellingSuggestion(query: string): Promise<string | null> {
	try {
		const payload = (await getJson(
			`${RXNAV}/spellingsuggestions.json?name=${encodeURIComponent(query)}`
		)) as { suggestionGroup?: { suggestionList?: { suggestion?: string[] } } };
		const first = payload.suggestionGroup?.suggestionList?.suggestion?.[0];
		return first && first.toLocaleLowerCase() !== query.trim().toLocaleLowerCase() ? first : null;
	} catch {
		return null;
	}
}

function countBy(values: (string | null)[]): FacetCount[] {
	const counts = new Map<string, number>();
	for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || naturalCompare(a.value, b.value));
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
	stored?: (rxcuis: string[]) => Promise<Map<string, StoredConcept>>,
	filters: SearchFilters = {}
): Promise<{
	concepts: RxConcept[];
	total: number;
	reused: string[];
	matches: Record<string, ConceptMatch>;
	facets: SearchFacets;
	suggestion: string | null;
	approximate: boolean;
}> {
	const ranking = await rankingOf(query);
	const tier = (rxcui: string) => ranking.matches.get(rxcui)?.tier ?? 'strong';
	// Weaker matches and set-aside combinations are listed only when asked for.
	const pool = ranking.roots.filter((root) => {
		const value = tier(root.rxcui);
		return value === 'strong' || (value === 'combo' && filters.combos) || filters.weak;
	});
	const facetsOf = new Map(pool.map((root) => [root.rxcui, nameFacets(root.name)]));
	const facets: SearchFacets = {
		forms: countBy(
			pool
				.filter(
					(root) => !filters.strength || facetsOf.get(root.rxcui)!.strength === filters.strength
				)
				.map((root) => facetsOf.get(root.rxcui)!.form)
		),
		strengths: countBy(
			pool
				.filter((root) => !filters.form || facetsOf.get(root.rxcui)!.form === filters.form)
				.map((root) => facetsOf.get(root.rxcui)!.strength)
		),
		combos: ranking.roots.filter((root) => tier(root.rxcui) === 'combo').length,
		weak: ranking.roots.filter((root) => tier(root.rxcui) === 'weak').length
	};
	const filtered = pool.filter((root) => {
		const facet = facetsOf.get(root.rxcui)!;
		return (
			(!filters.form || facet.form === filters.form) &&
			(!filters.strength || facet.strength === filters.strength)
		);
	});
	const known = stored
		? await stored(filtered.map((root) => root.rxcui))
		: new Map<string, StoredConcept>();
	const empty = (rxcui: string) => {
		const entry = known.get(rxcui);
		return entry && isEmptyConcept(entry.concept) ? 1 : 0;
	};
	// Stable: the ranking's own order holds within each group.
	const roots = [...filtered].sort((a, b) => empty(a.rxcui) - empty(b.rxcui));
	const reuse = new Map(
		[...known].flatMap(([rxcui, entry]) => (entry.fresh ? [[rxcui, entry.concept] as const] : []))
	);
	const page = await pageOfRanking(offset, { ...ranking, roots }, reuse);
	return {
		...page,
		// Within the page too, anything with nothing to load goes last.
		concepts: [...page.concepts].sort(
			(a, b) => Number(isEmptyConcept(a)) - Number(isEmptyConcept(b))
		),
		reused: page.concepts
			.filter((concept) => reuse.has(concept.rxcui))
			.map((concept) => concept.rxcui),
		matches: Object.fromEntries(
			page.concepts.flatMap((concept) => {
				const match = ranking.matches.get(concept.rxcui);
				return match ? [[concept.rxcui, match]] : [];
			})
		),
		facets,
		suggestion: ranking.suggestion,
		approximate: ranking.approximate
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
	let suggestion: string | null = null;
	if (!ids.length && !numeric) {
		const url = `${RXNAV}/approximateTerm.json?term=${encodeURIComponent(query)}&maxEntries=${MAX_CONCEPTS}&option=1`;
		const payload = (await getJson(url)) as {
			approximateGroup?: { candidate?: { rxcui?: string; score?: string }[] };
		};
		// Keep only candidates close to the best one: the tail of an approximate
		// match is unrelated words that happen to share letters.
		const candidates = payload.approximateGroup?.candidate ?? [];
		const top = Math.max(0, ...candidates.map((candidate) => Number(candidate.score) || 0));
		ids = [
			...new Set(
				candidates
					.filter((candidate) => !top || (Number(candidate.score) || 0) >= top * APPROXIMATE_CUTOFF)
					.flatMap((candidate) => candidate.rxcui ?? [])
			)
		];
		approximate = { source: 'rxnav', nativeId: `approximate:${query}`, url, payload };
		suggestion = await spellingSuggestion(query);
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
	// Rank before paging. Each root is scored against the query by its own name and
	// the brands rolled into it; an exact RxCUI leads, then complete matches by score,
	// generic nodes before brands that stand alone, non-packs, and a numeric-aware
	// name order so strengths sort.
	const parsed = parseQuery(query);
	// RxNav's approximate match returns the drug as typed beside its look-alikes;
	// a word one of them spells is no misspelling of the others.
	const known = knownWords(
		[...members].flatMap(([rxcui, list]) => [
			concepts.get(rxcui)!.name,
			...list.map((member) => member.name)
		])
	);
	const scored = [...members.keys()].map((rxcui) => {
		const concept = concepts.get(rxcui)!;
		const fit = numeric
			? { matched: true, score: 0, reasons: [], missing: [] }
			: relevance(
					parsed,
					{
						name: concept.name,
						aliases: (members.get(rxcui) ?? []).map((member) => member.name)
					},
					known
				);
		return { concept, fit };
	});
	// A single-ingredient query sets combinations aside, but only when it has
	// single-ingredient answers; a combination brand's own generic still leads.
	const setAside = (item: (typeof scored)[number]) =>
		!numeric &&
		singleIngredientQuery(parsed) &&
		isCombination(item.concept.name) &&
		scored.some((other) => other.fit.matched && !isCombination(other.concept.name));
	const anyMatched = scored.some((item) => item.fit.matched);
	const matches = new Map<string, ConceptMatch>(
		scored.map((item) => [
			item.concept.rxcui,
			{
				// Nothing matched completely (an abbreviation RxNorm does not use, say):
				// the partial matches are all there is, so none is hidden.
				tier: item.fit.matched || !anyMatched ? (setAside(item) ? 'combo' : 'strong') : 'weak',
				reasons: item.fit.reasons,
				missing: item.fit.missing
			}
		])
	);
	const tierOrder = { strong: 0, combo: 1, weak: 2 } as const;
	const key = (item: (typeof scored)[number]) => [
		// An RxCUI lookup must keep its own concept on the first page.
		Number(item.concept.rxcui !== query.trim()),
		tierOrder[matches.get(item.concept.rxcui)!.tier],
		-item.fit.score,
		Number(branded.has(item.concept.tty ?? '')),
		Number(item.concept.tty === 'GPCK' || item.concept.tty === 'BPCK')
	];
	const roots = scored
		.sort((a, b) => {
			const [x, y] = [key(a), key(b)];
			const i = x.findIndex((value, index) => value !== y[index]);
			return i >= 0 ? x[i] - y[i] : naturalCompare(a.concept.name, b.concept.name);
		})
		.map((item) => item.concept);
	return {
		roots,
		matches,
		suggestion,
		approximate: Boolean(approximate),
		members,
		concepts,
		parentsOf,
		counterpartsOf,
		evidence,
		related
	};
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
