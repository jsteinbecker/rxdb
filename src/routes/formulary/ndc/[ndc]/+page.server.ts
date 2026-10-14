import { error, fail, isHttpError } from '@sveltejs/kit';
import { toNdc11 } from '$lib/ndc';
import { prisma } from '$lib/server/prisma';
import { itemName } from '$lib/item-name';
import { stagedTree, syncExternalPackages } from '$lib/server/catalog-sync';
import { defaultScope, loadedItems, localNamesOf, unlinkPackage } from '$lib/server/catalog-formulary';
import { withPharmClassRules } from '$lib/server/pharm-class-view';
import { withLocalConcepts } from '$lib/server/local-concept-view';
import { loadConceptSnapshots, scdsForSbds } from '$lib/server/catalog-store';
import {
	createLocalConcept,
	listLocalConcepts,
	LocalConceptInputError,
	stopSuperseding,
	supersede,
	updateLocalConcept
} from '$lib/server/local-concept-store';
import { localConceptDraft, type DraftSource } from '$lib/local-concept-draft';
import { editTargetError, parseLocalConceptInput, type IonicRow, type LocalConceptInput } from '$lib/local-concept-input';
import type { LocalConceptView } from '$lib/local-concept-view';
import { packageClassKey } from '$lib/pharm-class-key';
import { scopeOptions } from '$lib/pharm-class-scope-options';
import { parseSettings } from '$lib/settings';
import {
	countMatches,
	deleteRule,
	knownClasses,
	RuleInputError,
	rulesForKeys,
	upsertRule
} from '$lib/server/pharm-class-rule-store';
import { applyReinterpret, previewReinterpret } from '$lib/server/reinterpret';
import {
	findEquivalentPackages,
	removePropertyOverrides,
	savePropertyOverride
} from '$lib/server/property-override';
import {
	clearDosingMeasure,
	loadDosingMeasure,
	saveDosingMeasure
} from '$lib/server/dosing-measure-store';
import { isAmbiguityKind } from '$lib/labeler-ambiguity';
import { readCitationInput } from '$lib/server/override-citation';
import type { ReviewRequest } from '$lib/reinterpret';
import {
	loadPillImageLayouts,
	pillImageTarget,
	queuePillImages,
	unmeasured
} from '$lib/server/pill-image-store';
import { resolvePillPhotos } from '$lib/server/pill-photo';
import { dev } from '$app/environment';
import { pillImageKey, type PillMedia } from '$lib/pill-image-layout';
import { measuredToIln } from '$lib/imprints/measured-to-iln';
import { guessIln } from '$lib/imprints/spl-to-iln';
import { toSplAppearance } from '$lib/imprints/iln-render';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const ndc = toNdc11(params.ndc);
	if (!ndc) error(400, 'Use an 11-digit NDC or a labeled, hyphenated NDC.');
	const [item] = await syncExternalPackages([ndc]);
	if (!item) error(404, 'No package data available.');
	const [{ packages }, equivalents, dosingMeasure] = await Promise.all([
		stagedTree({ concepts: [], packages: [item] }),
		findEquivalentPackages(item),
		loadDosingMeasure(item)
	]);
	const links = await prisma.formularyItemPackage.findMany({
		where: {
			validTo: null,
			formularyItem: { entity: { retiredAt: null } },
			package: {
				entity: {
					externalIdentifiers: { some: { namespace: 'ndc11', normalizedValue: ndc, validTo: null } }
				}
			}
		},
		select: { formularyItem: { select: { id: true, displayName: true, nameOverride: true, strengthAsPercent: true } } }
	});
	const scope = await defaultScope(prisma);
	const scopeId = scope.id;
	// A superseded concept's item reads by its local name; a nameOverride still wins (itemName).
	const localNames = links.length ? localNamesOf(await loadedItems(prisma, scopeId)) : new Map<string, string>();
	const formularyItems = links.map(({ formularyItem }) => ({
		id: formularyItem.id,
		displayName: itemName(localNames.get(formularyItem.id) ?? formularyItem.displayName, formularyItem)
	}));
	const [shown] = await withLocalConcepts(
		prisma,
		scopeId,
		await withPharmClassRules(prisma, scopeId, packages.slice(0, 1))
	);
	return {
		item: shown,
		localConceptEditor: await localConceptEditorFor(scopeId, shown),
		confirmRemove: parseSettings(scope.settings).confirmRemove,
		// Streamed: counting matches scans the cached snapshots.
		pharmClassRules: pharmClassRulesFor(scopeId, item),
		equivalents,
		dosingMeasure,
		formularyItems,
		// Streamed: finding a photo may mean re-reading the label or searching
		// NLM's archive, and the page should not wait on either.
		pillMedia: pillMediaFor(item)
	};
};

