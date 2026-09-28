import type { ExternalPackage } from './catalog-providers';
import { resolvePackageVolume } from './catalog-facts';
import {
  RECONSTITUTION_OVERRIDE_KEY,
  parseDiluentList,
  parseRouteList
} from '../property-override-fields';

export function applyPropertyOverrides(item: ExternalPackage): ExternalPackage {
  const entries = Object.entries(item.propertyOverrides ?? {});
  if (!entries.length) return item;
  const result = structuredClone(item);
  for (const [key, { value }] of entries) {
    if (
      [
        'description',
        'brandName',
        'genericName',
        'labelerName',
        'labelerCode',
        'productCode',
        'doseForm',
        'rxcuiStatus',
        'marketingEndDate'
      ].includes(key)
    )
      Object.assign(result, { [key]: value });
    else if (['isMultiDose', 'isDryFill', 'listed', 'splPresent', 'isVeterinary'].includes(key))
      Object.assign(result, { [key]: value === 'true' });
    else if (key.startsWith('details.product.')) {
      if (result.details?.product)
        Object.assign(result.details.product, { [key.slice('details.product.'.length)]: value });
    } else if (key.startsWith('size.')) {
      if (result.size)
        Object.assign(result.size, {
          [key.slice('size.'.length)]: ['value', 'packQty'].includes(key.slice('size.'.length))
            ? Number(value)
            : value
        });
    } else {
      const match = RECONSTITUTION_OVERRIDE_KEY.exec(key);
      if (!match) continue;
      // An id that no longer matches means the label's instruction changed
      // since the override was written; it stops applying rather than landing
      // on whichever row now sits in its place.
      const row = /^\d+$/.test(match[1])
        ? result.reconstitution[Number(match[1])]
        : result.reconstitution.find((candidate) => candidate.id === match[1]);
      if (!row) continue;
      if (match[3]) {
        const concentration = row.concentrations[Number(match[3])];
        if (concentration) concentration.mgPerMl = Number(value);
      } else if (match[2] === 'routes') {
        const routes = parseRouteList(value);
        if (routes) row.routes = routes;
      } else if (match[2] === 'diluents') row.diluents = parseDiluentList(value);
      else Object.assign(row, { [match[2]]: Number(value) });
    }
  }
  // A hand-entered description or size replaces what the correction restated.
  if (entries.some(([key]) => key === 'description' || key === 'size.value' || key === 'size.unit'))
    result.unitOfUseCorrection = null;
  if (
    entries.some(
      ([key]) =>
        key === 'isDryFill' ||
        key === 'size.value' ||
        key === 'size.unit' ||
        key.startsWith('reconstitution.')
    )
  )
    result.resolvedVolume = resolvePackageVolume(
      result.isDryFill,
      result.size,
      result.ingredients,
      result.reconstitution
    );
  for (const [key, { value }] of entries) {
    if (!key.startsWith('resolvedVolume.')) continue;
    result.resolvedVolume ??= {
      meaning: 'unknown',
      finalVolumeMl: null,
      diluentMl: null,
      concentrationMgPerMl: null
    };
    const field = key.slice('resolvedVolume.'.length);
    if (field === 'meaning')
      result.resolvedVolume.meaning = value as NonNullable<
        ExternalPackage['resolvedVolume']
      >['meaning'];
    else if (
      ['diluentMl', 'finalVolumeMl', 'powderDisplacementMl', 'concentrationMgPerMl'].includes(field)
    )
      Object.assign(result.resolvedVolume, { [field]: Number(value) });
  }
  if (result.resolvedVolume && !result.propertyOverrides?.['resolvedVolume.powderDisplacementMl']) {
    const { finalVolumeMl, diluentMl } = result.resolvedVolume;
    result.resolvedVolume.powderDisplacementMl =
      finalVolumeMl != null && diluentMl != null ? Math.max(0, finalVolumeMl - diluentMl) : null;
  }
  return result;
}
