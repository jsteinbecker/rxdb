/**
 * Persisted package state: provider baselines and user decisions, written under a
 * sorted package lock with revision (compare-and-swap) checks so a refresh never
 * overwrites a decision.
 *
 * @module
 */
import type { Prisma, PackageCuration } from '../../../generated/client';
import type { ExternalPackage } from '../../catalog/types';
import {
	curatedPackage,
	providerBaseline,
	recoverLegacyBaseline,
	samePackageValue,
	type PackageOverrides,
	type PackageReview
} from '../../catalog/package-state';
import { mergePackage } from '../../catalog/effective-package';
import { CATALOG_VERSION, snapshotPackage, type PackageSnapshot } from './cache';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | 'packageCuration'>;
export type PackageState = Omit<PackageCuration, 'baseline' | 'overrides' | 'review'> & {
	baseline: ExternalPackage;
	overrides: PackageOverrides;
	review: PackageReview;
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export class PackageConflict extends Error {
	readonly status = 409;
	constructor() {
		super('This package changed while you were editing. Reload the page and review your changes.');
	}
}
export function expectedPackageRevision(value: unknown): number {
	if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
		throw new PackageConflict();
	return Number(value);
}
export function assertPackageRevision(state: PackageState, expected: number) {
	if (!Number.isSafeInteger(expected) || state.revision !== expected) throw new PackageConflict();
}

/** All multi-package writers use the same sorted lock order. */
export async function lockPackageStates(db: Pick<Db, '$queryRaw'>, ndcs: string[]) {
	for (const ndc of [...new Set(ndcs)].sort())
		await db.$queryRaw`SELECT pg_advisory_xact_lock(731925, hashtext(${ndc}))::text`;
}

function decode(row: PackageCuration): PackageState {
	if (row.initialized)
		return {
			...row,
			baseline: row.baseline as unknown as ExternalPackage,
			overrides: row.overrides as PackageOverrides,
			review: row.review as PackageReview
		};
	const legacy = row.baseline as unknown as ExternalPackage;
	const recovered = recoverLegacyBaseline(
		{ ...legacy, propertyOverrides: row.overrides as PackageOverrides },
		row.legacyBaseline as unknown as ExternalPackage | null
	);
	return {
		...row,
		...recovered,
		overrides: row.overrides as PackageOverrides,
		review: row.review as PackageReview
	};
}

export async function loadPackageStates(
	db: Db,
	ndcs: string[],
	{ withoutLabel = false } = {}
): Promise<Map<string, PackageState>> {
	if (!ndcs.length) return new Map();
	const rows = withoutLabel
		? await db.$queryRaw<PackageCuration[]>`
    SELECT ndc, baseline #- '{details,label}' AS baseline, baseline_version AS "baselineVersion",
      refresh_at AS "refreshAt", overrides, review - 'label' AS review, revision, initialized,
      unknown_keys AS "unknownKeys", NULL::jsonb AS "legacySnapshot",
      legacy_baseline #- '{details,label}' AS "legacyBaseline", updated_at AS "updatedAt"
    FROM package_curation WHERE ndc = ANY(${ndcs}::text[])`
		: await db.packageCuration.findMany({ where: { ndc: { in: ndcs } } });
	return new Map(rows.map((row) => [row.ndc, decode(row)]));
}

export function stateSnapshot(state: PackageState): PackageSnapshot {
	return {
		version: CATALOG_VERSION,
		baselineVersion: state.baselineVersion,
		refreshAt: state.refreshAt.toISOString(),
		baseline: state.baseline,
		item: curatedPackage(
			state.baseline,
			state.overrides,
			state.review,
			state.revision,
			state.unknownKeys
		)
	};
}
export function projectionPayload(state: PackageState): PackageSnapshot {
	const { baseline: _baseline, ...snapshot } = stateSnapshot(state);
	void _baseline;
	return snapshot;
}

/** Caller holds the package lock. Refresh never overwrites user decisions. */
export async function writeProviderBaseline(db: Db, item: ExternalPackage): Promise<PackageState> {
	const previous = (await loadPackageStates(db, [item.ndc])).get(item.ndc);
	if (item.editRevision !== undefined && previous) return previous; // Promotion of an already resolved package.
	const fresh = providerBaseline(item);
	const baseline = previous ? providerBaseline(mergePackage(previous.baseline, fresh)) : fresh;
	const changed =
		previous &&
		(previous.baselineVersion !== CATALOG_VERSION ||
			!samePackageValue(previous.baseline, baseline));
	const row = await db.packageCuration.upsert({
		where: { ndc: item.ndc },
		create: {
			ndc: item.ndc,
			baseline: json(baseline),
			baselineVersion: CATALOG_VERSION,
			refreshAt: new Date(snapshotPackage(fresh).refreshAt),
			overrides: json(item.propertyOverrides ?? {})
		},
		update: {
			baseline: json(baseline),
			baselineVersion: CATALOG_VERSION,
			refreshAt: new Date(snapshotPackage(fresh).refreshAt),
			initialized: true,
			unknownKeys: [],
			...(changed ? { revision: { increment: 1 } } : {})
		}
	});
	return decode(row);
}

/** Caller holds the package lock; CAS also protects callers that misuse the lock. */
export async function writePackageDecisions(
	db: Db,
	state: PackageState,
	changes: {
		overrides: PackageOverrides;
		review?: PackageReview;
		baseline?: ExternalPackage;
		evidence?: unknown;
	}
) {
	const update = await db.packageCuration.updateMany({
		where: { ndc: state.ndc, revision: state.revision },
		data: {
			overrides: json(changes.overrides),
			review: json(changes.review ?? state.review),
			baseline: json(changes.baseline ?? state.baseline),
			initialized: true,
			unknownKeys: changes.baseline ? [] : state.unknownKeys,
			...(changes.baseline
				? {
						baselineVersion: CATALOG_VERSION,
						refreshAt: new Date(snapshotPackage(changes.baseline).refreshAt)
					}
				: {}),
			revision: { increment: 1 }
		}
	});
	if (update.count !== 1) throw new PackageConflict();
	return (await loadPackageStates(db, [state.ndc])).get(state.ndc)!;
}
