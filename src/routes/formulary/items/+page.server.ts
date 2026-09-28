import { fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { defaultScope, loadedItems, removeFromFormulary } from '$lib/server/catalog-formulary';
import { loadStagedNode } from '$lib/server/catalog-sync';
import { parseSettings } from '$lib/settings';
import type { Actions, PageServerLoad } from './$types';

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
		const items = await loadedItems(prisma, scope.id);
		let reloaded = 0;
		const failures: string[] = [];
		for (const item of items) {
			try {
				await loadStagedNode(item.target, scope.id, { force: true });
				reloaded++;
			} catch (error) {
				failures.push(`${item.displayName}: ${error instanceof Error ? error.message : 'Could not reload.'}`);
			}
		}
		return { reloadAll: { reloaded, total: items.length, failures } };
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
