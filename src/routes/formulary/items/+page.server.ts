import { fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { defaultScope, loadedItems, removeFromFormulary } from '$lib/server/catalog-formulary';
import { loadStagedNode } from '$lib/server/catalog-sync';
import { parseSettings } from '$lib/settings';
import { jobFailure, jobItem, trackJob } from '$lib/server/jobs';
import type { LoadedItem } from '$lib/server/catalog-formulary';
import type { Actions, PageServerLoad } from './$types';

function reloadItems(scopeId: string, items: LoadedItem[]) {
	return trackJob(
		`Refreshing ${items.length} item${items.length === 1 ? '' : 's'}`,
		() => reloadEach(scopeId, items),
		{ total: items.length }
	);
}

async function reloadEach(scopeId: string, items: LoadedItem[]) {
	let reloaded = 0;
	const failures: string[] = [];
	for (const [index, item] of items.entries()) {
		jobItem(item.displayName, index);
		try {
			await loadStagedNode(item.target, scopeId, { force: true });
			reloaded++;
		} catch (error) {
			failures.push(`${item.displayName}: ${error instanceof Error ? error.message : 'Could not reload.'}`);
			jobFailure(failures.at(-1)!);
		}
	}
	return { reloaded, total: items.length, failures };
}

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	return {
		scope: { id: scope.id, name: scope.name },
		settings: parseSettings(scope.settings),
		items: await loadedItems(prisma, scope.id)
	};
};

export const actions: Actions = {
	reloadAll: async () => {
		const scope = await defaultScope(prisma);
		return { reloadAll: await reloadItems(scope.id, await loadedItems(prisma, scope.id)) };
	},
	reloadSelected: async ({ request }) => {
		const ids = new Set(
			(await request.formData()).getAll('formularyItemId').filter((id): id is string => typeof id === 'string' && !!id)
		);
		if (!ids.size) return fail(400, { message: 'Choose items to refresh.' });
		const scope = await defaultScope(prisma);
		const items = (await loadedItems(prisma, scope.id)).filter((item) => ids.has(item.formularyItemId));
		if (!items.length) return fail(404, { message: 'Those items are no longer on this formulary.' });
		return { reloadAll: await reloadItems(scope.id, items) };
	},
	remove: async ({ request }) => {
		const id = (await request.formData()).get('formularyItemId');
		if (typeof id !== 'string' || !id) return fail(400, { message: 'Choose an item to remove.' });
		const scope = await defaultScope(prisma);
		try {
			return { removed: await removeFromFormulary(prisma, scope.id, id) };
		} catch (error) {
			return fail(422, {
				message: error instanceof Error ? error.message : 'The item could not be removed.'
			});
		}
	},
	update: async ({ request }) => {
		const formData = await request.formData();
		const itemId = formData.get('formularyItemId');
		const kind = formData.get('kind');
		const value = formData.get('target');
		if (
			typeof itemId !== 'string' ||
			!itemId ||
			(kind !== 'concept' && kind !== 'package') ||
			typeof value !== 'string' ||
			!value
		)
			return fail(400, { message: 'Choose a loaded item to update.' });
		const scope = await defaultScope(prisma);
		const item = (await loadedItems(prisma, scope.id)).find((candidate) => candidate.formularyItemId === itemId);
		if (
			!item ||
			item.target.kind !== kind ||
			(kind === 'concept'
				? item.target.kind !== 'concept' || item.target.rxcui !== value
				: item.target.kind !== 'package' || item.target.ndc !== value)
		)
			return fail(404, { message: 'That item is no longer on this formulary.' });
		try {
			const result = await loadStagedNode(item.target, scope.id, { force: true });
			return { updated: { displayName: result.displayName, packagesLinked: result.packagesLinked } };
		} catch (error) {
			return fail(422, {
				message: error instanceof Error ? error.message : 'The item could not be updated.'
			});
		}
	}
};
