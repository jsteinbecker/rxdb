import { resolvePackageVolume } from './catalog-facts';
import type { ExternalPackage } from './catalog-providers';

export const CATALOG_VERSION = 'catalog-sync-v18';
export const CACHE_SOURCE = 'catalog-enrichment';
const HOUR = 60 * 60 * 1000;
export type PackageSnapshot = {
	version: string;
	refreshAt: string;
	item: ExternalPackage;
};

export function snapshotPackage(item: ExternalPackage, now = new Date()): PackageSnapshot {
	const ttl = !item.complete ? 5 * 60 * 1000 : item.listed === false ? 7 * 24 * HOUR : 24 * HOUR;
	return {
		version: CATALOG_VERSION,
		refreshAt: new Date(now.getTime() + ttl).toISOString(),
		// Raw provider responses are retained separately as source records.
		item: { ...item, evidence: [], splXml: null }
	};
}

export function readSnapshot(payload: unknown): PackageSnapshot | null {
	if (!payload || typeof payload !== 'object') return null;
	const candidate = payload as PackageSnapshot;
	return candidate.version === CATALOG_VERSION &&
		typeof candidate.refreshAt === 'string' &&
		candidate.item &&
		/^\d{11}$/.test(candidate.item.ndc) &&
		Array.isArray(candidate.item.ingredients)
		? candidate
		: null;
}

export function isFresh(snapshot: PackageSnapshot, now = new Date()): boolean {
	return snapshot.version === CATALOG_VERSION && Date.parse(snapshot.refreshAt) > now.getTime();
}

/** Preserve known values across provider outages, but accept newly supplied facts. */
export function mergePackage(
	previous: ExternalPackage | undefined,
	current: ExternalPackage
): ExternalPackage {
	if (!previous) return current;
	const merged = { ...current };
	const nullable = [
		'description',
		'doseForm',
		'brandName',
		'genericName',
		'labelerName',
		'labelerCode',
		'productCode',
		'rxcuiStatus',
		'splSetId',
		'splTitle',
		'isVeterinary'
	] as const;
	for (const key of nullable) {
		// These fields share a null sentinel but have different value types.
		if (merged[key] === null) Object.assign(merged, { [key]: previous[key] });
	}
	if (current.listed === null) {
		merged.listed = previous.listed;
		merged.marketingEndDate = previous.marketingEndDate;
	}
	if (current.splPresent === null) merged.splPresent = previous.splPresent;
	if (current.splInactivated == null) merged.splInactivated = previous.splInactivated;
	if (previous.details) {
		const details = { ...(current.details ?? previous.details) };
		for (const key of Object.keys(previous.details) as (keyof typeof details)[]) {
			if (details[key] === null) Object.assign(details, { [key]: previous.details[key] });
		}
		merged.details = details;
	}
	if (!current.ingredients.length) merged.ingredients = previous.ingredients;
	if (current.description === null) merged.size = previous.size;
	if (current.doseForm === null) {
		merged.isDryFill = previous.isDryFill;
		merged.doseFormCorrection = previous.doseFormCorrection;
	}
	if (!current.reconstitution.length && !current.complete) {
		merged.reconstitution = previous.reconstitution;
	}
	if (current.isMultiDose === null && !current.complete) merged.isMultiDose = previous.isMultiDose;
	merged.resolvedVolume = resolvePackageVolume(
		merged.isDryFill,
		merged.size,
		merged.ingredients,
		merged.reconstitution
	);
	return merged;
}
