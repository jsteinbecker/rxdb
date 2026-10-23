/**
 * Previewing and applying a "Reload & reinterpret" of one package.
 *
 * @module
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/client';
import {
	gsrsMoieties,
	gsrsMoietyFactor,
	gsrsSalt,
	prismaSubstanceTable
} from '../medication/substance-store';
import { env } from '$env/dynamic/private';
import { prisma } from '$lib/server/infrastructure/database';
import { REVIEW_FIELDS, type ReviewRequest } from '$lib/curation/reinterpret';
import { reviewPackage } from '../../catalog/review-package';
import {
	applyPackageReview,
	packageReviewPatch,
	providerBaseline,
	type PackageOverrides,
	type PackageReview
} from '../../catalog/package-state';
import { mergePackage } from '../../catalog/effective-package';
import { enrichPackages, type SplPreference } from '../catalog/enrich-packages';
import type { ExternalPackage, SourcePayload } from '../../catalog/types';
import {
	assertPackageRevision,
	loadPackageStates,
	stateSnapshot
} from '../catalog/package-state-store';
import { commitPackageChanges } from './package-corrections';
import { refreshPackageEligibility } from '../catalog/entity-store';

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function previewReinterpret(
	ndc: string,
	request: ReviewRequest,
	expectedRevision: number
) {
	const state = (await loadPackageStates(prisma, [ndc])).get(ndc);
	if (!state) throw new Error('No provider baseline is stored for this NDC.');
	assertPackageRevision(state, expectedRevision);
	const current = stateSnapshot(state).item;
	const splDoubted = ['splSource', 'splDetail', 'label'].some(
		(key) => request.marks[key] === 'incorrect'
	);
	const preference: SplPreference = {
		prefer: request.preferredSetId.trim() || null,
		avoid: splDoubted && current.splSetId ? [current.splSetId] : []
	};
	const [fresh] = await enrichPackages([ndc], env.OPENFDA_API_KEY, new Map([[ndc, preference]]), {
		moietiesOf: gsrsMoieties(prismaSubstanceTable(prisma)),
		moietyFactorOf: gsrsMoietyFactor(prismaSubstanceTable(prisma)),
		saltOf: gsrsSalt(prismaSubstanceTable(prisma))
	});
	if (!fresh) throw new Error('The sources returned nothing for this NDC.');
	const { item: merged, rows } = reviewPackage(current, fresh, request);
	const baseline = providerBaseline(mergePackage(state.baseline, providerBaseline(fresh)));
	// Compute the review overlay without baking retained field overrides into it.
	const rawReview = reviewPackage(
		applyPackageReview(state.baseline, state.review),
		fresh,
		request
	).item;
	const review = packageReviewPatch(baseline, rawReview);
	const evidence: SourcePayload[] = [
		...fresh.evidence,
		{
			source: 'user-review',
			nativeId: `${ndc}:${randomUUID()}`,
			url: `urn:rxdb:review:ndc:${ndc}`,
			payload: {
				...request,
				unlocked: REVIEW_FIELDS.filter(
					(field) => (request.marks[field.key] ?? 'locked') !== 'locked'
				).map((field) => field.key)
			}
		}
	];
	await prisma.packageReviewPreview.deleteMany({ where: { expiresAt: { lt: new Date() } } });
	const preview = await prisma.packageReviewPreview.create({
		data: {
			token: randomUUID(),
			ndc,
			sourceRevision: state.revision,
			baseline: json(baseline),
			overrides: json(merged.propertyOverrides ?? {}),
			review: json(review),
			evidence: json(evidence),
			expiresAt: new Date(Date.now() + PREVIEW_TTL_MS)
		}
	});
	return {
		token: preview.token,
		rows,
		splSetId: { before: current.splSetId, after: merged.splSetId },
		providerErrors: fresh.providerErrors ?? []
	};
}

export async function applyReinterpret(ndc: string, token: string) {
	if (!/^[0-9a-f-]{36}$/i.test(token)) return false;
	const preview = await prisma.packageReviewPreview.findUnique({ where: { token } });
	if (!preview || preview.ndc !== ndc || preview.expiresAt.getTime() < Date.now()) return false;
	const changed = await commitPackageChanges(
		prisma,
		[
			{
				ndc,
				expectedRevision: preview.sourceRevision,
				baseline: preview.baseline as unknown as ExternalPackage,
				overrides: preview.overrides as PackageOverrides,
				review: preview.review as PackageReview,
				evidence: preview.evidence as unknown as SourcePayload[]
			}
		],
		async (tx) => {
			const deleted = await tx.packageReviewPreview.deleteMany({
				where: { token, expiresAt: { gt: new Date() } }
			});
			if (deleted.count !== 1) throw new Error('This preview expired or was already applied.');
		}
	);
	await refreshPackageEligibility(prisma, changed);
	return true;
}
