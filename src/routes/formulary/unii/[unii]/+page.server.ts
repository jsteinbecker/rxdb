import { error } from '@sveltejs/kit';
import { findDefaultScope } from '$lib/server/catalog-formulary';
import { formularyRows } from '$lib/server/formulary-view';
import { prisma } from '$lib/server/prisma';
import { normalizeUnii, uniiUsage } from '$lib/server/unii-usage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const unii = normalizeUnii(params.unii);
	if (!unii) error(400, 'A UNII is 10 letters or digits.');
	const [usages, scope] = await Promise.all([uniiUsage(prisma, unii), findDefaultScope(prisma)]);
	const onFormulary = new Set(
		scope ? (await formularyRows(prisma, scope.id)).map((row) => row.ndc) : []
	);
	const onFormularyUsages = usages.filter((usage) => onFormulary.has(usage.ndc));
	const names = new Map<string, number>();
	for (const usage of onFormularyUsages)
		for (const role of usage.roles)
			if ('name' in role) names.set(role.name, (names.get(role.name) ?? 0) + 1);
	return {
		unii,
		names: [...names].sort((a, b) => b[1] - a[1]).map(([name]) => name),
		usages: onFormularyUsages
	};
};
