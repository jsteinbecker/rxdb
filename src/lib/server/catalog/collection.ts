/**
 * Read-through package collection: cached snapshots while fresh, provider
 * enrichment for the rest.
 *
 * @module
 */
import { providerBaseline } from '../../catalog/package-state';
import { toNdc11 } from '../../catalog/ndc';
import { isFresh, type PackageSnapshot } from './cache';
import { mergePackage, resolveEffectivePackage } from '../../catalog/effective-package';
import type { ExternalPackage } from '../../catalog/types';

type CollectionStore = {
	load: (ndcs: string[]) => Promise<Map<string, PackageSnapshot>>;
	/** Each NDC's overrides from its latest snapshot, whatever its CATALOG_VERSION. */
	loadOverrides?: (ndcs: string[]) => Promise<Map<string, ExternalPackage['propertyOverrides']>>;
	fetch: (ndcs: string[]) => Promise<ExternalPackage[]>;
	save: (items: ExternalPackage[]) => Promise<void | ExternalPackage[]>;
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
	const carried =
		unread.length && store.loadOverrides ? await store.loadOverrides(unread) : new Map();
	const baselines = fetched.map((item) => {
		const previous = cached.get(item.ndc);
		return mergePackage(
			previous ? providerBaseline(previous.baseline ?? previous.item) : undefined,
			{ ...providerBaseline(item), evidence: item.evidence, splXml: item.splXml }
		);
	});
	const saved = baselines.length ? await store.save(baselines) : undefined;
	const refreshed =
		saved ??
		baselines.map((item) => {
			const propertyOverrides =
				cached.get(item.ndc)?.item.propertyOverrides ?? carried.get(item.ndc);
			return propertyOverrides ? resolveEffectivePackage({ ...item, propertyOverrides }) : item;
		});
	const available = new Map([...cached].map(([ndc, snapshot]) => [ndc, snapshot.item]));
	for (const item of refreshed) available.set(item.ndc, item);
	// Product-family siblings remain in the FDA evidence. Enriching every one
	// before returning makes a single NDC lookup wait for many unrelated packages.
	return unique.flatMap((ndc) => {
		const item = available.get(ndc);
		return item ? [item] : [];
	});
}