type SupersedeTarget = {
	/** The RxNorm SCD this NDC's concept is, or generalizes to, when known. */
	scd: { rxcui: string; name: string | null } | null;
	/** Why a new local concept can't supersede `scd` here; null when it can. */
	blocked: string | null;
};

/**
 * The SCD a local concept defined from this NDC supersedes: the NDC's own
 * RxCUI when it is an SCD, else its SCD counterpart from the concept snapshot.
 */
async function supersedeTarget(scopeId: string, item: DraftSource): Promise<SupersedeTarget> {
	const rxcui = item.details?.rxnav?.rxcui;
	if (!rxcui) return { scd: null, blocked: 'This NDC has no RxCUI to supersede.' };
	const concept = (await loadConceptSnapshots(prisma, [rxcui])).get(rxcui);
	// Brands roll up into their generic's node, so an SBD has no snapshot of its
	// own; its SCD is found from the SCD snapshots that list it.
	const viaSbd = concept ? null : (await scdsForSbds(prisma, [rxcui])).get(rxcui);
	if (!concept && !viaSbd) return { scd: null, blocked: `RxCUI ${rxcui} has no cached concept, so its SCD is unknown; search for ${rxcui} once to cache it.` };
	const counterpart = concept?.details?.counterparts.find((c) => c.tty === 'SCD');
	const scd = viaSbd
		? {
				rxcui: viaSbd.scdRxcui,
				name: (await loadConceptSnapshots(prisma, [viaSbd.scdRxcui])).get(viaSbd.scdRxcui)?.name ?? null
			}
		: concept?.tty === 'SCD'
			? { rxcui, name: concept.name }
			: counterpart
				? { rxcui: counterpart.rxcui, name: counterpart.name }
				: null;
	if (!scd) return { scd: null, blocked: `RxCUI ${rxcui} (${concept?.tty ?? 'unknown type'}) has no SCD counterpart.` };
	const target = await prisma.externalIdentifier.findFirst({
		where: { namespace: 'rxnorm_rxcui', normalizedValue: scd.rxcui, validTo: null },
		select: { entityId: true }
	});
	if (!target) return { scd, blocked: `RxCUI ${scd.rxcui} is not in the catalog yet; load it to the formulary first.` };
	const open = await prisma.entityMapping.findFirst({
		where: { objectEntityId: target.entityId, scopeId, mappingType: 'supersedes', validTo: null, supersededAt: null },
		select: { id: true }
	});
	return { scd, blocked: open ? `RxCUI ${scd.rxcui} is already superseded in this formulary.` : null };
}

