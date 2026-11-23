import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/infrastructure/database.ts';
import { defaultScope } from '#lib/server/formulary/membership.ts';
import {
	CompoundError,
	createCompound,
	listCompounds,
	setRoute
} from '#lib/server/compounds/store.ts';
import { INJECTION_ROUTES } from '#lib/labels/reconstitution-terms.ts';
import { parseSettings } from '#lib/formulary/settings.ts';
import { uniqueName } from '#lib/compounds/compound-naming.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	return {
		scope: { id: scope.id, name: scope.name },
		compounds: await listCompounds(prisma, scope.id),
		// The route most compounds here use, so a run of IV compounds needs no change.
		defaultRoute:
			(
				await prisma.compoundFormula.groupBy({
					by: ['route'],
					where: { scopeId: scope.id, route: { not: null } },
					_count: { route: true },
					orderBy: { _count: { route: 'desc' } },
					take: 1
				})
			)[0]?.route ?? null
	};
};

export const actions: Actions = {
	create: async ({ request }) => {
		const route = (await request.formData()).get('route');
		if (!INJECTION_ROUTES.includes(route as (typeof INJECTION_ROUTES)[number]))
			return fail(400, { message: `Choose a route first: ${INJECTION_ROUTES.join(', ')}.` });
		const scope = await defaultScope(prisma);
		// The name builds itself as components are added; until then it is the untitled placeholder.
		const { untitled } = parseSettings(scope.settings).compoundNaming;
		const taken = await prisma.compoundFormula.findMany({
			where: { scopeId: scope.id, name: { startsWith: untitled } },
			select: { name: true }
		});
		let id: string;
		try {
			id = await createCompound(
				prisma,
				scope.id,
				uniqueName(untitled, new Set(taken.map((row) => row.name)))
			);
			await setRoute(prisma, scope.id, id, route);
		} catch (error) {
			if (error instanceof CompoundError) return fail(error.status, { message: error.message });
			throw error;
		}
		redirect(303, `/compounds/${id}`);
	}
};
