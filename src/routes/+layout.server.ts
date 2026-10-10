import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import { parseSettings } from '$lib/settings';
import type { LayoutServerLoad } from './$types';

/** Display preferences every page's pill drawings read. */
export const load: LayoutServerLoad = async ({ depends }) => {
	depends('app:settings');
	const scope = await defaultScope(prisma);
	return { uniformImprintSize: parseSettings(scope.settings).uniformImprintSize };
};
