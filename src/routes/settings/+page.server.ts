import { fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { clearFormulary, defaultScope, loadedItems } from '$lib/server/catalog-formulary';
import { parseSettings, type FormularySettings } from '$lib/settings';
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
		const current = parseSettings(scope.settings);
		const settings = parseSettings({
			// Edited elsewhere (the formulary page, the views section); carry them over.
			comboDoseDisplay: current.comboDoseDisplay,
			views: current.views,
			defaultView: current.defaultView,
			defaultLevels: current.defaultLevels,
			expandDepth: form.get('expandDepth'),
			confirmRemove: form.get('confirmRemove') === 'on',
			uniformImprintSize: form.get('uniformImprintSize') === 'on'
		});
		await prisma.scope.update({ where: { id: scope.id }, data: { name, settings } });
		return { section: 'save', saved: true };
	},

	/** Save the builder's hierarchy as a named view, replacing one with the same name. */
	saveView: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('viewName') ?? '').trim();
		if (!name) return fail(400, { section: 'views', message: 'Give the view a name.' });
		if (name.length > 80)
			return fail(400, { section: 'views', message: 'Keep the view name under 80 characters.' });
		const levels = String(form.get('levels') ?? '')
			.split(',')
			.filter(Boolean);
		return updateViews((settings) => {
			const index = settings.views.findIndex((view) => view.name === name);
			const views = [...settings.views];
			if (index === -1) views.push({ name, levels });
			else views[index] = { name, levels };
			return { ...settings, views, defaultView: settings.defaultView ?? name };
		}, name);
	},

	deleteView: async ({ request }) => {
		const name = String((await request.formData()).get('viewName') ?? '');
		return updateViews((settings) => {
			const views = settings.views.filter((view) => view.name !== name);
			const defaultView =
				settings.defaultView === name ? (views[0]?.name ?? null) : settings.defaultView;
			return { ...settings, views, defaultView };
		});
	},

	defaultView: async ({ request }) => {
		const name = String((await request.formData()).get('viewName') ?? '');
		return updateViews((settings) => ({ ...settings, defaultView: name }));
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

async function updateViews(
	change: (settings: FormularySettings) => FormularySettings,
	savedView?: string
) {
	const scope = await defaultScope(prisma);
	const settings = parseSettings(change(parseSettings(scope.settings)));
	await prisma.scope.update({ where: { id: scope.id }, data: { settings } });
	return { section: 'views', savedView };
}
