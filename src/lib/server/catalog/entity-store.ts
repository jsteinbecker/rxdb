/**
 * Canonical catalog writes and eligibility reconciliation: persisting a
 * collection's entities, and re-applying the exclusion ladder from stored evidence
 * without provider calls.
 *
 * @module
 */
import {
	lockPackageStates,
	projectionPayload,
	stateSnapshot,
	writeProviderBaseline
} from './package-state-store';
import { withoutUnspecified } from '../../labels/spl-ingredients';
import { parseStrength } from '../../medication/strength-storage';
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../../generated/client';
import type { ExternalPackage, RxConcept, SourcePayload } from '../../catalog/types';
import { CACHE_SOURCE } from './cache';
import { recordEvidence } from './snapshot-store';
import { type ActivityInput, exclusionReason } from '../../catalog/package-facts';
import { linkPseudoScd } from './pseudo-scd-store';
import { checkLocalConceptDrift } from '../curation/local-concept-store';
import { logger } from '../infrastructure/log';

type Db = Prisma.TransactionClient;

async function namespace(db: Db, code: string, appliesTo: 'clinical_drug' | 'package' | 'product') {
	await db.identifierNamespace.upsert({
		where: { code },
		create: { code, appliesTo: [appliesTo] },
		update: {}
	});
}

async function identifier(db: Db, code: string, value: string) {
	return db.externalIdentifier.findFirst({
		where: { namespace: code, normalizedValue: value, validTo: null }
	});
}

async function attachIdentifier(
	db: Db,
	entityId: string,
	code: string,
	value: string,
	normalizedValue = value
) {
	await db.externalIdentifier.create({
		data: { entityId, namespace: code, value, normalizedValue, isPrimary: true }
	});
}

async function namedEntity(db: Db, type: 'ingredient' | 'labeler', rawName: string) {
	const name = type === 'ingredient' ? withoutUnspecified(rawName) : rawName;
	const existing =
		type === 'ingredient'
			? await db.ingredient.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
			: await db.labeler.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
	if (existing) return existing.id;
	const entity = await db.entity.create({ data: { type } });
	if (type === 'ingredient') await db.ingredient.create({ data: { id: entity.id, name } });
	else await db.labeler.create({ data: { id: entity.id, name } });
	return entity.id;
}

