import type { PrismaClient } from '../../generated/client';
import type { ExternalPackage, RxConcept } from './catalog-providers';
import { exclusionReason } from './catalog-facts';
import { persistCollection } from './catalog-store';

export const DEFAULT_FORMULARY = 'Default formulary';
const ORIGIN = 'formulary_origin';

export type LoadTarget = { kind: 'concept'; rxcui: string } | { kind: 'package'; ndc: string };
export type LoadResult = {
	formularyItemId: string;
	displayName: string;
	created: boolean;
	packagesLinked: number;
	packagesSkipped: { ndc: string; reason: string }[];
};

export const originKey = (scopeId: string, target: LoadTarget) =>
	`${scopeId}:${target.kind === 'concept' ? `rxcui:${target.rxcui}` : `ndc:${target.ndc}`}`;

/** Any root formulary scope; the default one may have been renamed in Settings. */
export const findDefaultScope = (db: PrismaClient) =>
	db.scope.findFirst({
		where: { kind: 'formulary', parentId: null },
		orderBy: { id: 'asc' }
	});

export async function defaultScope(db: PrismaClient) {
	const existing =
		(await db.scope.findFirst({
			where: { kind: 'formulary', name: DEFAULT_FORMULARY },
			orderBy: { id: 'asc' }
		})) ?? (await findDefaultScope(db));
	return existing ?? db.scope.create({ data: { kind: 'formulary', name: DEFAULT_FORMULARY } });
}

/** Which staged nodes already have a formulary item in the scope. */
export async function loadedOrigins(
	db: PrismaClient,
	scopeId: string,
	targets: LoadTarget[]
): Promise<Set<string>> {
	if (!targets.length) return new Set();
	const rows = await db.externalIdentifier.findMany({
		where: {
			namespace: ORIGIN,
			normalizedValue: { in: targets.map((target) => originKey(scopeId, target)) },
			validTo: null,
			entity: { retiredAt: null }
		},
		select: { normalizedValue: true }
	});
	return new Set(rows.map((row) => row.normalizedValue));
}

/**
 * Promote a staged node into the canonical catalog and the formulary. Only here
 * are clinical-drug, product, package, ingredient and labeler entities written.
 */
export async function loadToFormulary(
	db: PrismaClient,
	scopeId: string,
	target: LoadTarget,
	concept: RxConcept | null,
	packages: ExternalPackage[]
): Promise<LoadResult> {
	const skipped: { ndc: string; reason: string }[] = [];
	const eligible = packages.filter((item) => {
		const reason = exclusionReason(item);
		if (reason) skipped.push({ ndc: item.ndc, reason });
		return !reason;
	});
	await persistCollection(db, concept ? [concept] : [], eligible);

	const displayName =
		target.kind === 'concept'
			? (concept?.name ?? `RxCUI ${target.rxcui}`)
			: [
					eligible[0]?.genericName ?? eligible[0]?.brandName ?? packages[0]?.description,
					`NDC ${target.ndc}`
				]
					.filter(Boolean)
					.join(' · ');
	const key = originKey(scopeId, target);

	return db.$transaction(
		async (tx) => {
			await tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;
			await tx.identifierNamespace.upsert({
				where: { code: ORIGIN },
				create: { code: ORIGIN, appliesTo: ['formulary_item'] },
				update: {}
			});
			const origin = await tx.externalIdentifier.findFirst({
				where: {
					namespace: ORIGIN,
					normalizedValue: key,
					validTo: null,
					entity: { retiredAt: null }
				}
			});
			let formularyItemId = origin?.entityId;
			if (!formularyItemId) {
				const entity = await tx.entity.create({ data: { type: 'formulary_item' } });
				await tx.formularyItem.create({
					data: {
						id: entity.id,
						scopeId,
						kind: target.kind === 'concept' ? 'clinical_drug' : 'package',
						displayName
					}
				});
				await tx.externalIdentifier.create({
					data: {
						entityId: entity.id,
						namespace: ORIGIN,
						value: key,
						normalizedValue: key,
						isPrimary: true
					}
				});
				formularyItemId = entity.id;
			}
			const packageIds = eligible.length
				? await tx.externalIdentifier.findMany({
						where: {
							namespace: 'ndc11',
							normalizedValue: { in: eligible.map((item) => item.ndc) },
							validTo: null
						},
						select: { entityId: true, normalizedValue: true }
					})
				: [];
			const linked = await tx.formularyItemPackage.findMany({
				where: { formularyItemId, validTo: null },
				select: { packageId: true, preferenceRank: true }
			});
			const known = new Set(linked.map((row) => row.packageId));
			let rank = Math.max(0, ...linked.map((row) => row.preferenceRank));
			const order = new Map(eligible.map((item, index) => [item.ndc, index]));
			const fresh = packageIds
				.filter((row) => !known.has(row.entityId))
				.sort((a, b) => order.get(a.normalizedValue)! - order.get(b.normalizedValue)!);
			if (fresh.length)
				await tx.formularyItemPackage.createMany({
					data: fresh.map((row) => ({
						formularyItemId: formularyItemId!,
						packageId: row.entityId,
						preferenceRank: ++rank
					}))
				});
			for (const item of eligible) {
				if (!packageIds.some((row) => row.normalizedValue === item.ndc))
					skipped.push({ ndc: item.ndc, reason: 'no-provider-evidence' });
			}
			return {
				formularyItemId,
				displayName,
				created: !origin,
				packagesLinked: linked.length + fresh.length,
				packagesSkipped: skipped
			};
		},
		{ timeout: 60_000 }
	);
}

