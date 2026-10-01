import { fail, redirect } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import { CompoundError, createCompound, listCompounds } from '$lib/server/compound-store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	return { scope: { id: scope.id, name: scope.name }, compounds: await listCompounds(prisma, scope.id) };
};

export const actions: Actions = {
	create: async ({ request }) => {
		const name = (await request.formData()).get('name');
		const scope = await defaultScope(prisma);
		let id: string;
		try {
			id = await createCompound(prisma, scope.id, typeof name === 'string' ? name : '');
		} catch (error) {
			if (error instanceof CompoundError) return fail(error.status, { message: error.message });
			throw error;
		}
		redirect(303, `/compounds/${id}`);
	}
};
