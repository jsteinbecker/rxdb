import type { ExternalPackage } from '$lib/server/catalog-providers';
import { RECONSTITUTION_ROUTES, type ReconstitutionRoute } from './reconstitution-terms';

/** How an equivalent NDC relates to the one being corrected. */
export type EquivalentRelation = 'sibling' | 'concept';

/**
 * A corrected value and what it cites: a passage of this package's SPL
 * (overrides saved before `source` existed are all SPL citations), a quoted
 * outside source, or the same field of an equivalent NDC.
 */
export type PropertyOverride = { value: string; createdAt: string } & (
  | {
      source?: 'spl';
      excerpt: string;
      sectionKey: string;
      sectionTitle: string;
      subsectionTitle: string | null;
      startOffset?: number;
      endOffset?: number;
      splSetId: string;
    }
  | { source: 'url'; url: string; title: string | null; excerpt: string }
  | {
      source: 'ndc';
      ndc: string;
      relation: EquivalentRelation;
      description: string | null;
    }
);

/** An NDC whose values may stand in for this one's, with each overridable value it has. */
export type EquivalentPackage = {
  ndc: string;
  relation: EquivalentRelation;
  description: string | null;
  labelerName: string | null;
  values: Record<string, string>;
};

const textFields = [
  ['description', 'Package description'],
  ['brandName', 'Brand name'],
  ['genericName', 'Generic name'],
  ['labelerName', 'Labeler'],
  ['labelerCode', 'Labeler code'],
  ['productCode', 'Product NDC'],
  ['doseForm', 'Dose form'],
  ['rxcuiStatus', 'RxNav NDC status'],
  ['marketingEndDate', 'Marketing end date'],
  ['details.product.productType', 'Product type'],
  ['details.product.marketingCategory', 'Marketing category'],
  ['details.product.applicationNumber', 'Application number'],
  ['details.product.deaSchedule', 'DEA schedule']
] as const;
const booleanFields = [
  ['isMultiDose', 'Multi-dose (true or false)'],
  ['isDryFill', 'Dry fill (true or false)'],
  ['listed', 'FDA NDC listing (true or false)'],
  ['splPresent', 'SPL presence (true or false)'],
  ['isVeterinary', 'Veterinary (true or false)']
] as const;
const volumeFields = [
  ['resolvedVolume.diluentMl', 'Diluent volume (mL)'],
  ['resolvedVolume.finalVolumeMl', 'Resulting volume (mL)'],
  ['resolvedVolume.powderDisplacementMl', 'Powder displacement (mL)'],
  ['resolvedVolume.concentrationMgPerMl', 'Resulting concentration (mg/mL)']
] as const;

/**
 * `reconstitution.<row>.<field>`. The row is its content id (`r1a2b3c4d`), or
 * — for rows saved before rows had ids, and overrides written against them —
 * its position.
 */
export const RECONSTITUTION_OVERRIDE_KEY =
  /^reconstitution\.(r[0-9a-f]{8}(?:-\d+)?|\d+)\.(vialMassMg|diluentMl|finalVolumeMl|concentrations\.(\d+)\.mgPerMl|routes|diluents)$/;

/** Route codes from an override value like "IM, IV", or null if any is unknown. */
export function parseRouteList(value: string): ReconstitutionRoute[] | null {
  const codes = value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((code) => code.toUpperCase());
  return codes.length &&
    codes.every((code) => (RECONSTITUTION_ROUTES as readonly string[]).includes(code))
    ? RECONSTITUTION_ROUTES.filter((route) => codes.includes(route))
    : null;
}

/** Diluents from an override value like "SWFI, NS". */
export const parseDiluentList = (value: string): string[] => [
  ...new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
];

type ReconRow = ExternalPackage['reconstitution'][number];
const describeRow = (row: ReconRow, index: number) =>
  `Reconstitution ${index + 1} (${[
    row.routes?.join('/'),
    `${row.diluentMl} mL`,
    row.diluents?.join(' or ')
  ]
    .filter(Boolean)
    .join(' · ')})`;

export function overrideTargets(
  item: Pick<ExternalPackage, 'reconstitution' | 'size' | 'details'>
): { key: string; label: string }[] {
  return [
    ...textFields
      .filter(([key]) => !key.startsWith('details.product.') || item.details?.product)
      .map(([key, label]) => ({ key, label })),
    ...booleanFields.map(([key, label]) => ({ key, label })),
    ...(item.size
      ? [
          { key: 'size.value', label: 'Unit-of-use quantity' },
          { key: 'size.packQty', label: 'Containers per package' },
          { key: 'size.container', label: 'Unit-of-use container' },
          { key: 'size.unit', label: 'Unit-of-use unit' }
        ]
      : []),
    ...volumeFields.map(([key, label]) => ({ key, label })),
    {
      key: 'resolvedVolume.meaning',
      label: 'Package volume meaning (final, diluent, capacity, unknown)'
    },
    ...item.reconstitution.flatMap((row, index) => {
      const key = `reconstitution.${row.id ?? index}`;
      const name = describeRow(row, index);
      return [
        { key: `${key}.vialMassMg`, label: `${name}: vial content (mg)` },
        { key: `${key}.diluentMl`, label: `${name}: diluent (mL)` },
        { key: `${key}.finalVolumeMl`, label: `${name}: resulting volume (mL)` },
        ...row.concentrations.map((_, concentration) => ({
          key: `${key}.concentrations.${concentration}.mgPerMl`,
          label: `${name}: concentration ${concentration + 1} (mg/mL)`
        })),
        { key: `${key}.routes`, label: `${name}: routes (${RECONSTITUTION_ROUTES.join(', ')})` },
        { key: `${key}.diluents`, label: `${name}: diluents (e.g. SWFI, NS, lidocaine 1%)` }
      ];
    })
  ];
}

