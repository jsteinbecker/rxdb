/**
 * Keeping provider facts, review decisions and field overrides apart: the baseline
 * stored from providers, the review choices patched on top of it, and the curated
 * package they produce.
 *
 * @module
 */
import type { ExternalPackage } from './types';
import type { PropertyOverride } from '../curation/property-override-fields';
import { REVIEW_FIELDS, fieldValue } from '../curation/reinterpret';
import { resolveEffectivePackage } from './effective-package';

export type PackageOverrides = Record<string, PropertyOverride>;
export type PackageReview = Record<string, unknown>;

/** Remove user/read projections before storing provider facts. */
export function providerBaseline(item: ExternalPackage): ExternalPackage {
	const baseline = structuredClone(item);
	delete baseline.propertyOverrides;
	delete baseline.localConcept;
	delete baseline.editRevision;
	delete baseline.baselineUnavailable;
	delete baseline.manualExclusion;
	baseline.evidence = [];
	baseline.splXml = null;
	const product = baseline.details?.product;
	if (product?.pharmClassResolution) {
		product.pharmClasses = product.pharmClassResolution.source;
		delete product.pharmClassResolution;
	}
	return baseline;
}

export function applyPackageReview(
	baseline: ExternalPackage,
	review: PackageReview
): ExternalPackage {
	const result = structuredClone(baseline);
	for (const field of REVIEW_FIELDS) {
		if (!Object.hasOwn(review, field.key)) continue;
		const value = structuredClone(review[field.key]);
		if (field.detail) {
			result.details ??= { product: null, packaging: null, label: null, spl: null, rxnav: null };
			Object.assign(result.details, { [field.detail]: value });
		} else {
			const keys = field.keys ?? [];
			if (keys.length === 1) Object.assign(result, { [keys[0]]: value });
			else
				for (const key of keys)
					Object.assign(result, { [key]: (value as Record<string, unknown>)?.[key] ?? null });
		}
	}
	return result;
}

export const samePackageValue = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
function stable(value: unknown): string {
	return JSON.stringify(value, (_, v) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
			: v
	);
}

/** Store review choices independently of provider facts and field overrides. */
export function packageReviewPatch(
	baseline: ExternalPackage,
	reviewed: ExternalPackage
): PackageReview {
	return Object.fromEntries(
		REVIEW_FIELDS.flatMap((field) => {
			const before = fieldValue(baseline, field);
			const after = fieldValue(reviewed, field);
			return samePackageValue(before, after) ? [] : [[field.key, after]];
		})
	);
}

export function curatedPackage(
	baseline: ExternalPackage,
	overrides: PackageOverrides,
	review: PackageReview,
	revision: number,
	unknownKeys: string[] = []
): ExternalPackage {
	const reviewed = applyPackageReview(baseline, review);
	const item = resolveEffectivePackage(
		{ ...reviewed, propertyOverrides: overrides },
		{
			recomputeVolume: ['doseForm', 'size', 'ingredients', 'reconstitution'].some((key) =>
				Object.hasOwn(review, key)
			)
		}
	);
	item.editRevision = revision;
	if (unknownKeys.length) item.baselineUnavailable = unknownKeys;
	return item;
}

function pathsForOverride(key: string): string[] {
	if (key.startsWith('details.spl.ingredients.'))
		return ['ingredients', 'details.spl.ingredients', 'resolvedVolume'];
	if (key.startsWith('details.spl.appearances.')) return ['details.spl.appearances'];
	if (key.startsWith('reconstitution.')) return ['reconstitution', 'resolvedVolume'];
	if (key.startsWith('resolvedVolume.')) return ['resolvedVolume'];
	if (key.startsWith('size.')) return ['size', 'unitOfUseCorrection', 'resolvedVolume'];
	if (key === 'doseForm') return ['doseForm', 'doseFormCorrection', 'isDryFill', 'resolvedVolume'];
	return [key];
}

function pathValue(item: ExternalPackage, path: string): unknown {
	return path
		.split('.')
		.reduce<unknown>(
			(value, key) =>
				value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
			item
		);
}
function restorePath(item: ExternalPackage, path: string, value: unknown) {
	const keys = path.split('.');
	let parent = item as unknown as Record<string, unknown>;
	for (const key of keys.slice(0, -1)) {
		if (!parent[key] || typeof parent[key] !== 'object') return;
		parent = parent[key] as Record<string, unknown>;
	}
	parent[keys.at(-1)!] = structuredClone(value ?? null);
}

/** Recover only correction-owned fields from unmodified history; preserve unrelated latest facts. */
export function recoverLegacyBaseline(latest: ExternalPackage, original: ExternalPackage | null) {
	const baseline = providerBaseline(latest);
	const unknownKeys: string[] = [];
	for (const key of Object.keys(latest.propertyOverrides ?? {})) {
		if (key === 'manualExclusion') continue;
		if (!original) unknownKeys.push(key);
		for (const path of pathsForOverride(key)) {
			const previous = original ? pathValue(original, path) : undefined;
			const current = pathValue(baseline, path);
			restorePath(
				baseline,
				path,
				previous ?? (Array.isArray(current) ? [] : path === 'isDryFill' ? false : null)
			);
		}
	}
	if (unknownKeys.length) baseline.complete = false;
	return { baseline, unknownKeys };
}
