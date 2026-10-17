// ── Formulary hierarchy ──────────────────────────────────────────────────────
// A formulary view is a list of packages grouped by an ordered list of
// dimensions the user picks: route class → route → dose form → item → … Each
// dimension reads one or more values from a row; a row with several values
// (a combination product's ingredients) repeats under each, and a row with
// none lands in a "Not specified" bucket rather than disappearing.

import type { KitComposition } from './kit-parts';
import { enantiomerShares, ingredientGroup } from './ingredient-group';
import { labelerGroup } from './labeler-group';
import { naturalCompare } from './natural-sort';
import { mgPer } from './units';
import { canonicalSplForm } from './concept-fill';
import { equivalence, type EquivalenceGroup, type Equivalence } from './equivalence';

export type FormularyRow = {
	packageId: string;
	ndc: string;
	formularyItemId: string;
	formularyItem: string;
	description: string | null;
	displayTitle?: string | null;
	routes: string[];
	doseForm: string | null;
	ingredients: { name: string; strength: string | null }[];
	brandName: string | null;
	genericName: string | null;
	labeler: string | null;
	size: {
		kind: 'volume' | 'mass' | 'count';
		value: number;
		unit: string | null;
		container: string;
		packQty: number;
	} | null;
	isMultiDose: boolean | null;
	/** A kit's parts; its diluent reads beside the drug bottle in the package size. */
	kit?: KitComposition | null;
	preferenceRank: number;
	status: string;
	/** How a combination product's dose reads; attached from the formulary settings. */
	doseDisplay?: ComboDoseDisplay;
	/** Whether provider data has been fetched for the package; false means catalog facts only. */
	enriched?: boolean;
	/** Facts filled from the formulary concept because the package never stated them. */
	inferred?: { ingredients?: boolean; doseForm?: boolean };
	/** The dose form as its equivalence group reads; set by `buildTree`. */
	doseFormLabel?: string;
};

/**
 * Per-combination dose display. Absent means "each": every ingredient's
 * strength listed separately. `sum` adds them in one unit; `single` shows one.
 */
export type ComboDoseDisplay = { mode: 'sum' } | { mode: 'single'; ingredient: string };

export type Dimension = {
	key: string;
	label: string;
	hint: string;
	values: (row: FormularyRow) => string[];
	/**
	 * The row as seen beneath one of its values. A package given by IM and IV
	 * that sits under "Intravenous" should only offer IV to the levels below.
	 */
	narrow?: (row: FormularyRow, value: string) => FormularyRow;
	/**
	 * A sibling dimension this one's chip toggles to, with this one's mode name.
	 * Only the dimension without `hidden` is offered in the palette.
	 */
	variant?: { key: string; mode: string; hidden?: boolean };
};

export const NOT_SPECIFIED = 'Not specified';

const narrowRoutes = (label: (route: string) => string) => (row: FormularyRow, value: string) => ({
	...row,
	routes: row.routes.filter((route) => label(route) === value)
});

