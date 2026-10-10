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
