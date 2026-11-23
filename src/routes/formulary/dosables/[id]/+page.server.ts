import { error } from '@sveltejs/kit';
import { prisma } from '#lib/server/infrastructure/database.ts';
import { defaultScope } from '#lib/server/formulary/membership.ts';
import { loadDosable } from '#lib/server/formulary/dosable-components.ts';
import type { PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params }) => {
	const scope = await defaultScope(prisma);
	const dosable = UUID.test(params.id) ? await loadDosable(prisma, scope.id, params.id) : null;
	if (!dosable) error(404, 'That drug and route is not on this formulary.');
	return { scope: { id: scope.id, name: scope.name }, dosable };
};