const titleCase = (value: string) =>
	value.toLowerCase().replace(/(^|[\s,/(-])([a-z])/g, (_, lead, char) => lead + char.toUpperCase());

const clean = (value: string | null | undefined) => value?.trim() || null;

/** An ingredient as the hierarchy names it: `Cefepime`, never `Cefepime Hydrochloride`. */
export const ingredientLabel = (name: string) =>
	titleCase(ingredientGroup(name)).replace(/-([A-Za-z]{4})$/, (_, suffix) => `-${suffix.toLowerCase()}`);

/**
 * A labeler as the hierarchy names it: `Teva`, for every spelling of Teva.
 * All-caps directory names are title-cased so they meet their label spelling.
 */
export const labelerLabel = (name: string) => {
	const group = labelerGroup(name);
	return group === group.toUpperCase() ? titleCase(group) : group;
};

const ROUTE_CLASSES: [RegExp, string][] = [
	// Word boundaries matter: PARENTERAL contains ENTERAL.
	[/\b(?:ORAL|SUBLINGUAL|BUCCAL|ENTERAL|GASTR|NASOGASTRIC|RECTAL|JEJUN)/i, 'Enteral'],
	[
		/INTRAVENOUS|INTRAMUSCULAR|SUBCUTANEOUS|INTRADERMAL|INTRATHECAL|EPIDURAL|INJECT|PARENTERAL|INTRA/i,
		'Parenteral'
	],
	[/INHAL|RESPIRATORY|NASAL/i, 'Inhalation & nasal'],
	[/TOPICAL|TRANSDERMAL|CUTANEOUS|OPHTHALMIC|OTIC|VAGINAL|DENTAL|MUCOSAL/i, 'Topical & local']
];

export function routeClass(route: string): string {
	return ROUTE_CLASSES.find(([pattern]) => pattern.test(route))?.[1] ?? 'Other routes';
}

const UNIT_DOSE = /unit[-\s]?dose|\bU\.?D\.?\b|BLISTER|DOSE PACK|SINGLE-DOSE|AMPULE|PREFILLED/i;

/** Unit-dose packaging versus bulk stock bottles, from the packaging text. */
export function packagingClass(row: FormularyRow): string {
	if (row.description && UNIT_DOSE.test(row.description)) return 'Unit-dose packaging';
	if (row.size && /BLISTER|CUP|POUCH|PACKET|AMPULE|SYRINGE/i.test(row.size.container))
		return 'Unit-dose packaging';
	return row.description ? 'Bulk packaging' : NOT_SPECIFIED;
}

const amount = (value: number, unit: string | null) =>
	`${Number(value.toPrecision(6))}${unit && /^[a-z%]/i.test(unit) && unit.length <= 3 ? '' : ' '}${unit ? (unit.length > 3 ? titleCase(unit) : unit) : ''}`.trim();

/** "75 mL Bottle", "30 Tablet Blister × 10", a kit's "7.5g Bottle + 145mL Diluent" */
export function packageSize(row: FormularyRow): string | null {
	if (!row.size) return null;
	const { value, unit, container, packQty } = row.size;
	const packageContainer = container
		.replace(/\b(?:SINGLE|MULTI)[-\s]?DOSE\b/gi, '')
		.replace(/\s*,\s*,/g, ',')
		.replace(/^\s*,\s*|\s*,\s*$/g, '')
		.trim();
	const diluent = row.kit?.partOf?.length
		? null
		: row.kit?.parts.find((part) => part.role === 'diluent' && part.amount !== null);
	return `${amount(value, unit)} ${titleCase(packageContainer)}${packQty > 1 ? ` × ${packQty}` : ''}${
		diluent ? ` + ${amount(diluent.amount!, diluent.unit)} Diluent` : ''
	}`;
}

const routeLabel = (route: string) => `${titleCase(route)} route`;

/** The route a Route node's label names ("Oral route" → "Oral"); null for other labels. */
export const routeOfLabel = (label: string): string | null =>
	label.match(/^(.+) route$/)?.[1] ?? null;

/**
 * Collapse terminology variants that do not change the useful hierarchy split.
 * Lyophilized describes how a powder for solution is manufactured; it still
 * belongs with the corresponding powder-for-solution dose form here, as the
 * legacy `FOR SUSPENSION` belongs with `POWDER, FOR SUSPENSION`.
 */
export function hierarchyDoseForm(doseForm: string): string {
	return titleCase(canonicalSplForm(doseForm));
}

/** The dose form a row is grouped under, after equivalence groups. */
const formLabel = (row: FormularyRow) => {
	const doseForm = clean(row.doseForm);
	return doseForm ? (row.doseFormLabel ?? hierarchyDoseForm(doseForm)) : null;
};

const routeForm = (doseForm: string) => (route: string) => titleCase(`${route} ${doseForm}`.trim());

/** The combination a row belongs to, e.g. "Amoxicillin / Clavulanate"; null for single agents. */
export function comboKey(row: FormularyRow): string | null {
	const names = [...new Set(row.ingredients.map((item) => ingredientLabel(item.name)))].sort(
		compare
	);
	return names.length > 1 ? names.join(' / ') : null;
}

// ── Racemates beside one of their own enantiomers ────────────────────────────
// Mixed amphetamine salts list `AMPHETAMINE SULFATE` and `AMPHETAMINE ASPARTATE`
// (racemic) beside `DEXTROAMPHETAMINE SULFATE` and `… SACCHARATE`, so read by
// salt they are four ingredients of two names that overlap. What the product
// delivers is two enantiomers: a racemate is half dextro, half levo. So when a
// product carries `dextroX` or `levoX` beside `X`, every salt of `X` splits
// evenly between the two, and every salt of an enantiomer joins its whole —
// Adderall's four 1.25 mg salts read Dextroamphetamine 3.75 mg / Levoamphetamine
// 1.25 mg. A racemate on its own (Evekeo) is left as the racemate.

/**
 * A product's ingredients with each racemate split into the enantiomers it is
 * made of and every salt of an enantiomer summed into it (see above). Returned
 * unchanged when nothing splits, or when the strengths involved cannot be added
 * (different units or denominators, or some stated and some not).
 */
export function resolveRacemates<T extends { name: string; strength: string | null }>(
	ingredients: T[]
): { name: string; strength: string | null }[] {
	const shares = enantiomerShares(ingredients.map((item) => item.name));
	if (!shares) return ingredients;
	const out: { name: string; parts: { strength: string | null; share: number }[] }[] = [];
	ingredients.forEach((item, index) => {
		for (const { name, share } of shares[index]) {
			const key = name.toLowerCase();
			const found = out.find((entry) => entry.name.toLowerCase() === key);
			if (found) found.parts.push({ strength: item.strength, share });
			else out.push({ name, parts: [{ strength: item.strength, share }] });
		}
	});
	const resolved = out.map(({ name, parts }) => {
		if (parts.length === 1 && parts[0].share === 1) return { name, strength: parts[0].strength };
		if (parts.every((part) => !part.strength)) return { name, strength: null };
		const parsed = parts.map((part) => (part.strength ? parseStrength(part.strength) : null));
		const [first] = parsed;
		if (!first || parsed.some((item) => !item || item.family !== first.family || item.per !== first.per))
			return null;
		const total =
			parsed.reduce((sum, item, at) => sum + item!.base * parts[at].share, 0) / (mgPer(first.unit) ?? 1);
		return { name, strength: `${Number(total.toPrecision(6))} ${first.unit}${first.perLabel}` };
	});
	return resolved.every(Boolean) ? (resolved as { name: string; strength: string | null }[]) : ingredients;
}

/** The ingredient names `resolveRacemates` would list, for keys built from names alone. */
export function racemateNames(names: string[]): string[] {
	const shares = enantiomerShares(names);
	return shares ? [...new Set(shares.flatMap((list) => list.map((entry) => entry.name)))] : names;
}


/** "500 mg", "5 mg/5 mL" → amount in a base unit over a denominator. */
function parseStrength(strength: string) {
	const match = strength
		.trim()
		.match(/^([\d.,]+)\s*([a-zµ%[\]]+)\s*(?:\/\s*([\d.]*)\s*([a-z[\]]*))?$/i);
	if (!match) return null;
	const value = Number(match[1].replace(/,/g, ''));
	const unit = match[2].toLowerCase();
	if (!Number.isFinite(value)) return null;
	// Mass units scale to milligrams; anything else only sums with itself.
	const scale = mgPer(unit);
	return {
		base: scale ? value * scale : value,
		family: scale ? 'mass' : unit,
		unit,
		per: match[3] || match[4] ? `${Number(match[3] || 1)}${(match[4] ?? '').toLowerCase()}` : '',
		// "/1" with no unit is one vial or tablet; it adds nothing to the label.
		perLabel: match[4] ? `/${match[3] || ''}${match[4]}` : ''
	};
}

/**
 * Total of every ingredient's strength in the first ingredient's unit, or null
 * when units or denominators differ (mg + units, mg/mL + mg/5mL).
 */
export function summedStrength(strengths: string[]): string | null {
	const parsed = strengths.map(parseStrength);
	const [first] = parsed;
	if (
		!first ||
		parsed.some((item) => !item || item.family !== first.family || item.per !== first.per)
	)
		return null;
	const total = parsed.reduce((sum, item) => sum + item!.base, 0) / (mgPer(first.unit) ?? 1);
	return `${Number(total.toPrecision(6))}${first.unit}${first.perLabel}`.replace(/\s+/g, '');
}

/**
 * One spelling per strength, so equal amounts share a hierarchy node: `1 g/1`,
 * `1000 mg/1` and `1 g` all read `1g`. A mass takes the largest of g, mg and
 * mcg that keeps it at or above one (below 1 mg it keeps its own unit, since
 * `0.5 mg/mL` is how that concentration is written); denominators are kept.
 */
export function normalizeStrength(strength: string): string {
	const parsed = parseStrength(strength);
	if (!parsed) return strength.replace(/\s+/g, '');
	const unit =
		parsed.family !== 'mass'
			? parsed.unit
			: parsed.base >= 1000
				? 'g'
				: parsed.base >= 1
					? 'mg'
					: parsed.unit;
	const value = parsed.family === 'mass' ? parsed.base / mgPer(unit)! : parsed.base;
	return `${Number(value.toPrecision(6))}${unit}${parsed.perLabel}`;
}

export function strengthOf(row: FormularyRow): string {
	const each = row.ingredients.filter((item) => item.strength);
	const display = row.doseDisplay;
	if (display?.mode === 'single') {
		const pick = each.find((item) => ingredientLabel(item.name) === display.ingredient);
		if (pick) return normalizeStrength(pick.strength!);
	} else if (display?.mode === 'sum' && each.length > 1) {
		const total = summedStrength(each.map((item) => item.strength!));
		if (total) return `${normalizeStrength(total)} total`;
	}
	return each.map((item) => normalizeStrength(item.strength!)).join(' / ');
}

export const DIMENSIONS: Dimension[] = [
	{
		key: 'routeClass',
		label: 'Route class',
		hint: 'Enteral, parenteral, topical…',
		values: (row) => [...new Set(row.routes.map(routeClass))],
		narrow: narrowRoutes(routeClass)
	},
	{
		key: 'route',
		label: 'Route',
		hint: 'Oral, intravenous…',
		values: (row) => row.routes.map(routeLabel),
		narrow: narrowRoutes(routeLabel)
	},
	{
		key: 'doseForm',
		label: 'Dose form',
		hint: 'Capsule, powder for suspension…',
		values: (row) => {
			const doseForm = formLabel(row);
			return doseForm ? [doseForm] : [];
		}
	},
	{
		key: 'routeForm',
		label: 'Route + form',
		hint: 'Oral Capsule, Intravenous Solution…',
		values: (row) => {
			const doseForm = formLabel(row);
			return doseForm ? (row.routes.length ? row.routes : ['']).map(routeForm(doseForm)) : [];
		},
		narrow: (row, value) => ({
			...row,
			routes: row.routes.filter((route) => routeForm(formLabel(row) ?? '')(route) === value)
		})
	},
	{
		key: 'ingredient',
		label: 'Ingredient',
		hint: 'Each active ingredient',
		variant: { key: 'ingredientCombo', mode: 'Separated' },
		values: (row) =>
			row.ingredients.flatMap((item) => {
				const name = clean(item.name);
				return name ? [ingredientLabel(name)] : [];
			})
	},
	{
		key: 'ingredientCombo',
		label: 'Ingredient',
		hint: 'Combination products stay together',
		variant: { key: 'ingredient', mode: 'Combinations', hidden: true },
		values: (row) =>
			row.ingredients.some((item) => clean(item.name))
				? [comboKey(row) ?? ingredientLabel(row.ingredients.find((item) => clean(item.name))!.name)]
				: []
	},
	{
		key: 'formularyItem',
		label: 'Formulary item',
		hint: 'The loaded concept or package',
		values: (row) => [row.formularyItem]
	},
	{
		key: 'strength',
		label: 'Strength',
		hint: '500 mg, 50 mg/mL…',
		values: (row) => {
			const strength = strengthOf(row);
			return clean(strength) ? [strength] : [];
		}
	},
	{
		key: 'packaging',
		label: 'Packaging',
		hint: 'Unit dose vs bulk',
		values: (row) => [packagingClass(row)]
	},
	{
		key: 'doseType',
		label: 'Dose type',
		hint: 'Single- vs multi-dose',
		values: (row) =>
			row.isMultiDose === null ? [] : [row.isMultiDose ? 'Multi-dose' : 'Single-dose']
	},
	{
		key: 'packageSize',
		label: 'Package size',
		hint: '75 mL Bottle, 100 Tablet Bottle…',
		values: (row) => {
			const size = packageSize(row);
			return size ? [size] : [];
		}
	},
	{
		key: 'brand',
		label: 'Brand / generic',
		hint: 'Proprietary name',
		values: (row) => [
			row.brandName && row.brandName.toLowerCase() !== row.genericName?.toLowerCase()
				? titleCase(row.brandName)
				: 'Generic'
		]
	},
	{
		key: 'labeler',
		label: 'Labeler',
		hint: 'Manufacturer or repackager',
		values: (row) => {
				const labeler = clean(row.labeler);
				return labeler ? [labelerLabel(labeler)] : [];
			}
	}
];

export const DIMENSION_BY_KEY = new Map(DIMENSIONS.map((dimension) => [dimension.key, dimension]));

export const DEFAULT_LEVELS = ['routeClass', 'routeForm', 'formularyItem', 'packaging'];

/**
 * A level is a dimension key, suffixed with `~` when its nodes absorb an only
 * child, radix-tree style: "IV" over a lone "Thiamine" reads "IV – Thiamine".
 */
export const MERGE_MARK = '~';

/** The dimension key a level groups by, without its merge mark. */
export const levelDimension = (level: string) =>
	level.endsWith(MERGE_MARK) ? level.slice(0, -MERGE_MARK.length) : level;

/** Whether a level's nodes absorb an only child. */
export const mergesChildren = (level: string) => level.endsWith(MERGE_MARK);

/** Turn a level's merge mark on or off. */
export const withMerge = (level: string, merge: boolean) =>
	levelDimension(level) + (merge ? MERGE_MARK : '');

/** A level's display name, e.g. "Route class". */
export const levelLabel = (level: string) => DIMENSION_BY_KEY.get(levelDimension(level))?.label;

/** Valid levels, merge marks kept, one per dimension. */
export function validLevelKeys(levels: string[]): string[] {
	const seen = new Set<string>();
	return levels.filter((level) => {
		const key = levelDimension(level);
		if (!DIMENSION_BY_KEY.has(key) || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export type TreeNode = {
	/** Stable path key, e.g. "routeClass=Enteral|route=Oral route". */
	id: string;
	dimension: string;
	label: string;
	count: number;
	children: TreeNode[];
	rows: FormularyRow[];
	/** Ancestors merged into this node, outermost first; they read before its label. */
	merged?: { dimension: string; label: string }[];
	/** The values an equivalence group gathered under this label, when they differ from it. */
	equivalent?: string[];
};

/** Separator between a merged node's segments. */
export const MERGE_SEPARATOR = ' – ';

const compare = naturalCompare;

export type TreeOptions = {
	/** Values of one dimension that read as one node. */
	equivalenceGroups?: EquivalenceGroup[];
};

/**
 * Group rows by each dimension in turn. The last level's nodes hold the rows
 * (packages); an empty level list returns a single flat root. Equivalence
 * groups merge sibling values into their display label; a dose-form group
 * also merges the form within "Route + form".
 */
export function buildTree(
	rows: FormularyRow[],
	levels: string[],
	options: TreeOptions = {}
): TreeNode[] {
	const groups = options.equivalenceGroups ?? [];
	const eq = equivalence(groups);
	const formGroups = groups.some((group) => group.dimension === 'doseForm');
	const prepared = formGroups
		? rows.map((row) => {
				const doseForm = clean(row.doseForm);
				return doseForm
					? { ...row, doseFormLabel: eq('doseForm', hierarchyDoseForm(doseForm)) }
					: row;
			})
		: rows;
	return grow(prepared, levels, groups.length ? eq : null, '');
}

/**
 * A row as seen beneath an equivalence label: narrowed to every original
 * value that label gathers, its routes joined.
 */
function narrowAll(
	dimension: Dimension,
	row: FormularyRow,
	originals: string[]
): FormularyRow {
	if (!dimension.narrow) return row;
	const views = originals.map((value) => dimension.narrow!(row, value));
	return views.length === 1
		? views[0]
		: { ...views[0], routes: [...new Set(views.flatMap((view) => view.routes))] };
}

function grow(
	rows: FormularyRow[],
	levels: string[],
	eq: Equivalence | null,
	parent: string
): TreeNode[] {
	const [level, ...rest] = levels;
	const key = level && levelDimension(level);
	const dimension = key ? DIMENSION_BY_KEY.get(key) : undefined;
	if (!dimension) return rest.length ? grow(rows, rest, eq, parent) : [];
	const buckets = new Map<string, FormularyRow[]>();
	const gathered = new Map<string, Set<string>>();
	for (const row of rows) {
		const originals = [...new Set(dimension.values(row))];
		const labels = new Map<string, string[]>();
		for (const value of originals) {
			const label = eq ? eq(key, value) : value;
			labels.set(label, [...(labels.get(label) ?? []), value]);
			if (label !== value) gathered.set(label, (gathered.get(label) ?? new Set()).add(value));
		}
		// Dose forms were mapped before grouping so Route + form shares them; recover the spelling.
		if (key === 'doseForm' && row.doseFormLabel && row.doseForm) {
			const original = hierarchyDoseForm(row.doseForm);
			if (original !== row.doseFormLabel)
				gathered.set(
					row.doseFormLabel,
					(gathered.get(row.doseFormLabel) ?? new Set()).add(original)
				);
		}
		if (!labels.size) labels.set(NOT_SPECIFIED, []);
		for (const [label, values] of labels)
			buckets.set(label, [
				...(buckets.get(label) ?? []),
				values.length ? narrowAll(dimension, row, values) : row
			]);
	}
	return [...buckets]
		.sort(([a], [b]) => (a === NOT_SPECIFIED ? 1 : b === NOT_SPECIFIED ? -1 : compare(a, b)))
		.map(([label, members]) => {
			const id = `${parent}${parent ? '|' : ''}${key}=${label}`;
			const children = grow(members, rest, eq, id);
			// Every row lands in some child, so an only child holds them all.
			if (mergesChildren(level) && children.length === 1) {
				const [child] = children;
				return { ...child, merged: [{ dimension: key, label }, ...(child.merged ?? [])] };
			}
			const equivalent = gathered.get(label);
			return {
				id,
				dimension: key,
				label,
				count: members.length,
				children,
				rows: children.length
					? []
					: [...members].sort(
							(a, b) => a.preferenceRank - b.preferenceRank || compare(a.ndc, b.ndc)
						),
				...(equivalent ? { equivalent: [...equivalent].sort(compare) } : {})
			};
		});
}

/** Each value a dimension takes across the rows, with how many rows take it. */
export function dimensionValues(rows: FormularyRow[], key: string): { label: string; count: number }[] {
	const dimension = DIMENSION_BY_KEY.get(key);
	if (!dimension) return [];
	const counts = new Map<string, number>();
	for (const row of rows)
		for (const value of new Set(dimension.values(row)))
			counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => compare(a.label, b.label));
}

/** Parse `?levels=a,b~,c`, dropping unknown and duplicate keys. */
export function parseLevels(value: string | null, fallback = DEFAULT_LEVELS): string[] {
	if (value === null) return fallback;
	return validLevelKeys(value.split(','));
}

/**
 * A summed combo's description, e.g. "ampicillin 100 MG/ML / sulbactam 50 MG/ML
 * Injectable Solution" → names "ampicillin / sulbactam", strength "150 MG/ML",
 * rest "Injectable Solution"; null when the row isn't summed or won't parse.
 */
export function summedDescription(
	text: string | null | undefined,
	display: ComboDoseDisplay | undefined
): { names: string; strength: string; rest: string } | null {
	if (display?.mode !== 'sum' || !text) return null;
	const segments = text.split(' / ');
	if (segments.length < 2) return null;
	const strengthPattern = String.raw`([\d.,]+\s*[a-zµ%[\]]+(?:\/[\d.]*\s*[a-z[\]]+)?)`;
	const parts = segments.map((segment, index) =>
		segment.match(
			new RegExp(
				`^(.+?)\\s+${strengthPattern}${index === segments.length - 1 ? '(.*)$' : '$'}`,
				'i'
			)
		)
	);
	if (parts.some((match) => !match)) return null;
	const total = summedStrength(parts.map((match) => match![2]));
	const split = total?.match(/^([\d.]+)(.+)$/);
	if (!split) return null;
	return {
		names: parts.map((match) => match![1]).join(' / '),
		strength: `${split[1]} ${split[2].toUpperCase()}`,
		rest: (parts.at(-1)![3] ?? '').trim()
	};
}
