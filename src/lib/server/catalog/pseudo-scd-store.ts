/**
 * Persisting pseudo-SCD links: pointing each package at the pseudo-SCD its facts
 * derive, and backfilling links from the latest snapshots.
 *
 * @module
 */
import type { Prisma, PrismaClient } from '../../../generated/client';
import { PSEUDO_SCD_TTY, pseudoScdFor, type PseudoScdSource } from '../../medication/pseudo-scd';
import { loadPackageSnapshots } from './snapshot-store';

type Db = Prisma.TransactionClient;

export const PSEUDO_SCD_NAMESPACE = 'pseudo_scd';
export const PACKAGE_PSEUDO_SCD = 'package_pseudo_clinical_drug';

/** The pseudo-SCD clinical drug for these contents, created on first use. */
async function pseudoScdEntity(db: Db, key: string, name: string): Promise<string> {
	await db.identifierNamespace.upsert({
		where: { code: PSEUDO_SCD_NAMESPACE },
		create: { code: PSEUDO_SCD_NAMESPACE, appliesTo: ['clinical_drug'], isDerived: true },
		update: {}
	});
	const existing = await db.externalIdentifier.findFirst({
		where: { namespace: PSEUDO_SCD_NAMESPACE, normalizedValue: key, validTo: null }
	});
	if (existing) {
		await db.clinicalDrug.update({
			where: { id: existing.entityId },
			data: { name, tty: PSEUDO_SCD_TTY }
		});
		return existing.entityId;
	}
	const entity = await db.entity.create({ data: { type: 'clinical_drug' } });
	await db.clinicalDrug.create({ data: { id: entity.id, name, tty: PSEUDO_SCD_TTY } });
	await db.externalIdentifier.create({
		data: {
			entityId: entity.id,
			namespace: PSEUDO_SCD_NAMESPACE,
			value: key,
			normalizedValue: key,
			isPrimary: true,
			derivationRule: 'bulk dry-fill content'
		}
	});
	return entity.id;
}

/**
 * Point a package at the pseudo-SCD its facts derive, or end its link when
 * they no longer do. The RxNorm `package_clinical_drug` link is untouched.
 */
export async function linkPseudoScd(
	db: Db,
	packageId: string,
	item: PseudoScdSource,
	sourceRecordId: string | null = null
) {
	const pseudo = pseudoScdFor(item);
	const drugId = pseudo ? await pseudoScdEntity(db, pseudo.key, pseudo.name) : null;
	await db.relationshipType.upsert({
		where: { code: PACKAGE_PSEUDO_SCD },
		create: {
			code: PACKAGE_PSEUDO_SCD,
			fromType: 'package',
			toType: 'clinical_drug',
			cardinality: 'one'
		},
		update: {}
	});
	const current = await db.entityRelationship.findMany({
		where: { relationshipType: PACKAGE_PSEUDO_SCD, fromEntityId: packageId, validTo: null }
	});
	if (drugId && current.length === 1 && current[0].toEntityId === drugId) return;
	if (current.length)
		await db.entityRelationship.updateMany({
			where: { relationshipType: PACKAGE_PSEUDO_SCD, fromEntityId: packageId, validTo: null },
			data: { validTo: new Date() }
		});
	if (drugId)
		await db.entityRelationship.create({
			data: {
				relationshipType: PACKAGE_PSEUDO_SCD,
				fromEntityId: packageId,
				toEntityId: drugId,
				sourceRecordId
			}
		});
}

/** Derive pseudo-SCD links for every catalog package from its latest snapshot. */
export async function backfillPseudoScds(db: PrismaClient): Promise<number> {
	const packages = await db.externalIdentifier.findMany({
		where: { namespace: 'ndc11', validTo: null, entity: { type: 'package' } },
		select: { entityId: true, normalizedValue: true }
	});
	const snapshots = await loadPackageSnapshots(
		db,
		packages.map((row) => row.normalizedValue)
	);
	let linked = 0;
	for (const row of packages) {
		const item = snapshots.get(row.normalizedValue)?.item;
		if (!item) continue;
		await db.$transaction(async (tx) => {
			await tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;
			await linkPseudoScd(tx, row.entityId, item);
		});
		if (pseudoScdFor(item)) linked++;
	}
	return linked;
}
