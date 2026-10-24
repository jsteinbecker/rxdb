import { prisma } from '$lib/server/infrastructure/database';
import { defaultScope } from '$lib/server/formulary/membership';
import { parseSettings } from '$lib/formulary/settings';
import type { LayoutServerLoad } from './$types';

/** Display preferences every page reads: pill drawings, and how strengths are shown. */
export const load: LayoutServerLoad = async ({ depends }) => {
	depends('app:settings');
	const scope = await defaultScope(prisma);
	const settings = parseSettings(scope.settings);
	return {
		uniformImprintSize: settings.uniformImprintSize,
		strengthStyles: settings.strengthStyles
	};
};
