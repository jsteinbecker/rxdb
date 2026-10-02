import {classifyMultiDose, parseUnitOfUse, restateUnitOfUse, type UnitOfUseSize} from '../ndc-packaging';
import {multiDoseFromLabel} from '../label-multidose';
import {isDryFillForm, parseIngredientMassMg} from '../ingredient-content';
import {
    dedupeProseReconstitutions,
    fromBottleRows,
    fromReconstitutionRows,
    parseBottleProse,
    parseReconstitutionProse,
    type ProseReconstitution,
    resolveBottleVolume,
    type ResolvedDryFillVolume,
    resolveDryFillVolume,
    rowsForVial,
    statedReconstitutedConcentrations,
    withLabelConcentrations,
    withRowIds
} from '../dry-fill-volume';
import {type LabelBlock, labelSectionBlocks} from '../spl-sections';
import {bottleReconstitutionFromLabel, parseConcentrationMgPerMl, reconstitutionFromLabel} from '../reconstitution';
import {rxNormStrengths} from '../spl-strength-checks';
import {mgPer, toMg} from '../units';

/**
 * A unit of use the directory states as the salt's mass, restated as the
 * active moiety's. `description` and `size` carry the corrected values;
 * `from` keeps the description as imported.
 */
export type UnitOfUseCorrection = {
  from: string;
  description: string;
  note: string;
};

export type PackageFacts = {
  size: UnitOfUseSize | null;
  /** Set when `size` was restated from salt to moiety mass. */
  unitOfUseCorrection: UnitOfUseCorrection | null;
  isMultiDose: boolean | null;
  isDryFill: boolean;
  reconstitution: ProseReconstitution[];
  resolvedVolume: ResolvedDryFillVolume | null;
};

export function parsePackageFacts(
  ndc: string,
  description: string | null,
  doseForm: string | null,
  ingredients: { name: string; strength: string | null }[],
  label: Record<string, unknown> | null,
  splXml: string | null = null,
  rxNormName: string | null = null
): PackageFacts {
  const size = description ? parseUnitOfUse(description) : null;
  const sections = [
    'how_supplied',
    'package_label_principal_display_panel',
    'storage_and_handling',
    'description',
    'dosage_and_administration',
    'instructions_for_use',
    'spl_unclassified_section'
  ];
  const prose = (blocks: LabelBlock[]): string[] =>
    blocks.flatMap((block): string[] =>
      block.type === 'paragraph'
        ? [block.runs.map((run) => run.text).join('')]
        : block.type === 'list'
          ? block.items.flatMap(prose)
          : []
    );
  const splSections = splXml ? labelSectionBlocks(splXml) : {};
  const text = sections
    .flatMap((key) => (Array.isArray(label?.[key]) ? (label[key] as string[]) : []))
    .concat(sections.flatMap((key) => prose(splSections[key] ?? [])))
    .join('\n');
  const tables = { ...label, spl_tables_table: splXml ? [splXml] : [] };
  const allRows =
    label || splXml
      ? dedupeProseReconstitutions([
          ...parseReconstitutionProse(text),
          ...fromReconstitutionRows(reconstitutionFromLabel(tables)),
          ...fromBottleRows([...bottleReconstitutionFromLabel(tables), ...parseBottleProse(text)])
        ])
      : [];
  // Shared labels tabulate every vial size; keep this package's. Without a
  // complete ingredient mass there is no vial size to match, so keep all.
  //
  // Vial sizes are matched, and volumes resolved, on the active moiety's
  // mass: that is what RxNorm quantifies and what labels name their vials by.
  // The listed strength is often the salt's — Hikma's vancomycin bulk vial is
  // "5.13 g" of the hydrochloride and "the 5 g vial" everywhere it is used.
  const quantified = moietyMassesFromRxNorm(rxNormName, ingredients);
  //
  // A kit lists no ingredients, but its description names each component:
  // "15 g in 1 BOTTLE * 289 mL in 1 BOTTLE" is the powder and its diluent.
  const kit = description ? kitComponents(description) : null;
  const vialMg = quantified
    ? [...quantified.values()].reduce((sum, mg) => sum + mg, 0)
    : (totalIngredientMg(ingredients) ??
      (kit?.massesMg.length === 1 ? kit.massesMg[0] : null));
  const reconstitution = withKitDiluent(
    vialMg === null ? allRows : rowsForVial(allRows, vialMg),
    kit?.volumesMl ?? []
  );
  // Without an SCD mass, a single-ingredient vial the label names on its own
  // (matched within salt distance by `rowsForVial`) takes the label's figure.
  const labeledMg = [
    ...new Set(reconstitution.flatMap((row) => (row.vialMassMg === null ? [] : [row.vialMassMg])))
  ];
  const moietyMasses =
    quantified ??
    (ingredients.length === 1 && labeledMg.length === 1
      ? new Map([[ingredients[0].name, labeledMg[0]]])
      : null);
  const isDryFill = isDryFillForm(doseForm ?? '');
  // A row naming no vial is about this package's vial (`rowsForVial` kept it
  // for that reason), whose content is the ingredient strength: "each vial"
  // of Anavip is its 120 mg.
  const vialRows =
    isDryFill && vialMg !== null
      ? reconstitution.map((row) => (row.vialMassMg === null ? { ...row, vialMassMg: vialMg } : row))
      : reconstitution;
  // A salt's package mass can differ from the labeled active-moiety vial
  // size: "1025 mg in 1 VIAL" of vancomycin hydrochloride is the 1 g vial.
  // The same correction the ingredient strength gets is carried into the
  // unit of use and the description that states it.
  const unitOfUseCorrection =
    isDryFill && ingredients.length === 1 && moietyMasses && description
      ? saltUnitOfUse(
          description,
          size,
          ingredients[0].name,
          rxNormStrengths(rxNormName).find((entry) =>
            ingredients[0].name.toLowerCase().includes(entry.name.toLowerCase())
          )?.name ?? null,
          [...moietyMasses.values()][0]
        )
      : null;
  const normalizedSize =
    unitOfUseCorrection && size
      ? { ...size, value: massInUnit([...moietyMasses!.values()][0], size.unit!) }
      : size;
  // Some labels state the resulting concentration in another sentence, or
  // another section, from the instruction it results from. An unattributed
  // concentration can only be read as this vial's when it has one ingredient.
  const volumeRows = withRowIds(
    ingredients.length === 1
      ? withLabelConcentrations(
          vialRows,
          statedReconstitutedConcentrations(text),
          moietyMasses ? [...moietyMasses.values()][0] : vialMg
        )
      : vialRows
  );

  return {
    size: normalizedSize,
    unitOfUseCorrection,
    isMultiDose:
      classifyMultiDose(description ?? '', doseForm ?? '') ??
      (text ? multiDoseFromLabel(text, ndc) : null),
    isDryFill,
    reconstitution: volumeRows,
    resolvedVolume: resolvePackageVolume(isDryFill, normalizedSize, ingredients, volumeRows, moietyMasses)
  };
}