async function persistProduct(db: Db, item: ExternalPackage, existingProductId?: string) {
	await namespace(db, 'openfda_product_ndc', 'product');
	// Normalized labeler + product segments identify all packages of one product.
	const key = item.ndc.slice(0, 9);
	const identified = await identifier(db, 'openfda_product_ndc', key);
	// Also recognize the identifiers written by the initial port.
	const legacy =
		!identified && item.productCode
			? await identifier(db, 'openfda_product_ndc', item.productCode.replaceAll('-', ''))
			: null;
	const id = identified?.entityId ?? legacy?.entityId ?? existingProductId;
	const labelerId = item.labelerName
		? await namedEntity(db, 'labeler', item.labelerName)
		: undefined;
	const productId = id ?? (await db.entity.create({ data: { type: 'product' } })).id;
	const data = {
		proprietaryName: item.brandName ?? item.genericName ?? undefined,
		doseForm: item.doseForm ?? undefined,
		labelerId
	};
	if (id) await db.product.update({ where: { id }, data });
	else
		await db.product.create({
			data: {
				...data,
				id: productId,
				labelerId: labelerId ?? (await namedEntity(db, 'labeler', 'Unknown labeler'))
			}
		});
	if (!identified) {
		if (legacy)
			await db.externalIdentifier.update({
				where: { id: legacy.id },
				data: { normalizedValue: key }
			});
		else await attachIdentifier(db, productId, 'openfda_product_ndc', item.productCode ?? key, key);
	}
	const parsed = item.ingredients.map((active) => ({
		...active,
		strength: parseStrength(active.strength),
		delivered: parseStrength(active.delivered ?? null)
	}));
	// A missing/unparseable upstream strength must not erase an existing ingredient list.
	if (parsed.length && parsed.every((active) => active.strength !== null)) {
		const current = await db.productIngredient.findMany({
			where: { productId, validTo: null },
			orderBy: { ordinal: 'asc' }
		});
		const desired: (NonNullable<ReturnType<typeof parseStrength>> & {
			productId: string;
			ingredientId: string;
			deliveredNumMag: number | null;
			deliveredNumUom: string | null;
			ordinal: number;
		})[] = [];
		for (const [index, active] of parsed.entries()) {
			desired.push({
				productId,
				ingredientId: await namedEntity(db, 'ingredient', active.name),
				...active.strength!,
				deliveredNumMag: active.delivered?.strengthNumMag ?? null,
				deliveredNumUom: active.delivered?.strengthNumUom ?? null,
				ordinal: index + 1
			});
		}
		const changed =
			current.length !== desired.length ||
			current.some((row, i) => {
				const next = desired[i];
				return (
					!next ||
					row.ingredientId !== next.ingredientId ||
					Number(row.strengthNumMag) !== next.strengthNumMag ||
					row.strengthNumUom !== next.strengthNumUom ||
					Number(row.strengthDenMag) !== next.strengthDenMag ||
					row.strengthDenUom !== next.strengthDenUom ||
					(row.deliveredNumMag === null ? null : Number(row.deliveredNumMag)) !==
						next.deliveredNumMag ||
					row.deliveredNumUom !== next.deliveredNumUom
				);
			});
		if (changed) {
			await db.productIngredient.updateMany({
				where: { productId, validTo: null },
				data: { validTo: new Date() }
			});
			await db.productIngredient.createMany({ data: desired });
		}
	}
	return productId;
}

