import { withoutUnspecified } from '../spl-ingredients';
import { parseStrength } from '../strength';
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/client';
import type { ExternalPackage, RxConcept, SourcePayload } from './catalog-providers';
import {
	CACHE_SOURCE,
	CATALOG_VERSION,
	type PackageSnapshot,
	readSnapshot,
	snapshotPackage
} from './catalog-cache';
import { exclusionReason } from './catalog-facts';
import { linkPseudoScd } from './pseudo-scd-store';

type Db = Prisma.TransactionClient;

const CONCEPT_TTL_MS = 24 * 60 * 60 * 1000;
export type ConceptSnapshot = { version: string; refreshAt: string; concept: RxConcept };
const conceptKey = (rxcui: string) => `rxcui:${rxcui}`;

/** Keep one record per native ID in a source run; the latest payload wins. */
export function uniqueRunEvidence(evidence: SourcePayload[]): SourcePayload[] {
	const uniqueByKey = new Map<string, SourcePayload>();
	for (const item of evidence) uniqueByKey.set(`${item.source}:${item.nativeId}`, item);
	return [...uniqueByKey.values()];
}

export type CacheRecord = { sourceNativeId: string; payload: unknown };

/**
 * The newest completed cache snapshot for each native ID. Prisma's `distinct`
 * fetches every historical row and dedupes in memory, so this is DISTINCT ON,
 * over ids only: payloads are large, and are read just for the winning rows.
 * `withoutLabel` drops the label text (~95% of a package snapshot) in the
 * database, for bulk readers that never show it.
 */
export function latestCacheRecords(
	db: Pick<PrismaClient, '$queryRaw'>,
	nativeIds: string[],
	{ withoutLabel = false }: { withoutLabel?: boolean } = {}
): Promise<CacheRecord[]> {
	if (!nativeIds.length) return Promise.resolve([]);
	return db.$queryRaw<CacheRecord[]>`
    WITH latest AS (
      SELECT DISTINCT ON (r.source_native_id) r.id
      FROM source_record r
      JOIN ingestion_run run ON run.id = r.ingestion_run_id
      WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
        AND r.source_native_id = ANY(${nativeIds}::text[])
      ORDER BY r.source_native_id, r.observed_at DESC
    )
    SELECT r.source_native_id AS "sourceNativeId",
      CASE WHEN ${withoutLabel} THEN r.payload #- '{item,details,label}' ELSE r.payload END AS payload
    FROM source_record r JOIN latest ON latest.id = r.id`;
}

/**
 * Concepts staged by earlier searches, each marked fresh while its snapshot has
 * not reached its refresh time. Stale ones still say whether a concept has NDCs.
 */
export async function loadStoredConcepts(
	db: PrismaClient,
	rxcuis: string[],
	now = Date.now()
): Promise<Map<string, { concept: RxConcept; fresh: boolean }>> {
	const records = await latestCacheRecords(db, rxcuis.map(conceptKey));
	return new Map(
		records.flatMap((record) => {
			const snapshot = record.payload as ConceptSnapshot | null;
			return snapshot?.version === CATALOG_VERSION && snapshot.concept?.rxcui
				? [
						[
							snapshot.concept.rxcui,
							{ concept: snapshot.concept, fresh: Date.parse(snapshot.refreshAt) > now }
						] as const
					]
				: [];
		})
	);
}

/** Fetched concepts are staged as provenance until someone loads them. */
export async function loadConceptSnapshots(
	db: PrismaClient,
	rxcuis: string[]
): Promise<Map<string, RxConcept>> {
	const records = await latestCacheRecords(db, rxcuis.map(conceptKey));
	return new Map(
		records.flatMap((record) => {
			const snapshot = record.payload as ConceptSnapshot | null;
			return snapshot?.version === CATALOG_VERSION && snapshot.concept?.rxcui
				? [[snapshot.concept.rxcui, snapshot.concept] as const]
				: [];
		})
	);
}

/** Record raw evidence and cache snapshots without creating catalog entities. */
export async function stageCollection(
	db: PrismaClient,
	concepts: RxConcept[],
	packages: ExternalPackage[]
) {
	const now = Date.now();
	const evidence: SourcePayload[] = [
		...concepts.flatMap((concept) => concept.evidence),
		...packages.flatMap((item) => item.evidence),
		...concepts.map((concept) => ({
			source: CACHE_SOURCE,
			nativeId: conceptKey(concept.rxcui),
			url: `urn:rxdb:catalog:rxcui:${concept.rxcui}`,
			payload: {
				version: CATALOG_VERSION,
				refreshAt: new Date(now + CONCEPT_TTL_MS).toISOString(),
				concept: { ...concept, evidence: [] }
			} satisfies ConceptSnapshot
		})),
		...packages.map((item) => ({
			source: CACHE_SOURCE,
			nativeId: item.ndc,
			url: `urn:rxdb:catalog:ndc:${item.ndc}`,
			payload: snapshotPackage(item)
		}))
	];
	if (!evidence.length) return;
	// A run has at most one source record for each source/native ID. Providers
	// can contribute multiple snapshots for the same ID (for example a search
	// result and an enriched package); keep the last complete payload in this
	// batch instead of trying to insert conflicting rows into the same run.
	const unique = uniqueRunEvidence(evidence);
	await db.$transaction((tx) => recordEvidence(tx, unique), { timeout: 60_000 });
}

/**
 * `withoutLabel` leaves out `details.label`; only for read-only views, since a
 * snapshot written back without it would lose the label text.
 */
