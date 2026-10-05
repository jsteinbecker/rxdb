import {quantifiedScdName} from '$lib/quantified-scd';
import type {PrismaClient} from '../../generated/client';
import type {FormularyRow} from '../formulary-hierarchy';
import {loadPackageSnapshots} from './catalog-store';
import {correctedIngredients, packageDisplayTitle} from '../package-title';
import {PACKAGE_PSEUDO_SCD} from './pseudo-scd-store';

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
              // A bulk dry fill sits under its content pseudo-SCD, not RxNorm's concentration.
              relationshipsFrom: {
                where: { relationshipType: PACKAGE_PSEUDO_SCD, validTo: null },
                take: 1,
                select: { toEntity: { select: { clinicalDrug: { select: { name: true } } } } }
              },
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
    const pseudo = link.package.entity.relationshipsFrom[0]?.toEntity.clinicalDrug;
    // The snapshot's facts, falling back to the catalog's; the title and the
    // hierarchy both read these, so they never disagree.
    const facts = {
      ...item,
      description: item?.description ?? link.package.description,
      doseForm: item?.doseForm ?? item?.details?.spl?.doseForm ?? product?.doseForm ?? null,
      brandName: item?.brandName ?? product?.proprietaryName ?? null,
      genericName: item?.genericName ?? null,
      labelerName: item?.labelerName ?? product?.labeler.name ?? null,
      size: item?.size ?? null,
      isMultiDose: item?.isMultiDose ?? (doseType ? doseType === 'multi-dose' : null)
    };
    return [
      {
        packageId: link.package.id,
        ndc,
        formularyItemId: link.formularyItem.id,
        formularyItem: quantifiedScdName(pseudo?.name ?? link.formularyItem.displayName),
        description: facts.description,
        displayTitle: packageDisplayTitle(facts),
        routes: item?.details?.product?.routes ?? [],
        doseForm: facts.doseForm,
        ingredients: item ? correctedIngredients(item) : [],
        brandName: facts.brandName,
        genericName: facts.genericName,
        labeler: facts.labelerName,
        size: facts.size,
        isMultiDose: facts.isMultiDose,
        kit: item?.kit ?? null,
        preferenceRank: link.preferenceRank,
        status: link.package.entity.status
      }
    ];
  });
}
