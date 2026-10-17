import type {ExternalPackage} from '$lib/server/catalog-providers';
import type {AmbiguityTag} from './labeler-ambiguity';
import {RECONSTITUTION_ROUTES, type ReconstitutionRoute} from './reconstitution-terms';
import {
  applyIngredientCorrection,
  ingredientAsCorrection,
  INGREDIENT_CORRECTION_KEY,
  ingredientCorrectionKey,
  parseIngredientCorrection,
  sameIngredientRow,
  serializeIngredientCorrection
} from './ingredient-correction';
import {guessIln} from './imprints/spl-to-iln';
import {splitShapeProportion} from './imprints/shapes';
import {validateIln} from './imprints/iln-parse';
import {toSplAppearance} from './imprints/iln-render';
import {
    COLOR_CHOICES,
    colorTerm,
    isSolidDoseForm,
    type PillAppearance,
    PROFILE_CHOICES,
    SHAPE_CODES
} from './spl-characteristics';

/** One passage of this package's SPL that an override quotes. */
export type SplPassage = {
  excerpt: string;
  sectionKey: string;
  sectionTitle: string;
  subsectionTitle: string | null;
  startOffset: number;
  endOffset: number;
};

/** How an equivalent NDC relates to the one being corrected. */
export type EquivalentRelation = 'sibling' | 'concept';

/**
 * A corrected value and what it cites: a passage of this package's SPL
 * (overrides saved before `source` existed are all SPL citations), a quoted
 * outside source, the same field of an equivalent NDC, or nothing at all.
 */
export type PropertyOverride = {
  value: string;
  createdAt: string;
  /** Why the labeler's value was wrong, when the correction names a known pattern. */
  ambiguity?: AmbiguityTag;
  /** The sibling NDC this was saved on, when copied here because the field is product-level. */
  propagatedFrom?: string;
} & (
  | {
      source?: 'spl';
      excerpt: string;
      sectionKey: string;
      sectionTitle: string;
      subsectionTitle: string | null;
      startOffset?: number;
      endOffset?: number;
      splSetId: string;
      /** Every passage cited, when more than one; the fields above repeat the first. */
      passages?: SplPassage[];
    }
  | { source: 'url'; url: string; title: string | null; excerpt: string }
  | {
      source: 'ndc';
      ndc: string;
      relation: EquivalentRelation;
      description: string | null;
    }
  | { source: 'none' }
);

/**
 * Fields that describe the product rather than one package of it, so a
 * correction applies to every package NDC of the same product: appearance,
 * ingredients, dose form, routes, names and product registration details.
 */
export const isProductLevelKey = (key: string): boolean =>
  [
    'brandName',
    'genericName',
    'labelerName',
    'labelerCode',
    'productCode',
    'doseForm',
    'splPresent',
    'isVeterinary'
  ].includes(key) ||
  key.startsWith('details.product.') ||
  key === TOTAL_SHARED_KEY ||
  key.startsWith('details.spl.appearances.') ||
  key.startsWith('details.spl.ingredients.');

/**
 * Fields that describe the unit of use (the vial, not the carton or tray of
 * vials), so a correction applies to every package of the product holding the
 * same unit: its fill, container, reconstitution and resulting volume.
 */
export const isUnitOfUseKey = (key: string): boolean =>
  ['size.kind', 'size.value', 'size.unit', 'size.container'].includes(key) ||
  key.startsWith('reconstitution.') ||
  key.startsWith('resolvedVolume.');

const SIZE_FIELDS = ['kind', 'value', 'unit', 'container'] as const;

/**
 * Whether two packages hold the same unit of use, by fill and container. A
 * field `a` corrected by hand is left out, since `b` may still show the value
 * the correction replaced.
 */
export function sameUnitOfUse(
  a: Pick<ExternalPackage, 'size' | 'propertyOverrides'>,
  b: Pick<ExternalPackage, 'size'>
): boolean {
  if (!a.size || !b.size) return false;
  const norm = (value: unknown) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value;
  return SIZE_FIELDS.every((field) => {
    const own = a.propertyOverrides?.[`size.${field}`];
    return (own && !own.propagatedFrom) || norm(a.size![field]) === norm(b.size![field]);
  });
}

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
  ['rxcuiStatus', 'RxNav NDC status'],
  ['marketingEndDate', 'Marketing end date'],
  ['details.product.productType', 'Product type'],
  ['details.product.marketingCategory', 'Marketing category'],
  ['details.product.applicationNumber', 'Application number'],
  ['details.product.deaSchedule', 'DEA schedule']
] as const;

