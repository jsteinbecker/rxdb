import { prisma } from './prisma';
import { loadPackageSnapshots, stageCollection } from './catalog-store';
import { equivalentValues, type EquivalentPackage } from '$lib/property-override-fields';
import { CACHE_SOURCE, readSnapshot } from './catalog-cache';
import type { ExternalPackage } from './catalog-providers';
import { applyPropertyOverrides } from './apply-property-overrides';
import { citeOverride, type OverrideCitationInput } from './override-citation';

type Package = Omit<ExternalPackage, 'splXml' | 'evidence'>;

/**
 * Cached packages that may stand in for `item`: other packages of the same
 * product, then packages sharing its RxNorm concept (same ingredient,
 * strength and dose form). Only values each one actually has are listed.
 */
export async function findEquivalentPackages(item: Package): Promise<EquivalentPackage[]> {
  const siblings = item.details?.packaging?.siblings.map((sibling) => sibling.ndc) ?? [];
  const rxcui = item.details?.rxnav?.rxcui;
  const records = await prisma.sourceRecord.findMany({
    where: {
      ingestionRun: { source: CACHE_SOURCE, status: 'completed' },
      sourceNativeId: { not: item.ndc },
      OR: [
        { sourceNativeId: { in: siblings } },
        ...(rxcui
          ? [{ payload: { path: ['item', 'details', 'rxnav', 'rxcui'], equals: rxcui } }]
          : [])
      ]
    },
    orderBy: [{ sourceNativeId: 'asc' }, { observedAt: 'desc' }],
    distinct: ['sourceNativeId'],
    select: { sourceNativeId: true, payload: true },
    take: 60
  });
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

export async function savePropertyOverride(
  ndc: string,
  key: string,
  value: string,
  citation: OverrideCitationInput
) {
  const current = (await loadPackageSnapshots(prisma, [ndc])).get(ndc)?.item;
  if (!current) throw new Error('No staged data for this NDC.');
  const equivalents = citation.source === 'ndc' ? await findEquivalentPackages(current) : [];
  const override = citeOverride(current, key, value, citation, equivalents);
  const item = {
    ...current,
    propertyOverrides: { ...current.propertyOverrides, [key]: override },
    evidence: [
      {
        source: 'user-override',
        nativeId: `${ndc}:${key}:${override.createdAt}`,
        url: `urn:rxdb:override:ndc:${ndc}`,
        payload: { key, ...override }
      }
    ]
  };
  await stageCollection(prisma, [], [applyPropertyOverrides(item)]);
}
