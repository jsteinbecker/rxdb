import type { PrismaClient } from '../../../generated/client';
import { defaultScope, loadedItems, localNamesOf } from '../formulary/membership';
import { formularyRows } from '../formulary/read';
import { applyCompoundName, loadCompound } from './store';
import { buildCompoundName, type CompoundNaming } from '../../compounds/compound-naming';
import { parseSettings } from '../../formulary/settings';

type Rows = Awaited<ReturnType<typeof formularyRows>>;

async function context(db: PrismaClient, scopeId: string) {
  const rows = await formularyRows(db, scopeId, localNamesOf(await loadedItems(db, scopeId)));
  return new Map(rows.map((row) => [row.packageId, row]));
}

async function rename(
  db: PrismaClient,
  scopeId: string,
  id: string,
  naming: CompoundNaming,
  byPackage: Map<string, Rows[number]>
) {
  const compound = await loadCompound(db, scopeId, id);
  if (compound.locked) return compound.name;
  const base = buildCompoundName(
    compound.lines.map((line) => ({
      ...line,
      ingredients: (byPackage.get(line.packageId)?.ingredients ?? []).map((ingredient) => ingredient.name)
    })),
    naming,
    compound.total
  );
  return base === compound.name ? base : applyCompoundName(db, scopeId, id, base);
}

/** Rebuild a draft compound's name from its components and the formulary's naming rules. */
export async function refreshCompoundName(db: PrismaClient, id: string) {
  const scope = await defaultScope(db);
  const naming = parseSettings(scope.settings).compoundNaming;
  return rename(db, scope.id, id, naming, await context(db, scope.id));
}

/** Rebuild every draft's name, after the naming rules change. Saved compounds keep theirs. */
export async function refreshDraftNames(db: PrismaClient, scopeId: string, naming: CompoundNaming) {
  const drafts = await db.compoundFormula.findMany({
    where: { scopeId, status: 'draft' },
    orderBy: { name: 'asc' },
    select: { id: true }
  });
  if (!drafts.length) return;
  const byPackage = await context(db, scopeId);
  for (const draft of drafts) await rename(db, scopeId, draft.id, naming, byPackage);
}