async function persistPackage(db: Db, item: ExternalPackage, sourceRecordId: string) {
	await namespace(db, 'ndc11', 'package');
	const existing = await identifier(db, 'ndc11', item.ndc);
	const reason = exclusionReason(item);
	// Do not manufacture catalog entities when every provider was unavailable or empty.
	if (!existing && !item.listed && !item.splPresent && item.rxcuiStatus?.toUpperCase() !== 'ACTIVE')
		return;
	const entityId =
		existing?.entityId ??
		(
			await db.entity.create({
				data: { type: 'package', status: reason ? 'catalog-excluded' : 'active' }
			})
		).id;
	// Package packaging descriptions are missing for many NDCs. Keep the row
	// useful with the product's name, while allowing a later package-specific
	// description to replace this fallback.
	const fallbackDescription = item.genericName ?? item.brandName ?? null;
	const currentPackage = existing
		? await db.package.findUnique({ where: { id: entityId }, select: { description: true } })
		: null;
	const currentDescription = currentPackage?.description ?? null;
	const currentIsFallback =
		currentDescription !== null &&
		(currentDescription === item.genericName || currentDescription === item.brandName);
	const data = {
		description:
			item.description ??
			(currentDescription === null || currentIsFallback
				? (fallbackDescription ?? undefined)
				: undefined),
		containerType: item.size?.container ?? undefined,
		isUnitOfUse: item.size ? item.size.packQty === 1 : undefined
	};
	if (existing) {
		await db.package.update({ where: { id: entityId }, data });
		// Retired/manual statuses remain under user control.
		if (reason || canRestorePackage(item))
			await db.entity.updateMany({
				where: { id: entityId, status: { in: ['active', 'catalog-excluded'] }, retiredAt: null },
				data: { status: reason ? 'catalog-excluded' : 'active' }
			});
		if (reason) await unlinkExcluded(db, { id: entityId });
	} else {
		await db.package.create({ data: { id: entityId, ...data } });
		await attachIdentifier(db, entityId, 'ndc11', item.ndc);
	}
	const component = await db.packageComponent.findFirst({
		where: { parentPackageId: entityId, childProductId: { not: null }, validTo: null }
	});
	const productId = await persistProduct(db, item, component?.childProductId ?? undefined);
	const quantityMag = item.size?.packQty ?? (component ? Number(component.quantityMag) : 1);
	if (component)
		await db.packageComponent.update({
			where: { id: component.id },
			data: { childProductId: productId, quantityMag }
		});
	else
		await db.packageComponent.create({
			data: { parentPackageId: entityId, childProductId: productId, quantityMag, quantityUom: '1' }
		});
	// A reconstituted volume is not physical fill in the unopened dry powder vial.
	const liquidFill = !item.isDryFill && item.size?.kind === 'volume' ? item.size : null;
	const container = {
		labeledFillMag:
			item.description !== null || item.isDryFill ? (liquidFill?.value ?? null) : undefined,
		labeledFillUom:
			item.description !== null || item.isDryFill ? (liquidFill?.unit ?? 'mL') : undefined,
		doseType:
			item.isMultiDose === null ? undefined : item.isMultiDose ? 'multi-dose' : 'single-dose',
		sourceRecordId
	};
	await db.containerSpec.upsert({
		where: { packageId: entityId },
		create: { packageId: entityId, ...container },
		update: container
	});
	// Keep the catalog's package-to-RxNorm link queryable after the snapshot is staged.
	const rxcui = item.details?.rxnav?.rxcui;
	if (rxcui) {
		const drug = await identifier(db, 'rxnorm_rxcui', rxcui);
		if (drug) {
			const relationshipType = 'package_clinical_drug';
			await db.relationshipType.upsert({
				where: { code: relationshipType },
				create: { code: relationshipType, fromType: 'package', toType: 'clinical_drug' },
				update: {}
			});
			const current = await db.entityRelationship.findMany({
				where: { relationshipType, fromEntityId: entityId, validTo: null }
			});
			if (!current.some((link) => link.toEntityId === drug.entityId)) {
				await db.entityRelationship.updateMany({
					where: { relationshipType, fromEntityId: entityId, validTo: null },
					data: { validTo: new Date() }
				});
				await db.entityRelationship.create({
					data: {
						relationshipType,
						fromEntityId: entityId,
						toEntityId: drug.entityId,
						sourceRecordId
					}
				});
			}
		}
	}
	// A bulk dry fill RxNorm codes by concentration is also placed on its content concept.
	await linkPseudoScd(db, entityId, item, sourceRecordId);
}

async function attachBrands(db: Db, entityId: string, concept: RxConcept) {
	const details = concept.details;
	if (!details) return;
	const wanted = [
		...details.brandedProducts.map((brand) => ['rxnorm_branded_rxcui', brand.rxcui] as const),
		...details.brands.map((brand) => ['rxnorm_brand_name', brand.name] as const)
	];
	for (const [code, value] of wanted) {
		await namespace(db, code, 'clinical_drug');
		const normalizedValue = value.toLowerCase();
		const present = await db.externalIdentifier.findFirst({
			where: { entityId, namespace: code, normalizedValue, validTo: null }
		});
		if (!present)
			await db.externalIdentifier.create({
				data: { entityId, namespace: code, value, normalizedValue, isPrimary: false }
			});
	}
}

const driftLog = logger('local-concept');

