import { VOLUME_UNIT, type Role } from './compound-builder';
import { formatRational, type Rational } from '../medication/rational';

/**
 * How a compound's name is built from its components. Templates use `{token}`
 * placeholders; text in `[brackets]` is kept only when every token inside it
 * has a value, so "[ in {diluents}]" disappears until a diluent is added.
 */
export type CompoundNaming = {
  /** Whole name. Tokens: {actives}, {diluents}, {total}. */
  template: string;
  /** One active ingredient. Tokens: {ingredient}, {dose}, {conc}, {volume}. */
  active: string;
  /** One diluent. Same tokens as `active`. */
  diluent: string;
  /** Between components of the same role. */
  joiner: string;
  letterCase: NameCase;
  /** Used while the compound has no components. */
  untitled: string;
};

export type NameCase = 'as-is' | 'upper' | 'lower' | 'title';
export const NAME_CASES: NameCase[] = ['as-is', 'upper', 'lower', 'title'];

export const DEFAULT_NAMING: CompoundNaming = {
  template: '{actives}[ in {diluents}]',
  active: '{ingredient}[ {dose}]',
  diluent: '{ingredient}[ {volume}]',
  joiner: ' / ',
  letterCase: 'as-is',
  untitled: 'New compound'
};

export const MAX_NAME = 120;

const text = (value: unknown, fallback: string, max = 200) =>
  typeof value === 'string' && value.length <= max ? value : fallback;

export function parseNaming(value: unknown): CompoundNaming {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const nonBlank = (value: unknown, fallback: string) => {
    const parsed = text(value, fallback);
    return parsed.trim() ? parsed : fallback;
  };
  return {
    template: nonBlank(raw.template, DEFAULT_NAMING.template),
    active: nonBlank(raw.active, DEFAULT_NAMING.active),
    diluent: nonBlank(raw.diluent, DEFAULT_NAMING.diluent),
    joiner: text(raw.joiner, DEFAULT_NAMING.joiner, 20),
    letterCase: NAME_CASES.includes(raw.letterCase as NameCase)
      ? (raw.letterCase as NameCase)
      : DEFAULT_NAMING.letterCase,
    untitled: nonBlank(raw.untitled, DEFAULT_NAMING.untitled).trim().slice(0, MAX_NAME)
  };
}

/** Fill `{token}`s; a `[section]` with any empty token inside is dropped whole. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  const fill = (part: string) => part.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
  const empty = (part: string) =>
    [...part.matchAll(/\{(\w+)\}/g)].some(([, key]) => !values[key]?.trim());
  return template
    .replace(/\[([^[\]]*)\]/g, (_, section: string) => (empty(section) ? '' : fill(section)))
    .replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

export interface NamedComponent {
  role: Role;
  /** Ingredient names of the component's package. */
  ingredients: string[];
  doseUnit: string;
  conc: Rational | null;
  dose: Rational | null;
  volume: Rational | null;
}

const amount = (value: Rational | null, unit: string) =>
  value ? `${formatRational(value)} ${unit}` : '';

function applyCase(name: string, letterCase: NameCase) {
  if (letterCase === 'upper') return name.toUpperCase();
  if (letterCase === 'lower') return name.toLowerCase();
  if (letterCase === 'title')
    return name.replace(/\p{L}[\p{L}']*/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  return name;
}

/** The name the rules give these components, before making it unique. */
export function buildCompoundName(
  components: NamedComponent[],
  naming: CompoundNaming,
  total: Rational | null = null
): string {
  const part = (role: Role) =>
    components
      .filter((component) => component.role === role && component.ingredients.length)
      .map((component) =>
        fillTemplate(role === 'active' ? naming.active : naming.diluent, {
          // Title case reaches ingredient names only, so units stay "mg/mL".
          ingredient: component.ingredients
            .map((name) => (naming.letterCase === 'title' ? applyCase(name, 'title') : name))
            .join(naming.joiner),
          dose: role === 'active' ? amount(component.dose, component.doseUnit) : '',
          conc: amount(component.conc, `${component.doseUnit}/${VOLUME_UNIT}`),
          volume: amount(component.volume, VOLUME_UNIT)
        }).trim()
      )
      .filter(Boolean)
      .join(naming.joiner);
  const actives = part('active');
  const diluents = part('diluent');
  if (!actives && !diluents) return naming.untitled;
  const name = fillTemplate(naming.template, {
    actives,
    diluents,
    total: amount(total, VOLUME_UNIT)
  })
    .replace(/\s+/g, ' ')
    .trim();
  const cased = naming.letterCase === 'title' ? name : applyCase(name, naming.letterCase);
  return (cased || naming.untitled).slice(0, MAX_NAME).trim();
}

/** `base`, or `base (2)`, `base (3)`… — the first not in `taken`. */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, MAX_NAME - suffix.length).trimEnd() + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}
