import { fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { clearFormulary, defaultScope, loadedItems } from '$lib/server/catalog-formulary';
import { parseSettings } from '$lib/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	return {
		scope: { id: scope.id, name: scope.name },
		settings: parseSettings(scope.settings),
		itemCount: (await loadedItems(prisma, scope.id)).length
	};
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { section: 'save', message: 'The formulary needs a name.' });
		if (name.length > 120)
			return fail(400, { section: 'save', message: 'Keep the name under 120 characters.' });
		const scope = await defaultScope(prisma);
		const settings = parseSettings({
			// Chosen on the formulary page, not this form; carry it over.
			comboDoseDisplay: parseSettings(scope.settings).comboDoseDisplay,
			defaultLevels: String(form.get('defaultLevels') ?? '')
				.split(',')
				.filter(Boolean),
			expandDepth: form.get('expandDepth'),
			confirmRemove: form.get('confirmRemove') === 'on'
		});
		await prisma.scope.update({ where: { id: scope.id }, data: { name, settings } });
		return { section: 'save', saved: true };
	},

	clear: async ({ request }) => {
		const scope = await defaultScope(prisma);
		const typed = String((await request.formData()).get('confirmName') ?? '').trim();
		if (typed !== scope.name)
			return fail(400, {
				section: 'clear',
				message: `Type the formulary name exactly ("${scope.name}") to confirm.`
			});
		return { section: 'clear', cleared: await clearFormulary(prisma, scope.id) };
	}
};
