import { error, fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { defaultScope, loadedItems } from '$lib/server/catalog-formulary';
import { formularyRows } from '$lib/server/formulary-view';
import { addBrandTag, itemBrands, removeBrandTag, restoreBrandTag } from '$lib/server/brand-tag-store';
import { itemPackages, relatedItems } from '$lib/formulary-item';
import { parseBrandName } from '$lib/brand-tags';
import { parseReleaseAbbreviation } from '$lib/time-release';
import { parseNameOverride } from '$lib/item-name';
import { summarizeItem } from '$lib/item-summary';
import { loadPackageSnapshots } from '$lib/server/catalog-store';
import { loadStagedNode } from '$lib/server/catalog-sync';
import { withPharmClassRules } from '$lib/server/pharm-class-view';
import { hasAppearance, isSolidDoseForm, type PillAppearance } from '$lib/spl-characteristics';
import { refineAppearances } from '$lib/spl-appearance-text';
import type { PillImageLayout, PillPhotoRef } from '$lib/pill-image-layout';
import { storedPillPhotos } from '$lib/server/pill-photo';
import { localPillPhotos } from '$lib/server/local-pill-photos';
import { dev } from '$app/environment';
import {
	labelPhoto,
	loadPillImageLayouts,
	pillImageTarget,
	queuePillImages,
	unmeasured,
	type PillImageTarget
} from '$lib/server/pill-image-store';
import type { Actions, PageServerLoad } from './$types';

async function itemInScope(id: string) {
	const scope = await defaultScope(prisma);
	const item = (await loadedItems(prisma, scope.id)).find(
		(candidate) => candidate.formularyItemId === id
	);
	return { scope, item };
}

export const load: PageServerLoad = async ({ params }) => {
	const { scope, item } = await itemInScope(params.id);
	if (!item) error(404, 'That item is not on this formulary.');
	const rows = await formularyRows(prisma, scope.id);
	const packages = itemPackages(rows, item.formularyItemId);
	const snapshots = await loadPackageSnapshots(prisma, packages.map((row) => row.ndc));
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
		const refined = refineAppearances(snapshot?.details?.spl?.appearances ?? [], snapshot?.details?.label?.sections, {
			ndc: row.ndc,
			strengths: snapshot?.ingredients.map((ingredient) => ingredient.strength) ?? [],
			doseForm
		});
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
	const resolved = await withPharmClassRules(
		prisma,
		scope.id,
		snapshotNdcs.map((ndc) => snapshots.get(ndc)!.item)
	);
	const summaryItems = new Map(snapshotNdcs.map((ndc, index) => [ndc, resolved[index]]));
	return {
		appearances,
		layouts,
		scope: { id: scope.id, name: scope.name },
		item,
		brands: await itemBrands(prisma, item.formularyItemId),
		packages,
		summary: summarizeItem(
			packages,
			summaryItems,
			item.displayName
		),
		related: relatedItems(rows, item.formularyItemId)
	};
};

export const actions: Actions = {
	refresh: async ({ params }) => {
		const { scope, item } = await itemInScope(params.id);
		if (!item) error(404, 'That item is not on this formulary.');
		try {
			const result = await loadStagedNode(item.target, scope.id, { force: true });
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
		await prisma.formularyItem.update({
			where: { id: params.id },
			data: {
				// Saving the sourced name unchanged keeps the item following its source.
				nameOverride: parsed.name === item.sourceName ? null : parsed.name,
				strengthAsPercent: form.get('percent') === 'on'
			}
		});
	},
	setReleaseAbbreviation: async ({ params, request }) => {
		const parsed = parseReleaseAbbreviation((await request.formData()).get('abbreviation'));
		if ('error' in parsed) return fail(400, { releaseMessage: parsed.error });
		const { item } = await itemInScope(params.id);
		if (!item) error(404, 'That item is not on this formulary.');
		if (!item.releasePeriod) return fail(400, { releaseMessage: 'This item has no release period.' });
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
		if (typeof key !== 'string' || !key) return fail(400, { brandMessage: 'Choose a brand to remove.' });
		if (!(await itemInScope(params.id)).item) error(404, 'That item is not on this formulary.');
		await removeBrandTag(prisma, params.id, key);
	},
	restoreBrand: async ({ params, request }) => {
		const key = (await request.formData()).get('key');
		if (typeof key !== 'string' || !key) return fail(400, { brandMessage: 'Choose a brand to restore.' });
		if (!(await itemInScope(params.id)).item) error(404, 'That item is not on this formulary.');
		await restoreBrandTag(prisma, params.id, key);
	}
};