/** Fixed choices for a field, or null when it takes free text or a number. */
export function overrideChoices(key: string): string[] | null {
  if (booleanFields.some(([field]) => field === key)) return ['true', 'false'];
  if (key === 'resolvedVolume.meaning') return ['final', 'diluent', 'capacity', 'unknown'];
  return null;
}

/** How a numeric field is typed: the unit it is stored in and its bounds. */
export type OverrideQuantity = {
  unit: string | null;
  integer: boolean;
  min: number;
  exclusiveMin: boolean;
};

/** The quantity a numeric override takes, or null for a text or choice field. */
export function overrideQuantity(
  key: string,
  item: Pick<ExternalPackage, 'size'>
): OverrideQuantity | null {
  const positive = (unit: string | null, integer = false): OverrideQuantity => ({
    unit,
    integer,
    min: 0,
    exclusiveMin: true
  });
  if (key === 'size.packQty') return positive(null, true);
  if (key === 'size.value') return positive(item.size?.unit ?? null);
  if (key === 'resolvedVolume.powderDisplacementMl')
    return { ...positive('mL'), exclusiveMin: false };
  if (key === 'resolvedVolume.concentrationMgPerMl') return positive('mg/mL');
  if (volumeFields.some(([field]) => field === key)) return positive('mL');
  const reconField = RECONSTITUTION_OVERRIDE_KEY.exec(key)?.[2];
  if (reconField === 'vialMassMg') return positive('mg');
  if (reconField === 'diluentMl' || reconField === 'finalVolumeMl') return positive('mL');
  if (reconField?.startsWith('concentrations.')) return positive('mg/mL');
  return null;
}

/** The value the page currently shows for `key`, as override text. */
export function overrideCurrentValue(
  item: Omit<ExternalPackage, 'splXml' | 'evidence'>,
  key: string
): string | null {
  const text = (value: unknown) => (value == null ? null : String(value));
  if (key.startsWith('details.product.'))
    return text(
      item.details?.product?.[
        key.slice('details.product.'.length) as keyof NonNullable<
          NonNullable<ExternalPackage['details']>['product']
        >
      ]
    );
  if (key.startsWith('size.'))
    return text(
      item.size?.[key.slice('size.'.length) as keyof NonNullable<ExternalPackage['size']>]
    );
  if (key.startsWith('resolvedVolume.'))
    return text(
      item.resolvedVolume?.[
        key.slice('resolvedVolume.'.length) as keyof NonNullable<ExternalPackage['resolvedVolume']>
      ]
    );
  const match = RECONSTITUTION_OVERRIDE_KEY.exec(key);
  if (match) {
    const row = /^\d+$/.test(match[1])
      ? item.reconstitution[Number(match[1])]
      : item.reconstitution.find((candidate) => candidate.id === match[1]);
    if (!row) return null;
    if (match[3]) return text(row.concentrations[Number(match[3])]?.mgPerMl);
    if (match[2] === 'routes' || match[2] === 'diluents') return row[match[2]]?.join(', ') ?? null;
    return text(row[match[2] as 'vialMassMg' | 'diluentMl' | 'finalVolumeMl']);
  }
  return text((item as unknown as Record<string, unknown>)[key]);
}

/**
 * `source`'s value for each of `item`'s overridable fields. A reconstitution
 * row is matched by content id, or failing that by position, since equivalent
 * labels often word the same instruction differently.
 */
export function equivalentValues(
  item: Omit<ExternalPackage, 'splXml' | 'evidence'>,
  source: Omit<ExternalPackage, 'splXml' | 'evidence'>
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { key } of overrideTargets(item)) {
    let value = overrideCurrentValue(source, key);
    const match = value == null ? RECONSTITUTION_OVERRIDE_KEY.exec(key) : null;
    if (match) {
      const index = /^\d+$/.test(match[1])
        ? Number(match[1])
        : item.reconstitution.findIndex((row) => row.id === match[1]);
      const row = source.reconstitution[index];
      if (row) value = overrideCurrentValue(source, key.replace(match[1], row.id ?? String(index)));
    }
    if (value != null && value.trim() !== '' && validOverrideValue(key, value)) values[key] = value;
  }
  return values;
}

export function validOverrideValue(key: string, value: string): boolean {
  if (
    textFields.some(([field]) => field === key) ||
    key === 'size.container' ||
    key === 'size.unit'
  )
    return !!value.trim() && value.length <= 500;
  if (booleanFields.some(([field]) => field === key)) return value === 'true' || value === 'false';
  if (key === 'resolvedVolume.meaning')
    return ['final', 'diluent', 'capacity', 'unknown'].includes(value);
  const reconField = RECONSTITUTION_OVERRIDE_KEY.exec(key)?.[2];
  if (reconField === 'routes') return parseRouteList(value) !== null;
  if (reconField === 'diluents') return parseDiluentList(value).length > 0 && value.length <= 200;
  if (
    volumeFields.some(([field]) => field === key) ||
    key === 'size.value' ||
    key === 'size.packQty' ||
    reconField !== undefined
  )
    return (
      Number.isFinite(Number(value)) &&
      (key === 'resolvedVolume.powderDisplacementMl' ? Number(value) >= 0 : Number(value) > 0) &&
      value.trim() !== ''
    );
  return false;
}
