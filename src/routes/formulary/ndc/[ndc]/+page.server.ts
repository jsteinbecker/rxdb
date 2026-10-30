import { loadPackageDetail } from '$lib/server/catalog/package-detail';
import { expectedPackageRevision, PackageConflict } from '$lib/server/catalog/package-state-store';
import { fail, isHttpError } from '@sveltejs/kit';
import { toNdc11 } from '$lib/catalog/ndc';
import { prisma } from '$lib/server/infrastructure/database';

import { syncExternalPackages } from '$lib/server/catalog/sync';
import { defaultScope, unlinkPackage } from '$lib/server/formulary/membership';

import { supersedeTarget } from '$lib/server/curation/local-concept-target';
import {
	createLocalConcept,
	listLocalConcepts,
	LocalConceptInputError,
	stopSuperseding,
	supersede,
	updateLocalConcept
} from '$lib/server/curation/local-concept-store';
import { localConceptDraft } from '$lib/curation/local-concept-draft';
import { editTargetError, parseLocalConceptInput } from '$lib/curation/local-concept-input';

import { packageClassKey } from '$lib/formulary/pharm-class-key';
import { scopeOptions } from '$lib/formulary/pharm-class-scope-options';

import {
	deleteRule,
	RuleInputError,
	upsertRule
} from '$lib/server/curation/pharm-class-rule-store';
import { applyReinterpret, previewReinterpret } from '$lib/server/curation/reinterpret';
import {
	removePropertyOverrides,
	savePropertyOverride
} from '$lib/server/curation/property-override';
import { clearDosingMeasure, saveDosingMeasure } from '$lib/server/curation/dosing-measure-store';
import { isAmbiguityKind } from '$lib/catalog/labeler-ambiguity';
import { readCitationInput } from '$lib/server/curation/override-citation';
import type { ReviewRequest } from '$lib/curation/reinterpret';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => loadPackageDetail(params.ndc);

function parseReview(raw: FormDataEntryValue | null): ReviewRequest | null {
	try {
		const value = JSON.parse(String(raw ?? '')) as Partial<ReviewRequest>;
		return {
			marks: value.marks ?? {},
			notes: value.notes ?? {},
			overrides: value.overrides ?? {},
			keepRows: value.keepRows ?? {},
			preferredSetId: String(value.preferredSetId ?? ''),
			note: String(value.note ?? '')
		};
	} catch {
		return null;
	}
}