export async function persistCollection(
	db: PrismaClient,
	concepts: RxConcept[],
	packages: ExternalPackage[]
) {
	const seen = new Set<string>();
	const uniqueEvidence = (items: SourcePayload[]) =>
		items.filter((item) => {
			const key = `${item.source}:${item.nativeId}:${createHash('sha256').update(JSON.stringify(item.payload)).digest('hex')}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

	// Serializes the read/create sequence across searches, including different query strings.
	// All network requests happen before these short transactions.
	for (const concept of concepts) {
		await db.$transaction(
			async (tx) => {
				await tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;
				await namespace(tx, 'rxnorm_rxcui', 'clinical_drug');
				const existing = await identifier(tx, 'rxnorm_rxcui', concept.rxcui);
				const data = { name: concept.name, tty: concept.tty };
				if (existing) {
					await tx.clinicalDrug.update({ where: { id: existing.entityId }, data });
					if (concept.vetOnly !== null)
						await tx.entity.updateMany({
							where: {
								id: existing.entityId,
								retiredAt: null,
								status: { in: ['active', 'catalog-excluded'] }
							},
							data: { status: concept.vetOnly ? 'catalog-excluded' : 'active' }
						});
				} else {
					const entity = await tx.entity.create({
						data: { type: 'clinical_drug', status: concept.vetOnly ? 'catalog-excluded' : 'active' }
					});
					await tx.clinicalDrug.create({ data: { id: entity.id, ...data } });
					await attachIdentifier(tx, entity.id, 'rxnorm_rxcui', concept.rxcui);
				}
				// Brands are attributes of the generic node, not nodes of their own.
				const drugId =
					existing?.entityId ?? (await identifier(tx, 'rxnorm_rxcui', concept.rxcui))!.entityId;
				await attachBrands(tx, drugId, concept);
				await recordEvidence(tx, uniqueEvidence(concept.evidence));
			},
			{ timeout: 60_000 }
		);
	}
	for (const item of packages) {
		await db.$transaction(
			async (tx) => {
				await tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;
				await recordEvidence(tx, uniqueEvidence(item.evidence));
				await lockPackageStates(tx, [item.ndc]);
				const state = await writeProviderBaseline(tx, item);
				const snapshot = projectionPayload(state);
				const records = await recordEvidence(tx, [
					{
						source: CACHE_SOURCE,
						nativeId: item.ndc,
						url: `urn:rxdb:catalog:ndc:${item.ndc}`,
						payload: snapshot
					}
				]);
				await persistPackage(tx, stateSnapshot(state).item, [...records.values()][0]);
			},
			{ timeout: 60_000 }
		);
	}
	// Review items only; a failure here must never fail the load.
	try {
		await checkLocalConceptDrift(db, concepts, packages);
	} catch (error) {
		driftLog.error('drift check failed', { error: String(error) });
	}
}

function canRestorePackage(item: ActivityInput): boolean {
	return (
		item.isVeterinary === false &&
		(item.listed === true ||
			item.splPresent === true ||
			item.rxcuiStatus?.toUpperCase() === 'ACTIVE')
	);
}

/**
 * End-dates the formulary links of packages the catalog has excluded. The exclusion ladder
 * only answers on positive evidence (an outage is never absence), so an obsolete or unlisted
 * package leaves the formulary; it returns only when a load links it again.
 */
async function unlinkExcluded(db: Db, entity: Prisma.EntityWhereInput) {
	await db.formularyItemPackage.updateMany({
		where: { validTo: null, package: { entity: { ...entity, status: 'catalog-excluded' } } },
		data: { validTo: new Date() }
	});
}

/** Reevaluate time-dependent exclusions even when no provider refresh is needed. */
export async function refreshPackageEligibility(db: PrismaClient, items: EligibilityInput[]) {
	if (!items.length) return;
	await db.$transaction(
		async (tx) => {
			await tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;
			await applyEligibility(tx, items);
		},
		{ timeout: 60_000 }
	);
}

/** What the exclusion ladder reads from a package. */
type EligibilityInput = ActivityInput & { ndc: string };

/**
 * Reapply the exclusion ladder to every package on a formulary, from stored evidence
 * only (no provider calls). A sync already rechecks the packages it fetches; this
 * covers the rest, so a rule change reaches packages nobody has opened since. It reads
 * each package's newest snapshot of any catalog version: the eligibility facts do not
 * depend on the parser that a version bump changes.
 */
export async function reconcileFormularyEligibility(db: PrismaClient) {
	const items = await db.$queryRaw<EligibilityInput[]>`
    SELECT DISTINCT ON (r.source_native_id)
      r.source_native_id AS ndc,
      (r.payload #>> '{item,listed}')::boolean AS listed,
      r.payload #>> '{item,productCode}' AS "productCode",
      (r.payload #>> '{item,splPresent}')::boolean AS "splPresent",
      (r.payload #>> '{item,splInactivated}')::boolean AS "splInactivated",
      (r.payload #>> '{item,isVeterinary}')::boolean AS "isVeterinary",
      r.payload #>> '{item,rxcuiStatus}' AS "rxcuiStatus",
      r.payload #>> '{item,marketingEndDate}' AS "marketingEndDate",
      r.payload #>> '{item,manualExclusion}' AS "manualExclusion",
      jsonb_build_object('packaging', jsonb_build_object('siblings',
        COALESCE(r.payload #> '{item,details,packaging,siblings}', '[]'::jsonb))) AS details
    FROM source_record r
    JOIN ingestion_run run ON run.id = r.ingestion_run_id
    WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
      AND r.source_native_id IN (
        SELECT ei.normalized_value
        FROM external_identifier ei
        JOIN entity e ON e.id = ei.entity_id
        WHERE ei.namespace = 'ndc11' AND ei.valid_to IS NULL
          AND e.status = 'active' AND e.retired_at IS NULL
          AND EXISTS (
            SELECT 1 FROM formulary_item_package f
            WHERE f.package_id = e.id AND f.valid_to IS NULL
          )
      )
    ORDER BY r.source_native_id, r.observed_at DESC`;
	await refreshPackageEligibility(db, items);
	return {
		checked: items.length,
		excluded: items.filter((item) => exclusionReason(item)).map((item) => item.ndc)
	};
}

async function applyEligibility(db: Db, items: EligibilityInput[]) {
	const excluded = items.filter((item) => exclusionReason(item) !== null).map((item) => item.ndc);
	const active = items
		.filter((item) => !exclusionReason(item) && canRestorePackage(item))
		.map((item) => item.ndc);
	for (const [ndcs, status] of [
		[excluded, 'catalog-excluded'],
		[active, 'active']
	] as const) {
		if (!ndcs.length) continue;
		await db.entity.updateMany({
			where: {
				type: 'package',
				retiredAt: null,
				status: { in: ['active', 'catalog-excluded'] },
				externalIdentifiers: {
					some: { namespace: 'ndc11', normalizedValue: { in: [...ndcs] }, validTo: null }
				}
			},
			data: { status }
		});
	}
	if (excluded.length)
		await unlinkExcluded(db, {
			externalIdentifiers: {
				some: { namespace: 'ndc11', normalizedValue: { in: excluded }, validTo: null }
			}
		});
	// A product remains searchable while any of its packages is still active.
	const products = await db.product.findMany({
		where: {
			packageComponents: {
				some: {
					validTo: null,
					parentPackage: {
						entity: {
							externalIdentifiers: {
								some: {
									namespace: 'ndc11',
									normalizedValue: { in: items.map((item) => item.ndc) },
									validTo: null
								}
							}
						}
					}
				}
			}
		},
		select: {
			id: true,
			packageComponents: {
				where: { validTo: null },
				select: {
					parentPackage: { select: { entity: { select: { status: true, retiredAt: true } } } }
				}
			}
		}
	});
	for (const product of products) {
		const packages = product.packageComponents.map((component) => component.parentPackage.entity);
		const status = packages.some(
			(entity) => entity.status === 'active' && entity.retiredAt === null
		)
			? 'active'
			: packages.length && packages.every((entity) => entity.status === 'catalog-excluded')
				? 'catalog-excluded'
				: null;
		if (status)
			await db.entity.updateMany({
				where: { id: product.id, retiredAt: null, status: { in: ['active', 'catalog-excluded'] } },
				data: { status }
			});
	}
}