/** Dose forms offered when correcting one; a package's own forms are offered too. */
export const DOSE_FORM_CHOICES = [
  'INJECTION',
  'INJECTION, EMULSION',
  'INJECTION, POWDER, FOR SOLUTION',
  'INJECTION, POWDER, FOR SUSPENSION',
  'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION',
  'INJECTION, SOLUTION',
  'INJECTION, SOLUTION, CONCENTRATE',
  'INJECTION, SUSPENSION',
  'TABLET',
  'TABLET, COATED',
  'TABLET, FILM COATED',
  'TABLET, EXTENDED RELEASE',
  'TABLET, CHEWABLE',
  'CAPSULE',
  'CAPSULE, EXTENDED RELEASE',
  'SOLUTION',
  'SUSPENSION',
  'POWDER, FOR SOLUTION',
  'POWDER, FOR SUSPENSION',
  'SYRUP',
  'CREAM',
  'OINTMENT',
  'GEL',
  'PATCH',
  'SPRAY',
  'AEROSOL, METERED',
  'SUPPOSITORY'
] as const;
/** Joins several dose forms into the one string a package stores; the forms hold commas. */
export const DOSE_FORM_SEPARATOR = '; ';

/** Routes of administration a package may list. */
export const ROUTE_CHOICES = [
  'INTRAVENOUS',
  'INTRAMUSCULAR',
  'SUBCUTANEOUS',
  'INTRADERMAL',
  'INTRATHECAL',
  'INTRA-ARTICULAR',
  'INTRAPERITONEAL',
  'INTRAOCULAR',
  'ORAL',
  'TOPICAL',
  'NASAL',
  'RESPIRATORY (INHALATION)',
  'OPHTHALMIC',
  'OTIC',
  'RECTAL',
  'VAGINAL',
  'BUCCAL',
  'SUBLINGUAL',
  'URETHRAL'
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
 * its position. A row the user added has an `a<n>` id: its `diluentMl`
 * override creates it. `removed` set to "true" drops the row.
 */
export const RECONSTITUTION_OVERRIDE_KEY =
  /^reconstitution\.(r[0-9a-f]{8}(?:-\d+)?|a\d+|\d+)\.(vialMassMg|diluentMl|finalVolumeMl|concentrations\.(\d+)\.mgPerMl|routes|diluents|removed)$/;

/** Whether ingredients sharing a moiety get a total row; unset follows RxNorm. */
export const TOTAL_SHARED_KEY = 'details.spl.totalSharedMoieties';

/** `details.spl.ingredients.<index>.strength`: an ingredient's labeled amount. */
export const INGREDIENT_STRENGTH_KEY = /^details\.spl\.ingredients\.(\d+)\.strength$/;

/** `details.spl.appearances.<index>.iln`: a pill's imprint layout, in ILN. */
export const PILL_ILN_KEY = /^details\.spl\.appearances\.(\d+)\.iln$/;
/** A pill's shape, which may carry a proportion: `LONG CAPSULE`, `CAPSULE 2.6:1`. */
export const PILL_SHAPE_KEY = /^details\.spl\.appearances\.(\d+)\.shape$/;
export const pillIlnKey = (index: number) => `details.spl.appearances.${index}.iln`;

/** `details.spl.appearances.<index>.<field>`: one coded fact about a pill. */
export const PILL_FIELD_KEY =
  /^details\.spl\.appearances\.(\d+)\.(colors|shape|sizeMm|score|imprint|profile)$/;
const PILL_FIELDS = [
  ['colors', 'colors'],
  ['shape', 'shape'],
  ['sizeMm', 'size (mm)'],
  ['score', 'score (pieces it divides into)'],
  ['profile', 'profile (flat, biconvex, concave…)']
] as const;
const SHAPE_CHOICES = [...new Set(Object.values(SHAPE_CODES))];
const SCORE_CHOICES = ['1', '2', '3', '4'] as const;

/** The id the next user-added reconstitution row takes. */
export function nextAddedRowId(
  item: Pick<ExternalPackage, 'reconstitution' | 'propertyOverrides'>
): string {
  const used = [
    ...item.reconstitution.map((row) => row.id ?? ''),
    ...Object.keys(item.propertyOverrides ?? {}).map((key) => key.split('.')[1] ?? '')
  ].flatMap((id) => (/^a\d+$/.test(id) ? [Number(id.slice(1))] : []));
  return `a${used.length ? Math.max(...used) + 1 : 0}`;
}

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
  item: Pick<ExternalPackage, 'reconstitution' | 'size' | 'details' | 'doseForm'> &
    Partial<Pick<ExternalPackage, 'propertyOverrides'>>
): { key: string; label: string }[] {
  return [
    ...textFields
      .filter(([key]) => !key.startsWith('details.product.') || item.details?.product)
      .map(([key, label]) => ({ key, label })),
    { key: 'manualExclusion', label: 'Formulary exclusion reason' },
    { key: 'doseForm', label: 'Dose form (choose any)' },
    ...(item.details?.product
      ? [{ key: 'details.product.routes', label: 'Routes (choose any)' }]
      : []),
    ...booleanFields.map(([key, label]) => ({ key, label })),
    ...(item.details?.spl
      ? [{ key: TOTAL_SHARED_KEY, label: 'Total ingredients sharing a moiety (true or false)' }]
      : []),
    ...(item.size
      ? [
          { key: 'size.value', label: 'Unit-of-use quantity' },
          { key: 'size.packQty', label: 'Unit-of-sale quantity' },
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
        {
          key: `${key}.concentrations.${row.concentrations.length}.mgPerMl`,
          label: `${name}: add a concentration (mg/mL)`
        },
        { key: `${key}.routes`, label: `${name}: routes (${RECONSTITUTION_ROUTES.join(', ')})` },
        { key: `${key}.diluents`, label: `${name}: diluents (e.g. SWFI, NS, lidocaine 1%)` },
        { key: `${key}.removed`, label: `${name}: remove row (true or false)` }
      ];
    }),
    {
      key: `reconstitution.${nextAddedRowId({ propertyOverrides: {}, ...item })}.diluentMl`,
      label: 'New reconstitution row: diluent to add (mL)'
    },
    ...(isSolidDoseForm(item.doseForm) ? (item.details?.spl?.appearances ?? []) : []).map(
      (appearance, index, all) => {
        const name = `Pill appearance${all.length > 1 ? ` ${index + 1}${appearance.productCode ? ` (${appearance.productCode})` : ''}` : ''}`;
        return [
          ...PILL_FIELDS.map(([field, label]) => ({
            key: `details.spl.appearances.${index}.${field}`,
            label: `${name}: ${label}`
          })),
          { key: pillIlnKey(index), label: `${name}: imprint layout (ILN)` }
        ];
      }
    ).flat(),
    ...(item.details?.spl?.ingredients ?? []).flatMap((ingredient, index) =>
      ingredient.kind === 'ionic'
        ? []
        : [
            {
              key: `details.spl.ingredients.${index}.strength`,
              label: `${ingredient.name} (${ingredient.kind}): strength`
            },
            ...(ingredient.kind === 'active'
              ? [
                  {
                    key: ingredientCorrectionKey(index),
                    label: `${ingredient.name}: ingredient correction`
                  }
                ]
              : [])
          ]
    )
  ];
}