export const actions: Actions = {
	override: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { message: 'Invalid NDC.' });
		const form = await request.formData();
		const citation = readCitationInput(form);
		if (!citation) return fail(400, { message: 'Choose what the override cites.' });
		const named = form.get('ambiguity');
		if (named && !isAmbiguityKind(named))
			return fail(400, { message: 'Unknown labeler ambiguity.' });
		const kind = isAmbiguityKind(named) ? named : null;
		try {
			await savePropertyOverride(
				ndc,
				String(form.get('key') ?? ''),
				String(form.get('value') ?? ''),
				citation,
				expectedPackageRevision(form.get('revision')),
				kind ? { kind, note: String(form.get('note') ?? '') } : undefined
			);
			return { overridden: true };
		} catch (cause) {
			return fail(cause instanceof PackageConflict ? 409 : 400, {
				message: cause instanceof Error ? cause.message : 'Could not save override.'
			});
		}
	},
	/** Saved per SCD concept, so it reaches every NDC sharing this one's concept. */
	setDosingMeasure: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { action: 'dosingMeasure', message: 'Invalid NDC.' });
		const form = await request.formData();
		const [item] = await syncExternalPackages([ndc]);
		if (!item) return fail(404, { action: 'dosingMeasure', message: 'No package data available.' });
		try {
			await saveDosingMeasure(
				item,
				String(form.get('mode') ?? ''),
				form.get('ingredient') ? String(form.get('ingredient')) : null,
				form.getAll('ingredients').map(String)
			);
			return { dosingMeasureSaved: true };
		} catch (cause) {
			return fail(400, {
				action: 'dosingMeasure',
				message: cause instanceof Error ? cause.message : 'Could not save dosing measure.'
			});
		}
	},
	clearDosingMeasure: async ({ params }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { action: 'dosingMeasure', message: 'Invalid NDC.' });
		const [item] = await syncExternalPackages([ndc]);
		if (!item) return fail(404, { action: 'dosingMeasure', message: 'No package data available.' });
		await clearDosingMeasure(item);
		return { dosingMeasureSaved: true };
	},
	removeOverride: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { message: 'Invalid NDC.' });
		const data = await request.formData();
		const keys = data.getAll('key').map(String);
		try {
			await removePropertyOverrides(ndc, keys, expectedPackageRevision(data.get('revision')));
			return { overridden: true };
		} catch (cause) {
			return fail(cause instanceof PackageConflict ? 409 : 400, {
				message: cause instanceof Error ? cause.message : 'Could not remove override.'
			});
		}
	},
	/** Keeps this NDC off the formulary and unlinks it from any item it is on. */
	exclude: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { message: 'Invalid NDC.' });
		const data = await request.formData();
		const reason = String(data.get('reason') ?? '').trim();
		if (!reason) return fail(400, { message: 'Say why this NDC is excluded.' });
		try {
			await savePropertyOverride(
				ndc,
				'manualExclusion',
				reason,
				{ source: 'none' },
				expectedPackageRevision(data.get('revision'))
			);
			await unlinkPackage(prisma, ndc);
			return { excluded: true };
		} catch (cause) {
			return fail(cause instanceof PackageConflict ? 409 : 400, {
				message: cause instanceof Error ? cause.message : 'Could not exclude.'
			});
		}
	},
	include: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { message: 'Invalid NDC.' });
		try {
			await removePropertyOverrides(
				ndc,
				['manualExclusion'],
				expectedPackageRevision((await request.formData()).get('revision'))
			);
			return { excluded: false };
		} catch (cause) {
			return fail(cause instanceof PackageConflict ? 409 : 400, {
				message: cause instanceof Error ? cause.message : 'Could not include.'
			});
		}
	},
	/** Re-scrape and reinterpret without saving; the user confirms the result. */
	preview: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		const data = await request.formData();
		const review = parseReview(data.get('review'));
		if (!ndc || !review) return fail(400, { message: 'Malformed review request.' });
		if (review.preferredSetId && !/^[0-9a-f-]{36}$/i.test(review.preferredSetId.trim()))
			return fail(400, { message: 'A DailyMed set ID looks like 8-4-4-4-12 hex digits.' });
		try {
			return {
				preview: await previewReinterpret(
					ndc,
					review,
					expectedPackageRevision(data.get('revision'))
				)
			};
		} catch (cause) {
			return fail(cause instanceof PackageConflict ? 409 : 502, {
				message: cause instanceof Error ? cause.message : 'Scrape failed.'
			});
		}
	},
	/** Upserts the rule for the chosen scope of this package's own key (never a client-supplied key). */
	pharmClassRule: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { action: 'pharmClassRule', message: 'Invalid NDC.' });
		const form = await request.formData();
		const [item] = await syncExternalPackages([ndc]);
		if (!item)
			return fail(404, { action: 'pharmClassRule', message: 'No package data available.' });
		const classKey = packageClassKey(item);
		const option = scopeOptions(classKey).find((candidate) => candidate.id === form.get('scope'));
		if (!option)
			return fail(400, { action: 'pharmClassRule', message: 'Choose where the rule applies.' });
		const mode = String(form.get('mode') ?? '');
		if (mode !== 'replace' && mode !== 'add' && mode !== 'suppress')
			return fail(400, { action: 'pharmClassRule', message: 'Choose replace, add or hide.' });
		try {
			await upsertRule(prisma, (await defaultScope(prisma)).id, {
				moietyKey: classKey.moietyKey,
				moietyNames: classKey.moietyNames,
				doseFormGroup: option.doseFormGroup,
				route: option.route,
				strengthKey: option.strengthKey,
				mode,
				classes: form.getAll('classes').map(String),
				note: String(form.get('note') ?? '').trim() || null
			});
			return { pharmClassRuleSaved: true };
		} catch (cause) {
			if (cause instanceof RuleInputError)
				return fail(400, { action: 'pharmClassRule', message: cause.message });
			throw cause;
		}
	},
	pharmClassRuleDelete: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { action: 'pharmClassRuleDelete', message: 'No rule chosen.' });
		try {
			await deleteRule(prisma, (await defaultScope(prisma)).id, id);
		} catch (cause) {
			// Unknown, malformed or other-scope ids keep their 404 status, but as a message the
			// dialog can show, not an error page (the rule may simply have been deleted already).
			if (isHttpError(cause, 404))
				return fail(404, {
					action: 'pharmClassRuleDelete',
					message: 'Rule not found; it may already be deleted.'
				});
			throw cause;
		}
		return { pharmClassRuleSaved: true };
	},
	/**
	 * Creates a local SCD (evidence always from this NDC's label) and, when asked,
	 * supersedes the SCD in the same transaction; or updates the one being edited.
	 */
	localConceptSave: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { action: 'localConceptSave', message: 'Invalid NDC.' });
		const form = await request.formData();
		let raw: Record<string, unknown>;
		try {
			raw = JSON.parse(String(form.get('concept') ?? ''));
		} catch {
			return fail(400, { action: 'localConceptSave', message: 'Malformed local concept.' });
		}
		const id = String(form.get('id') ?? '');
		const scopeId = (await defaultScope(prisma)).id;
		try {
			if (id) {
				const refused = editTargetError(id, await listLocalConcepts(prisma, scopeId));
				if (refused)
					return fail(refused.status, { action: 'localConceptSave', message: refused.message });
				// Evidence stays what the concept was defined from.
				const stored = await prisma.localConcept.findUnique({
					where: { id },
					select: { evidenceSetId: true, evidenceVersion: true, evidenceNdc: true }
				});
				if (!stored) throw new LocalConceptInputError('Local concept not found');
				await updateLocalConcept(prisma, id, parseLocalConceptInput({ ...raw, ...stored }));
				return { localConceptSaved: true };
			}
			const [item] = await syncExternalPackages([ndc]);
			if (!item)
				return fail(404, { action: 'localConceptSave', message: 'No package data available.' });
			const { evidenceSetId, evidenceVersion, evidenceNdc } = localConceptDraft(item).input;
			const input = parseLocalConceptInput({ ...raw, evidenceSetId, evidenceVersion, evidenceNdc });
			let rxcui: string | null = null;
			if (form.get('supersede') === 'on') {
				const target = await supersedeTarget(prisma, scopeId, item);
				if (target.blocked || !target.scd)
					throw new LocalConceptInputError(target.blocked ?? 'There is no SCD to supersede.');
				rxcui = target.scd.rxcui;
			}
			await prisma.$transaction(
				async (tx) => {
					const created = await createLocalConcept(tx, input);
					if (rxcui) await supersede(tx, scopeId, created.id, rxcui, null);
				},
				{ timeout: 60_000 }
			);
			return { localConceptSaved: true };
		} catch (cause) {
			if (cause instanceof LocalConceptInputError)
				return fail(400, { action: 'localConceptSave', message: cause.message });
			throw cause;
		}
	},
	/** Ends the local concept's active supersede mapping in this scope. */
	localConceptStop: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { action: 'localConceptStop', message: 'No local concept chosen.' });
		const scopeId = (await defaultScope(prisma)).id;
		try {
			const mapping = (await listLocalConcepts(prisma, scopeId)).find(
				(c) => c.id === id
			)?.supersedes;
			if (!mapping?.active) throw new LocalConceptInputError('No active supersede mapping found');
			await stopSuperseding(prisma, scopeId, mapping.mappingId);
		} catch (cause) {
			if (cause instanceof LocalConceptInputError)
				return fail(400, { action: 'localConceptStop', message: cause.message });
			throw cause;
		}
		return { localConceptSaved: true };
	},
	apply: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		const token = String((await request.formData()).get('token') ?? '');
		try {
			if (!ndc || !(await applyReinterpret(ndc, token)))
				return fail(410, { message: 'This preview expired. Run the reload again.' });
			return { applied: true };
		} catch (cause) {
			return fail(cause instanceof PackageConflict ? 409 : 400, {
				message: cause instanceof Error ? cause.message : 'Could not apply preview.'
			});
		}
	}
};
