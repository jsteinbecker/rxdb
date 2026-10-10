import type { PackageClassKey } from './pharm-class-key';

export type ScopeOption = {
	id: 'all' | 'form' | 'route' | 'strength';
	label: string;
	doseFormGroup: string | null;
	route: string | null;
	strengthKey: string | null;
};

/**
 * The scopes a rule for this package can take, broadest first. Each narrower option keeps the
 * facets of the one before it. A package with several routes offers its first (the matcher
 * accepts a rule's route when the package lists it); `strength` needs a parseable strength.
 */
export function scopeOptions(key: PackageClassKey): ScopeOption[] {
	if (!key.moietyKey) return [];
	const route = key.routes[0] ?? null;
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
	if (route)
		options.push({
			id: 'route',
			label: `${key.doseFormGroup}, ${route.toLowerCase()}`,
			doseFormGroup: key.doseFormGroup,
			route,
			strengthKey: null
		});
	if (key.strengthKey)
		options.push({
			id: 'strength',
			label: `${key.doseFormGroup}${route ? `, ${route.toLowerCase()}` : ''}, this strength`,
			doseFormGroup: key.doseFormGroup,
			route,
			strengthKey: key.strengthKey
		});
	return options;
}
