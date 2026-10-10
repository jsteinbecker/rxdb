import type { ExternalPackage } from './server/catalog-providers';
import { parseStrength } from './strength';

export type PackageClassKey = {
  moietyKey: string;
  moietyNames: string;
  doseFormGroup: string;
  routes: string[];
  strengthKey: string | null;
};

type Details = ExternalPackage['details'];

const actives = (details: Details) =>
  (details?.spl?.ingredients ?? []).filter((ingredient) => ingredient.kind === 'active');

type Ingredient = NonNullable<NonNullable<Details>['spl']>['ingredients'][number];

/** An active ingredient's moiety UNII, else its own UNII. */
const moietyOf = (ingredient: Ingredient): string | null =>
  ingredient.moieties.find((moiety) => moiety.unii)?.unii ?? ingredient.unii;

/** Sorted, de-duplicated moiety UNIIs of the active ingredients; product UNIIs when there is no SPL or it lists none. */
export function moietyKeyOf(details: Details): string {
  const fromSpl = actives(details)
    .map(moietyOf)
    .filter((unii): unii is string => !!unii);
  const uniis = fromSpl.length ? fromSpl : (details?.product?.uniis ?? []);
  return [...new Set(uniis)].sort().join('|');
}

const INJECTABLE_ROUTE =
  /^(?:INTRAVENOUS|INTRAMUSCULAR|SUBCUTANEOUS|INTRADERMAL|INTRATHECAL|EPIDURAL|INTRAVITREAL|INTRA-ARTICULAR|INTRAVASCULAR|INJECTION|INTRACAVERNOUS|INTRACAVITARY|INTRALESIONAL|INTRAOCULAR|INTRACAMERAL|INTRAPERITONEAL|INTRAPLEURAL|INTRAVENTRICULAR|INTRASPINAL|INTRABURSAL|INTRACARDIAC|SUBARACHNOID|PERINEURAL|INFILTRATION|PERCUTANEOUS|SOFT TISSUE)/i;

const CREAMY = /\b(?:cream|ointment|lotion|gel|foam|paste|shampoo|salve)\b/i;

/**
 * Form text to group, most specific first. `null` defers to the route; `oral-solid`, `suppository`,
 * `film` and `kit` are resolved against the route in `doseFormGroup`.
 */
const FORMS: [RegExp, string | null][] = [
  [/\bimplant/i, 'other'],
  [/\b(?:injection|injectable|infusion)\b/i, 'injectable'],
  [/\bkit\b/i, 'kit'],
  [/\b(?:aerosol|inhal|nebuli)/i, 'inhalation'],
  [/\b(?:patch|transdermal)\b/i, 'transdermal'],
  [/\benema\b/i, 'rectal'],
  [/\bsuppository\b/i, 'suppository'],
  [/\b(?:pessary)\b/i, 'vaginal'],
  [/\b(?:tablet|capsule|caplet|pill|lozenge|troche|pellet|granule)/i, 'oral-solid'],
  [/\b(?:film|insert)\b/i, 'film'],
  [/\b(?:syrup|elixir|tincture)\b/i, 'oral-liquid'],
  [CREAMY, null],
  [/\b(?:solution|suspension|emulsion|drops|spray|powder|liquid|concentrate)\b/i, null]
];

const ROUTE_GROUPS: [RegExp, string][] = [
  [INJECTABLE_ROUTE, 'injectable'],
  [/^OPHTHALMIC/i, 'ophthalmic'],
  [/^OTIC/i, 'otic'],
  [/^NASAL/i, 'nasal'],
  [/^RESPIRATORY|^INHALATION/i, 'inhalation'],
  [/^RECTAL/i, 'rectal'],
  [/^VAGINAL/i, 'vaginal'],
  [/^TRANSDERMAL/i, 'transdermal'],
  [/^(?:TOPICAL|CUTANEOUS)/i, 'topical'],
  [/^(?:ORAL|SUBLINGUAL|BUCCAL)/i, 'oral-liquid'],
  // Sites with no group of their own: deliberately `other` rather than a wrong guess.
  [/^(?:INTRAVESICAL|DENTAL|PERIODONTAL|URETERAL|URETHRAL)/i, 'other']
];

const routeGroup = (routes: string[]): string | null => {
  for (const route of routes) {
    const hit = ROUTE_GROUPS.find(([pattern]) => pattern.test(route.trim()));
    if (hit) return hit[1];
  }
  return null;
};