/** What the local concept block and its "Define / Edit local concept" dialog start from. */
async function localConceptEditorFor(scopeId: string, item: DraftSource & { localConcept?: LocalConceptView }) {
	const local = item.localConcept;
	const [target, stored, substances] = await Promise.all([
		supersedeTarget(scopeId, item).catch((cause): SupersedeTarget => {
			console.error('supersede target lookup failed', cause);
			return { scd: null, blocked: 'Could not look up the RxNorm SCD.' };
		}),
		local
			? prisma.localConcept.findUnique({
					where: { id: local.id },
					select: { evidenceSetId: true, evidenceVersion: true, evidenceNdc: true, note: true }
				})
			: null,
		// Type-ahead names are a convenience: a failure leaves only the label's own.
		prisma.uniiSubstance
			.findMany({
				where: { notFound: false, name: { not: null } },
				select: { unii: true, name: true },
				orderBy: { name: 'asc' },
				take: 5000
			})
			.catch(() => [])
	]);
	const existing: { id: string; code: string; input: LocalConceptInput } | null =
		local && stored
			? {
					id: local.id,
					code: local.code,
					input: {
						doseForm: local.doseForm,
						ingredients: local.ingredients,
						evidenceSetId: stored.evidenceSetId,
						evidenceVersion: stored.evidenceVersion,
						evidenceNdc: stored.evidenceNdc,
						ionicContent: Array.isArray(local.ionicContent) ? (local.ionicContent as IonicRow[]) : null,
						note: stored.note
					}
				}
			: null;
	// The label's own substances first, then every one GSRS has answered for.
	const options = new Map<string, string>();
	for (const row of item.details?.spl?.ingredients ?? []) {
		if (row.unii) options.set(row.unii.toUpperCase(), row.name);
		for (const moiety of row.moieties) if (moiety.unii) options.set(moiety.unii.toUpperCase(), moiety.name);
	}
	for (const row of substances) if (row.name && !options.has(row.unii)) options.set(row.unii, row.name);
	return {
		draft: localConceptDraft(item),
		existing,
		target,
		substances: [...options].map(([unii, name]) => ({ unii, name }))
	};
}

/** The scope options for assigning a class to this package, each with its match count and any existing rule. */
async function pharmClassRulesFor(
	scopeId: string,
	item: Awaited<ReturnType<typeof syncExternalPackages>>[number]
) {
	const classKey = packageClassKey(item);
	const options = scopeOptions(classKey);
	if (!options.length) return { classKey, scopes: [], known: [], degraded: false };
	// Counts and type-ahead names are conveniences: a failure falls back to empty rather than
	// rejecting the whole stream. Only the existing-rule lookup is required.
	let degraded = false;
	const soft = <T>(value: Promise<T>, fallback: T) =>
		value.catch(() => {
			degraded = true;
			return fallback;
		});
	const [rules, counts, known] = await Promise.all([
		rulesForKeys(prisma, scopeId, [classKey.moietyKey]),
		Promise.all(
			options.map((option) =>
				soft(countMatches(prisma, { moietyKey: classKey.moietyKey, ...option }), {
					count: 0,
					capped: false
				})
			)
		),
		soft(knownClasses(prisma), [] as string[])
	]);
	const scopes = options.map((option, index) => {
		const rule = rules.find(
			(candidate) =>
				candidate.doseFormGroup === option.doseFormGroup &&
				candidate.route === option.route &&
				candidate.strengthKey === option.strengthKey
		);
		return {
			...option,
			...counts[index],
			rule: rule
				? { id: rule.id, mode: rule.mode, classes: rule.classes, note: rule.note ?? '' }
				: null
		};
	});
	return { classKey, scopes, known, degraded };
}

