import type { PrismaClient } from '../../generated/client';
import { CACHE_SOURCE, readSnapshot, type PackageSnapshot } from './catalog-cache';
import { packageTitle } from '../package-title';

/** UNIIs are 10 uppercase alphanumerics. */
export const normalizeUnii = (value: string) => {
	const unii = value.trim().toUpperCase();
	return /^[A-Z0-9]{10}$/.test(unii) ? unii : null;
};

/** How a package's data refers to the UNII. */
export type UniiRole =
	| { kind: 'active' | 'inactive' | 'ionic'; name: string; strength: string | null }
	| { kind: 'moiety'; name: string; of: string }
	| { kind: 'openfda' };

export type UniiUsage = {
	ndc: string;
	/** The title the package's NDC page shows. */
	title: string;
	description: string | null;
	brandName: string | null;
	genericName: string | null;
	labelerName: string | null;
	doseForm: string | null;
	roles: UniiRole[];
};

function rolesIn(item: PackageSnapshot['item'], unii: string): UniiRole[] {
	const roles: UniiRole[] = [];
	for (const ingredient of item.details?.spl?.ingredients ?? []) {
		if (ingredient.unii === unii)
			roles.push({ kind: ingredient.kind, name: ingredient.name, strength: ingredient.strength });
		for (const moiety of ingredient.moieties)
			if (moiety.unii === unii)
				roles.push({ kind: 'moiety', name: moiety.name, of: ingredient.name });
	}
	if (item.details?.product?.uniis.includes(unii)) roles.push({ kind: 'openfda' });
	return roles;
}

/** Every cached package snapshot (latest per NDC) that references the UNII anywhere. */
export async function uniiUsage(db: PrismaClient, unii: string): Promise<UniiUsage[]> {
	const rows = await db.$queryRaw<{ ndc: string; payload: unknown }[]>`
		SELECT DISTINCT ON (r.source_native_id) r.source_native_id AS ndc, r.payload
		FROM source_record r
		JOIN ingestion_run run ON run.id = r.ingestion_run_id
		WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
		ORDER BY r.source_native_id, r.observed_at DESC`;
	return rows
		.flatMap(({ ndc, payload }) => {
			// Only the latest snapshot per NDC counts, so filter after DISTINCT ON.
			if (!JSON.stringify(payload).includes(`"${unii}"`)) return [];
			const snapshot = readSnapshot(payload);
			if (!snapshot || snapshot.item.ndc !== ndc) return [];
			const roles = rolesIn(snapshot.item, unii);
			if (!roles.length) return [];
			const { description, brandName, genericName, labelerName, doseForm } = snapshot.item;
			const title = packageTitle(snapshot.item);
			return [{ ndc, title, description, brandName, genericName, labelerName, doseForm, roles }];
		})
		.sort((a, b) => a.ndc.localeCompare(b.ndc));
}
