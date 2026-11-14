/**
 * Every cached package that refers to a UNII, and how it refers to it.
 *
 * @module
 */
import type { PrismaClient } from '../../../generated/client';
import type { PackageSnapshot } from './cache';
import { loadPackageStates, stateSnapshot } from './package-state-store';
import { packageTitle } from '../../catalog/package-title';
import { formContext } from '../../medication/strength-style';

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
	/** The dose form text strength display rules match (`formContext`). */
	strengthForm: string;
	/** The package's active ingredients, the companions a strength rule can name. */
	actives: string[];
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
	const ids = await db.$queryRaw<{ ndc: string }[]>`
    SELECT ndc FROM package_curation
    WHERE baseline::text LIKE ${`%"${unii}"%`} OR overrides::text LIKE ${`%"${unii}"%`}
      OR review::text LIKE ${`%"${unii}"%`} OR legacy_baseline::text LIKE ${`%"${unii}"%`}`;
	const states = await loadPackageStates(
		db,
		ids.map((row) => row.ndc),
		{ withoutLabel: true }
	);
	return [...states.values()]
		.flatMap((state) => {
			const ndc = state.ndc;
			const snapshot = stateSnapshot(state);
			const roles = rolesIn(snapshot.item, unii);
			if (!roles.length) return [];
			const { description, brandName, genericName, labelerName, doseForm } = snapshot.item;
			const title = packageTitle(snapshot.item);
			const strengthForm = formContext(title, doseForm, snapshot.item.details?.product?.routes ?? []);
			const actives = (snapshot.item.details?.spl?.ingredients ?? [])
				.filter((ingredient) => ingredient.kind === 'active')
				.map((ingredient) => ingredient.name);
			return [
				{ ndc, title, description, brandName, genericName, labelerName, doseForm, roles, strengthForm, actives }
			];
		})
		.sort((a, b) => a.ndc.localeCompare(b.ndc));
}