/** How a numeric field is typed: the unit it is stored in and its bounds. */
export type OverrideQuantity = {
  unit: string | null;
  integer: boolean;
  min: number;
  exclusiveMin: boolean;
};

type Pkg = Omit<ExternalPackage, 'splXml' | 'evidence'>;

/** Everything one override key means: how its value is read, checked and applied. */
export type OverrideField = {
  /** Fixed choices, or null when it takes free text or a number. */
  choices: readonly string[] | null;
  /** Set when several of the choices may be picked; the value joins them with this. */
  separator?: string;
  /** The quantity a numeric field takes, or null for a text or choice field. */
  quantity: (item: Pick<ExternalPackage, 'size'>) => OverrideQuantity | null;
  valid: (value: string) => boolean;
  /** The value the page currently shows, as override text. */
  get: (item: Pkg) => string | null;
  /** Write the value onto a copy being corrected; a removed row goes in `removed`. */
  set: (item: Pkg, value: string, removed: Set<ReconRow>) => void;
  /** Invalidates the resolved volume, which is then worked out again. */
  affectsVolume?: boolean;
  /** Replaces what a salt-to-moiety unit-of-use correction restated. */
  replacesCorrection?: boolean;
  /** Applies after the other overrides, so it wins over them on what they share. */
  appliesLast?: boolean;
  /** Whether an equivalent NDC's value stands for `corrected`, where it need not be identical. */
  matches?: (equivalent: string, corrected: string) => boolean;
  /** Corrects the resolved volume itself, so it applies after that is worked out. */
  correctsVolume?: boolean;
};