const massInUnit = (mg: number, unit: string) => Number((mg / mgPer(unit)!).toPrecision(12));

/**
 * The correction for a unit of use stated as a salt's mass: within 10% of
 * the moiety's (the tolerance vial matching uses) but not equal to it.
 */
function saltUnitOfUse(
  description: string,
  size: UnitOfUseSize | null,
  ingredient: string,
  moiety: string | null,
  moietyMg: number
): UnitOfUseCorrection | null {
  const statedMg = size?.kind === 'mass' ? toMg(size.value, size.unit) : null;
  if (!size?.unit || statedMg === null) return null;
  if (statedMg === moietyMg || Math.abs(statedMg - moietyMg) > statedMg * 0.1) return null;
  const value = massInUnit(moietyMg, size.unit);
  const corrected = restateUnitOfUse(description, size, value);
  if (!corrected) return null;
  const counterion = moiety
    ? ingredient.toLowerCase().replace(moiety.toLowerCase(), '').replace(/\s+/g, ' ').trim()
    : '';
  return {
    from: description,
    description: corrected,
    note:
      `Unit of use corrected from stated value of ${size.value} ${size.unit}, equivalent to ` +
      (moiety
        ? `${value} ${size.unit} ${moiety.toLowerCase()}` +
          (counterion ? ` as the ${counterion} salt` : ' as its salt')
        : `${value} ${size.unit} of the active moiety in ${ingredient.toLowerCase()}`)
  };
}

/**
 * Per-ingredient moiety masses from a quantified RxNorm name — `vancomycin
 * 5000 MG Injection` — keyed by the package's ingredient names. Null unless
 * every ingredient gets one: a per-mL SCD ("100 MG/ML Injectable Solution")
 * says nothing about the vial, and a partial answer cannot give a total.
 */
function moietyMassesFromRxNorm(
  rxNormName: string | null,
  ingredients: { name: string }[]
): Map<string, number> | null {
  const strengths = rxNormStrengths(rxNormName);
  if (!ingredients.length || strengths.some((entry) => entry.perUnit !== null)) return null;
  const masses = new Map<string, number>();
  for (const ingredient of ingredients) {
    const name = ingredient.name.toLowerCase();
    const matches = strengths.filter((entry) => name.includes(entry.name.toLowerCase()));
    const mg = matches.length === 1 ? parseIngredientMassMg(`${matches[0].value} ${matches[0].unit}`) : null;
    if (mg === null) return null;
    masses.set(ingredient.name, mg);
  }
  return masses;
}

