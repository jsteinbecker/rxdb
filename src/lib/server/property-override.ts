import { env } from '$env/dynamic/private';
import { prisma } from './prisma';
import {
  type CacheRecord,
  latestCacheRecords,
  loadPackageSnapshots,
  stageCollection
} from './catalog-store';
import {
  type EquivalentPackage,
  equivalentValues,
  type PropertyOverride
} from '$lib/property-override-fields';
import { CACHE_SOURCE, mergePackage, readSnapshot } from './catalog-cache';
import { enrichPackages, type ExternalPackage } from './catalog-providers';
import { applyPropertyOverrides } from './apply-property-overrides';
import {
  buildAmbiguityOverrides,
  citeOverride,
  type OverrideCitationInput
} from './override-citation';
import type { AmbiguityKind } from '../labeler-ambiguity';

type Package = Omit<ExternalPackage, 'splXml' | 'evidence'>;

/**
 * Cached packages that may stand in for `item`: other packages of the same
 * product, then packages sharing its RxNorm concept (same ingredient,
 * strength and dose form). Only values each one actually has are listed.
 */
export async function findEquivalentPackages(item: Package): Promise<EquivalentPackage[]> {
  const siblings = item.details?.packaging?.siblings.map((sibling) => sibling.ndc) ?? [];
  const rxcui = item.details?.rxnav?.rxcui;
  // Any snapshot that ever matched nominates an NDC; only its latest snapshot
  // decides whether it still shares the concept.
  const matches = (record: CacheRecord) =>
    siblings.includes(record.sourceNativeId) ||
    (!!rxcui && readSnapshot(record.payload)?.item.details?.rxnav?.rxcui === rxcui);
  const nominated = rxcui
    ? await prisma.$queryRaw<{ ndc: string }[]>`
        SELECT DISTINCT r.source_native_id AS ndc
        FROM source_record r
        JOIN ingestion_run run ON run.id = r.ingestion_run_id
        WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
          AND r.payload #>> '{item,details,rxnav,rxcui}' = ${rxcui}`
    : [];
  const records = (
    await latestCacheRecords(
      prisma,
      [...new Set([...siblings, ...nominated.map((row) => row.ndc)])].filter(
        (ndc) => ndc !== item.ndc
      )
    )
  )
    .filter(matches)
    .slice(0, 60);
  return records
    .flatMap((record) => {
      const source = readSnapshot(record.payload)?.item;
      if (!source || source.ndc !== record.sourceNativeId) return [];
      const values = equivalentValues(item, source);
      return Object.keys(values).length
        ? [
            {
              ndc: source.ndc,
              relation: siblings.includes(source.ndc) ? ('sibling' as const) : ('concept' as const),
              description: source.description,
              labelerName: source.labelerName,
              values
            }
          ]
        : [];
    })
    .sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'sibling' ? -1 : 1));
}

/** Stages `overrides` (by field) onto the package, recording each as evidence. */
async function stageOverrides(
  current: ExternalPackage,
  overrides: Record<string, PropertyOverride>
) {
  const item = {
    ...current,
    propertyOverrides: { ...current.propertyOverrides, ...overrides },
    evidence: Object.entries(overrides).map(([key, override]) => ({
      source: 'user-override',
      nativeId: `${current.ndc}:${key}:${override.createdAt}`,
      url: `urn:rxdb:override:ndc:${current.ndc}`,
      payload: { key, ...override }
    }))
  };
  await stageCollection(prisma, [], [applyPropertyOverrides(item)]);
}

export async function savePropertyOverride(
  ndc: string,
  key: string,
  value: string,
  citation: OverrideCitationInput,
  ambiguity?: { kind: AmbiguityKind; note: string }
) {
  const current = (await loadPackageSnapshots(prisma, [ndc])).get(ndc)?.item;
  if (!current) throw new Error('No staged data for this NDC.');
  if (ambiguity)
    return stageOverrides(
      current,
      buildAmbiguityOverrides(current, key, value, ambiguity.kind, ambiguity.note, citation)
    );
  const equivalents = citation.source === 'ndc' ? await findEquivalentPackages(current) : [];
  await stageOverrides(current, {
    [key]: citeOverride(current, key, value, citation, equivalents)
  });
}

/**
 * Removes saved overrides. Staged values have the overrides applied, so the
 * package is re-fetched to restore the originals; overrides that stay are
 * re-applied on top. The removal is recorded as evidence.
 */
export async function removePropertyOverrides(ndc: string, keys: string[]) {
  const current = (await loadPackageSnapshots(prisma, [ndc])).get(ndc)?.item;
  if (!current) throw new Error('No staged data for this NDC.');
  const removed = keys.filter((key) => current.propertyOverrides?.[key]);
  if (!removed.length) throw new Error('No saved override to remove.');
  const [fresh] = await enrichPackages([ndc], env.OPENFDA_API_KEY);
  if (!fresh?.complete)
    throw new Error('Providers did not answer, so the original values could not be restored.');
  const remaining = Object.fromEntries(
    Object.entries(current.propertyOverrides ?? {}).filter(([key]) => !removed.includes(key))
  );
  const restored = mergePackage(
    { ...current, propertyOverrides: remaining },
    { ...fresh, propertyOverrides: undefined }
  );
  restored.propertyOverrides = Object.keys(remaining).length ? remaining : undefined;
  restored.evidence = [
    ...fresh.evidence,
    {
      source: 'user-override-removal',
      nativeId: `${ndc}:${new Date().toISOString()}`,
      url: `urn:rxdb:override:ndc:${ndc}`,
      payload: { keys: removed }
    }
  ];
  await stageCollection(prisma, [], [restored]);
}
