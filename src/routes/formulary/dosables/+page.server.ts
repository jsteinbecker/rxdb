import { prisma } from '#lib/server/infrastructure/database.ts';
import { defaultScope } from '#lib/server/formulary/membership.ts';
import { listDosables } from '#lib/server/formulary/dosable-components.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	return {
		scope: { id: scope.id, name: scope.name },
		dosables: await listDosables(prisma, scope.id)
	};
};
