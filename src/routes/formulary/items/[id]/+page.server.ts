import { error, fail } from '@sveltejs/kit';
import { prisma } from '#lib/server/infrastructure/database.ts';
import { trackJob } from '#lib/server/infrastructure/jobs.ts';
import { defaultScope, loadedItems, localNamesOf } from '#lib/server/formulary/membership.ts';
import { formularyRows } from '#lib/server/formulary/read.ts';
import {
	addBrandTag,
	itemBrands,
	removeBrandTag,
	restoreBrandTag
} from '#lib/server/formulary/brand-tag-store.ts';
import { itemPackages, relatedItems } from '#lib/formulary/item.ts';
import { parseBrandName } from '#lib/medication/brand-tags.ts';
import { parseReleaseAbbreviation } from '#lib/medication/time-release.ts';
import { parseNameOverride } from '#lib/formulary/item-name.ts';
import { nameIngredients, ingredientOrderKey, parseIngredientOrder } from '#lib/medication/ingredient-order.ts';
import { parseItemStrengthStyle } from '#lib/medication/strength-style.ts';
import { parseSettings } from '#lib/formulary/settings.ts';
import { projectRows } from '#lib/formulary/hierarchy.ts';
import { summarizeItem } from '#lib/formulary/item-summary.ts';
import { loadPackageSnapshots } from '../../../../lib/server/catalog/snapshot-store';
import { loadStagedNode } from '#lib/server/catalog/sync.ts';
import { cmsBilling } from '#lib/server/providers/cms-billing.ts';
import { withPharmClassRules } from '#lib/server/curation/pharm-class-view.ts';
import { withLocalConcepts } from '#lib/server/curation/local-concept-view.ts';
import {
	hasAppearance,
	isSolidDoseForm,
	type PillAppearance
} from '#lib/labels/spl-characteristics.ts';
import { refineAppearances } from '#lib/labels/spl-appearance-text.ts';
import type { PillImageLayout, PillPhotoRef } from '#lib/imprints/pill-image-layout.ts';
import { storedPillPhotos } from '#lib/server/media/pill-photo.ts';
import { localPillPhotos } from '#lib/server/media/local-pill-photos.ts';
import { dev } from '$app/env';
import {
	labelPhoto,
	loadPillImageLayouts,
	pillImageTarget,
	queuePillImages,
	unmeasured,
	type PillImageTarget
} from '#lib/server/media/pill-image-store.ts';
import { vialPrepVariants } from '#lib/compounds/vial-prep-consensus.ts';
import type { Actions, PageServerLoad } from './$types';

async function itemInScope(id: string) {
	const scope = await defaultScope(prisma);
	const all = await loadedItems(prisma, scope.id);
	const item = all.find((candidate) => candidate.formularyItemId === id);
	return { scope, item, localNames: localNamesOf(all) };
}

export const load: PageServerLoad = async ({ params }) => {
	const { scope, item, localNames } = await itemInScope(params.id);
	if (!item) error(404, 'That item is not on this formulary.');
	const settings = parseSettings(scope.settings);
	// Projected once over the whole formulary, as the tree reads them, so every view agrees.
	const rows = projectRows(
		await formularyRows(prisma, scope.id, localNames),
		settings.equivalenceGroups
	);
	const packages = itemPackages(rows, item.formularyItemId);
	const snapshots = await loadPackageSnapshots(
		prisma,
		packages.map((row) => row.ndc)
	);
	// Pill mockups by NDC, only for solid forms: a vial's label never states an
	// appearance, and a stray one on a non-solid must not be drawn as a pill.
	// Photos are the label's own, or ones an NDC page view already looked up;
	// this page never goes looking itself, since it can list dozens of NDCs.
	const appearances: Record<
		string,
		{ doseForm: string | null; list: PillAppearance[]; photos: (PillPhotoRef | null)[] }
	> = {};
	const ndcs = packages.map((row) => row.ndc);
	const stored = await storedPillPhotos(prisma, ndcs);
	// Photos saved by hand in development win over everything else.
	const saved = dev ? await localPillPhotos(ndcs) : new Map<string, Map<number, PillPhotoRef>>();
	const targets: PillImageTarget[] = [];
	for (const row of packages) {
		const snapshot = snapshots.get(row.ndc)?.item;
		const doseForm = row.doseForm ?? snapshot?.doseForm ?? null;
		// Indexed before filtering: a stored photo is keyed by the appearance's
		// position in the package, which is its part.
		// The label's prose in How Supplied or DF&S wins over the coded observations.
		const refined = refineAppearances(
			snapshot?.details?.spl?.appearances ?? [],
			snapshot?.details?.label?.sections,
			{
				ndc: row.ndc,
				strengths: snapshot?.ingredients.map((ingredient) => ingredient.strength) ?? [],
				doseForm
			}
		);
		const all = refined.map((appearance, index) => ({
			appearance,
			photo:
				saved.get(row.ndc)?.get(index + 1) ??
				labelPhoto(snapshot?.splSetId, appearance) ??
				stored.get(row.ndc)?.get(index + 1) ??
				null
		}));
		const shown = all.filter(({ appearance }) => hasAppearance(appearance));
		if (!shown.length || !isSolidDoseForm(doseForm)) continue;
		appearances[row.ndc] = {
			doseForm,
			list: shown.map(({ appearance }) => appearance),
			photos: shown.map(({ photo }) => photo)
		};
		for (const { appearance, photo } of shown) {
			const target = pillImageTarget(photo, appearance, doseForm);
			if (target) targets.push(target);
		}
	}
	// Photos nobody has measured are measured after this response, for next time.
	const layouts: Record<string, PillImageLayout> = Object.fromEntries(
		await loadPillImageLayouts(prisma, targets)
	);
	queuePillImages(prisma, await unmeasured(prisma, targets));
	// Display-time pharm-class rules; the snapshots themselves stay as sourced.
	const snapshotNdcs = [...snapshots.keys()];
	const resolved = await withLocalConcepts(
		prisma,
		scope.id,
		await withPharmClassRules(
			prisma,
			scope.id,
			snapshotNdcs.map((ndc) => snapshots.get(ndc)!.item)
		)
	);
	const summaryItems = new Map(snapshotNdcs.map((ndc, index) => [ndc, resolved[index]]));
	const billing = await cmsBilling(
		prisma,
		packages.map((row) => ({
			ndc: row.ndc,
			doseForm: row.doseForm ?? snapshots.get(row.ndc)?.item.doseForm ?? null
		}))
	);
	// Every vial preparation the packages' labels state, and where they differ.
	const vialPrep = vialPrepVariants(
		packages.map((row) => {
			const snapshot = snapshots.get(row.ndc)?.item;
			return {
				packageId: row.packageId,
				ndc: row.ndc,
				title: row.ndc,
				isDryFill: snapshot ? snapshot.isDryFill : null,
				reconstitution: snapshot?.reconstitution ?? []
			};
		})
	);
	return {
		appearances,
		vialPrep,
		layouts,
		cmsBilling: Object.fromEntries(billing),
		scope: { id: scope.id, name: scope.name },
		// The formulary's rules, so the name editor previews what saving would show.
		strengthStyles: settings.strengthStyles,
		item,
		brands: await itemBrands(prisma, item.formularyItemId),
		packages,
		// The unstyled name: its strengths are parsed, and a display rule's "1:4,000" is not one.
		summary: summarizeItem(packages, summaryItems, item.nameOverride ?? item.sourceName),
		related: relatedItems(rows, item.formularyItemId)
	};
};

