/**
 * Build step for product forms ($lib/catalog/product-forms.ts): group the live
 * formulary's packages, then write product_form and its children.
 *
 * Everything here is derived and rebuilt in full, except:
 * - `product_form_route` rows with source `manual`, and every override, which a
 *   rebuild never touches;
 * - forms and derived routes that drop out, which are retired, never deleted, so
 *   compounds that point at them see "no current source" rather than break.
 *
 * @module
 */
import type { Prisma, PrismaClient } from '../../../generated/client';
import { buildProductForms, type ProductFormInput } from '../../catalog/product-forms';
import { namedEntity } from './entity-store';
import { loadPackageSnapshots } from './snapshot-store';

type Db = Prisma.TransactionClient;

export interface ProductFormRefresh {
	forms: number;
	created: number;
	retired: number;
	routes: number;
	preps: number;
	skipped: { ndc: string; reason: string }[];
	/** Drug + route rows rebuilt from the refreshed forms (`refresh_dosable_components()`). */
	dosableComponents: DosableComponentRefresh;
}

export interface DosableComponentRefresh {
	created: number;
	retired: number;
	linked: number;
	unlinked: number;
}

/** Rebuilds the derived dosable components and their formulary item links; manual rows stay. */
export async function refreshDosableComponents(db: Db | PrismaClient): Promise<DosableComponentRefresh> {
	const [row] = await db.$queryRaw<{ result: DosableComponentRefresh }[]>`SELECT refresh_dosable_components() AS result`;
	return row.result;
}

/** The live formulary's packages, each with its NDC and linked SCD. */
async function livePackages(db: PrismaClient) {
	return db.$queryRaw<{ packageId: string; ndc: string; scdId: string | null; scdName: string | null }[]>`
		SELECT DISTINCT ON (p.package_id) p.package_id AS "packageId", ei.normalized_value AS ndc,
		       cd.id AS "scdId", cd.name AS "scdName"
		FROM (SELECT DISTINCT package_id FROM formulary_item_package WHERE valid_to IS NULL) p
		JOIN external_identifier ei ON ei.entity_id = p.package_id AND ei.namespace = 'ndc11' AND ei.valid_to IS NULL
		LEFT JOIN entity_relationship er ON er.from_entity_id = p.package_id AND er.valid_to IS NULL
		     AND er.relationship_type IN ('package_clinical_drug', 'package_pseudo_clinical_drug')
		LEFT JOIN clinical_drug cd ON cd.id = er.to_entity_id
		ORDER BY p.package_id, (er.relationship_type = 'package_clinical_drug') DESC`;
}

export async function loadProductFormInputs(db: PrismaClient): Promise<ProductFormInput[]> {
	const rows = await livePackages(db);
	const snapshots = await loadPackageSnapshots(db, rows.map((row) => row.ndc), { withoutLabel: true });
	return rows.map((row) => {
		const item = snapshots.get(row.ndc)?.item;
		return {
			packageId: row.packageId,
			ndc: row.ndc,
			doseForm: item?.doseForm ?? null,
			scd: row.scdId && row.scdName ? { id: row.scdId, name: row.scdName } : null,
			actives: (item?.details?.spl?.ingredients ?? [])
				.filter((ingredient) => ingredient.kind === 'active')
				.map((ingredient) => ({ name: ingredient.name, moieties: ingredient.moieties ?? [] })),
			listed: (item?.ingredients ?? []).map((ingredient) => ingredient.name),
			routes: item?.details?.product?.routes ?? [],
			isDryFill: item ? item.isDryFill : null,
			reconstitution: item?.reconstitution ?? []
		};
	});
}

