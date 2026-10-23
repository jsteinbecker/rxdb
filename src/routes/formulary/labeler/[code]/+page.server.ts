import { error } from '@sveltejs/kit';
import { findDefaultScope } from '$lib/server/formulary/membership';
import { formularyNdcStatuses } from '$lib/server/formulary/read';
import {
	labeledFormat,
	labelerPackages,
	normalizeLabelerCode,
	ZERO_SEGMENT,
	zeroSegment
} from '$lib/server/catalog/labeler-packages';
import { prisma } from '$lib/server/infrastructure/database';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const code = normalizeLabelerCode(params.code);
	if (!code) error(400, 'A labeler code is the first five digits of an NDC.');
	const [packages, scope] = await Promise.all([
		labelerPackages(prisma, code),
		findDefaultScope(prisma)
	]);
	const statuses = scope
		? await formularyNdcStatuses(prisma, scope.id)
		: new Map<string, 'on' | 'excluded'>();
	// Sources disagree on casing, so tally names case-insensitively and show the
	// most common spelling of each.
	const names = new Map<string, Map<string, number>>();
	for (const { labelerName: name } of packages) {
		if (!name) continue;
		const spellings = names.get(name.toUpperCase()) ?? new Map<string, number>();
		names.set(name.toUpperCase(), spellings.set(name, (spellings.get(name) ?? 0) + 1));
	}
	const ranked = [...names.values()].map((spellings) => {
		const [[name], ...rest] = [...spellings].sort((a, b) => b[1] - a[1]);
		return { name, count: rest.reduce((sum, [, n]) => sum + n, spellings.get(name)!) };
	});
	const zero = zeroSegment(code, packages);
	return {
		code,
		names: ranked.sort((a, b) => b.count - a.count).map(({ name }) => name),
		zero,
		packages: packages.map((pkg) => {
			// A package that can't settle its own format takes the labeler's.
			const own = labeledFormat(pkg);
			const fallback = zero.segment && zero.segment !== 'mixed' ? zero.segment : null;
			return {
				...pkg,
				onFormulary: statuses.get(pkg.ndc) === 'on',
				formularyStatus:
					statuses.get(pkg.ndc) === 'on'
						? ('on' as const)
						: statuses.get(pkg.ndc) === 'excluded'
							? ('flagged' as const)
							: ('unknown' as const),
				zeroSegment: own ? ZERO_SEGMENT[own.format] : fallback,
				zeroBasis: own?.basis ?? (fallback ? ('labeler' as const) : null)
			};
		})
	};
};
