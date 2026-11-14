/**
 * A labeler's packages: labeler codes, the 10-digit layout each NDC is labeled in
 * (4-4-2, 5-3-2 or 5-4-1), and every cached package under a code.
 *
 * @module
 */
import { loadPackageStates, stateSnapshot } from './package-state-store';
import type { PrismaClient } from '../../../generated/client';
import { packageStrengthText, packageTitle } from '../../catalog/package-title';
import { formContext } from '../../medication/strength-style';

/** A labeler code is the first five digits of an 11-digit NDC. */
export const normalizeLabelerCode = (value: string) => {
	const code = value.trim().replace(/\D/g, '');
	return /^\d{5}$/.test(code) ? code : null;
};

/** The labeler code of an 11-digit NDC. */
export const labelerCodeOf = (ndc: string) => ndc.slice(0, 5);

export type LabelerPackage = {
	ndc: string;
	/** The title the package's NDC page shows. */
	title: string;
	description: string | null;
	brandName: string | null;
	genericName: string | null;
	labelerName: string | null;
	doseForm: string | null;
	productCode: string | null;
	/** Ingredients with strengths, e.g. "vancomycin 1.25 g/250 mL". */
	strength: string | null;
	/** The dose form text strength display rules match (`formContext`). */
	strengthForm: string;
};

/** The 10-digit layouts an NDC is labeled in; each pads one segment to reach 5-4-2. */
export type NdcFormat = '4-4-2' | '5-3-2' | '5-4-1';
export type Basis = 'labeled' | 'inferred';

/** Which segment of the 11-digit NDC drops its leading zero to give the labeled 10. */
export const ZERO_SEGMENT = { '4-4-2': 'first', '5-3-2': 'second', '5-4-1': 'third' } as const;
export type ZeroSegment = (typeof ZERO_SEGMENT)[NdcFormat];

const FORMAT_BY_LENGTHS: Record<string, NdcFormat> = {
	'4-4': '4-4-2',
	'5-3': '5-3-2',
	'5-4': '5-4-1'
};

/**
 * The format a package is labeled in: read from its hyphenated product NDC when
 * known, otherwise deduced when only one segment has a leading zero to drop.
 */
export function labeledFormat(pkg: {
	ndc: string;
	productCode: string | null;
}): { format: NdcFormat; basis: Basis } | null {
	const lengths = pkg.productCode
		?.split('-')
		.map((part) => part.length)
		.join('-');
	const stated = lengths ? FORMAT_BY_LENGTHS[lengths] : undefined;
	if (stated) return { format: stated, basis: 'labeled' };
	const possible = (
		[
			['4-4-2', pkg.ndc[0]],
			['5-3-2', pkg.ndc[5]],
			['5-4-1', pkg.ndc[9]]
		] as const
	).flatMap(([format, lead]) => (lead === '0' ? [format] : []));
	return possible.length === 1 ? { format: possible[0], basis: 'inferred' } : null;
}

export type ZeroSegmentAnalysis = {
	segment: ZeroSegment | 'mixed' | null;
	basis: Basis;
	counts: Record<NdcFormat | 'unknown', number>;
};

/**
 * Where a labeler's NDCs drop their zero. A 4-digit labeler code (4-4-2) holds
 * for every NDC under it; a 5-digit labeler picks 5-3-2 or 5-4-1, so the
 * packages that settle it vouch for the ones that can't.
 */
export function zeroSegment(
	code: string,
	packages: { ndc: string; productCode: string | null }[]
): ZeroSegmentAnalysis {
	const counts = { '4-4-2': 0, '5-3-2': 0, '5-4-1': 0, unknown: 0 };
	let allLabeled = packages.length > 0;
	for (const pkg of packages) {
		const found = labeledFormat(pkg);
		counts[found?.format ?? 'unknown']++;
		if (found?.basis !== 'labeled') allLabeled = false;
	}
	const basis: Basis = allLabeled ? 'labeled' : 'inferred';
	if (counts['4-4-2'] && code.startsWith('0')) return { segment: 'first', basis, counts };
	const seen = (['4-4-2', '5-3-2', '5-4-1'] as const).filter((format) => counts[format]);
	if (seen.length > 1) return { segment: 'mixed', basis, counts };
	return { segment: seen.length ? ZERO_SEGMENT[seen[0]] : null, basis, counts };
}

/** Every cached package snapshot (latest per NDC) under the labeler code. */
export async function labelerPackages(db: PrismaClient, code: string): Promise<LabelerPackage[]> {
	const ids = await db.packageCuration.findMany({
		where: { ndc: { startsWith: code } },
		select: { ndc: true }
	});
	const states = await loadPackageStates(
		db,
		ids.map((row) => row.ndc),
		{ withoutLabel: true }
	);
	return [...states.values()].flatMap((state) => {
		const ndc = state.ndc;
		const snapshot = stateSnapshot(state);
		const { description, brandName, genericName, labelerName, doseForm, productCode } =
			snapshot.item;
		return [
			{
				ndc,
				title: packageTitle(snapshot.item),
				description,
				brandName,
				genericName,
				labelerName,
				doseForm,
				productCode,
				strength: packageStrengthText(snapshot.item),
				strengthForm: formContext(
					packageTitle(snapshot.item),
					doseForm,
					snapshot.item.details?.product?.routes ?? []
				)
			}
		];
	});
}
