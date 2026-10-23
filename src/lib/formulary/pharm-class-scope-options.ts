/**
 * The scopes a pharmacologic class rule for a package can take, broadest first:
 * all forms, the dose-form group, each listed route, then the strength.
 *
 * @module
 */
import type { PackageClassKey } from './pharm-class-key';

export type ScopeOption = {
	/** `all`, `form`, `strength`, or `route:<ROUTE>` (one per route the package lists). */
	id: 'all' | 'form' | 'strength' | `route:${string}`;
	label: string;
	doseFormGroup: string | null;
	route: string | null;
	strengthKey: string | null;
};

/**
 * The scopes a rule for this package can take, broadest first: all forms, the dose-form group, one
 * option per listed route, then the strength. The strength option keeps the route only when the
 * package lists exactly one (it is then the cumulative narrowing); with several routes it applies
 * across them, since the matcher accepts a route-less rule and picking one route would be arbitrary.
 * `strength` needs a parseable strength. No moiety key means no rules at all.
 */
export function scopeOptions(key: PackageClassKey): ScopeOption[] {
	if (!key.moietyKey) return [];
	const routes = [...new Set(key.routes)];
	const options: ScopeOption[] = [
		{ id: 'all', label: 'All forms', doseFormGroup: null, route: null, strengthKey: null },
		{
			id: 'form',
			label: `${key.doseFormGroup} only`,
			doseFormGroup: key.doseFormGroup,
			route: null,
			strengthKey: null
		}
	];
	for (const route of routes)
		options.push({
			id: `route:${route}`,
			label: `${key.doseFormGroup}, ${route.toLowerCase()} route only`,
			doseFormGroup: key.doseFormGroup,
			route,
			strengthKey: null
		});
	if (key.strengthKey) {
		const route = routes.length === 1 ? routes[0] : null;
		options.push({
			id: 'strength',
			label: `${key.doseFormGroup}${route ? `, ${route.toLowerCase()}` : routes.length ? ', any route' : ''}, this strength`,
			doseFormGroup: key.doseFormGroup,
			route,
			strengthKey: key.strengthKey
		});
	}
	return options;
}
