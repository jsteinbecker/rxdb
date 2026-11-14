/**
 * Committing package changes — corrections, review decisions, provenance and cache
 * projections — together, with no provider calls.
 *
 * @module
 */
import type { Prisma, PrismaClient } from '../../../generated/client';
import type { ExternalPackage, SourcePayload } from '../../catalog/types';
import type { PackageOverrides, PackageReview } from '../../catalog/package-state';
import {
	assertPackageRevision,
	loadPackageStates,
	lockPackageStates,
	projectionPayload,
	stateSnapshot,
	writePackageDecisions
} from '../catalog/package-state-store';
import { recordEvidence } from '../catalog/snapshot-store';

export type PackageChange = {
	ndc: string;
	expectedRevision: number;
	overrides: PackageOverrides;
	review?: PackageReview;
	baseline?: ExternalPackage;
	evidence: SourcePayload[];
};

/** Corrections, review decisions, provenance and cache projections commit together. No provider calls. */
export async function commitPackageChanges(
	db: PrismaClient,
	changes: PackageChange[],
	finalize?: (tx: Prisma.TransactionClient) => Promise<void>
) {
	if (!changes.length) return [];
	return db.$transaction(
		async (tx) => {
			await lockPackageStates(
				tx,
				changes.map((change) => change.ndc)
			);
			const states = await loadPackageStates(
				tx,
				changes.map((change) => change.ndc)
			);
			for (const change of changes) {
				const state = states.get(change.ndc);
				if (!state) throw new Error('No provider baseline is stored for this NDC.');
				assertPackageRevision(state, change.expectedRevision);
			}
			const result: ExternalPackage[] = [];
			const evidence = changes.flatMap((change) => change.evidence);
			for (const change of changes) {
				const state = await writePackageDecisions(tx, states.get(change.ndc)!, change);
				result.push(stateSnapshot(state).item);
				evidence.push({
					source: 'catalog-enrichment',
					nativeId: state.ndc,
					url: `urn:rxdb:catalog:ndc:${state.ndc}`,
					payload: projectionPayload(state)
				});
			}
			await recordEvidence(tx, evidence);
			if (finalize) await finalize(tx);
			return result;
		},
		{ timeout: 60_000 }
	);
}
