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

/** Sorted, de-duplicated moiety UNIIs of the active ingredients; product UNIIs when there is no SPL. */
export function moietyKeyOf(details: Details): string {
  const fromSpl = actives(details)
    .map((ingredient) => ingredient.moieties.find((moiety) => moiety.unii)?.unii ?? ingredient.unii)
    .filter((unii): unii is string => !!unii);
  const uniis = details?.spl ? fromSpl : (details?.product?.uniis ?? []);
  return [...new Set(uniis)].sort().join('|');
}

/** Form text to group, most specific first. A `null` group defers to the route. */
const FORMS: [RegExp, string | null][] = [
  [/\b(?:injection|injectable|infusion|implant|kit)\b/i, 'injectable'],
  [/\b(?:aerosol|inhal|nebuli)/i, 'inhalation'],
  [/\b(?:patch|transdermal)\b/i, 'transdermal'],
  [/\b(?:suppository|enema)\b/i, 'rectal'],
  [/\b(?:pessary)\b/i, 'vaginal'],
  [/\b(?:tablet|capsule|caplet|pill|lozenge|troche|pellet|granule)/i, 'oral-solid'],
  [/\b(?:syrup|elixir|tincture)\b/i, 'oral-liquid'],
  [/\b(?:cream|ointment|lotion|gel|foam|paste|shampoo|salve)\b/i, null],
  [/\b(?:solution|suspension|emulsion|drops|spray|powder|liquid|concentrate|film|insert)\b/i, null]
];

const ROUTE_GROUPS: [RegExp, string][] = [
  [/^(?:INTRAVENOUS|INTRAMUSCULAR|SUBCUTANEOUS|INTRADERMAL|INTRATHECAL|EPIDURAL|INTRAVITREAL|INTRA-ARTICULAR|INTRAVASCULAR|INJECTION)/i, 'injectable'],
  [/^OPHTHALMIC/i, 'ophthalmic'],
  [/^OTIC/i, 'otic'],
  [/^NASAL/i, 'nasal'],
  [/^RESPIRATORY|^INHALATION/i, 'inhalation'],
  [/^RECTAL/i, 'rectal'],
  [/^VAGINAL/i, 'vaginal'],
  [/^TRANSDERMAL/i, 'transdermal'],
  [/^(?:TOPICAL|CUTANEOUS)/i, 'topical'],
  [/^(?:ORAL|SUBLINGUAL|BUCCAL)/i, 'oral-liquid']
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
  if (group === 'oral-solid') {
    const byRoute = routeGroup(routes);
    return byRoute === 'vaginal' || byRoute === 'rectal' || byRoute === 'ophthalmic' ? byRoute : group;
  }
  if (group) return group;
  const byRoute = routeGroup(routes);
  if (byRoute) return byRoute;
  return /\b(?:cream|ointment|lotion|gel|foam|paste|shampoo|salve)\b/i.test(doseForm ?? '')
    ? 'topical'
    : 'other';
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

/** Sorted, exact strengths of the actives; null when any of them cannot be parsed. */
export function strengthKey(strengths: (string | null)[]): string | null {
  if (!strengths.length) return null;
  const parts = strengths.map(oneStrength);
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
    strengthKey: strengthKey(actives(item.details).map((ingredient) => ingredient.strength))
  };
}