const BOOLEAN = ['true', 'false'] as const;
const VOLUME_MEANINGS = ['final', 'diluent', 'capacity', 'unknown'] as const;

const text = (value: unknown) => (value == null ? null : String(value));
const isText = (max: number) => (value: string) => !!value.trim() && value.length <= max;
const isBoolean = (value: string) => value === 'true' || value === 'false';
const positive = (unit: string | null, integer = false): OverrideQuantity => ({
  unit,
  integer,
  min: 0,
  exclusiveMin: true
});

const field = (
  spec: Pick<OverrideField, 'valid' | 'get' | 'set'> & Partial<OverrideField>
): OverrideField => ({ choices: null, quantity: () => null, ...spec });

/** A numeric field, valid within the bounds its quantity states. */
const numberField = (
  quantity: OverrideQuantity | ((item: Pick<ExternalPackage, 'size'>) => OverrideQuantity),
  spec: Pick<OverrideField, 'get' | 'set'> & Partial<OverrideField>
): OverrideField => {
  const quantityOf = typeof quantity === 'function' ? quantity : () => quantity;
  const { min, exclusiveMin } = quantityOf({ size: null });
  return field({
    quantity: quantityOf,
    valid: (value) =>
      value.trim() !== '' &&
      Number.isFinite(Number(value)) &&
      (exclusiveMin ? Number(value) > min : Number(value) >= min),
    ...spec
  });
};

const TEXT_KEYS = new Set<string>(textFields.map(([key]) => key));
const BOOLEAN_KEYS = new Set<string>(booleanFields.map(([key]) => key));
const PRODUCT_PREFIX = 'details.product.';

/** A value that joins several entries with `separator`. */
export const splitMulti = (value: string, separator: string): string[] =>
  value
    .split(separator.trim())
    .map((entry) => entry.trim())
    .filter(Boolean);

