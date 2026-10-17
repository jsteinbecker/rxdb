import { toNdc11 } from '../ndc';
import { isFresh, mergePackage, type PackageSnapshot } from './catalog-cache';
import { type ExternalPackage } from './catalog-providers';
import { applyPropertyOverrides } from './apply-property-overrides';

type CollectionStore = {
	load: (ndcs: string[]) => Promise<Map<string, PackageSnapshot>>;
	/** Each NDC's overrides from its latest snapshot, whatever its CATALOG_VERSION. */
	loadOverrides?: (ndcs: string[]) => Promise<Map<string, ExternalPackage['propertyOverrides']>>;
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
	const unique = [...new Set(ndcs.map(toNdc11).filter((ndc): ndc is string => ndc !== null))];
	if (!unique.length) return [];
	const cached = await store.load(unique);
	const missing = unique.filter(
		(ndc) => force || !cached.has(ndc) || !isFresh(cached.get(ndc)!, now)
	);
	const fetched = missing.length ? await store.fetch(missing) : [];
	// A snapshot from an older CATALOG_VERSION is unreadable, but its overrides
	// are the user's and must outlive the bump.
	const unread = fetched.filter((item) => !cached.has(item.ndc)).map((item) => item.ndc);
	const carried = unread.length && store.loadOverrides ? await store.loadOverrides(unread) : new Map();
	const refreshed = fetched.map((item) => {
		const previous = cached.get(item.ndc)?.item;
		if (previous) return mergePackage(previous, item);
		const propertyOverrides = carried.get(item.ndc);
		return propertyOverrides ? applyPropertyOverrides({ ...item, propertyOverrides }) : item;
	});
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
