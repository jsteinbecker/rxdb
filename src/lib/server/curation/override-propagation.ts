/**
 * Passing overrides along: applying them to a package, and copying them to sibling
 * packages of the same product (product-level fields always; unit-of-use fields
 * when the sibling holds the same unit).
 *
 * @module
 */
import { commitPackageChanges } from './package-corrections';
import { stateSnapshot, loadPackageStates } from '../catalog/package-state-store';
import type { PrismaClient } from '../../../generated/client';
import type { ExternalPackage } from '../../catalog/types';
import { loadPackageSnapshots } from '../catalog/snapshot-store';
import { resolveEffectivePackage } from '../../catalog/effective-package';
import {
	isProductLevelKey,
	isUnitOfUseKey,
	type PropertyOverride,
	sameUnitOfUse
} from '../../curation/property-override-fields';

type Overrides = Record<string, PropertyOverride>;

/** `item` with `overrides` added and applied, each recorded as evidence. */
export function withOverrides(item: ExternalPackage, overrides: Overrides): ExternalPackage {
	return resolveEffectivePackage({
		...item,
		propertyOverrides: { ...item.propertyOverrides, ...overrides },
		evidence: Object.entries(overrides).map(([key, override]) => ({
			source: 'user-override',
			nativeId: `${item.ndc}:${key}:${override.createdAt}`,
			url: `urn:rxdb:override:ndc:${item.ndc}`,
			payload: { key, ...override }
		}))
	});
}

/** Cached packages of the same product as `item` (same product NDC). */
export async function productSiblings(
	db: PrismaClient,
	item: Pick<ExternalPackage, 'ndc' | 'productCode' | 'details'>
): Promise<ExternalPackage[]> {
	const ndcs = (item.details?.packaging?.siblings.map((sibling) => sibling.ndc) ?? []).filter(
		(ndc) => ndc !== item.ndc
	);
	if (!ndcs.length) return [];
	const snapshots = await loadPackageSnapshots(db, ndcs);
	return ndcs.flatMap((ndc) => {
		const sibling = snapshots.get(ndc)?.item;
		return sibling && (!item.productCode || sibling.productCode === item.productCode)
			? [sibling]
			: [];
	});
}

/**
 * The copies of `overrides` that reach `sibling`: product-level fields always,
 * unit-of-use fields when it holds the same unit as `source`. A sibling's own
 * correction is kept; one copied from another package is replaced.
 */
export function siblingCopies(
	source: ExternalPackage,
	sibling: ExternalPackage,
	overrides: Overrides
): Overrides {
	const sameUnit = sameUnitOfUse(source, sibling);
	return Object.fromEntries(
		Object.entries(overrides)
			.filter(([key, override]) => {
				if (!isProductLevelKey(key) && !(sameUnit && isUnitOfUseKey(key))) return false;
				const existing = sibling.propertyOverrides?.[key];
				if (!existing) return true;
				if (!existing.propagatedFrom) return false;
				// Already passed along; restaging it would only add a snapshot.
				return !(
					existing.propagatedFrom === source.ndc &&
					existing.createdAt === override.createdAt &&
					existing.value === override.value
				);
			})
			.map(([key, override]) => [key, { ...override, propagatedFrom: source.ndc }])
	);
}

/** Stages `overrides` on `source` and every sibling they reach, in one run. */
export async function stageWithSiblings(
	db: PrismaClient,
	source: ExternalPackage,
	overrides: Overrides
) {
	const siblings = await productSiblings(db, source);
	const staged = [
		withOverrides(source, overrides),
		...siblings.flatMap((sibling) => {
			const copies = siblingCopies(source, sibling, overrides);
			return Object.keys(copies).length ? [withOverrides(sibling, copies)] : [];
		})
	];
	return commitPackageChanges(
		db,
		staged.map((item) => ({
			ndc: item.ndc,
			expectedRevision: item.editRevision!,
			overrides: item.propertyOverrides ?? {},
			evidence: item.evidence
		}))
	);
}

/**
 * Passes every package's own saved corrections along to its siblings, as a
 * new correction would be. Returns each sibling changed and the fields it took.
 */
export async function passAlongSavedOverrides(
	db: PrismaClient,
	{ dryRun = false }: { dryRun?: boolean } = {}
): Promise<{ ndc: string; keys: string[] }[]> {
	const rows = await db.packageCuration.findMany({ select: { ndc: true } });
	const states = await loadPackageStates(
		db,
		rows.map((row) => row.ndc)
	);
	const sources = [...states.values()].flatMap((state) => {
		const item = stateSnapshot(state).item;
		const own = Object.fromEntries(
			Object.entries(state.overrides).filter(([, override]) => !override.propagatedFrom)
		);
		return Object.keys(own).length ? [{ item, own }] : [];
	});
	// Copies for each sibling, the newest correction winning where two disagree.
	const pending = new Map<string, { sibling: ExternalPackage; copies: Overrides }>();
	for (const { item, own } of sources)
		for (const sibling of await productSiblings(db, item)) {
			const entry = pending.get(sibling.ndc) ?? { sibling, copies: {} };
			for (const [key, copy] of Object.entries(siblingCopies(item, sibling, own))) {
				const held = entry.copies[key];
				if (!held || held.createdAt < copy.createdAt) entry.copies[key] = copy;
			}
			if (Object.keys(entry.copies).length) pending.set(sibling.ndc, entry);
		}
	const changes = [...pending.values()];
	if (!dryRun)
		for (let start = 0; start < changes.length; start += 50) {
			const staged = changes
				.slice(start, start + 50)
				.map(({ sibling, copies }) => withOverrides(sibling, copies));
			await commitPackageChanges(
				db,
				staged.map((item) => ({
					ndc: item.ndc,
					expectedRevision: item.editRevision!,
					overrides: item.propertyOverrides ?? {},
					evidence: item.evidence
				}))
			);
		}
	return changes.map(({ sibling, copies }) => ({ ndc: sibling.ndc, keys: Object.keys(copies) }));
}
