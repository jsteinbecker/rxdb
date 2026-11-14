/**
 * Display-time local concepts: items and staged trees annotated with the local
 * concept that supersedes their RxCUI in a scope.
 *
 * @module
 */
import type { PrismaClient } from '../../../generated/client';
import {
	applyLocalConcepts,
	resolveLocal,
	type LocalConceptRecord,
	type LocalConceptView
} from '../../curation/local-concept-view';
import { loadConceptSnapshots, sbdIndex } from '../catalog/snapshot-store';
import type { ExternalPackage, RxConcept } from '../../catalog/types';
import { activeLocalConcepts } from './local-concept-store';

type LoadActive = (db: PrismaClient, scopeId: string) => Promise<Map<string, LocalConceptRecord>>;
type LoadSnapshots = (db: PrismaClient, rxcuis: string[]) => Promise<Map<string, RxConcept>>;

/**
 * rxcui -> local view for the scope: direct mappings, plus derived SBDs for
 * rxcuis with no mapping of their own whose SCD counterpart is mapped.
 * Starts from the scope's active mappings (few), so a scope without local
 * concepts reads nothing else, and only the mapped SCDs' snapshots are read
 * to find which requested SBDs they claim. Read paths only (never sync,
 * staging or reinterpret).
 */
export async function localConceptsByRxcui(
	db: PrismaClient,
	scopeId: string,
	rxcuis: string[],
	loadActive: LoadActive = activeLocalConcepts,
	loadSnapshots: LoadSnapshots = loadConceptSnapshots
): Promise<Map<string, LocalConceptView>> {
	const wanted = [...new Set(rxcuis.filter(Boolean))];
	if (!wanted.length) return new Map();
	const byRxcui = await loadActive(db, scopeId);
	if (!byRxcui.size) return new Map();
	const unmapped = wanted.filter((rxcui) => !byRxcui.has(rxcui));
	const counterparts = new Map<string, string>();
	const brands = new Map<string, string>();
	if (unmapped.length) {
		// A derived SBD needs a mapped SCD, so only mapped rxcuis' snapshots can claim one.
		const snapshots = await loadSnapshots(db, [...byRxcui.keys()]);
		for (const [rxcui, { scdRxcui, brand }] of sbdIndex([...snapshots.values()], unmapped)) {
			counterparts.set(rxcui, scdRxcui);
			if (brand) brands.set(rxcui, brand);
		}
	}
	return resolveLocal(wanted, byRxcui, counterparts, brands);
}

/**
 * Display-time local concepts: items whose RxCUI is superseded in the scope get
 * `localConcept`. Falls back to the items unchanged if the lookup throws.
 */
export async function withLocalConcepts<T extends Pick<ExternalPackage, 'details'>>(
	db: PrismaClient,
	scopeId: string,
	items: T[],
	loadActive: LoadActive = activeLocalConcepts,
	loadSnapshots: LoadSnapshots = loadConceptSnapshots
): Promise<(T & { localConcept?: LocalConceptView })[]> {
	try {
		return await applyLocalConcepts(items, (rxcuis) =>
			localConceptsByRxcui(db, scopeId, rxcuis, loadActive, loadSnapshots)
		);
	} catch (error) {
		console.error('local concept lookup failed; serving un-augmented data', error);
		return items;
	}
}

type Resolvable = Pick<ExternalPackage, 'details'>;

/** `withLocalConcepts` for a staged tree: one lookup, packages put back where they came from. */
export async function withLocalConceptsInTree<
	P extends Resolvable,
	Tree extends { concepts: { packages: P[] }[]; packages: P[] }
>(
	db: PrismaClient,
	scopeId: string,
	tree: Tree,
	loadActive?: LoadActive,
	loadSnapshots?: LoadSnapshots
): Promise<Tree> {
	const flat = [...tree.concepts.flatMap((c) => c.packages), ...tree.packages];
	const resolved = await withLocalConcepts(db, scopeId, flat, loadActive, loadSnapshots);
	let next = 0;
	return {
		...tree,
		concepts: tree.concepts.map((c) => ({
			...c,
			packages: c.packages.map(() => resolved[next++])
		})),
		packages: tree.packages.map(() => resolved[next++])
	};
}