/** RxNorm-DFG-like group for an SPL dose form; the route breaks ties for forms that name no site. */
export function doseFormGroup(doseForm: string | null, routes: string[]): string {
  const hit = FORMS.find(([pattern]) => pattern.test(doseForm ?? ''));
  if (!hit) return 'other';
  const [, group] = hit;
  const byRoute = routeGroup(routes);
  switch (group) {
    case 'oral-solid':
    case 'film':
      // A solid dosed by another site follows that site; an injectable route for a solid (a pellet) is `other`.
      if (byRoute === null || byRoute === 'oral-liquid') return 'oral-solid';
      return byRoute === 'injectable' ? 'other' : byRoute;
    case 'suppository':
      return byRoute === 'vaginal' ? 'vaginal' : 'rectal';
    case 'kit':
      return byRoute && byRoute !== 'oral-liquid' ? byRoute : 'other';
    case null:
      // An oral gel/cream is not a liquid; leave it ungrouped.
      if (byRoute === 'oral-liquid' && CREAMY.test(doseForm ?? '')) return 'other';
      if (byRoute) return byRoute;
      return CREAMY.test(doseForm ?? '') ? 'topical' : 'other';
    default:
      return group;
  }
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

/** Exact rational from a JS number's shortest decimal form (handles exponents). */
function rational(value: number): [bigint, bigint] {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error(`not a plain number: ${value}`);
  const fraction = match[2] ?? '';
  let num = BigInt(match[1] + fraction);
  let den = 10n ** BigInt(fraction.length);
  const exponent = Number(match[3] ?? 0);
  if (exponent >= 0) num *= 10n ** BigInt(exponent);
  else den *= 10n ** BigInt(-exponent);
  return [num, den];
}

const MASS_MG: Record<string, [bigint, bigint]> = {
  mg: [1n, 1n],
  g: [1000n, 1n],
  mcg: [1n, 1000n],
  ug: [1n, 1000n],
  kg: [1000000n, 1n]
};
const VOLUME_ML: Record<string, [bigint, bigint]> = { ml: [1n, 1n], l: [1000n, 1n], dl: [100n, 1n] };

/** Scale a measurement into its base unit (mg / mL); other units are kept as lowercase text. */
function normalize(value: number, unit: string): { num: bigint; den: bigint; unit: string } {
  const [n, d] = rational(value);
  const lower = unit.toLowerCase();
  const scale = MASS_MG[lower] ?? VOLUME_ML[lower];
  if (!scale) return { num: n, den: d, unit: lower };
  return {
    num: n * scale[0],
    den: d * scale[1],
    unit: MASS_MG[lower] ? 'mg' : 'mL'
  };
}

function oneStrength(text: string | null): string | null {
  const parsed = parseStrength(text);
  if (!parsed) return null;
  const top = normalize(parsed.strengthNumMag, parsed.strengthNumUom);
  const bottom =
    parsed.strengthDenUom === '1'
      ? (([num, den]) => ({ num, den, unit: '1' }))(rational(parsed.strengthDenMag))
      : normalize(parsed.strengthDenMag, parsed.strengthDenUom);
  // (top.num / top.den) / (bottom.num / bottom.den)
  let num = top.num * bottom.den;
  let den = top.den * bottom.num;
  const divisor = gcd(num, den);
  num /= divisor;
  den /= divisor;
  return `${num}/${den} ${top.unit}/${bottom.unit}`;
}

/**
 * Exact strengths of the actives, sorted; null when any of them cannot be parsed. A combination pairs each
 * strength with its moiety (`MOIETY=20/1 mg/mL`) so 5/10 and 10/5 of the same pair differ; a single active
 * has no prefix (its moiety is already the rule's `moietyKey`).
 */
export function strengthKey(
  actives: { moiety: string | null; strength: string | null }[]
): string | null {
  if (!actives.length) return null;
  const parts = actives.map(({ moiety, strength }) => {
    const exact = oneStrength(strength);
    return exact !== null && actives.length > 1 ? `${moiety ?? ''}=${exact}` : exact;
  });
  if (parts.some((part) => part === null)) return null;
  return (parts as string[]).sort().join('|');
}

export function packageClassKey(
  item: Pick<ExternalPackage, 'doseForm' | 'details'>
): PackageClassKey {
  const routes = item.details?.product?.routes ?? [];
  const names = actives(item.details).map((ingredient) => ingredient.moieties[0]?.name ?? ingredient.name);
  return {
    moietyKey: moietyKeyOf(item.details),
    moietyNames: [...new Set(names)].sort().join(' / '),
    doseFormGroup: doseFormGroup(item.doseForm, routes),
    routes,
    strengthKey: strengthKey(
      actives(item.details).map((ingredient) => ({
        moiety: moietyOf(ingredient),
        strength: ingredient.strength
      }))
    )
  };
}
