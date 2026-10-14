import type { PrismaClient } from '../../generated/client';
import { applyLocalConcepts, resolveLocal, type LocalConceptRecord, type LocalConceptView } from '../local-concept-view';
import { loadConceptSnapshots } from './catalog-store';
import type { ExternalPackage, RxConcept } from './catalog-providers';
import { localConceptsForRxcuis } from './local-concept-store';

type LoadRecords = (db: PrismaClient, scopeId: string, rxcuis: string[]) => Promise<Map<string, LocalConceptRecord>>;
type LoadSnapshots = (db: PrismaClient, rxcuis: string[]) => Promise<Map<string, RxConcept>>;

/**
 * rxcui -> local view for the scope: direct mappings, plus derived SBDs for
 * rxcuis with no mapping of their own whose SCD counterpart is mapped.
 * Read paths only (never sync, staging or reinterpret).
 */
export async function localConceptsByRxcui(
  db: PrismaClient,
  scopeId: string,
  rxcuis: string[],
  loadRecords: LoadRecords = localConceptsForRxcuis,
  loadSnapshots: LoadSnapshots = loadConceptSnapshots
): Promise<Map<string, LocalConceptView>> {
  const wanted = [...new Set(rxcuis.filter(Boolean))];
  if (!wanted.length) return new Map();
  const byRxcui = new Map(await loadRecords(db, scopeId, wanted));
  const unmapped = wanted.filter((rxcui) => !byRxcui.has(rxcui));
  const counterparts = new Map<string, string>();
  const brands = new Map<string, string>();
  if (unmapped.length) {
    const snapshots = await loadSnapshots(db, unmapped);
    for (const rxcui of unmapped) {
      const details = snapshots.get(rxcui)?.details;
      const scd = details?.counterparts.find((c) => c.tty === 'SCD');
      const brand = details?.brands[0]?.name;
      if (scd) counterparts.set(rxcui, scd.rxcui);
      if (brand) brands.set(rxcui, brand);
    }
    const scdKeys = [...new Set(counterparts.values())].filter((rxcui) => !byRxcui.has(rxcui));
    if (scdKeys.length) for (const [k, v] of await loadRecords(db, scopeId, scdKeys)) byRxcui.set(k, v);
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
  loadRecords: LoadRecords = localConceptsForRxcuis,
  loadSnapshots: LoadSnapshots = loadConceptSnapshots
): Promise<(T & { localConcept?: LocalConceptView })[]> {
  try {
    return await applyLocalConcepts(items, (rxcuis) =>
      localConceptsByRxcui(db, scopeId, rxcuis, loadRecords, loadSnapshots)
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
  loadRecords?: LoadRecords,
  loadSnapshots?: LoadSnapshots
): Promise<Tree> {
  const flat = [...tree.concepts.flatMap((c) => c.packages), ...tree.packages];
  const resolved = await withLocalConcepts(db, scopeId, flat, loadRecords, loadSnapshots);
  let next = 0;
  return {
    ...tree,
    concepts: tree.concepts.map((c) => ({ ...c, packages: c.packages.map(() => resolved[next++]) })),
    packages: tree.packages.map(() => resolved[next++])
  };
}
