import { prisma } from './prisma';
import {
  dosingConceptKey,
  parseDosingMeasure,
  type DosingMeasure,
  type DosingMeasureSource
} from '$lib/dosing-measure';

/** The selection made for this package's SCD concept, if any. */
export async function loadDosingMeasure(item: DosingMeasureSource): Promise<DosingMeasure | null> {
  const key = dosingConceptKey(item);
  const row = key ? await prisma.scdDosingMeasure.findUnique({ where: { conceptKey: key } }) : null;
  if (!row) return null;
  return row.mode === 'ingredient' && row.ingredient
    ? { mode: 'ingredient', ingredient: row.ingredient }
    : row.mode === 'sum'
      ? row.ingredients.length
        ? { mode: 'sum', ingredients: row.ingredients }
        : { mode: 'sum' }
      : null;
}

/** Saves the selection for the concept; every NDC under it reads it back. */
export async function saveDosingMeasure(
  item: DosingMeasureSource,
  mode: string,
  ingredient: string | null,
  ingredients: string[] = []
) {
  const key = dosingConceptKey(item);
  if (!key) throw new Error('This package has no SCD concept to attach a dosing measure to.');
  const parsed = parseDosingMeasure(item, mode, ingredient, ingredients);
  if ('error' in parsed) throw new Error(parsed.error);
  const data = {
    mode: parsed.measure.mode,
    ingredient: parsed.measure.mode === 'ingredient' ? parsed.measure.ingredient : null,
    ingredients: parsed.measure.mode === 'sum' ? (parsed.measure.ingredients ?? []) : []
  };
  await prisma.scdDosingMeasure.upsert({
    where: { conceptKey: key },
    create: { conceptKey: key, ...data },
    update: data
  });
}

export async function clearDosingMeasure(item: DosingMeasureSource) {
  const key = dosingConceptKey(item);
  if (key) await prisma.scdDosingMeasure.deleteMany({ where: { conceptKey: key } });
}
