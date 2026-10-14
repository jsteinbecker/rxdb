import { fail } from '@sveltejs/kit';
import { editTargetError } from '$lib/local-concept-input';
import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import { parseSettings } from '$lib/settings';
import {
	listLocalConcepts,
	LocalConceptInputError,
	retireLocalConcept,
	stopSuperseding
} from '$lib/server/local-concept-store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	return {
		scope: { id: scope.id, name: scope.name },
		settings: parseSettings(scope.settings),
		concepts: await listLocalConcepts(prisma, scope.id)
	};
};

export const actions: Actions = {
	/** Ends the supersede mapping; the id is checked against this scope's own mappings. */
	localConceptStop: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { action: 'localConceptStop', message: 'No local concept chosen.' });
		try {
			const scopeId = (await defaultScope(prisma)).id;
			const concepts = await listLocalConcepts(prisma, scopeId);
			const refused = editTargetError(id, concepts);
			if (refused) return fail(refused.status, { action: 'localConceptStop', message: refused.message });
			const mapping = concepts.find((c) => c.id === id)?.supersedes;
			if (!mapping?.active) throw new LocalConceptInputError('No active supersede mapping found');
			await stopSuperseding(prisma, scopeId, mapping.mappingId);
		} catch (cause) {
			if (cause instanceof LocalConceptInputError)
				return fail(400, { action: 'localConceptStop', message: cause.message });
			throw cause;
		}
		return { localConceptSaved: true };
	},
	localConceptRetire: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { action: 'localConceptRetire', message: 'No local concept chosen.' });
		try {
			const scopeId = (await defaultScope(prisma)).id;
			const refused = editTargetError(id, await listLocalConcepts(prisma, scopeId));
			if (refused) return fail(refused.status, { action: 'localConceptRetire', message: refused.message });
			await retireLocalConcept(prisma, id);
		} catch (cause) {
			if (cause instanceof LocalConceptInputError)
				return fail(400, { action: 'localConceptRetire', message: cause.message });
			throw cause;
		}
		return { localConceptSaved: true };
	}
};
