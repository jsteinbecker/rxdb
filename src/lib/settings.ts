// ── Formulary settings ───────────────────────────────────────────────────────
// Preferences stored on the formulary scope. Anything missing or malformed
// falls back to the default, so older rows and hand edits never break a page.

import { naturalCompare } from './natural-sort';
import {
  type ComboDoseDisplay,
  DEFAULT_LEVELS,
  DIMENSION_BY_KEY,
  ingredientLabel,
  racemateNames,
  validLevelKeys
} from './formulary-hierarchy';
import { type EquivalenceGroup, parseEquivalenceGroups } from './equivalence';

export type ExpandDepth = 'none' | 'first' | 'all';

/** A named hierarchy, built in Settings and picked on the formulary. */
export type FormularyView = { name: string; levels: string[] };

/** Views a formulary starts with before any are saved. */
export const BUILT_IN_VIEWS: FormularyView[] = [
	{ name: 'Route → form → item', levels: DEFAULT_LEVELS },
	{ name: 'Ingredient → strength → size', levels: ['ingredient', 'doseForm', 'strength', 'packageSize'] },
	{ name: 'Labeler → item', levels: ['labeler', 'formularyItem'] },
	{ name: 'Flat list', levels: [] }
];

export type FormularySettings = {
	/** Hierarchy used when the formulary is opened without `?levels=`. */
	defaultLevels: string[];
	/** Saved views offered on the formulary, in order. */
	views: FormularyView[];
	/** Name of the view the formulary opens with; null falls back to `defaultLevels`. */
	defaultView: string | null;
	/** How much of the tree is open when the formulary first renders. */
	expandDepth: ExpandDepth;
	/** Ask before removing a single loaded item. */
	confirmRemove: boolean;
	/** Dose display per combination, keyed by `comboKey`; missing means each separately. */
	comboDoseDisplay: Record<string, ComboDoseDisplay>;
	/** Pill drawings give every imprint string on a face one size unless ILN sizes it explicitly. */
	uniformImprintSize: boolean;
	/** Sibling values the hierarchy merges into one node, per dimension. */
	equivalenceGroups: EquivalenceGroup[];
};

export const DEFAULT_SETTINGS: FormularySettings = {
	defaultLevels: DEFAULT_LEVELS,
	views: BUILT_IN_VIEWS,
	defaultView: BUILT_IN_VIEWS[0].name,
	expandDepth: 'none',
	confirmRemove: true,
	comboDoseDisplay: {},
	uniformImprintSize: false,
	equivalenceGroups: []
};

export function parseComboDoseDisplay(value: unknown): ComboDoseDisplay | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (raw.mode === 'sum') return { mode: 'sum' };
	if (raw.mode === 'single' && typeof raw.ingredient === 'string' && raw.ingredient)
		return { mode: 'single', ingredient: ingredientLabel(raw.ingredient) };
	return null;
}


/**
 * Keys saved before salts were grouped (`Piperacillin Sodium / …`), or before
 * racemates split (`Amphetamine / … / Dextroamphetamine`), read as `comboKey` now makes them.
 */
function canonicalComboKey(key: string): string {
	return [...new Set(racemateNames(key.split(' / ')).map(ingredientLabel))]
		.sort(naturalCompare)
		.join(' / ');
}

const EXPAND_DEPTHS: ExpandDepth[] = ['none', 'first', 'all'];

function validLevels(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	return validLevelKeys(value.filter((key): key is string => typeof key === 'string'));
}

function parseViews(value: unknown): FormularyView[] {
	if (!Array.isArray(value)) return DEFAULT_SETTINGS.views;
	const seen = new Set<string>();
	return value.flatMap((view) => {
		if (!view || typeof view !== 'object') return [];
		const raw = view as Record<string, unknown>;
		const name = typeof raw.name === 'string' ? raw.name.trim() : '';
		const levels = validLevels(raw.levels);
		if (!name || !levels || seen.has(name)) return [];
		seen.add(name);
		return [{ name, levels }];
	});
}

export function parseSettings(value: unknown): FormularySettings {
	const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const views = parseViews(raw.views);
	const defaultView =
		typeof raw.defaultView === 'string' && views.some((view) => view.name === raw.defaultView)
			? raw.defaultView
			: raw.views === undefined && raw.defaultLevels === undefined
				? DEFAULT_SETTINGS.defaultView
				: null;
	const levels =
		views.find((view) => view.name === defaultView)?.levels ??
		validLevels(raw.defaultLevels) ??
		DEFAULT_SETTINGS.defaultLevels;
	return {
		defaultLevels: levels,
		views,
		defaultView,
		expandDepth: EXPAND_DEPTHS.includes(raw.expandDepth as ExpandDepth)
			? (raw.expandDepth as ExpandDepth)
			: DEFAULT_SETTINGS.expandDepth,
		confirmRemove:
			typeof raw.confirmRemove === 'boolean' ? raw.confirmRemove : DEFAULT_SETTINGS.confirmRemove,
		uniformImprintSize:
			typeof raw.uniformImprintSize === 'boolean'
				? raw.uniformImprintSize
				: DEFAULT_SETTINGS.uniformImprintSize,
		equivalenceGroups: parseEquivalenceGroups(
			raw.equivalenceGroups,
			new Set(DIMENSION_BY_KEY.keys())
		),
		comboDoseDisplay: Object.fromEntries(
			Object.entries(
				raw.comboDoseDisplay && typeof raw.comboDoseDisplay === 'object' ? raw.comboDoseDisplay : {}
			).flatMap(([key, display]) => {
				const parsed = parseComboDoseDisplay(display);
				return parsed ? [[canonicalComboKey(key), parsed]] : [];
			})
		)
	};
}
