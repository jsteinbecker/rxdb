import { fail } from '@sveltejs/kit';
import { editTargetError } from '$lib/local-concept-input';
import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import { syncExternalPackages } from '$lib/server/catalog-sync';
import { supersedeTarget } from '$lib/server/local-concept-target';
import { editNdc } from '$lib/local-concept-list';
import { parseSettings } from '$lib/settings';
import {
	listLocalConcepts,
	LocalConceptInputError,
	retireLocalConcept,
	stopSuperseding,
	supersede
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
	/** Re-creates the supersede mapping of a stopped concept; the rxcui is the stored one. */
	localConceptResupersede: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { action: 'localConceptResupersede', message: 'No local concept chosen.' });
		try {
			const scopeId = (await defaultScope(prisma)).id;
			const concepts = await listLocalConcepts(prisma, scopeId);
			const refused = editTargetError(id, concepts);
			if (refused) return fail(refused.status, { action: 'localConceptResupersede', message: refused.message });
			const mapping = concepts.find((c) => c.id === id)?.supersedes;
			if (!mapping?.rxcui) throw new LocalConceptInputError('This concept never superseded an RxNorm concept.');
			if (mapping.active) throw new LocalConceptInputError('This concept is already superseding.');
			await supersede(prisma, scopeId, id, mapping.rxcui, null);
		} catch (cause) {
			if (cause instanceof LocalConceptInputError)
				return fail(400, { action: 'localConceptResupersede', message: cause.message });
			throw cause;
		}
		return { localConceptSaved: true };
	},
	/**
	 * Supersedes for a never-mapped concept: the target is recomputed from its evidence
	 * NDC exactly as the NDC page's editor does (never a client-supplied rxcui).
	 */
	localConceptSupersede: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { action: 'localConceptSupersede', message: 'No local concept chosen.' });
		try {
			const scopeId = (await defaultScope(prisma)).id;
			const concepts = await listLocalConcepts(prisma, scopeId);
			const refused = editTargetError(id, concepts);
			if (refused) return fail(refused.status, { action: 'localConceptSupersede', message: refused.message });
			const concept = concepts.find((c) => c.id === id)!;
			if (concept.supersedes)
				throw new LocalConceptInputError(
					concept.supersedes.active
						? 'This concept is already superseding.'
						: 'This concept superseded an RxNorm concept before; use Supersede again.'
				);
			const ndc = editNdc(concept.evidence.ndc);
			if (!ndc)
				throw new LocalConceptInputError('No evidence NDC was recorded for this concept, so its RxNorm SCD is unknown.');
			const [item] = await syncExternalPackages([ndc]);
			if (!item) throw new LocalConceptInputError(`No package data available for NDC ${ndc}.`);
			const target = await supersedeTarget(prisma, scopeId, item);
			if (target.blocked || !target.scd)
				throw new LocalConceptInputError(target.blocked ?? 'There is no SCD to supersede.');
			await supersede(prisma, scopeId, id, target.scd.rxcui, null);
		} catch (cause) {
			if (cause instanceof LocalConceptInputError)
				return fail(400, { action: 'localConceptSupersede', message: cause.message });
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
