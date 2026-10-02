import type { UnitOfUseSize } from './ndc-packaging';
import { hierarchyDoseForm } from './formulary-hierarchy';
import { withBiosimilarSuffix } from './biosimilar';
import { ingredientGroup } from './ingredient-group';
import { absoluteFillStrength, pharmacyBulkFillMl } from './ingredient-content';
import { mgPer } from './units';

type Ingredient = { name: string; strength: string | null };

/** The package facts a title is built from; every field is optional. */
export type PackageTitleSource = {
  ndc?: string;
  description?: string | null;
  doseForm?: string | null;
  brandName?: string | null;
  genericName?: string | null;
  labelerName?: string | null;
  ingredients?: Ingredient[] | null;
  size?: UnitOfUseSize | null;
  isMultiDose?: boolean | null;
  isDryFill?: boolean | null;
  splTitle?: string | null;
  details?: {
    rxnav?: { conceptName?: string | null } | null;
    spl?: { ingredients: { name: string; kind: string; strength: string | null }[] } | null;
  } | null;
};

/**
 * The package's active ingredients with the strengths its NDC page shows: the
 * label's corrected figure (the active moiety, per vial rather than per the
 * directory's `1 g/20mL` or salt `1.13 g/1`) where the label lists that
 * ingredient, else the directory's, read per vial for a dry fill.
 */
export function correctedIngredients(item: PackageTitleSource): Ingredient[] {
  // A biosimilar is its own ingredient: `ADALIMUMAB` on a product whose generic
  // name is `adalimumab-adaz` reads `ADALIMUMAB-ADAZ`, never the reference's.
  const texts = [
    item.genericName,
    item.splTitle,
    item.details?.rxnav?.conceptName,
    ...(item.details?.spl?.ingredients ?? []).map((ingredient) => ingredient.name)
  ];
  const named = (ingredient: Ingredient): Ingredient => ({
    ...ingredient,
    name: withBiosimilarSuffix(ingredient.name, texts)
  });
  const spl = (item.details?.spl?.ingredients ?? [])
    .filter((ingredient) => ingredient.kind === 'active')
    // The substance name, as the FDA directory gives it; the hierarchy groups
    // salts itself, and a moiety name reads `POTASSIUM CATION` for an electrolyte.
    .map((ingredient) => named({ name: ingredient.name, strength: ingredient.strength }));
  if (!item.ingredients?.length) return spl;
  const size = item.size;
  const fillVolumeMl = size?.kind === 'volume' ? size.value * (size.unit === 'L' ? 1000 : 1) : null;
  const bulkFillMl = pharmacyBulkFillMl(item.description ?? size?.container, fillVolumeMl);
  const key = (name: string) => ingredientGroup(name).toLowerCase();
  const labeled = new Map(
    spl.flatMap((entry) => (entry.strength ? [[key(entry.name), entry.strength] as const] : []))
  );
  return item.ingredients.map(named).map((ingredient) => ({
    name: ingredient.name,
    strength:
      labeled.get(key(ingredient.name)) ??
      (item.isDryFill
        ? absoluteFillStrength(ingredient.strength, bulkFillMl, fillVolumeMl)
        : ingredient.strength)
  }));
}

const UNITS: Record<string, string> = {
  '[iu]': 'units',
  iu: 'units',
  "[usp'u]": 'USP units',
  "[hp'_x]": 'X',
  '[pnu]': 'PNU',
  ug: 'mcg',
  µg: 'mcg',
  ml: 'mL',
  l: 'L',
  meq: 'mEq',
  mmol: 'mmol'
};
const MEASURE = /^(?:m?g|mcg|k?g|ml|l|oz|cm2?|actuat|\[?iu\]?)$/i;

/** RxNorm leads a time-release name with its period: "24 HR metoprolol …". */
const LEADING_PERIOD = /^(\d+(?:\.\d+)?\s*(?:HR|HOURS?|DAYS?|WEEKS?|MONTHS?))\s+/i;

/**
 * Moves RxNorm's leading release period behind the release modifier of the
 * dose form: "24 HR metoprolol succinate 100 MG Extended Release Oral Tablet"
 * → "metoprolol succinate 100 MG Extended Release (24 HR) Oral Tablet".
 */
export function timeReleaseAfterRelease(name: string): string {
  const period = name.match(LEADING_PERIOD)?.[1];
  if (!period) return name;
  const rest = name.replace(LEADING_PERIOD, '');
  const placed = rest.replace(
    /\b(Extended|Delayed|Controlled|Sustained)([- ]Release)\b/i,
    `$1$2 (${period.toUpperCase()})`
  );
  return placed === rest ? `${rest} (${period.toUpperCase()})` : placed;
}

const unitText = (unit: string) => UNITS[unit.toLowerCase()] ?? unit.toLowerCase();
const number = (value: number) => String(Number(value.toPrecision(6)));

/**
 * "1.25 g/250mL" → "1.25 g/250 mL", "80 mg/1" → "80 mg", "1000 mg/1 VIAL" →
 * "1 g". An absolute amount in a liquid package reads over the package volume,
 * so a vial's `1000 [iU]` shows as "1000 units/10 mL".
 */
