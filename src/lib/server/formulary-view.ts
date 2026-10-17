import { itemName } from '$lib/item-name';
import type {PrismaClient} from '../../generated/client';
import {resolveRacemates, type FormularyRow} from '../formulary-hierarchy';
import {loadPackageSnapshots} from './catalog-store';
import {correctedIngredients, packageDisplayTitle} from '../package-title';
import {PACKAGE_PSEUDO_SCD} from './pseudo-scd-store';
import {fillFromConcept} from '../concept-fill';
import {scopeStrengthStyles} from './strength-styles';

/**
 * Every package currently linked into a formulary scope, flattened with the
 * facts the hierarchy groups by. Catalog tables supply identity and the linked
 * product; the latest enrichment snapshot supplies routes and label facts the
 * catalog does not model yet.
 */
export async function formularyRows(
  db: PrismaClient,
  scopeId: string,
  /**
   * formularyItemId -> local concept name; the user's nameOverride still wins.
   * A promise is awaited only after the rows are read, so callers can load both at once.
   */
  localNames: Map<string, string> | Promise<Map<string, string>> = new Map()
): Promise<FormularyRow[]> {
  const styles = await scopeStrengthStyles(db, scopeId);
  const links = await db.formularyItemPackage.findMany({
    where: {
      validTo: null,
      formularyItem: { scopeId, entity: { retiredAt: null } },
      // Catalog-excluded packages never appear in a hierarchy.
      package: { entity: { status: { not: 'catalog-excluded' } } }
    },
    select: {
      preferenceRank: true,
      formularyItem: { select: { id: true, displayName: true, nameOverride: true, strengthAsPercent: true } },
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
  const snapshots = await loadPackageSnapshots(db, ndcs, { withoutLabel: true });
  const directory = await productDirectory(db);
  const names = await localNames;

  // Packages never enriched are placed by their concept rather than left "Not specified";
  // a racemate beside its own enantiomer then reads as the two enantiomers.
  return fillFromConcept(links.flatMap((link) => {
    const ndc = link.package.entity.externalIdentifiers[0]?.normalizedValue;
    if (!ndc) return [];
    const item = snapshots.get(ndc)?.item;
    // A package whose linked product is missing or a placeholder is still named by its
    // product NDC, or at least its labeler code.
    const linked = link.package.components[0]?.childProduct;
    const listed = directory.products.get(ndc.slice(0, 9));
    const known = (name: string | undefined) => (name && !PLACEHOLDER_LABELER.test(name) ? name : null);
    const doseType = link.package.containerSpecs[0]?.doseType;
    const pseudo = link.package.entity.relationshipsFrom[0]?.toEntity.clinicalDrug;
    // The snapshot's facts, falling back to the catalog's; the title and the
    // hierarchy both read these, so they never disagree.
    const facts = {
      ...item,
      description: item?.description ?? link.package.description,
      doseForm:
        item?.doseForm ?? item?.details?.spl?.doseForm ?? linked?.doseForm ?? listed?.doseForm ?? null,
      brandName: item?.brandName ?? linked?.proprietaryName ?? listed?.proprietaryName ?? null,
      genericName: item?.genericName ?? null,
      labelerName:
        item?.labelerName ??
        known(linked?.labeler.name) ??
        known(listed?.labeler.name) ??
        directory.labelers.get(ndc.slice(0, 5)) ??
        null,
      size: item?.size ?? null,
      isMultiDose: item?.isMultiDose ?? (doseType ? doseType === 'multi-dose' : null)
    };
    return [
      {
        packageId: link.package.id,
        ndc,
        formularyItemId: link.formularyItem.id,
        formularyItem: itemName(
          names.get(link.formularyItem.id) ?? pseudo?.name ?? link.formularyItem.displayName,
          link.formularyItem,
          styles
        ),
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
        status: link.package.entity.status,
        enriched: Boolean(item)
      }
    ];
  })).map((row) => ({ ...row, ingredients: resolveRacemates(row.ingredients) }));
}

/** The NDCs `formularyRows` would list, without loading anything else about them. */
export async function formularyNdcs(db: PrismaClient, scopeId: string): Promise<Set<string>> {
  const links = await db.formularyItemPackage.findMany({
    where: {
      validTo: null,
      formularyItem: { scopeId, entity: { retiredAt: null } },
      package: { entity: { status: { not: 'catalog-excluded' } } }
    },
    select: {
      package: {
        select: {
          entity: {
            select: {
              externalIdentifiers: {
                where: { namespace: 'ndc11', validTo: null },
                select: { normalizedValue: true },
                take: 1
              }
            }
          }
        }
      }
    }
  });
  return new Set(links.flatMap((link) => link.package.entity.externalIdentifiers[0]?.normalizedValue ?? []));
}

/**
 * Every NDC linked into the scope, with whether the link counts: `on` for an
 * eligible package, `excluded` for one the catalog keeps off the formulary.
 */
export async function formularyNdcStatuses(
  db: PrismaClient,
  scopeId: string
): Promise<Map<string, 'on' | 'excluded'>> {
  const links = await db.formularyItemPackage.findMany({
    where: { validTo: null, formularyItem: { scopeId, entity: { retiredAt: null } } },
    select: {
      package: {
        select: {
          entity: {
            select: {
              status: true,
              externalIdentifiers: {
                where: { namespace: 'ndc11', validTo: null },
                select: { normalizedValue: true },
                take: 1
              }
            }
          }
        }
      }
    }
  });
  const statuses = new Map<string, 'on' | 'excluded'>();
  for (const { package: { entity } } of links) {
    const ndc = entity.externalIdentifiers[0]?.normalizedValue;
    if (!ndc) continue;
    // Any eligible link puts the package on, whatever its other links say.
    if (entity.status !== 'catalog-excluded') statuses.set(ndc, 'on');
    else if (!statuses.has(ndc)) statuses.set(ndc, 'excluded');
  }
  return statuses;
}

/** The catalog's stand-in for a product whose labeler was never known. */
const PLACEHOLDER_LABELER = /^unknown labeler$/i;

type DirectoryProduct = { proprietaryName: string | null; doseForm: string | null; labeler: { name: string } };

/**
 * Every catalog product by its 9-digit product NDC, and a labeler name for each
 * 5-digit labeler code: one local query that names packages no product was linked to.
 */
async function productDirectory(db: PrismaClient) {
  const rows = await db.externalIdentifier.findMany({
    where: { namespace: 'openfda_product_ndc', validTo: null },
    select: {
      normalizedValue: true,
      entity: {
        select: {
          product: {
            select: { proprietaryName: true, doseForm: true, labeler: { select: { name: true } } }
          }
        }
      }
    }
  });
  const products = new Map<string, DirectoryProduct>();
  const labelers = new Map<string, string>();
  for (const row of rows) {
    const product = row.entity.product;
    if (!product) continue;
    products.set(row.normalizedValue, product);
    if (PLACEHOLDER_LABELER.test(product.labeler.name)) continue;
    if (!labelers.has(row.normalizedValue.slice(0, 5))) labelers.set(row.normalizedValue.slice(0, 5), product.labeler.name);
  }
  return { products, labelers };
}
