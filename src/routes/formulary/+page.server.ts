import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import { formularyRows } from '$lib/server/formulary-view';
import { syncExternalPackages } from '$lib/server/catalog-sync';
import { toNdc11 } from '$lib/ndc';
import { fail } from '@sveltejs/kit';
import { parseComboDoseDisplay, parseSettings } from '$lib/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	return {
		scope: { id: scope.id, name: scope.name },
		settings: parseSettings(scope.settings),
		rows: await formularyRows(prisma, scope.id)
	};
};

export const actions: Actions = {
	/** Save how one combination's dose reads; mode "each" clears the override. */
	comboDose: async ({ request }) => {
		const form = await request.formData();
		const combo = String(form.get('combo') ?? '').trim();
		if (!combo) return fail(400, { message: 'Missing combination.' });
		const display = parseComboDoseDisplay({
			mode: form.get('mode'),
			ingredient: form.get('ingredient')
		});
		const scope = await defaultScope(prisma);
		const settings = parseSettings(scope.settings);
		const { [combo]: _, ...rest } = settings.comboDoseDisplay;
		settings.comboDoseDisplay = display ? { ...rest, [combo]: display } : rest;
		await prisma.scope.update({ where: { id: scope.id }, data: { settings } });
		return { saved: true };
	},
	/** Refetch every provider for the given NDCs, bypassing fresh cache, to fill gaps. */
	resolve: async ({ request }) => {
		const form = await request.formData();
		const ndcs = [
			...new Set(
				String(form.get('ndcs') ?? '')
					.split(',')
					.map(toNdc11)
					.filter((ndc): ndc is string => ndc !== null)
			)
		];
		if (!ndcs.length) return fail(400, { message: 'No NDCs to resolve.' });
		const batch = 240;
		let resolved = 0;
		for (let start = 0; start < ndcs.length; start += batch)
			resolved += (await syncExternalPackages(ndcs.slice(start, start + batch), { force: true }))
				.length;
		return { resolved, requested: ndcs.length };
	}
};
