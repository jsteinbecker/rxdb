import { toNdc11 } from '../ndc';
import { isFresh, mergePackage, type PackageSnapshot } from './catalog-cache';
import { MAX_CONCEPTS, MAX_NDCS_PER_CONCEPT, type ExternalPackage } from './catalog-providers';

type CollectionStore = {
	load: (ndcs: string[]) => Promise<Map<string, PackageSnapshot>>;
	fetch: (ndcs: string[]) => Promise<ExternalPackage[]>;
	save: (items: ExternalPackage[]) => Promise<void>;
};

/** `force` refetches every NDC, even ones with a fresh cached snapshot. */
export async function collectPackages(
	ndcs: string[],
	store: CollectionStore,
	now = new Date(),
	{ force = false } = {}
) {
	const unique = [...new Set(ndcs.map(toNdc11).filter((ndc): ndc is string => ndc !== null))].slice(
		0,
		MAX_CONCEPTS * MAX_NDCS_PER_CONCEPT
	);
	if (!unique.length) return [];
	const cached = await store.load(unique);
	const missing = unique.filter(
		(ndc) => force || !cached.has(ndc) || !isFresh(cached.get(ndc)!, now)
	);
	const fetched = missing.length ? await store.fetch(missing) : [];
	const refreshed = fetched.map((item) => mergePackage(cached.get(item.ndc)?.item, item));
	if (refreshed.length) await store.save(refreshed);
	const available = new Map([...cached].map(([ndc, snapshot]) => [ndc, snapshot.item]));
	for (const item of refreshed) available.set(item.ndc, item);
	// Product-family siblings remain in the FDA evidence. Enriching every one
	// before returning makes a single NDC lookup wait for many unrelated packages.
	return unique.flatMap((ndc) => {
		const item = available.get(ndc);
		return item ? [item] : [];
	});
}
