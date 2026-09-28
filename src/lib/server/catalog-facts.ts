import { parseUnitOfUse, classifyMultiDose, type UnitOfUseSize } from '../ndc-packaging';
import { multiDoseFromLabel } from '../label-multidose';
import { isDryFillForm, parseIngredientMassMg } from '../ingredient-content';
import {
  parseReconstitutionProse,
  dedupeProseReconstitutions,
  fromReconstitutionRows,
  resolveDryFillVolume,
  rowsForVial,
  type ResolvedDryFillVolume,
  type ProseReconstitution
} from '../dry-fill-volume';
import { labelSectionBlocks, type LabelBlock } from '../spl-sections';
import { reconstitutionFromLabel } from '../reconstitution';

export type PackageFacts = {
  size: UnitOfUseSize | null;
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
  splXml: string | null = null
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
  const allRows =
    label || splXml
      ? dedupeProseReconstitutions([
          ...parseReconstitutionProse(text),
          ...fromReconstitutionRows(
            reconstitutionFromLabel({ ...label, spl_tables_table: splXml ? [splXml] : [] })
          )
        ])
      : [];
  // Shared labels tabulate every vial size; keep this package's. Without a
  // complete ingredient mass there is no vial size to match, so keep all.
  const vialMg = totalIngredientMg(ingredients);
  const reconstitution = vialMg === null ? allRows : rowsForVial(allRows, vialMg);
  const isDryFill = isDryFillForm(doseForm ?? '');

  return {
    size,
    isMultiDose:
      classifyMultiDose(description ?? '', doseForm ?? '') ??
      (text ? multiDoseFromLabel(text, ndc) : null),
    isDryFill,
    reconstitution,
    resolvedVolume: resolvePackageVolume(isDryFill, size, ingredients, reconstitution)
  };
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
  reconstitution: ProseReconstitution[]
): ResolvedDryFillVolume | null {
  const masses = ingredients.map(
    (item) => [item.name, parseIngredientMassMg(item.strength ?? '')] as const
  );
  // An incomplete ingredient mass list cannot establish a combination vial's total.
  const completeMasses = masses.length > 0 && masses.every(([, mass]) => mass !== null);
  return isDryFill && completeMasses
    ? resolveDryFillVolume(
        size?.kind === 'volume' && size.unit === 'mL' ? size.value : null,
        new Map(masses as [string, number][]),
        reconstitution
      )
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
