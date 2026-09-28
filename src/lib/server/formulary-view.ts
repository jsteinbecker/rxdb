import type { PrismaClient } from '../../generated/client';
import type { FormularyRow } from '../formulary-hierarchy';
import type { PackageSnapshot } from './catalog-cache';
import { loadPackageSnapshots } from './catalog-store';
import { packageDisplayTitle } from '../package-title';

function ingredientsFromSpl(item: PackageSnapshot['item']) {
  return (item.details?.spl?.ingredients ?? [])
    .filter((ingredient) => ingredient.kind === 'active')
    .map((ingredient) => ({
      name: ingredient.moieties.find((moiety) => moiety.name)?.name ?? ingredient.name,
      strength: ingredient.strength
    }));
}

/**
 * Every package currently linked into a formulary scope, flattened with the
 * facts the hierarchy groups by. Catalog tables supply identity and the linked
 * product; the latest enrichment snapshot supplies routes and label facts the
 * catalog does not model yet.
 */
export async function formularyRows(db: PrismaClient, scopeId: string): Promise<FormularyRow[]> {
  const links = await db.formularyItemPackage.findMany({
    where: {
      validTo: null,
      formularyItem: { scopeId, entity: { retiredAt: null } },
      // Catalog-excluded packages never appear in a hierarchy.
      package: { entity: { status: { not: 'catalog-excluded' } } }
    },
    select: {
      preferenceRank: true,
      formularyItem: { select: { id: true, displayName: true } },
      package: {
        select: {
          id: true,
          description: true,
          entity: {
            select: {
              status: true,
              externalIdentifiers: {
                where: { namespace: 'ndc11', validTo: null },
                select: { normalizedValue: true },
                take: 1
              }
            }
          },
          containerSpecs: { select: { doseType: true } },
          components: {
            where: { validTo: null, childProductId: { not: null } },
            take: 1,
            select: {
              childProduct: {
                select: {
                  proprietaryName: true,
                  doseForm: true,
                  labeler: { select: { name: true } }
                }
              }
            }
          }
        }
      }
    }
  });
  const ndcs = links.flatMap(
    (link) => link.package.entity.externalIdentifiers[0]?.normalizedValue ?? []
  );
  const snapshots = await loadPackageSnapshots(db, ndcs);

  return links.flatMap((link) => {
    const ndc = link.package.entity.externalIdentifiers[0]?.normalizedValue;
    if (!ndc) return [];
    const item = snapshots.get(ndc)?.item;
    const product = link.package.components[0]?.childProduct;
    const doseType = link.package.containerSpecs[0]?.doseType;
    const labeler = item?.labelerName ?? product?.labeler.name ?? null;
    const metadataRoutes = item?.details?.product?.routes ?? [];
    return [
      {
        packageId: link.package.id,
        ndc,
        formularyItemId: link.formularyItem.id,
        formularyItem: link.formularyItem.displayName,
        description: item?.description ?? link.package.description,
        displayTitle: packageDisplayTitle({
          rxNormName: item?.details?.rxnav?.conceptName,
          packageDescription: item?.description ?? link.package.description,
          splTitle: item?.splTitle,
          isMultiDose: item?.isMultiDose ?? (doseType ? doseType === 'multi-dose' : null),
          labeler
        }),
        routes: metadataRoutes,
        doseForm: item?.doseForm ?? item?.details?.spl?.doseForm ?? product?.doseForm ?? null,
        ingredients: item?.ingredients?.length
          ? item.ingredients
          : item
            ? ingredientsFromSpl(item)
            : [],
        brandName: item?.brandName ?? product?.proprietaryName ?? null,
        genericName: item?.genericName ?? null,
        labeler,
        size: item?.size ?? null,
        isMultiDose: item?.isMultiDose ?? (doseType ? doseType === 'multi-dose' : null),
        preferenceRank: link.preferenceRank,
        status: link.package.entity.status
      }
    ];
  });
}