function resolveField(key: string): OverrideField | null {
  if (key === 'manualExclusion')
    return field({
      valid: isText(500),
      get: (item) => text(item.manualExclusion),
      set: (item, value) => Object.assign(item, { manualExclusion: value })
    });
  if (key === 'doseForm')
    return field({
      choices: DOSE_FORM_CHOICES,
      separator: DOSE_FORM_SEPARATOR,
      valid: (value) => isText(500)(value) && splitMulti(value, DOSE_FORM_SEPARATOR).length > 0,
      get: (item) => text(item.doseForm),
      set: (item, value) => {
        item.doseForm = splitMulti(value, DOSE_FORM_SEPARATOR).join(DOSE_FORM_SEPARATOR);
      }
    });
  if (key === 'details.product.routes')
    return field({
      choices: ROUTE_CHOICES,
      separator: ', ',
      valid: (value) => isText(500)(value) && splitMulti(value, ',').length > 0,
      get: (item) => item.details?.product?.routes?.join(', ') ?? null,
      set: (item, value) => {
        if (item.details?.product) item.details.product.routes = splitMulti(value, ',');
      }
    });
  if (TEXT_KEYS.has(key)) {
    if (key.startsWith(PRODUCT_PREFIX)) {
      const name = key.slice(PRODUCT_PREFIX.length) as keyof NonNullable<
        NonNullable<ExternalPackage['details']>['product']
      >;
      return field({
        valid: isText(500),
        get: (item) => text(item.details?.product?.[name]),
        set: (item, value) => {
          if (item.details?.product) Object.assign(item.details.product, { [name]: value });
        }
      });
    }
    return field({
      valid: isText(500),
      get: (item) => text(item[key as keyof Pkg]),
      set: (item, value) => Object.assign(item, { [key]: value }),
      replacesCorrection: key === 'description'
    });
  }
  if (key === TOTAL_SHARED_KEY)
    return field({
      choices: BOOLEAN,
      valid: isBoolean,
      get: (item) => {
        const value = item.details?.spl?.totalSharedMoieties;
        return value === undefined ? null : String(value);
      },
      set: (item, value) => {
        if (item.details?.spl) item.details.spl.totalSharedMoieties = value === 'true';
      }
    });
  if (BOOLEAN_KEYS.has(key))
    return field({
      choices: BOOLEAN,
      valid: isBoolean,
      get: (item) => text(item[key as keyof Pkg]),
      set: (item, value) => Object.assign(item, { [key]: value === 'true' }),
      affectsVolume: key === 'isDryFill'
    });

  const size = /^size\.(value|packQty|container|unit)$/.exec(key)?.[1] as
    keyof NonNullable<ExternalPackage['size']> | undefined;
  if (size) {
    const numeric = size === 'value' || size === 'packQty';
    const spec = {
      get: (item: Pkg) => text(item.size?.[size]),
      set: (item: Pkg, value: string) => {
        if (item.size) Object.assign(item.size, { [size]: numeric ? Number(value) : value });
      },
      // The quantity and unit are what the volume and the salt correction read.
      affectsVolume: size === 'value' || size === 'unit',
      replacesCorrection: size === 'value' || size === 'unit'
    };
    if (size === 'value') return numberField((item) => positive(item.size?.unit ?? null), spec);
    if (size === 'packQty') return numberField(positive(null, true), spec);
    return field({ valid: isText(500), ...spec });
  }

  const volume = /^resolvedVolume\.(\w+)$/.exec(key)?.[1];
  if (volume) {
    const target = (item: Pkg) =>
      (item.resolvedVolume ??= {
        meaning: 'unknown',
        finalVolumeMl: null,
        diluentMl: null,
        concentrationMgPerMl: null
      });
    const get = (item: Pkg) =>
      text(item.resolvedVolume?.[volume as keyof NonNullable<ExternalPackage['resolvedVolume']>]);
    if (volume === 'meaning')
      return field({
        choices: VOLUME_MEANINGS,
        valid: (value) => (VOLUME_MEANINGS as readonly string[]).includes(value),
        get,
        set: (item, value) => {
          target(item).meaning = value as (typeof VOLUME_MEANINGS)[number];
        },
        correctsVolume: true
      });
    const quantity =
      volume === 'powderDisplacementMl'
        ? { ...positive('mL'), exclusiveMin: false }
        : volume === 'concentrationMgPerMl'
          ? positive('mg/mL')
          : volume === 'diluentMl' || volume === 'finalVolumeMl'
            ? positive('mL')
            : null;
    if (!quantity) return null;
    return numberField(quantity, {
      get,
      set: (item, value) => Object.assign(target(item), { [volume]: Number(value) }),
      correctsVolume: true
    });
  }

  const pill = PILL_ILN_KEY.exec(key);
  if (pill) {
    const index = Number(pill[1]);
    return field({
      valid: (value) => value.length <= 500 && validateIln(value).ok,
      // What the mockup draws without an override: the guess from SPL.
      get: (item) => {
        const appearance = item.details?.spl?.appearances[index];
        if (!appearance) return null;
        return appearance.iln ?? guessIln(toSplAppearance(appearance, item.doseForm)).iln;
      },
      set: (item, value) => {
        const appearance = item.details?.spl?.appearances[index];
        if (appearance) appearance.iln = value.trim();
      }
    });
  }

  const pillField = PILL_FIELD_KEY.exec(key);
  if (pillField) {
    const index = Number(pillField[1]);
    const name = pillField[2] as (typeof PILL_FIELDS)[number][0] | 'imprint';
    const appearanceOf = (item: Pkg) => item.details?.spl?.appearances[index];
    const mark = (appearance: PillAppearance) => {
      appearance.overridden = [...new Set([...(appearance.overridden ?? []), name])];
    };
    const set = (apply: (appearance: PillAppearance, value: string) => void) => (item: Pkg, value: string) => {
      const appearance = appearanceOf(item);
      if (!appearance) return;
      apply(appearance, value.trim());
      mark(appearance);
    };
    switch (name) {
      case 'colors':
        return field({
          choices: COLOR_CHOICES,
          separator: ', ',
          valid: (value) => isText(200)(value) && splitMulti(value, ',').length > 0,
          get: (item) => appearanceOf(item)?.colors.join(', ') || null,
          set: set((appearance, value) => {
            appearance.colors = splitMulti(value, ',')
              .map(colorTerm)
              .filter((color): color is string => !!color);
            appearance.colorText = null;
          })
        });
      case 'shape':
        return field({
          choices: SHAPE_CHOICES,
          // A capsule outline may also state its proportion (`LONG CAPSULE`, `CAPSULE 2.6:1`).
          valid: (value) => {
            const {base, error} = splitShapeProportion(value);
            return !error && SHAPE_CHOICES.includes(base);
          },
          get: (item) => appearanceOf(item)?.shape ?? null,
          set: set((appearance, value) => {
            appearance.shape = value;
            appearance.shapeCode = null;
            appearance.shapeText = null;
          })
        });
      case 'sizeMm':
        return numberField(positive('mm'), {
          get: (item) => text(appearanceOf(item)?.sizeMm),
          set: set((appearance, value) => (appearance.sizeMm = Number(value)))
        });
      case 'score':
        return field({
          choices: SCORE_CHOICES,
          valid: (value) => (SCORE_CHOICES as readonly string[]).includes(value),
          get: (item) => text(appearanceOf(item)?.score),
          set: set((appearance, value) => (appearance.score = Number(value)))
        });
      case 'profile':
        return field({
          choices: PROFILE_CHOICES,
          valid: isText(100),
          get: (item) => appearanceOf(item)?.profile ?? null,
          set: set((appearance, value) => (appearance.profile = value))
        });
      // No longer offered (the ILN carries the imprint); kept so saved overrides still apply.
      case 'imprint':
        return field({
          valid: isText(200),
          get: (item) => appearanceOf(item)?.imprint ?? null,
          set: set((appearance, value) => (appearance.imprint = value))
        });
    }
  }

  const ingredient = INGREDIENT_STRENGTH_KEY.exec(key);
  if (ingredient) {
    const index = Number(ingredient[1]);
    return field({
      valid: isText(200),
      get: (item) => item.details?.spl?.ingredients[index]?.strength ?? null,
      set: (item, value) => {
        const target = item.details?.spl?.ingredients[index];
        if (!target) return;
        // The catalog's own ingredient list drives volume rules; keep it in step.
        for (const listed of item.ingredients)
          if (listed.name.toLowerCase() === target.name.toLowerCase()) listed.strength = value;
        target.strength = value;
      },
      affectsVolume: true
    });
  }

  const correction = INGREDIENT_CORRECTION_KEY.exec(key);
  if (correction) {
    const index = Number(correction[1]);
    return field({
      valid: (value) => value.length <= 4000 && parseIngredientCorrection(value) !== null,
      // The row as it reads now, in the correction's shape.
      get: (item) => {
        const row = item.details?.spl?.ingredients[index];
        const read = row && ingredientAsCorrection(row);
        return read ? serializeIngredientCorrection(read) : null;
      },
      set: (item, value) => {
        const target = item.details?.spl?.ingredients[index];
        const parsed = parseIngredientCorrection(value);
        if (target && parsed) applyIngredientCorrection(target, item.ingredients, parsed);
      },
      matches: (equivalent, corrected) => {
        const a = parseIngredientCorrection(equivalent);
        const b = parseIngredientCorrection(corrected);
        return !!a && !!b && sameIngredientRow(a, b);
      },
      affectsVolume: true,
      appliesLast: true
    });
  }

  const reconstitution = RECONSTITUTION_OVERRIDE_KEY.exec(key);
  if (reconstitution) {
    const [, id, name, concentration] = reconstitution;
    // An id that no longer matches means the label's instruction changed since
    // the override was written; it stops applying rather than landing on
    // whichever row now sits in its place.
    const rowOf = (item: Pick<Pkg, 'reconstitution'>) =>
      /^\d+$/.test(id)
        ? item.reconstitution[Number(id)]
        : item.reconstitution.find((row) => row.id === id);
    const onRow =
      (write: (row: ReconRow, value: string, removed: Set<ReconRow>) => void) =>
      (item: Pkg, value: string, removed: Set<ReconRow>) => {
        const row = rowOf(item);
        if (row) write(row, value, removed);
      };
    if (name === 'removed')
      return field({
        choices: BOOLEAN,
        valid: isBoolean,
        get: (item) => (rowOf(item) ? 'false' : null),
        set: onRow((row, value, removed) => {
          if (value === 'true') removed.add(row);
        }),
        affectsVolume: true
      });
    if (name === 'routes')
      return field({
        choices: RECONSTITUTION_ROUTES,
        separator: ', ',
        valid: (value) => parseRouteList(value) !== null,
        get: (item) => rowOf(item)?.routes?.join(', ') ?? null,
        set: onRow((row, value) => {
          const routes = parseRouteList(value);
          if (routes) row.routes = routes;
        }),
        affectsVolume: true
      });
    if (name === 'diluents')
      return field({
        valid: (value) => parseDiluentList(value).length > 0 && value.length <= 200,
        get: (item) => rowOf(item)?.diluents?.join(', ') ?? null,
        set: onRow((row, value) => {
          row.diluents = parseDiluentList(value);
        }),
        affectsVolume: true
      });
    if (concentration !== undefined) {
      const index = Number(concentration);
      return numberField(positive('mg/mL'), {
        get: (item) => text(rowOf(item)?.concentrations[index]?.mgPerMl),
        set: onRow((row, value) => {
          const existing = row.concentrations[index];
          if (existing) existing.mgPerMl = Number(value);
          else if (index === row.concentrations.length)
            row.concentrations.push({ name: null, mgPerMl: Number(value) });
        }),
        affectsVolume: true
      });
    }
    const amount = name as 'vialMassMg' | 'diluentMl' | 'finalVolumeMl';
    return numberField(positive(amount === 'vialMassMg' ? 'mg' : 'mL'), {
      get: (item) => text(rowOf(item)?.[amount]),
      set: onRow((row, value) => {
        row[amount] = Number(value);
      }),
      affectsVolume: true
    });
  }
  return null;
}

