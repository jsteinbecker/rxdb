/**
 * Resolving the package a reader sees: provider facts merged across refreshes
 * (known values survive an outage, new facts are accepted), then corrections
 * applied and the values they affect re-derived, then explicit volume corrections.
 *
 * @module
 */
import type { ExternalPackage } from './types';
import { resolvePackageVolume } from './package-facts';
import { overrideField } from '../curation/property-override-fields';

/** Apply effective corrections, derive affected values, then apply explicit volume corrections. */
export function resolveEffectivePackage(
	item: ExternalPackage,
	{ recomputeVolume = false }: { recomputeVolume?: boolean } = {}
): ExternalPackage {
	const entries = Object.entries(item.propertyOverrides ?? {});
	if (!entries.length && !recomputeVolume) return item;
	const result = structuredClone(item);
	// A row the user added exists once its diluent does.
	for (const [key, { value }] of entries) {
		const id = /^reconstitution\.(a\d+)\.diluentMl$/.exec(key)?.[1];
		if (id && !result.reconstitution.some((row) => row.id === id))
			result.reconstitution.push({
				id,
				vialMassMg: null,
				diluentMl: Number(value),
				finalVolumeMl: null,
				concentrations: []
			});
	}
	const overrides = entries
		.flatMap(([key, { value }]) => {
			const field = overrideField(key);
			return field ? [{ field, value }] : [];
		})
		// A stable sort: those that win over others on what they share go last.
		.sort((a, b) => Number(!!a.field.appliesLast) - Number(!!b.field.appliesLast));
	const removed = new Set<ExternalPackage['reconstitution'][number]>();
	for (const { field, value } of overrides)
		if (!field.correctsVolume) field.set(result, value, removed);
	if (removed.size)
		result.reconstitution = result.reconstitution.filter((row) => !removed.has(row));
	// A hand-entered description or size replaces what the correction restated.
	if (overrides.some(({ field }) => field.replacesCorrection)) result.unitOfUseCorrection = null;
	if (recomputeVolume || overrides.some(({ field }) => field.affectsVolume))
		result.resolvedVolume = resolvePackageVolume(
			result.isDryFill,
			result.size,
			result.ingredients,
			result.reconstitution
		);
	for (const { field, value } of overrides)
		if (field.correctsVolume) field.set(result, value, removed);
	if (result.resolvedVolume && !result.propertyOverrides?.['resolvedVolume.powderDisplacementMl']) {
		const { finalVolumeMl, diluentMl } = result.resolvedVolume;
		result.resolvedVolume.powderDisplacementMl =
			finalVolumeMl != null && diluentMl != null ? Math.max(0, finalVolumeMl - diluentMl) : null;
	}
	return result;
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
	if (!previous) return resolveEffectivePackage(current);
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
	return resolveEffectivePackage(merged);
}
