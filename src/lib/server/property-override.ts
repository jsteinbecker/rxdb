import { env } from '$env/dynamic/private';
import { gsrsMoieties, gsrsMoietyFactor, prismaSubstanceTable } from './unii-substance-store';
import { prisma } from './prisma';
import {
	type CacheRecord,
	latestCacheRecords,
	loadPackageSnapshots,
	stageCollection
} from './catalog-store';
import { type EquivalentPackage, equivalentValues } from '$lib/property-override-fields';
import { CACHE_SOURCE, mergePackage, readSnapshot } from './catalog-cache';
import { enrichPackages, type ExternalPackage } from './catalog-providers';
import { productSiblings, stageWithSiblings } from './override-propagation';
import {
	buildAmbiguityOverrides,
	citeOverride,
	type OverrideCitationInput
} from './override-citation';
import type { AmbiguityKind } from '../labeler-ambiguity';

type Package = Omit<ExternalPackage, 'splXml' | 'evidence'>;

/**
 * Cached packages that may stand in for `item`: other packages of the same
 * product, then packages sharing its RxNorm concept (same ingredient,
 * strength and dose form). Only values each one actually has are listed.
 */
export async function findEquivalentPackages(item: Package): Promise<EquivalentPackage[]> {
	const siblings = item.details?.packaging?.siblings.map((sibling) => sibling.ndc) ?? [];
	const rxcui = item.details?.rxnav?.rxcui;
	// Any snapshot that ever matched nominates an NDC; only its latest snapshot
	// decides whether it still shares the concept.
	const matches = (record: CacheRecord) =>
		siblings.includes(record.sourceNativeId) ||
		(!!rxcui && readSnapshot(record.payload)?.item.details?.rxnav?.rxcui === rxcui);
	const nominated = rxcui
		? await prisma.$queryRaw<{ ndc: string }[]>`
        SELECT DISTINCT r.source_native_id AS ndc
        FROM source_record r
        JOIN ingestion_run run ON run.id = r.ingestion_run_id
        WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
          AND r.payload #>> '{item,details,rxnav,rxcui}' = ${rxcui}`
		: [];
	const records = (
		await latestCacheRecords(
			prisma,
			[...new Set([...siblings, ...nominated.map((row) => row.ndc)])].filter(
				(ndc) => ndc !== item.ndc
			)
		)
	)
		.filter(matches)
		.slice(0, 60);
	return records
		.flatMap((record) => {
			const source = readSnapshot(record.payload)?.item;
			if (!source || source.ndc !== record.sourceNativeId) return [];
			const values = equivalentValues(item, source);
			return Object.keys(values).length
				? [
						{
							ndc: source.ndc,
							relation: siblings.includes(source.ndc) ? ('sibling' as const) : ('concept' as const),
							description: source.description,
							labelerName: source.labelerName,
							values
						}
					]
				: [];
		})
		.sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'sibling' ? -1 : 1));
}

export async function savePropertyOverride(
	ndc: string,
	key: string,
	value: string,
	citation: OverrideCitationInput,
	ambiguity?: { kind: AmbiguityKind; note: string }
) {
	const current = (await loadPackageSnapshots(prisma, [ndc])).get(ndc)?.item;
	if (!current) throw new Error('No staged data for this NDC.');
	const equivalents =
		!ambiguity && citation.source === 'ndc' ? await findEquivalentPackages(current) : [];
	const overrides = ambiguity
		? buildAmbiguityOverrides(current, key, value, ambiguity.kind, ambiguity.note, citation)
		: { [key]: citeOverride(current, key, value, citation, equivalents) };
	await stageWithSiblings(prisma, current, overrides);
}

/**
 * Removes saved overrides. Staged values have the overrides applied, so the
 * package is re-fetched to restore the originals; overrides that stay are
 * re-applied on top. The removal is recorded as evidence.
 */
export async function removePropertyOverrides(ndc: string, keys: string[]) {
	const current = (await loadPackageSnapshots(prisma, [ndc])).get(ndc)?.item;
	if (!current) throw new Error('No staged data for this NDC.');
	const removed = keys.filter((key) => current.propertyOverrides?.[key]);
	if (!removed.length) throw new Error('No saved override to remove.');
	// A manual exclusion has no provider value to restore, so it is simply cleared.
	if (removed.every((key) => key === 'manualExclusion')) {
		const remaining = Object.fromEntries(
			Object.entries(current.propertyOverrides ?? {}).filter(([key]) => key !== 'manualExclusion')
		);
		await stageCollection(
			prisma,
			[],
			[
				{
					...current,
					manualExclusion: null,
					propertyOverrides: Object.keys(remaining).length ? remaining : undefined,
					evidence: [removalEvidence(ndc, removed)]
				}
			]
		);
		return;
	}
	// Copies this package made onto its siblings go with it.
	const removals = [
		{ item: current, keys: removed },
		...(await productSiblings(prisma, current)).flatMap((sibling) => {
			const copied = removed.filter(
				(key) => sibling.propertyOverrides?.[key]?.propagatedFrom === ndc
			);
			return copied.length ? [{ item: sibling, keys: copied }] : [];
		})
	];
	const fresh = new Map(
		(
			await enrichPackages(
				removals.map(({ item }) => item.ndc),
				env.OPENFDA_API_KEY,
				undefined,
				{
					moietiesOf: gsrsMoieties(prismaSubstanceTable(prisma)),
					moietyFactorOf: gsrsMoietyFactor(prismaSubstanceTable(prisma))
				}
			)
		).map((item) => [item.ndc, item])
	);
	if (!fresh.get(ndc)?.complete)
		throw new Error('Providers did not answer, so the original values could not be restored.');
	// A sibling the providers did not answer for keeps its copy until removed there.
	await stageCollection(
		prisma,
		[],
		removals.flatMap(({ item, keys }) => {
			const provided = fresh.get(item.ndc);
			return provided?.complete ? [restoreWithout(item, provided, keys)] : [];
		})
	);
}

/** `current` re-read from `fresh`, with every override but `removed` re-applied. */
function restoreWithout(current: ExternalPackage, fresh: ExternalPackage, removed: string[]) {
	const remaining = Object.fromEntries(
		Object.entries(current.propertyOverrides ?? {}).filter(([key]) => !removed.includes(key))
	);
	const restored = mergePackage(
		{ ...current, propertyOverrides: remaining },
		{ ...fresh, propertyOverrides: undefined }
	);
	restored.propertyOverrides = Object.keys(remaining).length ? remaining : undefined;
	restored.evidence = [...fresh.evidence, removalEvidence(current.ndc, removed)];
	return restored;
}

const removalEvidence = (ndc: string, keys: string[]) => ({
	source: 'user-override-removal',
	nativeId: `${ndc}:${new Date().toISOString()}`,
	url: `urn:rxdb:override:ndc:${ndc}`,
	payload: { keys }
});
