import type { SkeletonKind } from './PageSkeleton.svelte';

/** Which skeleton stands in for a destination route while its load runs; unlisted routes just dim. */
const BY_ROUTE: Record<string, SkeletonKind> = {
	'/formulary': 'formulary',
	'/formulary/items': 'items',
	'/formulary/items/[id]': 'item',
	'/formulary/ndc/[ndc]': 'package',
	'/formulary/unii/[unii]': 'usage',
	'/formulary/labeler/[code]': 'usage',
	'/compounds': 'compounds',
	'/compounds/[id]': 'compound',
	'/settings': 'settings'
};

export const skeletonFor = (routeId: string | null | undefined): SkeletonKind | null =>
	(routeId && BY_ROUTE[routeId]) || null;
