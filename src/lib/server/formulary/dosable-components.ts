/**
 * Reads for the dosable components pages: every drug + route of a formulary
 * ("Ampicillin IV"), and one with its formulary items, their NDC packages, and
 * the compounds whose lines draw from it.
 *
 * @module
 */
import type { PrismaClient } from '../../../generated/client';
import { componentLabel } from '../compounds/constituents';
import { formularyRows } from './read';
import { localNamesOf, loadedItems } from './membership';
import { packageTitle } from '../../catalog/package-title';
import { ingredientLabel } from '../../formulary/hierarchy';
import { loadPackageSnapshots } from '../catalog/snapshot-store';
import { standardConcentration, FLAG_TEXT } from '../../compounds/standard-concentration';

export interface DosableSummary {
	id: string;
	label: string;
	route: string;
	/** Ingredient names in the component's order. */
	ingredients: string[];
	items: number;
	compounds: number;
	source: string;
	retired: boolean;
}

/** Every dosable component of a scope, live ones first, then by name and route. */
export async function listDosables(db: PrismaClient, scopeId: string): Promise<DosableSummary[]> {
	const rows = await db.dosableComponent.findMany({
		where: { scopeId },
		select: {
			id: true,
			displayName: true,
			nameOverride: true,
			route: true,
			source: true,
			retiredAt: true,
			ingredients: {
				orderBy: { ordinal: 'asc' },
				select: { ingredient: { select: { name: true } } }
			},
			_count: { select: { items: { where: { retiredAt: null } } } },
			formulaSlots: { select: { formulaId: true } }
		}
	});
	return rows
		.map((row) => ({
			id: row.id,
			label: componentLabel(row),
			route: row.route,
			ingredients: row.ingredients.map((entry) => ingredientLabel(entry.ingredient.name)),
			items: row._count.items,
			compounds: new Set(row.formulaSlots.map((slot) => slot.formulaId)).size,
			source: row.source,
			retired: row.retiredAt !== null
		}))
		.sort((a, b) => Number(a.retired) - Number(b.retired) || a.label.localeCompare(b.label));
}

type CompoundUse = {
	id: string;
	name: string;
	status: string;
	/** Each line of the compound that draws from the component, with how far it is pinned. */
	lines: {
		role: string;
		pinnedItem: string | null;
		ndcSubset: number | null;
		reason: string | null;
	}[];
};

/** One dosable component in a scope, or null when there is none with that id. */
export async function loadDosable(db: PrismaClient, scopeId: string, id: string) {
	const row = await db.dosableComponent.findFirst({
		where: { id, scopeId },
		select: {
			id: true,
			displayName: true,
			nameOverride: true,
			route: true,
			source: true,
			retiredAt: true,
			ingredients: {
				orderBy: { ordinal: 'asc' },
				select: { ingredient: { select: { name: true } } }
			},
			items: {
				select: {
					formularyItemId: true,
					source: true,
					retiredAt: true,
					formularyItem: { select: { displayName: true } }
				}
			},
			formulaSlots: {
				orderBy: { ordinal: 'asc' },
				select: {
					role: true,
					formularyItem: { select: { displayName: true } },
					packageRestriction: { select: { reason: true, _count: { select: { packages: true } } } },
					formula: { select: { id: true, name: true, status: true } }
				}
			}
		}
	});
	if (!row) return null;

	// The formulary's own rows give each package its NDC and shown title.
	const rows = await formularyRows(db, scopeId, localNamesOf(await loadedItems(db, scopeId)));
	const itemIds = new Set(row.items.map((item) => item.formularyItemId));
	const packagesOf = new Map<string, { packageId: string; ndc: string; title: string }[]>();
	for (const entry of rows) {
		if (!itemIds.has(entry.formularyItemId)) continue;
		const list = packagesOf.get(entry.formularyItemId) ?? [];
		list.push({ packageId: entry.packageId, ndc: entry.ndc, title: packageTitle(entry) });
		packagesOf.set(entry.formularyItemId, list);
	}
	const shownName = new Map(rows.map((entry) => [entry.formularyItemId, entry.formularyItem]));

	const compounds = new Map<string, CompoundUse>();
	for (const slot of row.formulaSlots) {
		const compound: CompoundUse = compounds.get(slot.formula.id) ?? { ...slot.formula, lines: [] };
		compound.lines.push({
			role: slot.role,
			pinnedItem: slot.formularyItem?.displayName ?? null,
			ndcSubset: slot.packageRestriction?._count.packages ?? null,
			reason: slot.packageRestriction?.reason ?? null
		});
		compounds.set(slot.formula.id, compound);
	}

	// The standard reconstituted concentration, from every linked item's labels.
	const live = row.items.filter((item) => item.retiredAt === null);
	const snapshots = await loadPackageSnapshots(
		db,
		live.flatMap((item) => (packagesOf.get(item.formularyItemId) ?? []).map((pkg) => pkg.ndc))
	);
	const concentration = standardConcentration(
		row.route,
		live.map((item) => ({
			itemId: item.formularyItemId,
			packages: (packagesOf.get(item.formularyItemId) ?? []).map((pkg) => {
				const snapshot = snapshots.get(pkg.ndc)?.item;
				return {
					packageId: pkg.packageId,
					ndc: pkg.ndc,
					title: pkg.title,
					isDryFill: snapshot ? snapshot.isDryFill : null,
					reconstitution: snapshot?.reconstitution ?? []
				};
			})
		})),
		row.ingredients.length > 1
	);
	const concentrationOf = new Map(concentration.items.map((item) => [item.itemId, item]));

	return {
		id: row.id,
		label: componentLabel(row),
		concentration: { status: concentration.status, mgPerMl: concentration.mgPerMl },
		route: row.route,
		ingredients: row.ingredients.map((entry) => ingredientLabel(entry.ingredient.name)),
		source: row.source,
		retired: row.retiredAt !== null,
		formularyItems: row.items
			.map((item) => ({
				id: item.formularyItemId,
				name: shownName.get(item.formularyItemId) ?? item.formularyItem.displayName,
				source: item.source,
				retired: item.retiredAt !== null,
				concentration: concentrationOf.has(item.formularyItemId)
					? {
							...concentrationOf.get(item.formularyItemId)!,
							notes: concentrationOf.get(item.formularyItemId)!.flags.map((flag) => FLAG_TEXT[flag])
						}
					: null,
				packages: packagesOf.get(item.formularyItemId) ?? []
			}))
			.sort((a, b) => Number(a.retired) - Number(b.retired) || a.name.localeCompare(b.name)),
		compoundList: [...compounds.values()].sort((a, b) => a.name.localeCompare(b.name))
	};
}
