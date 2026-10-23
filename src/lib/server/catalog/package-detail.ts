/**
 * Loads everything an NDC page shows about one package.
 *
 * @module
 */
import { error } from '@sveltejs/kit';
import { toNdc11 } from '$lib/catalog/ndc';
import { prisma } from '$lib/server/infrastructure/database';
import { itemName } from '$lib/formulary/item-name';
import { stagedTree, syncExternalPackages } from '$lib/server/catalog/sync';
import { defaultScope, loadedItems, localNamesOf } from '$lib/server/formulary/membership';
import { withPharmClassRules } from '$lib/server/curation/pharm-class-view';
import { withLocalConcepts } from '$lib/server/curation/local-concept-view';
import { supersedeTarget, type SupersedeTarget } from '$lib/server/curation/local-concept-target';

import { localConceptDraft, type DraftSource } from '$lib/curation/local-concept-draft';
import { type IonicRow, type LocalConceptInput } from '$lib/curation/local-concept-input';
import type { LocalConceptView } from '$lib/curation/local-concept-view';
import { packageClassKey } from '$lib/formulary/pharm-class-key';
import { scopeOptions } from '$lib/formulary/pharm-class-scope-options';
import { parseSettings } from '$lib/formulary/settings';
import {
	countMatches,
	knownClasses,
	rulesForKeys
} from '$lib/server/curation/pharm-class-rule-store';

import { findEquivalentPackages } from '$lib/server/curation/property-override';
import { loadDosingMeasure } from '$lib/server/curation/dosing-measure-store';

import {
	loadPillImageLayouts,
	pillImageTarget,
	queuePillImages,
	unmeasured
} from '$lib/server/media/pill-image-store';
import { resolvePillPhotos } from '$lib/server/media/pill-photo';
import { dev } from '$app/environment';
import { pillImageKey, type PillMedia } from '$lib/imprints/pill-image-layout';
import { measuredToIln } from '$lib/imprints/measured-to-iln';
import { guessIln } from '$lib/imprints/spl-to-iln';
import { toSplAppearance } from '$lib/imprints/iln-render';

export async function loadPackageDetail(input: string) {
	const ndc = toNdc11(input);
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
		select: {
			formularyItem: {
				select: { id: true, displayName: true, nameOverride: true, strengthStyle: true }
			}
		}
	});
	const scope = await defaultScope(prisma);
	const styles = parseSettings(scope.settings).strengthStyles;
	const scopeId = scope.id;
	// A superseded concept's item reads by its local name; a nameOverride still wins (itemName).
	const localNames = links.length
		? localNamesOf(await loadedItems(prisma, scopeId))
		: new Map<string, string>();
	const formularyItems = links.map(({ formularyItem }) => ({
		id: formularyItem.id,
		displayName: itemName(
			localNames.get(formularyItem.id) ?? formularyItem.displayName,
			formularyItem,
			styles
		),
		strengthStyle: formularyItem.strengthStyle
	}));
	const [shown] = await withLocalConcepts(
		prisma,
		scopeId,
		await withPharmClassRules(prisma, scopeId, packages.slice(0, 1))
	);
	return {
		item: shown,
		// Streamed: the supersede target can scan the cached concepts, and the
		// type-ahead list is large; only the local concept dialog needs either.
		localConceptEditor: localConceptEditorFor(scopeId, shown).catch((cause) => {
			console.error('local concept editor lookup failed', cause);
			return null;
		}),
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
}

/** What the local concept block and its "Define / Edit local concept" dialog start from. */
async function localConceptEditorFor(
	scopeId: string,
	item: DraftSource & { localConcept?: LocalConceptView }
) {
	const local = item.localConcept;
	const [target, stored, substances] = await Promise.all([
		supersedeTarget(prisma, scopeId, item).catch((cause): SupersedeTarget => {
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
						ionicContent: Array.isArray(local.ionicContent)
							? (local.ionicContent as IonicRow[])
							: null,
						note: stored.note
					}
				}
			: null;
	// The label's own substances first, then every one GSRS has answered for.
	const options = new Map<string, string>();
	for (const row of item.details?.spl?.ingredients ?? []) {
		if (row.unii) options.set(row.unii.toUpperCase(), row.name);
		for (const moiety of row.moieties)
			if (moiety.unii) options.set(moiety.unii.toUpperCase(), moiety.name);
	}
	for (const row of substances)
		if (row.name && !options.has(row.unii)) options.set(row.unii, row.name);
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
