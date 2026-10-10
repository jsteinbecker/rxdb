import type { PackageClassKey } from './pharm-class-key';

export type PharmClassRule = {
  id: string;
  moietyKey: string;
  doseFormGroup: string | null;
  route: string | null;
  strengthKey: string | null;
  mode: 'replace' | 'add' | 'suppress';
  classes: string[];
};

export function ruleMatches(rule: PharmClassRule, key: PackageClassKey): boolean {
  if (!key.moietyKey || rule.moietyKey !== key.moietyKey) return false;
  if (rule.doseFormGroup !== null && rule.doseFormGroup !== key.doseFormGroup) return false;
  if (rule.route !== null && !key.routes.includes(rule.route)) return false;
  if (rule.strengthKey !== null && rule.strengthKey !== key.strengthKey) return false;
  return true;
}

/**
 * Sort key: number of non-null facets first (x8), then the weighted facet sum
 * (strength 4 + route 2 + form 1) as tie-break. The weighted sum is at most 7, so it never outranks a facet.
 */
export function specificity(rule: PharmClassRule): number {
  const facets = [rule.strengthKey !== null, rule.route !== null, rule.doseFormGroup !== null];
  const count = facets.filter(Boolean).length;
  return count * 8 + (facets[0] ? 4 : 0) + (facets[1] ? 2 : 0) + (facets[2] ? 1 : 0);
}

export function resolvePharmClasses(
  source: string[],
  key: PackageClassKey,
  rules: PharmClassRule[]
): {
  classes: string[];
  source: string[];
  applied: { ruleId: string; mode: PharmClassRule['mode']; classes: string[] }[];
} {
  const matching = rules
    .filter((rule) => ruleMatches(rule, key))
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => specificity(a.rule) - specificity(b.rule) || a.index - b.index)
    .map(({ rule }) => rule);

  let classes = [...new Set(source)];
  for (const rule of matching) {
    if (rule.mode === 'replace') classes = [...new Set(rule.classes)];
    else if (rule.mode === 'add') classes = [...new Set([...classes, ...rule.classes])];
    else classes = rule.classes.length ? classes.filter((name) => !rule.classes.includes(name)) : [];
  }
  return {
    classes,
    source,
    applied: matching.map((rule) => ({ ruleId: rule.id, mode: rule.mode, classes: rule.classes }))
  };
}