export const actions: Actions = {
	refresh: async ({ params }) => {
		const { scope, item } = await itemInScope(params.id);
		if (!item) error(404, 'That item is not on this formulary.');
		try {
			const result = await trackJob(`Refreshing ${item.displayName}`, () =>
				loadStagedNode(item.target, scope.id, { force: true })
			);
			return { refreshed: { packagesLinked: result.packagesLinked } };
		} catch (e) {
			return fail(422, {
				refreshMessage: e instanceof Error ? e.message : 'The item could not be refreshed.'
			});
		}
	},
	setName: async ({ params, request }) => {
		const form = await request.formData();
		const parsed = parseNameOverride(form.get('name'));
		if ('error' in parsed) return fail(400, { nameMessage: parsed.error });
		const { item } = await itemInScope(params.id);
		if (!item) error(404, 'That item is not on this formulary.');
		const nameOverride = parsed.name === item.sourceName ? null : parsed.name;
		const order = parseIngredientOrder(form.getAll('ingredientOrder'));
		const sourced = nameIngredients(nameOverride ?? item.sourceName).map(ingredientOrderKey);
		await prisma.formularyItem.update({
			where: { id: params.id },
			data: {
				// Saving the sourced name unchanged keeps the item following its source.
				nameOverride,
				strengthStyle: parseItemStrengthStyle(form.get('strengthStyle')),
				// The sourced order saved unchanged is stored as no order, so the item keeps following its source.
				ingredientOrder: order.join('\n') === sourced.join('\n') ? [] : order
			}
		});
	},
	setReleaseAbbreviation: async ({ params, request }) => {
		const parsed = parseReleaseAbbreviation((await request.formData()).get('abbreviation'));
		if ('error' in parsed) return fail(400, { releaseMessage: parsed.error });
		const { item } = await itemInScope(params.id);
		if (!item) error(404, 'That item is not on this formulary.');
		if (!item.releasePeriod)
			return fail(400, { releaseMessage: 'This item has no release period.' });
		await prisma.formularyItem.update({
			where: { id: params.id },
			data: { releaseAbbreviation: parsed.abbreviation }
		});
	},
	addBrand: async ({ params, request }) => {
		const parsed = parseBrandName((await request.formData()).get('name'));
		if ('error' in parsed) return fail(400, { brandMessage: parsed.error });
		if (!(await itemInScope(params.id)).item) error(404, 'That item is not on this formulary.');
		await addBrandTag(prisma, params.id, parsed.name);
	},
	removeBrand: async ({ params, request }) => {
		const key = (await request.formData()).get('key');
		if (typeof key !== 'string' || !key)
			return fail(400, { brandMessage: 'Choose a brand to remove.' });
		if (!(await itemInScope(params.id)).item) error(404, 'That item is not on this formulary.');
		await removeBrandTag(prisma, params.id, key);
	},
	restoreBrand: async ({ params, request }) => {
		const key = (await request.formData()).get('key');
		if (typeof key !== 'string' || !key)
			return fail(400, { brandMessage: 'Choose a brand to restore.' });
		if (!(await itemInScope(params.id)).item) error(404, 'That item is not on this formulary.');
		await restoreBrandTag(prisma, params.id, key);
	}
};
