import type { ExternalPackage } from './catalog-providers';
import { resolvePackageVolume } from './catalog-facts';
import { overrideField } from '../property-override-fields';

export function applyPropertyOverrides(item: ExternalPackage): ExternalPackage {
  const entries = Object.entries(item.propertyOverrides ?? {});
  if (!entries.length) return item;
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
  if (overrides.some(({ field }) => field.affectsVolume))
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