export async function loadPackageSnapshots(
	db: PrismaClient,
	ndcs: string[],
	options: { withoutLabel?: boolean } = {}
): Promise<Map<string, PackageSnapshot>> {
	const records = await latestCacheRecords(db, ndcs, options);
	return new Map(
		records.flatMap((record) => {
			const snapshot = readSnapshot(record.payload);
			return snapshot && snapshot.item.ndc === record.sourceNativeId
				? [[record.sourceNativeId, snapshot] as const]
				: [];
		})
	);
}

/** JSON with object keys sorted, so equal payloads always serialize alike. */
function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_, nested) =>
		nested && typeof nested === 'object' && !Array.isArray(nested)
			? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: nested
	);
}

/**
 * The hash that decides whether a payload says anything new. A cache
 * snapshot's `refreshAt` changes on every refresh without changing the facts,
 * so it is left out; otherwise every refresh would store another copy.
 */
export function payloadHash(source: string, payload: unknown) {
	const stable =
		source === CACHE_SOURCE && payload && typeof payload === 'object' && 'refreshAt' in payload
			? { ...payload, refreshAt: undefined }
			: payload;
	return createHash('sha256').update(canonicalJson(stable)).digest();
}

/** The newest completed record per source/native ID, to compare hashes against. */
async function latestRecords(db: Db, evidence: SourcePayload[]) {
	if (!evidence.length) return new Map<string, { id: string; payloadHash: Uint8Array }>();
	const rows = await db.$queryRaw<
		{ id: string; source: string; nativeId: string; payloadHash: Uint8Array }[]
	>`
    SELECT DISTINCT ON (run.source, r.source_native_id)
      r.id, run.source, r.source_native_id AS "nativeId", r.payload_hash AS "payloadHash"
    FROM source_record r
    JOIN ingestion_run run ON run.id = r.ingestion_run_id
    WHERE run.status = 'completed'
      AND run.source = ANY(${[...new Set(evidence.map((item) => item.source))]}::text[])
      AND r.source_native_id = ANY(${[...new Set(evidence.map((item) => item.nativeId))]}::text[])
    ORDER BY run.source, r.source_native_id, r.observed_at DESC`;
	return new Map(rows.map((row) => [`${row.source}:${row.nativeId}`, row]));
}

async function recordEvidence(db: Db, evidence: SourcePayload[]): Promise<Map<string, string>> {
	const runs = new Map<string, string>();
	const records = new Map<string, string>();
	const latest = await latestRecords(db, evidence);
	for (const item of evidence) {
		const hash = payloadHash(item.source, item.payload);
		const key = `${item.source}:${item.nativeId}:${hash.toString('hex')}`;
		if (records.has(key)) continue;
		// Unchanged since the last observation: refresh that record in place.
		const previous = latest.get(`${item.source}:${item.nativeId}`);
		if (previous && hash.equals(previous.payloadHash)) {
			await db.sourceRecord.update({
				where: { id: previous.id },
				data: { payload: item.payload as Prisma.InputJsonValue, observedAt: new Date() }
			});
			records.set(key, previous.id);
			continue;
		}
		let runId = runs.get(item.source);
		if (!runId) {
			await db.source.upsert({
				where: { code: item.source },
				create: { code: item.source, description: `Imported from ${item.source}` },
				update: {}
			});
			const run = await db.ingestionRun.create({
				data: { source: item.source, parserVersion: CATALOG_VERSION }
			});
			runId = run.id;
			runs.set(item.source, runId);
		}
		const url = new URL(item.url);
		url.searchParams.delete('api_key');
		const record = await db.sourceRecord.create({
			data: {
				ingestionRunId: runId,
				sourceNativeId: item.nativeId,
				sourceUrl: url.href,
				payload: item.payload as Prisma.InputJsonValue,
				payloadHash: hash
			}
		});
		records.set(key, record.id);
	}
	for (const id of runs.values()) {
		await db.ingestionRun.update({
			where: { id },
			data: { status: 'completed', completedAt: new Date() }
		});
	}
	return records;
}

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

export { parseStrength };

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
		strength: parseStrength(active.strength)
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
			ordinal: number;
		})[] = [];
		for (const [index, active] of parsed.entries()) {
			desired.push({
				productId,
				ingredientId: await namedEntity(db, 'ingredient', active.name),
				...active.strength!,
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
					row.strengthDenUom !== next.strengthDenUom
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
				const snapshot = snapshotPackage(item);
				const records = await recordEvidence(tx, [
					{
						source: CACHE_SOURCE,
						nativeId: item.ndc,
						url: `urn:rxdb:catalog:ndc:${item.ndc}`,
						payload: snapshot
					}
				]);
				await persistPackage(tx, item, [...records.values()][0]);
			},
			{ timeout: 60_000 }
		);
	}
}

function canRestorePackage(item: ExternalPackage): boolean {
	return (
		item.isVeterinary === false &&
		(item.listed === true ||
			item.splPresent === true ||
			item.rxcuiStatus?.toUpperCase() === 'ACTIVE')
	);
}

/** Reevaluate time-dependent exclusions even when no provider refresh is needed. */
export async function refreshPackageEligibility(db: PrismaClient, items: ExternalPackage[]) {
	if (!items.length) return;
	await db.$transaction(
		async (tx) => {
			await tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;
			await applyEligibility(tx, items);
		},
		{ timeout: 60_000 }
	);
}

async function applyEligibility(db: Db, items: ExternalPackage[]) {
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