async function pillMediaFor(
	item: Awaited<ReturnType<typeof syncExternalPackages>>[number]
): Promise<PillMedia> {
	const appearances = item.details?.spl?.appearances ?? [];
	if (!appearances.length) return { photos: [], layouts: {}, ilns: [] };
	const photos = await resolvePillPhotos(prisma, item.ndc, item.splSetId, appearances, {
		local: dev
	});
	const targets = appearances.flatMap(
		(appearance, index) => pillImageTarget(photos[index], appearance, item.doseForm) ?? []
	);
	queuePillImages(prisma, await unmeasured(prisma, targets));
	const layouts = await loadPillImageLayouts(prisma, targets);
	const ilns = appearances.map((appearance, index) => {
		const photo = photos[index];
		const layout = photo && layouts.get(pillImageKey(photo.setId, photo.image));
		return layout
			? measuredToIln(layout, guessIln(toSplAppearance(appearance, item.doseForm)).form)
			: null;
	});
	return { photos, layouts: Object.fromEntries(layouts), ilns };
}

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
				kind ? { kind, note: String(form.get('note') ?? '') } : undefined
			);
			return { overridden: true };
		} catch (cause) {
			return fail(400, {
				message: cause instanceof Error ? cause.message : 'Could not save override.'
			});
		}
	},
	/** Saved per SCD concept, so it reaches every NDC sharing this one's concept. */
	setDosingMeasure: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { message: 'Invalid NDC.' });
		const form = await request.formData();
		const [item] = await syncExternalPackages([ndc]);
		if (!item) return fail(404, { message: 'No package data available.' });
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
				message: cause instanceof Error ? cause.message : 'Could not save dosing measure.'
			});
		}
	},
	clearDosingMeasure: async ({ params }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { message: 'Invalid NDC.' });
		const [item] = await syncExternalPackages([ndc]);
		if (!item) return fail(404, { message: 'No package data available.' });
		await clearDosingMeasure(item);
		return { dosingMeasureSaved: true };
	},
	removeOverride: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { message: 'Invalid NDC.' });
		const keys = (await request.formData()).getAll('key').map(String);
		try {
			await removePropertyOverrides(ndc, keys);
			return { overridden: true };
		} catch (cause) {
			return fail(400, {
				message: cause instanceof Error ? cause.message : 'Could not remove override.'
			});
		}
	},
	/** Keeps this NDC off the formulary and unlinks it from any item it is on. */
	exclude: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { message: 'Invalid NDC.' });
		const reason = String((await request.formData()).get('reason') ?? '').trim();
		if (!reason) return fail(400, { message: 'Say why this NDC is excluded.' });
		try {
			await savePropertyOverride(ndc, 'manualExclusion', reason, { source: 'none' });
			await unlinkPackage(prisma, ndc);
			return { excluded: true };
		} catch (cause) {
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not exclude.' });
		}
	},
	include: async ({ params }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { message: 'Invalid NDC.' });
		try {
			await removePropertyOverrides(ndc, ['manualExclusion']);
			return { excluded: false };
		} catch (cause) {
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not include.' });
		}
	},
	/** Re-scrape and reinterpret without saving; the user confirms the result. */
	preview: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		const review = parseReview((await request.formData()).get('review'));
		if (!ndc || !review) return fail(400, { message: 'Malformed review request.' });
		if (review.preferredSetId && !/^[0-9a-f-]{36}$/i.test(review.preferredSetId.trim()))
			return fail(400, { message: 'A DailyMed set ID looks like 8-4-4-4-12 hex digits.' });
		try {
			return { preview: await previewReinterpret(ndc, review) };
		} catch (cause) {
			return fail(502, { message: cause instanceof Error ? cause.message : 'Scrape failed.' });
		}
	},
	/** Upserts the rule for the chosen scope of this package's own key (never a client-supplied key). */
	pharmClassRule: async ({ params, request }) => {
		const ndc = toNdc11(params.ndc);
		if (!ndc) return fail(400, { action: 'pharmClassRule', message: 'Invalid NDC.' });
		const form = await request.formData();
		const [item] = await syncExternalPackages([ndc]);
		if (!item) return fail(404, { action: 'pharmClassRule', message: 'No package data available.' });
		const classKey = packageClassKey(item);
		const option = scopeOptions(classKey).find((candidate) => candidate.id === form.get('scope'));
		if (!option) return fail(400, { action: 'pharmClassRule', message: 'Choose where the rule applies.' });
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
			if (cause instanceof RuleInputError) return fail(400, { action: 'pharmClassRule', message: cause.message });
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
				return fail(404, { action: 'pharmClassRuleDelete', message: 'Rule not found; it may already be deleted.' });
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
				if (refused) return fail(refused.status, { action: 'localConceptSave', message: refused.message });
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
			if (!item) return fail(404, { action: 'localConceptSave', message: 'No package data available.' });
			const { evidenceSetId, evidenceVersion, evidenceNdc } = localConceptDraft(item).input;
			const input = parseLocalConceptInput({ ...raw, evidenceSetId, evidenceVersion, evidenceNdc });
			let rxcui: string | null = null;
			if (form.get('supersede') === 'on') {
				const target = await supersedeTarget(scopeId, item);
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
			const mapping = (await listLocalConcepts(prisma, scopeId)).find((c) => c.id === id)?.supersedes;
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
		if (!ndc || !(await applyReinterpret(ndc, token)))
			return fail(410, { message: 'This preview expired. Run the reload again.' });
		return { applied: true };
	}
};
