import type { PrismaClient } from '../../generated/client';
import { applyPharmClassRules } from '../pharm-class-view';
import type { PharmClassRule } from '../pharm-class-rules';
import { rulesForKeys } from './pharm-class-rule-store';
import type { ExternalPackage } from './catalog-providers';

/**
 * Display-time pharmacologic classes: the source's classes with the scope's rules
 * applied. Read paths only (never sync, staging or reinterpret).
 */
export function withPharmClassRules<T extends Pick<ExternalPackage, 'doseForm' | 'details'>>(
  db: PrismaClient,
  scopeId: string,
  items: T[],
  loadRules: (db: PrismaClient, scopeId: string, moietyKeys: string[]) => Promise<PharmClassRule[]> = rulesForKeys
): Promise<T[]> {
  return applyPharmClassRules(items, (keys) => loadRules(db, scopeId, keys));
}

type Resolvable = Pick<ExternalPackage, 'doseForm' | 'details'>;

/**
 * `withPharmClassRules` for a staged tree (concepts holding packages, plus loose packages): every
 * package is resolved in ONE rules query and put back where it came from. Response side only.
 */
export async function withPharmClassRulesInTree<
  P extends Resolvable,
  Tree extends { concepts: { packages: P[] }[]; packages: P[] }
>(
  db: PrismaClient,
  scopeId: string,
  tree: Tree,
  loadRules?: (db: PrismaClient, scopeId: string, moietyKeys: string[]) => Promise<PharmClassRule[]>
): Promise<Tree> {
  const flat = [...tree.concepts.flatMap((concept) => concept.packages), ...tree.packages];
  const resolved = await withPharmClassRules(db, scopeId, flat, loadRules);
  let next = 0;
  return {
    ...tree,
    concepts: tree.concepts.map((concept) => ({
      ...concept,
      packages: concept.packages.map(() => resolved[next++])
    })),
    packages: tree.packages.map(() => resolved[next++])
  };
}
