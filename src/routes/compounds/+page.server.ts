import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import { CompoundError, createCompound, listCompounds } from '$lib/server/compound-store';
import { parseSettings } from '$lib/settings';
import { uniqueName } from '$lib/compound-naming';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	return { scope: { id: scope.id, name: scope.name }, compounds: await listCompounds(prisma, scope.id) };
};

export const actions: Actions = {
	create: async () => {
		const scope = await defaultScope(prisma);
		// The name builds itself as components are added; until then it is the untitled placeholder.
		const { untitled } = parseSettings(scope.settings).compoundNaming;
		const taken = await prisma.compoundFormula.findMany({
			where: { scopeId: scope.id, name: { startsWith: untitled } },
			select: { name: true }
		});
		let id: string;
		try {
			id = await createCompound(prisma, scope.id, uniqueName(untitled, new Set(taken.map((row) => row.name))));
		} catch (error) {
			if (error instanceof CompoundError) return fail(error.status, { message: error.message });
			throw error;
		}
		redirect(303, `/compounds/${id}`);
	}
};
