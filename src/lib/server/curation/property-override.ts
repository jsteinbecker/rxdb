/**
 * Saving and removing property overrides, and finding the equivalent packages
 * whose values may stand in for one.
 *
 * @module
 */
import {
	assertPackageRevision,
	loadPackageStates,
	stateSnapshot
} from '../catalog/package-state-store';
import { commitPackageChanges } from './package-corrections';
import { refreshPackageEligibility } from '../catalog/entity-store';
import { prisma } from '../infrastructure/database';
import type { CacheRecord } from '../catalog/snapshot-store';
import { latestCacheRecords, loadPackageSnapshots } from '../catalog/snapshot-store';
import { type EquivalentPackage, equivalentValues } from '$lib/curation/property-override-fields';
import { readSnapshot } from '../catalog/cache';
import type { ExternalPackage } from '../../catalog/types';
import { productSiblings, stageWithSiblings } from './override-propagation';
import {
	buildAmbiguityOverrides,
	citeOverride,
	type OverrideCitationInput
} from './override-citation';
import type { AmbiguityKind } from '../../catalog/labeler-ambiguity';

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
        SELECT ndc FROM package_curation
        WHERE baseline #>> '{details,rxnav,rxcui}' = ${rxcui}
          OR review #>> '{rxnav,rxcui}' = ${rxcui}`
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
	expectedRevision: number,
	ambiguity?: { kind: AmbiguityKind; note: string }
) {
	const current = (await loadPackageSnapshots(prisma, [ndc])).get(ndc)?.item;
	if (!current) throw new Error('No staged data for this NDC.');
	const state = (await loadPackageStates(prisma, [ndc])).get(ndc);
	if (!state) throw new Error('No provider baseline is stored for this NDC.');
	assertPackageRevision(state, expectedRevision);
	const equivalents =
		!ambiguity && citation.source === 'ndc' ? await findEquivalentPackages(current) : [];
	const overrides = ambiguity
		? buildAmbiguityOverrides(current, key, value, ambiguity.kind, ambiguity.note, citation)
		: { [key]: citeOverride(current, key, value, citation, equivalents) };
	const changed = await stageWithSiblings(prisma, current, overrides);
	await refreshPackageEligibility(prisma, changed);
}

/** Remove decisions and replay the durable baseline, including propagated sibling copies. */
export async function removePropertyOverrides(
	ndc: string,
	keys: string[],
	expectedRevision: number
) {
	const state = (await loadPackageStates(prisma, [ndc])).get(ndc);
	if (!state) throw new Error('No provider baseline is stored for this NDC.');
	assertPackageRevision(state, expectedRevision);
	const current = stateSnapshot(state).item;
	const removed = keys.filter((key) => state.overrides[key]);
	if (!removed.length) throw new Error('No saved override to remove.');
	const removals = [
		{ item: current, keys: removed },
		...(await productSiblings(prisma, current)).flatMap((item) => {
			const copied = removed.filter((key) => item.propertyOverrides?.[key]?.propagatedFrom === ndc);
			return copied.length ? [{ item, keys: copied }] : [];
		})
	];
	const changed = await commitPackageChanges(
		prisma,
		removals.map(({ item, keys }) => ({
			ndc: item.ndc,
			expectedRevision: item.editRevision!,
			overrides: Object.fromEntries(
				Object.entries(item.propertyOverrides ?? {}).filter(([key]) => !keys.includes(key))
			),
			evidence: [
				{
					source: 'user-override-removal',
					nativeId: `${item.ndc}:${crypto.randomUUID()}`,
					url: `urn:rxdb:override:ndc:${item.ndc}`,
					payload: { keys }
				}
			]
		}))
	);
	await refreshPackageEligibility(prisma, changed);
}