export async function refreshProductForms(db: PrismaClient): Promise<ProductFormRefresh> {
	const { forms, skipped } = buildProductForms(await loadProductFormInputs(db));
	return db.$transaction(
		async (tx) => {
			const result: ProductFormRefresh = {
				forms: forms.length,
				created: 0,
				retired: 0,
				routes: 0,
				preps: 0,
				skipped,
				dosableComponents: { created: 0, retired: 0, linked: 0, unlinked: 0 }
			};
			const ids = new Map<string, string>();
			const ingredientId = async (name: string) =>
				ids.get(name) ?? ids.set(name, await namedEntity(tx, 'ingredient', name)).get(name)!;
			// Packages move between forms freely: membership is rebuilt whole.
			await tx.productFormPackage.deleteMany({});
			const live = new Set<string>();
			for (const form of forms) {
				const ingredientIds = await Promise.all(form.ingredients.map(ingredientId));
				const ingredientKey = [...ingredientIds].sort().join(',');
				let row = await tx.productForm.findUnique({
					where: { ingredientKey_doseForm: { ingredientKey, doseForm: form.doseForm } }
				});
				if (!row) {
					const entity = await tx.entity.create({ data: { type: 'product_form' } });
					row = await tx.productForm.create({ data: { id: entity.id, ingredientKey, doseForm: form.doseForm } });
					result.created++;
				} else {
					await tx.productForm.update({ where: { id: row.id }, data: { refreshedAt: new Date() } });
					await tx.entity.update({ where: { id: row.id }, data: { status: 'active', retiredAt: null } });
				}
				live.add(row.id);
				await writeChildren(tx, row.id, form, ingredientIds, ingredientId, result);
			}
			// Forms no live package belongs to any more, and their derived routes, retire.
			const gone = await tx.productForm.findMany({
				where: { id: { notIn: [...live] }, entity: { retiredAt: null } },
				select: { id: true }
			});
			for (const { id } of gone) {
				await tx.entity.update({ where: { id }, data: { status: 'retired', retiredAt: new Date() } });
				await tx.productFormRoute.updateMany({
					where: { productFormId: id, source: 'derived', retiredAt: null },
					data: { status: 'retired', retiredAt: new Date() }
				});
				result.retired++;
			}
			// Drug + route rows follow the forms and routes just written.
			result.dosableComponents = await refreshDosableComponents(tx);
			return result;
		},
		{ timeout: 120_000 }
	);
}

async function writeChildren(
	tx: Db,
	productFormId: string,
	form: ReturnType<typeof buildProductForms>['forms'][number],
	ingredientIds: string[],
	ingredientId: (name: string) => Promise<string>,
	result: ProductFormRefresh
) {
	await tx.productFormIngredient.deleteMany({ where: { productFormId } });
	await tx.productFormIngredient.createMany({
		data: ingredientIds.map((id, index) => ({ productFormId, ingredientId: id, ordinal: index + 1 }))
	});
	await tx.productFormPackage.createMany({
		data: form.packageIds.map((packageId) => ({ productFormId, packageId }))
	});
	await tx.productFormStrength.deleteMany({ where: { productFormId } });
	for (const strength of form.strengths)
		await tx.productFormStrength.create({
			data: {
				productFormId,
				clinicalDrugId: strength.scdId,
				ingredientId: await ingredientId(strength.ingredient),
				basisIngredientId: strength.basisIngredient ? await ingredientId(strength.basisIngredient) : null,
				basis: strength.basisIngredient ? 'salt' : 'active_moiety',
				strengthNumMag: strength.value,
				strengthNumUom: strength.unit,
				strengthDenMag: strength.per,
				strengthDenUom: strength.perUnit
			}
		});

	const routes = new Set(form.routes.map((r) => r.route));
	await tx.productFormRoute.updateMany({
		where: { productFormId, source: 'derived', route: { notIn: [...routes] }, retiredAt: null },
		data: { status: 'retired', retiredAt: new Date() }
	});
	for (const { route, preps } of form.routes) {
		const existing = await tx.productFormRoute.findUnique({
			where: { productFormId_route: { productFormId, route } }
		});
		// A manual route stays as entered; its preps are still refreshed from the labels.
		const row = existing
			? existing.source === 'derived'
				? await tx.productFormRoute.update({
						where: { id: existing.id },
						data: { status: 'active', retiredAt: null }
					})
				: existing
			: await tx.productFormRoute.create({ data: { productFormId, route } });
		result.routes++;
		await tx.productFormRoutePrep.deleteMany({ where: { productFormRouteId: row.id, packageId: null } });
		await tx.productFormRoutePrep.createMany({
			data: preps.map(({ step, agreeing, stating }) => ({
				productFormRouteId: row.id,
				vialMassMg: step.vialMassMg,
				diluents: step.diluents,
				diluentMl: step.diluentMl,
				finalVolumeMl: step.bottleMl ?? null,
				concentrationMgPerMl: step.concentrationMgPerMl,
				agreeing,
				stating
			}))
		});
		result.preps += preps.length;
	}
}
