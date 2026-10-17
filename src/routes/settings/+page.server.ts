import { fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { clearFormulary, defaultScope, loadedItems } from '$lib/server/catalog-formulary';
import { parseSettings, type FormularySettings } from '$lib/settings';
import { formularyRows } from '$lib/server/formulary-view';
import { DIMENSIONS, dimensionValues } from '$lib/formulary-hierarchy';
import { parseEquivalenceGroups } from '$lib/equivalence';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	const rows = await formularyRows(prisma, scope.id);
	return {
		scope: { id: scope.id, name: scope.name },
		settings: parseSettings(scope.settings),
		itemCount: (await loadedItems(prisma, scope.id)).length,
		/** Each dimension's current values, for building equivalence groups. */
		dimensionValues: Object.fromEntries(
			DIMENSIONS.map((dimension) => [dimension.key, dimensionValues(rows, dimension.key)])
		)
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
			equivalenceGroups: current.equivalenceGroups,
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

	/** Add or replace an equivalence group; `index` names the one replaced. */
	saveGroup: async ({ request }) => {
		const form = await request.formData();
		let parsed: unknown;
		try {
			parsed = JSON.parse(String(form.get('group') ?? ''));
		} catch {
			return fail(400, { section: 'groups', message: 'The group could not be read.' });
		}
		const [group] = parseEquivalenceGroups([parsed]);
		if (!group)
			return fail(400, { section: 'groups', message: 'A group needs a display name.' });
		if (!group.members.length)
			return fail(400, { section: 'groups', message: 'Add at least one value to merge.' });
		const rawIndex = form.get('index');
		// A new group sends no index; Number(null) would be 0 and overwrite the first group.
		const index = rawIndex === null || rawIndex === '' ? NaN : Number(rawIndex);
		return updateSettings((settings) => {
			const groups = [...settings.equivalenceGroups];
			if (Number.isInteger(index) && index >= 0 && index < groups.length) groups[index] = group;
			else groups.push(group);
			return { ...settings, equivalenceGroups: groups };
		}, { section: 'groups', savedGroup: group.display });
	},

	deleteGroup: async ({ request }) => {
		const index = Number((await request.formData()).get('index'));
		return updateSettings(
			(settings) => ({
				...settings,
				equivalenceGroups: settings.equivalenceGroups.filter((_, at) => at !== index)
			}),
			{ section: 'groups' }
		);
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

async function updateSettings<T>(
	change: (settings: FormularySettings) => FormularySettings,
	result: T
) {
	const scope = await defaultScope(prisma);
	const settings = parseSettings(change(parseSettings(scope.settings)));
	await prisma.scope.update({ where: { id: scope.id }, data: { settings } });
	return result;
}

const updateViews = (
	change: (settings: FormularySettings) => FormularySettings,
	savedView?: string
) => updateSettings(change, { section: 'views' as const, savedView });
