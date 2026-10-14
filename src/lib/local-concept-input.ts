// Validation for the local-concept form/API payload. Pure; throws
// LocalConceptInputError, which routes turn into fail(400).

import type { LocalIngredient } from './local-concept.ts';
import { isUuid } from './pharm-class-rule-input.ts';

export class LocalConceptInputError extends Error {}

/**
 * One line of the label's electrolyte statement ("acetate about 96 mEq/L,
 * provided as acetic acid and lysine acetate"). Not an ingredient row.
 */
export type IonicRow = {
  element: string;
  /** '' exact, '~' about, '<' less than. */
  comparator: '' | '~' | '<';
  mEqPerL: string;
  source: string | null;
};

export type LocalConceptInput = {
  doseForm: string;
  ingredients: LocalIngredient[];
  evidenceSetId: string;
  evidenceVersion: string;
  evidenceNdc: string | null;
  ionicContent: IonicRow[] | null;
  note: string | null;
};

const UNII = /^[A-Z0-9]{10}$/;
const DECIMAL = /^\d+(?:\.\d+)?$/;
const BASES = ['as_labeled', 'active_moiety'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim()) throw new LocalConceptInputError(`${label} is required`);
  if (value.trim().length > max) throw new LocalConceptInputError(`${label} is too long`);
  return value.trim();
}

function optionalText(value: unknown, label: string, max = 2000): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new LocalConceptInputError(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new LocalConceptInputError(`${label} is too long`);
  return trimmed || null;
}

function unii(value: unknown, label: string): string {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!UNII.test(v)) throw new LocalConceptInputError(`${label} must be a 10-character UNII`);
  return v;
}

function positive(value: unknown, label: string): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!DECIMAL.test(v) || !(Number(v) > 0))
    throw new LocalConceptInputError(`${label} must be a positive decimal`);
  return v;
}

function readIngredient(raw: unknown, index: number): LocalIngredient {
  const at = `Ingredient ${index + 1}`;
  if (!isRecord(raw)) throw new LocalConceptInputError(`${at} is malformed`);
  const basis = raw.basis;
  if (!BASES.includes(basis as (typeof BASES)[number]))
    throw new LocalConceptInputError(`${at}: basis must be as_labeled or active_moiety`);
  const isMoiety = basis === 'active_moiety';
  const hasMoiety = raw.moietyUnii != null || raw.moietyName != null;
  if (isMoiety && !hasMoiety) throw new LocalConceptInputError(`${at}: active moiety is required`);
  return {
    substanceUnii: unii(raw.substanceUnii, `${at} UNII`),
    substanceName: text(raw.substanceName, `${at} name`),
    basis: basis as LocalIngredient['basis'],
    moietyUnii: isMoiety ? unii(raw.moietyUnii, `${at} moiety UNII`) : null,
    moietyName: isMoiety ? text(raw.moietyName, `${at} moiety name`) : null,
    strengthNumMag: positive(raw.strengthNumMag, `${at} strength`),
    strengthNumUom: text(raw.strengthNumUom, `${at} strength unit`, 50),
    strengthDenMag: positive(raw.strengthDenMag ?? '1', `${at} per amount`),
    strengthDenUom: text(raw.strengthDenUom, `${at} per unit`, 50)
  };
}

/**
 * Why `id` can't be edited, or null when it can: it must be a well-formed uuid
 * (Postgres throws on a malformed one) of a concept in `editable`, the scope's
 * non-retired local concepts.
 */
export function editTargetError(
  id: string,
  editable: { id: string }[]
): { status: 400 | 404; message: string } | null {
  if (!isUuid(id)) return { status: 400, message: 'Invalid local concept id.' };
  if (!editable.some((concept) => concept.id === id))
    return { status: 404, message: 'Local concept not found; it may have been retired.' };
  return null;
}

const COMPARATORS = ['', '~', '<'] as const;

function readIonicContent(raw: unknown): IonicRow[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new LocalConceptInputError('Ionic content is malformed');
  if (raw.length > 20) throw new LocalConceptInputError('Ionic content has too many rows');
  return raw.length
    ? raw.map((row, index) => {
        const at = `Ionic content ${index + 1}`;
        if (!isRecord(row)) throw new LocalConceptInputError(`${at} is malformed`);
        const comparator = row.comparator ?? '';
        if (!COMPARATORS.includes(comparator as IonicRow['comparator']))
          throw new LocalConceptInputError(`${at}: comparator must be blank, ~ or <`);
        return {
          element: text(row.element, `${at} element`, 100),
          comparator: comparator as IonicRow['comparator'],
          mEqPerL: positive(row.mEqPerL, `${at} mEq/L`),
          source: optionalText(row.source, `${at} source`, 300)
        };
      })
    : null;
}

/** Throws `LocalConceptInputError` for invalid input. */
export function parseLocalConceptInput(raw: unknown): LocalConceptInput {
  if (!isRecord(raw)) throw new LocalConceptInputError('Invalid local concept');
  if (!Array.isArray(raw.ingredients) || raw.ingredients.length === 0)
    throw new LocalConceptInputError('At least one ingredient is required');
  const ingredients = raw.ingredients.map(readIngredient);
  const seen = new Set<string>();
  for (const i of ingredients) {
    if (seen.has(i.substanceUnii))
      throw new LocalConceptInputError(`Duplicate substance ${i.substanceUnii}`);
    seen.add(i.substanceUnii);
  }
  return {
    doseForm: text(raw.doseForm, 'Dose form'),
    ingredients,
    evidenceSetId: text(raw.evidenceSetId, 'Evidence set'),
    evidenceVersion: text(raw.evidenceVersion, 'Evidence version', 100),
    evidenceNdc: optionalText(raw.evidenceNdc, 'Evidence NDC', 50),
    ionicContent: readIonicContent(raw.ionicContent),
    note: optionalText(raw.note, 'Note')
  };
}
