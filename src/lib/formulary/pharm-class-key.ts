/**
 * The key a pharmacologic class rule matches a package by: its active moieties,
 * dose-form group, route and exact strengths.
 *
 * @module
 */
import type { ExternalPackage } from '../catalog/types';
import { strengthIdentity } from '../medication/strength';

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

/** The groups of every route, in `ROUTE_GROUPS` priority order (so the result does not depend on route order). */
const routeGroups = (routes: string[]): string[] => {
	const found = new Set(
		routes.flatMap((route) =>
			ROUTE_GROUPS.filter(([pattern]) => pattern.test(route.trim()))
				.slice(0, 1)
				.map(([, group]) => group)
		)
	);
	return ROUTE_GROUPS.map(([, group]) => group).filter(
		(group, i, all) => found.has(group) && all.indexOf(group) === i
	);
};
const routeGroup = (routes: string[]): string | null => routeGroups(routes)[0] ?? null;

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
		case 'suppository': {
			// Rectal when the route is rectal or unstated, vaginal by vaginal route; urethral and the like are `other`.
			const groups = routeGroups(routes);
			if (groups.includes('vaginal')) return 'vaginal';
			return !groups.length || groups.includes('rectal') ? 'rectal' : 'other';
		}
		case 'kit':
			// An injectable route wins, else the first topical-type site (not oral or unplaced), else `other`.
			return (
				routeGroups(routes).find((g) => g === 'injectable') ??
				routeGroups(routes).find((g) => g !== 'oral-liquid' && g !== 'other') ??
				'other'
			);
		case null:
			// An oral gel/cream is not a liquid; leave it ungrouped.
			if (byRoute === 'oral-liquid' && CREAMY.test(doseForm ?? '')) return 'other';
			if (byRoute) return byRoute;
			return CREAMY.test(doseForm ?? '') ? 'topical' : 'other';
		default:
			return group;
	}
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
		const exact = strengthIdentity(strength);
		return exact !== null && actives.length > 1 ? `${moiety ?? ''}=${exact}` : exact;
	});
	if (parts.some((part) => part === null)) return null;
	return (parts as string[]).sort().join('|');
}

export function packageClassKey(
	item: Pick<ExternalPackage, 'doseForm' | 'details'>
): PackageClassKey {
	const routes = item.details?.product?.routes ?? [];
	const moietyKey = moietyKeyOf(item.details);
	// Names follow the moiety-UNII order of `moietyKey` and of the combination `strengthKey`, so a label can pair them.
	const nameOf = new Map<string, string>();
	for (const ingredient of actives(item.details)) {
		const unii = moietyOf(ingredient);
		if (unii && !nameOf.has(unii))
			nameOf.set(unii, ingredient.moieties[0]?.name ?? ingredient.name);
	}
	const names = moietyKey
		.split('|')
		.filter(Boolean)
		.map((unii) => nameOf.get(unii) ?? unii);
	return {
		moietyKey,
		moietyNames: names.join(' / '),
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