function strengthText(strength: string, volume: { value: number; unit: string } | null) {
  const match = strength
    .trim()
    .match(/^([\d.,]+)\s*([^\s\d/][^/]*?)\s*(?:\/\s*([\d.]*)\s*([^\d\s][^/]*?)?\s*)?$/);
  if (!match) return strength.trim();
  let value = Number(match[1].replace(/,/g, ''));
  let unit = unitText(match[2]);
  if (!Number.isFinite(value)) return strength.trim();
  // A sub-gram mass of a gram or more reads in grams; kg stays as written.
  const mg = mgPer(unit);
  if (mg !== null && mg < 1000 && value * mg >= 1000) {
    value = (value * mg) / 1000;
    unit = 'g';
  }
  const perUnit = match[4]?.trim();
  // "/1", "/1 VIAL", "/1 TABLET": one dose unit adds nothing to the label.
  const per =
    perUnit && MEASURE.test(perUnit)
      ? `/${match[3] && Number(match[3]) !== 1 ? `${number(Number(match[3]))} ` : ''}${unitText(perUnit)}`
      : !perUnit && !match[3] && volume
        ? `/${number(volume.value)} ${volume.unit}`
        : '';
  return `${number(value)} ${unit}${per}`;
}

const isConcentration = (strength: string | null) => {
  const per = strength?.match(/\/\s*[\d.]*\s*([^\d\s/][^/]*?)\s*$/)?.[1];
  return !!per && MEASURE.test(per);
};

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const brandCase = (value: string) =>
  value === value.toUpperCase()
    ? value.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, lead, char) => lead + char.toUpperCase())
    : value;

/**
 * "Vancomycin 1.25 g/250 mL injection, solution" from the package's own
 * ingredients and dose form, led by its brand when that is a real brand name
 * ("Humulin R (insulin human 100 units/mL) …") rather than the generic.
 */
function generatedName(item: PackageTitleSource): string | null {
  // A concentration the directory states ("100 mg/5mL", ".7 mL/mL") reads
  // better than the label's per-package total; a dry fill has no concentration
  // until it is reconstituted, and a per-unit figure ("1.13 g/1") takes the
  // label's moiety correction.
  const stated = new Map(
    (item.isDryFill
      ? []
      : (item.ingredients ?? []).map((ingredient) => ({
          ...ingredient,
          name: withBiosimilarSuffix(ingredient.name, [
            item.genericName,
            item.splTitle,
            item.details?.rxnav?.conceptName
          ])
        }))
    ).flatMap((ingredient) =>
      isConcentration(ingredient.strength)
        ? [[ingredientGroup(ingredient.name).toLowerCase(), ingredient.strength!] as const]
        : []
    )
  );
  const ingredients = correctedIngredients(item)
    .filter((ingredient) => ingredient.name.trim())
    .map((ingredient) => ({
      ...ingredient,
      strength: stated.get(ingredientGroup(ingredient.name).toLowerCase()) ?? ingredient.strength
    }));
  if (!ingredients.length) return null;

  const size = item.size;
  // A dry fill's stated volume is the vial's, not the solution's.
  const volume =
    size?.kind === 'volume' && size.unit && !item.isDryFill
      ? { value: size.value, unit: size.unit }
      : null;
  const actives = ingredients
    .map((ingredient) =>
      [
        ingredient.name.trim().toLowerCase(),
        ingredient.strength?.trim() ? strengthText(ingredient.strength, volume) : null
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join(' / ');

  let doseForm = item.doseForm?.trim() ? hierarchyDoseForm(item.doseForm).toLowerCase() : null;
  const period = item.details?.rxnav?.conceptName?.trim().match(LEADING_PERIOD)?.[1];
  if (doseForm && period && !doseForm.includes('(')) {
    doseForm = timeReleaseAfterRelease(`${period} ${doseForm}`);
  }

  const brand = item.brandName?.trim();
  const generic = [item.genericName, ...ingredients.map((ingredient) => ingredient.name)]
    .filter((name): name is string => !!name?.trim())
    .flatMap((name) => [normalized(name), normalized(ingredientGroup(name))]);
  const isBrand = !!brand && !generic.some((name) => name.includes(normalized(brand)));

  const name = isBrand
    ? `${brandCase(brand!)} (${actives})${doseForm ? ` ${doseForm}` : ''}`
    : `${actives}${doseForm ? ` ${doseForm}` : ''}`;
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

/**
 * A readable NDC title generated from the package's ingredients, strengths,
 * dose form and brand. RxNorm's clinical drug name stands in only when the
 * package has no ingredients to build from; null when neither exists.
 */
export function packageDisplayTitle(item: PackageTitleSource): string | null {
  const rxNormName = item.details?.rxnav?.conceptName?.trim();
  const name =
    generatedName(item) ??
    (rxNormName
      ? timeReleaseAfterRelease(rxNormName).replace(/^./, (char) => char.toLocaleUpperCase())
      : null);
  if (!name) return null;

  const context: string[] = [];
  if (/\bCONCENTRATE\b/i.test(item.splTitle ?? '')) context.push('(Concentrate)');
  if (item.isMultiDose === true) context.push('MDV');

  const description = item.description ?? '';
  const carton = description.match(/\b(\d+)\s+([A-Z][A-Z ,/-]*?)\s+in\s+1\s+CARTON\b/i);
  if (carton) {
    const container = carton[2]
      .replace(/,?\s*(?:SINGLE|MULTI)[-\s]?DOSE\b/gi, '')
      .replace(/\s*,\s*/g, ' ')
      .trim()
      .toUpperCase();
    context.push(`CARTON of ${carton[1]} ${container}`);
  }
  if (item.labelerName?.trim()) context.push(`[${item.labelerName.trim()}]`);

  return context.length ? `${name} ${context.join(', ')}` : name;
}
