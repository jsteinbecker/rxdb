import { naturalCompare } from '$lib/natural-sort';
import type { Prisma } from '../../generated/client';
import {
	addBrand,
	brandKey,
	mergeBrands,
	removeBrand,
	type BrandRow
} from '$lib/brand-tags';

type Db = Prisma.TransactionClient;
export type BrandTag = { name: string; nameKey: string; source: 'rxnorm' | 'manual' };
export type ItemBrands = { active: BrandTag[]; dismissed: BrandTag[] };

const rowsOf = async (db: Db, formularyItemId: string): Promise<BrandRow[]> =>
	(await db.formularyItemBrand.findMany({
		where: { formularyItemId },
		select: { name: true, nameKey: true, source: true, suppressed: true }
	})) as BrandRow[];

/** Insert the RxNorm brands the item does not have yet; existing rows, dismissed or not, are untouched. */
export async function seedBrands(
	db: Db,
	formularyItemId: string,
	incoming: { name: string; rxcui?: string | null }[]
) {
	const fresh = mergeBrands(
		await rowsOf(db, formularyItemId),
		incoming.map((brand) => brand.name)
	);
	if (!fresh.length) return;
	const rxcuiOf = new Map(incoming.map((brand) => [brandKey(brand.name), brand.rxcui ?? null]));
	await db.formularyItemBrand.createMany({
		data: fresh.map((name) => ({
			formularyItemId,
			name,
			nameKey: brandKey(name),
			rxcui: rxcuiOf.get(brandKey(name)) ?? null,
			source: 'rxnorm'
		})),
		skipDuplicates: true
	});
}

export async function itemBrands(db: Db, formularyItemId: string): Promise<ItemBrands> {
	const rows = (await rowsOf(db, formularyItemId)).sort((a, b) =>
		naturalCompare(a.name, b.name)
	);
	const tag = ({ name, nameKey, source }: BrandRow): BrandTag => ({ name, nameKey, source });
	return {
		active: rows.filter((row) => !row.suppressed).map(tag),
		dismissed: rows.filter((row) => row.suppressed).map(tag)
	};
}

/** Add a manual tag, or restore a dismissed one with the same name. */
export async function addBrandTag(db: Db, formularyItemId: string, name: string) {
	const change = addBrand(await rowsOf(db, formularyItemId), name);
	const nameKey = brandKey(name);
	if (change.action === 'insert')
		await db.formularyItemBrand.create({
			data: { formularyItemId, name, nameKey, source: 'manual' }
		});
	else if (change.action === 'unsuppress')
		await db.formularyItemBrand.update({
			where: { formularyItemId_nameKey: { formularyItemId, nameKey } },
			data: { suppressed: false }
		});
}

/** Delete a manual tag; dismiss an RxNorm one so reloads keep it gone. */
export async function removeBrandTag(db: Db, formularyItemId: string, nameKey: string) {
	const change = removeBrand(await rowsOf(db, formularyItemId), nameKey);
	const where = { formularyItemId_nameKey: { formularyItemId, nameKey } };
	if (change.action === 'delete') await db.formularyItemBrand.delete({ where });
	else if (change.action === 'suppress')
		await db.formularyItemBrand.update({ where, data: { suppressed: true } });
}

/** Bring a dismissed RxNorm tag back. */
export const restoreBrandTag = (db: Db, formularyItemId: string, nameKey: string) =>
	db.formularyItemBrand.updateMany({
		where: { formularyItemId, nameKey, suppressed: true },
		data: { suppressed: false }
	});