/**
 * Component masses and volumes of a multi-part package description, one per
 * " * "-separated part ("15 g in 1 BOTTLE (…)  *  289 mL in 1 BOTTLE (…)").
 * Null for a single-part description.
 */
export function kitComponents(
  description: string
): { massesMg: number[]; volumesMl: number[] } | null {
  const parts = description.split(/\s\*\s/);
  if (parts.length < 2) return null;
  const massesMg: number[] = [];
  const volumesMl: number[] = [];
  for (const part of parts) {
    const match = /^\s*([\d.]+)\s*(kg|g|mg|mcg|mL)\s+in\s+1\b/i.exec(part);
    if (!match) continue;
    const value = Number(match[1]);
    if (match[2].toLowerCase() === 'ml') volumesMl.push(value);
    else massesMg.push(toMg(value, match[2])!);
  }
  return { massesMg, volumesMl };
}

/**
 * A kit's pre-measured diluent picks its row when the vial size alone doesn't:
 * a 7.5 g bottle takes 295 mL for 25 mg/mL or 145 mL for 50 mg/mL. Rows are
 * kept as they are unless the kit's volume matches some of them.
 */
function withKitDiluent<T extends { diluentMl: number }>(rows: T[], volumesMl: number[]): T[] {
  if (new Set(rows.map((row) => row.diluentMl)).size < 2) return rows;
  const matched = rows.filter((row) => volumesMl.includes(row.diluentMl));
  return matched.length ? matched : rows;
}

function totalIngredientMg(ingredients: { strength: string | null }[]): number | null {
  const masses = ingredients.map((item) => parseIngredientMassMg(item.strength ?? ''));
  if (!masses.length || masses.some((mass) => mass === null)) return null;
  return (masses as number[]).reduce((sum, mg) => sum + mg, 0);
}

export function resolvePackageVolume(
  isDryFill: boolean,
  size: UnitOfUseSize | null,
  ingredients: { name: string; strength: string | null }[],
  reconstitution: ProseReconstitution[],
  moietyMasses: ReadonlyMap<string, number> | null = null
): ResolvedDryFillVolume | null {
  const masses = ingredients.map(
    (item) =>
      [item.name, moietyMasses?.get(item.name) ?? parseIngredientMassMg(item.strength ?? '')] as const
  );
  // An incomplete ingredient mass list cannot establish a combination vial's total.
  const completeMasses = masses.length > 0 && masses.every(([, mass]) => mass !== null);
  const labeledMl = size?.kind === 'volume' && size.unit === 'mL' ? size.value : null;
  if (!isDryFill) return null;
  // An oral powder states what it will be per mL, not what it holds, so its
  // numerator is no content mass; the label's bottle rows are the evidence.
  const perMl = ingredients.map((item) => parseConcentrationMgPerMl(item.strength ?? ''));
  if (perMl.length && perMl.every((value) => value !== null)) {
    const bottle = resolveBottleVolume(
      labeledMl,
      (perMl as number[]).reduce((sum, value) => sum + value, 0),
      reconstitution
    );
    if (bottle.meaning !== 'unknown') return bottle;
  }
  return completeMasses
    ? resolveDryFillVolume(labeledMl, new Map(masses as [string, number][]), reconstitution)
    : null;
}

export type ActivityInput = {
  listed: boolean | null;
  marketingEndDate: string | null;
  rxcuiStatus: string | null;
  splPresent: boolean | null;
  /** DailyMed marks the NDC "(inactivated)" after an FDA compliance action. */
  splInactivated?: boolean | null;
  isVeterinary: boolean | null;
};
export type ExclusionReason =
  | 'veterinary'
  | 'marketing-ended'
  | 'rxnav-inactive'
  | 'inactive-unlisted'
  | 'no-spl'
  | 'spl-inactivated';
const INACTIVE = new Set(['OBSOLETE', 'ALIEN', 'RETIRED', 'UNKNOWN', 'NON-RXNORM']);

/** MedPool's directory → RxNav → SPL ladder. An outage is never evidence of absence. */
export function exclusionReason(item: ActivityInput, now = new Date()): ExclusionReason | null {
  if (item.isVeterinary === true) return 'veterinary';
  if (item.splInactivated === true) return 'spl-inactivated';
  if (item.listed === true) {
    const today = now.toISOString().slice(0, 10).replaceAll('-', '');
    return item.marketingEndDate &&
      /^\d{8}$/.test(item.marketingEndDate) &&
      item.marketingEndDate < today
      ? 'marketing-ended'
      : null;
  }
  if (item.splPresent === true) return null;
  if (item.listed === false && item.splPresent === false) return 'no-spl';
  if (INACTIVE.has(item.rxcuiStatus?.toUpperCase() ?? '')) return 'rxnav-inactive';
  return null;
}