const resolved = new Map<string, OverrideField | null>();

/** What an override key means, or null for a key no field answers to. */
export function overrideField(key: string): OverrideField | null {
  if (!resolved.has(key)) resolved.set(key, resolveField(key));
  return resolved.get(key)!;
}

/** Fixed choices for a field, or null when it takes free text or a number. */
export const overrideChoices = (key: string): readonly string[] | null =>
  overrideField(key)?.choices ?? null;

/** The separator of a field that takes several of its choices, or null for a single value. */
export const overrideSeparator = (key: string): string | null =>
  overrideField(key)?.separator ?? null;

/** The quantity a numeric override takes, or null for a text or choice field. */
export const overrideQuantity = (
  key: string,
  item: Pick<ExternalPackage, 'size'>
): OverrideQuantity | null => overrideField(key)?.quantity(item) ?? null;

/** The value the page currently shows for `key`, as override text. */
export const overrideCurrentValue = (item: Pkg, key: string): string | null =>
  overrideField(key)?.get(item) ?? null;

export const validOverrideValue = (key: string, value: string): boolean =>
  overrideField(key)?.valid(value) ?? false;

/**
 * `source`'s value for each of `item`'s overridable fields. A reconstitution
 * row is matched by content id, or failing that by position, since equivalent
 * labels often word the same instruction differently.
 */
export function equivalentValues(item: Pkg, source: Pkg): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { key } of overrideTargets(item)) {
    // Adding or removing a row is the user's call, not something to copy.
    if (key.endsWith('.removed') || /^reconstitution\.a\d+\./.test(key)) continue;
    // Another product's guessed layout says nothing; only a saved one is worth copying.
    const pill = PILL_ILN_KEY.exec(key);
    if (pill && !source.details?.spl?.appearances[Number(pill[1])]?.iln) continue;
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
