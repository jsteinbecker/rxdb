// ── Formulary settings ───────────────────────────────────────────────────────
// Preferences stored on the formulary scope. Anything missing or malformed
// falls back to the default, so older rows and hand edits never break a page.

import { DEFAULT_LEVELS, DIMENSION_BY_KEY, type ComboDoseDisplay } from './formulary-hierarchy';

export type ExpandDepth = 'none' | 'first' | 'all';

export type FormularySettings = {
	/** Hierarchy used when the formulary is opened without `?levels=`. */
	defaultLevels: string[];
	/** How much of the tree is open when the formulary first renders. */
	expandDepth: ExpandDepth;
	/** Ask before removing a single loaded item. */
	confirmRemove: boolean;
	/** Dose display per combination, keyed by `comboKey`; missing means each separately. */
	comboDoseDisplay: Record<string, ComboDoseDisplay>;
};

export const DEFAULT_SETTINGS: FormularySettings = {
	defaultLevels: DEFAULT_LEVELS,
	expandDepth: 'none',
	confirmRemove: true,
	comboDoseDisplay: {}
};

export function parseComboDoseDisplay(value: unknown): ComboDoseDisplay | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (raw.mode === 'sum') return { mode: 'sum' };
	if (raw.mode === 'single' && typeof raw.ingredient === 'string' && raw.ingredient)
		return { mode: 'single', ingredient: raw.ingredient };
	return null;
}

const EXPAND_DEPTHS: ExpandDepth[] = ['none', 'first', 'all'];

export function parseSettings(value: unknown): FormularySettings {
	const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const levels = Array.isArray(raw.defaultLevels)
		? [
				...new Set(
					raw.defaultLevels.filter(
						(key): key is string => typeof key === 'string' && DIMENSION_BY_KEY.has(key)
					)
				)
			]
		: DEFAULT_SETTINGS.defaultLevels;
	return {
		defaultLevels: levels,
		expandDepth: EXPAND_DEPTHS.includes(raw.expandDepth as ExpandDepth)
			? (raw.expandDepth as ExpandDepth)
			: DEFAULT_SETTINGS.expandDepth,
		confirmRemove:
			typeof raw.confirmRemove === 'boolean' ? raw.confirmRemove : DEFAULT_SETTINGS.confirmRemove,
		comboDoseDisplay: Object.fromEntries(
			Object.entries(
				raw.comboDoseDisplay && typeof raw.comboDoseDisplay === 'object' ? raw.comboDoseDisplay : {}
			).flatMap(([key, display]) => {
				const parsed = parseComboDoseDisplay(display);
				return parsed ? [[key, parsed]] : [];
			})
		)
	};
}
