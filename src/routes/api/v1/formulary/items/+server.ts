import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/infrastructure/database';
import { defaultScope, loadedItems, localNamesOf } from '$lib/server/formulary/membership';
import { formularyRows } from '$lib/server/formulary/read';
import { loadPackageSnapshots } from '../../../../../lib/server/catalog/snapshot-store';
import { itemPackages } from '$lib/formulary/item';
import { hyphenCandidates, labeledNdc, toNdc11 } from '$lib/catalog/ndc';
import type { RequestHandler } from './$types';

/**
 * GET /api/v1/formulary/items[?q=...]
 *
 * The default formulary's items, each with its linked packages, for apps that
 * import from it (KitTracker's med entry). `q` matches the item name, a brand,
 * generic or ingredient name, or any NDC hyphenation. Read-only: nothing is
 * collected from providers, so an unknown drug must be loaded here first.
 */
export const GET: RequestHandler = async ({ url }) => {
	const scope = await defaultScope(prisma);
	const loading = loadedItems(prisma, scope.id);
	const names = loading.then(localNamesOf);
	names.catch(() => {}); // a failure surfaces through Promise.all; don't report it twice
	const [items, rows] = await Promise.all([loading, formularyRows(prisma, scope.id, names)]);
	const snapshots = await loadPackageSnapshots(
		prisma,
		rows.map((row) => row.ndc),
		{ withoutLabel: true }
	);

	const result = items.map((item) => {
		const packages = itemPackages(rows, item.formularyItemId).map((row) => {
			const snapshot = snapshots.get(row.ndc)?.item;
			return {
				ndc11: row.ndc,
				ndc: labeledNdc(row.ndc, snapshot?.productCode) ?? hyphenCandidates(row.ndc)[0] ?? row.ndc,
				description: row.displayTitle ?? row.description,
				doseForm: row.doseForm,
				routes: row.routes,
				ingredients: row.ingredients,
				brandName: row.brandName,
				genericName: row.genericName,
				labeler: row.labeler,
				size: row.size,
				isMultiDose: row.isMultiDose,
				preferenceRank: row.preferenceRank,
				status: row.status
			};
		});
		return {
			id: item.formularyItemId,
			displayName: item.displayName,
			releaseAbbreviation: item.releaseAbbreviation,
			rxcui: item.target.kind === 'concept' ? item.target.rxcui : null,
			tty: item.tty,
			packages
		};
	});

	const q = url.searchParams.get('q')?.trim().toLowerCase();
	if (!q) return json({ items: result });
	const ndc = toNdc11(q);
	const digits = q.replace(/\D/g, '');
	return json({
		items: result.filter(
			(item) =>
				item.displayName.toLowerCase().includes(q) ||
				item.packages.some(
					(pkg) =>
						(ndc && pkg.ndc11 === ndc) ||
						(digits.length >= 4 && pkg.ndc.replace(/\D/g, '').includes(digits)) ||
						[pkg.brandName, pkg.genericName, ...pkg.ingredients.map((i) => i.name)].some((name) =>
							name?.toLowerCase().includes(q)
						)
				)
		)
	});
};
