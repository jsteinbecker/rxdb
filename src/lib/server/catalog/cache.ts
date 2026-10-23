/**
 * Package cache snapshots: the versioned snapshot written for each package, how
 * long it stays fresh, and reading it back.
 *
 * @module
 */
import { resolveEffectivePackage } from '../../catalog/effective-package';
import type { ExternalPackage } from '../../catalog/types';

import { withoutUnspecified } from '../../labels/spl-ingredients';

export const CATALOG_VERSION = 'catalog-sync-v35';
export const CACHE_SOURCE = 'catalog-enrichment';
const HOUR = 60 * 60 * 1000;
export type PackageSnapshot = {
	/** Durable raw facts for collection; never included in a browser package DTO. */
	baseline?: ExternalPackage;
	baselineVersion?: string;
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
		? resolveSnapshot(candidate)
		: null;
}

/** Reapply current correction policy on read, without changing the stored snapshot. */
function resolveSnapshot(snapshot: PackageSnapshot): PackageSnapshot {
	const normalized = withoutUnspecifiedNames(structuredClone(snapshot));
	normalized.item = resolveEffectivePackage(normalized.item);
	return normalized;
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
	return (
		snapshot.version === CATALOG_VERSION &&
		(snapshot.baselineVersion ?? snapshot.version) === CATALOG_VERSION &&
		Date.parse(snapshot.refreshAt) > now.getTime()
	);
}