export type LoadedItem = {
	formularyItemId: string;
	displayName: string;
	target: LoadTarget;
	/** RxNorm term type of a concept load (SCD, SBD, GPCK…), when the catalog knows it. */
	tty: string | null;
	packages: number;
	loadedAt: Date;
};

function parseOrigin(scopeId: string, key: string): LoadTarget | null {
	const match = key.slice(scopeId.length + 1).match(/^(rxcui|ndc):(.+)$/);
	if (!key.startsWith(`${scopeId}:`) || !match) return null;
	return match[1] === 'rxcui'
		? { kind: 'concept', rxcui: match[2] }
		: { kind: 'package', ndc: match[2] };
}

/** Every live formulary item in the scope, at the level it was loaded. */
export async function loadedItems(db: PrismaClient, scopeId: string): Promise<LoadedItem[]> {
	const origins = await db.externalIdentifier.findMany({
		where: {
			namespace: ORIGIN,
			normalizedValue: { startsWith: `${scopeId}:` },
			validTo: null,
			entity: { retiredAt: null, formularyItem: { scopeId } }
		},
		select: {
			normalizedValue: true,
			entity: {
				select: {
					createdAt: true,
					formularyItem: {
						select: {
							id: true,
							displayName: true,
							_count: { select: { formularyItemPackages: { where: { validTo: null } } } }
						}
					}
				}
			}
		}
	});
	const items = origins.flatMap((row) => {
		const target = parseOrigin(scopeId, row.normalizedValue);
		const item = row.entity.formularyItem;
		return target && item ? [{ target, item, loadedAt: row.entity.createdAt }] : [];
	});
	const rxcuis = items.flatMap(({ target }) => (target.kind === 'concept' ? [target.rxcui] : []));
	const concepts = rxcuis.length
		? await db.externalIdentifier.findMany({
				where: { namespace: 'rxnorm_rxcui', normalizedValue: { in: rxcuis }, validTo: null },
				select: {
					normalizedValue: true,
					entity: { select: { clinicalDrug: { select: { tty: true } } } }
				}
			})
		: [];
	const tty = new Map(concepts.map((row) => [row.normalizedValue, row.entity.clinicalDrug?.tty]));
	return items.map(({ target, item, loadedAt }) => ({
		formularyItemId: item.id,
		displayName: item.displayName,
		target,
		tty: target.kind === 'concept' ? (tty.get(target.rxcui) ?? null) : null,
		packages: item._count.formularyItemPackages,
		loadedAt
	}));
}

/**
 * Take a formulary item off the formulary at the level it was loaded: the
 * whole concept (every package it pooled) or the single package. History is
 * kept: package links and the origin are end-dated and the item retired, so a
 * later load of the same node starts a fresh item.
 */
export async function removeFromFormulary(
	db: PrismaClient,
	scopeId: string,
	formularyItemId: string
): Promise<{ displayName: string; packagesUnlinked: number }> {
	return db.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;
		const item = await tx.formularyItem.findFirst({
			where: { id: formularyItemId, scopeId, entity: { retiredAt: null } },
			select: { displayName: true }
		});
		if (!item) throw new Error('That item is not on this formulary.');
		const now = new Date();
		const { count } = await tx.formularyItemPackage.updateMany({
			where: { formularyItemId, validTo: null },
			data: { validTo: now }
		});
		await tx.externalIdentifier.updateMany({
			where: { entityId: formularyItemId, namespace: ORIGIN, validTo: null },
			data: { validTo: now }
		});
		await tx.entity.update({
			where: { id: formularyItemId },
			data: { status: 'retired', retiredAt: now }
		});
		return { displayName: item.displayName, packagesUnlinked: count };
	});
}

/**
 * Blank-slate reset: wipes every table (formulary, catalog, history,
 * settings — everything but the migration log). Reference rows and the
 * default scope are recreated on demand by the next load.
 */
export async function clearFormulary(
	db: PrismaClient,
	scopeId: string
): Promise<{ itemsRemoved: number; packagesUnlinked: number }> {
	return db.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;
		const itemsRemoved = await tx.formularyItem.count({
			where: { scopeId, entity: { retiredAt: null } }
		});
		const packagesUnlinked = await tx.formularyItemPackage.count({
			where: { formularyItem: { scopeId }, validTo: null }
		});
		const tables = await tx.$queryRaw<{ name: string }[]>`
			SELECT quote_ident(tablename) AS name FROM pg_tables
			WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
		if (tables.length)
			await tx.$executeRawUnsafe(
				`TRUNCATE ${tables.map((t) => t.name).join(', ')} RESTART IDENTITY CASCADE`
			);
		return { itemsRemoved, packagesUnlinked };
	});
}
