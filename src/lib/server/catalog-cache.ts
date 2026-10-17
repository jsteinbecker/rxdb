import { resolvePackageVolume } from './catalog-facts';
import type { ExternalPackage } from './catalog-providers';
import { applyPropertyOverrides } from './apply-property-overrides';

import { withoutUnspecified } from '../spl-ingredients';

export const CATALOG_VERSION = 'catalog-sync-v34';
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
		? withoutUnspecifiedNames(candidate)
		: null;
}

/**
 * Snapshots cached before names dropped `, UNSPECIFIED` still carry it, so
 * strip it on read too; every reader then sees the same name.
 */
function withoutUnspecifiedNames(snapshot: PackageSnapshot): PackageSnapshot {
	const item = snapshot.item;
	for (const ingredient of item.ingredients) ingredient.name = withoutUnspecified(ingredient.name);
	// Before v27 these were bare names, repeated once per product in the SPL.
	const labelNames = new Map(
		(item.labelIngredients ?? []).map(
			(ingredient: string | (typeof item.labelIngredients)[number]) => {
				const entry =
					typeof ingredient === 'string' ? { name: ingredient, kind: null } : ingredient;
				const name = withoutUnspecified(entry.name);
				return [`${entry.kind}:${name.toLowerCase()}`, { ...entry, name }];
			}
		)
	);
	item.labelIngredients = [...labelNames.values()] as typeof item.labelIngredients;
	for (const ingredient of item.details?.spl?.ingredients ?? []) {
		ingredient.name = withoutUnspecified(ingredient.name);
		for (const moiety of ingredient.moieties) moiety.name = withoutUnspecified(moiety.name);
		if (ingredient.ionicContent)
			ingredient.ionicContent.sourceIngredients =
				ingredient.ionicContent.sourceIngredients.map(withoutUnspecified);
	}
	return snapshot;
}

export function isFresh(snapshot: PackageSnapshot, now = new Date()): boolean {
	return snapshot.version === CATALOG_VERSION && Date.parse(snapshot.refreshAt) > now.getTime();
}

/** `current` with each null or empty-list field taken from `previous`. */
function keepKnownFields<T extends object>(previous: T, current: T): T {
	const kept = { ...current } as Record<string, unknown>;
	for (const [key, value] of Object.entries(previous)) {
		const now = kept[key];
		if (now === null || now === undefined || (Array.isArray(now) && !now.length)) kept[key] = value;
	}
	return kept as T;
}

/** Preserve known values across provider outages, but accept newly supplied facts. */
export function mergePackage(
	previous: ExternalPackage | undefined,
	current: ExternalPackage
): ExternalPackage {
	if (!previous) return current;
	const merged = { ...current };
	if (previous.propertyOverrides) merged.propertyOverrides = previous.propertyOverrides;
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
			// A section rebuilt from the providers that did answer (RxNorm alone still
			// yields a product section) would drop the failed provider's fields with it.
			else if (!current.complete && details[key] && previous.details[key]) {
				details[key] = keepKnownFields(previous.details[key], details[key]) as never;
			}
		}
		merged.details = details;
	}
	if (!current.ingredients.length) merged.ingredients = previous.ingredients;
	if (current.description === null) {
		merged.size = previous.size;
		merged.unitOfUseCorrection = previous.unitOfUseCorrection;
	}
	if (current.doseForm === null) {
		merged.isDryFill = previous.isDryFill;
		merged.doseFormCorrection = previous.doseFormCorrection;
	}
	if (!current.reconstitution.length && !current.complete) {
		merged.reconstitution = previous.reconstitution;
	}
	if (current.isMultiDose === null && !current.complete) merged.isMultiDose = previous.isMultiDose;
	merged.resolvedVolume =
		current.complete && current.resolvedVolume
			? current.resolvedVolume
			: !current.complete &&
				  previous.resolvedVolume &&
				  !current.reconstitution.length &&
				  !current.ingredients.length
				? previous.resolvedVolume
				: resolvePackageVolume(
						merged.isDryFill,
						merged.size,
						merged.ingredients,
						merged.reconstitution
					);
	return applyPropertyOverrides(merged);
}
