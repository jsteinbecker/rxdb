// ── Formulary hierarchy ──────────────────────────────────────────────────────
// A formulary view is a list of packages grouped by an ordered list of
// dimensions the user picks: route class → route → dose form → item → … Each
// dimension reads one or more values from a row; a row with several values
// (a combination product's ingredients) repeats under each, and a row with
// none lands in a "Not specified" bucket rather than disappearing.

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
	preferenceRank: number;
	status: string;
	/** How a combination product's dose reads; attached from the formulary settings. */
	doseDisplay?: ComboDoseDisplay;
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

/** "75 mL Bottle", "30 Tablet Blister × 10" */
export function packageSize(row: FormularyRow): string | null {
	if (!row.size) return null;
	const { value, unit, container, packQty } = row.size;
	const packageContainer = container
		.replace(/\b(?:SINGLE|MULTI)[-\s]?DOSE\b/gi, '')
		.replace(/\s*,\s*,/g, ',')
		.replace(/^\s*,\s*|\s*,\s*$/g, '')
		.trim();
	return `${amount(value, unit)} ${titleCase(packageContainer)}${packQty > 1 ? ` × ${packQty}` : ''}`;
}

const routeLabel = (route: string) => `${titleCase(route)} route`;

/**
 * Collapse terminology variants that do not change the useful hierarchy split.
 * Lyophilized describes how a powder for solution is manufactured; it still
 * belongs with the corresponding powder-for-solution dose form here.
 */
export function hierarchyDoseForm(doseForm: string): string {
	const normalized = doseForm
		.replace(/\bLYOPHILIZED\b/gi, '')
		.replace(/\s*,\s*/g, ', ')
		.replace(/,\s*,/g, ',')
		.replace(/\s+/g, ' ')
		.replace(/\s*,\s*$/, '')
		.trim();
	return titleCase(normalized);
}

const routeForm = (doseForm: string) => (route: string) => titleCase(`${route} ${doseForm}`.trim());

/** The combination a row belongs to, e.g. "Amoxicillin / Clavulanate"; null for single agents. */
export function comboKey(row: FormularyRow): string | null {
	const names = [...new Set(row.ingredients.map((item) => titleCase(item.name)))].sort(compare);
	return names.length > 1 ? names.join(' / ') : null;
}

// Mass units scale to milligrams; anything else only sums with itself.
const MASS: Record<string, number> = { g: 1000, mg: 1, mcg: 0.001, ug: 0.001, µg: 0.001, ng: 1e-6 };

/** "500 mg", "5 mg/5 mL" → amount in a base unit over a denominator. */
function parseStrength(strength: string) {
	const match = strength
		.trim()
		.match(/^([\d.,]+)\s*([a-zµ%[\]]+)\s*(?:\/\s*([\d.]*)\s*([a-z[\]]*))?$/i);
	if (!match) return null;
	const value = Number(match[1].replace(/,/g, ''));
	const unit = match[2].toLowerCase();
	if (!Number.isFinite(value)) return null;
	const scale = MASS[unit];
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
	const total = parsed.reduce((sum, item) => sum + item!.base, 0) / (MASS[first.unit] ?? 1);
	return `${Number(total.toPrecision(6))}${first.unit}${first.perLabel}`.replace(/\s+/g, '');
}

export function strengthOf(row: FormularyRow): string {
	const each = row.ingredients.filter((item) => item.strength);
	const display = row.doseDisplay;
	if (display?.mode === 'single') {
		const pick = each.find((item) => titleCase(item.name) === display.ingredient);
		if (pick) return pick.strength!.replace(/\s+/g, '');
	} else if (display?.mode === 'sum' && each.length > 1) {
		const total = summedStrength(each.map((item) => item.strength!));
		if (total) return `${total} total`;
	}
	return each.map((item) => item.strength!.replace(/\s+/g, '')).join(' / ');
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
			const doseForm = clean(row.doseForm);
			return doseForm ? [hierarchyDoseForm(doseForm)] : [];
		}
	},
	{
		key: 'routeForm',
		label: 'Route + form',
		hint: 'Oral Capsule, Intravenous Solution…',
		values: (row) =>
			row.doseForm
				? (row.routes.length ? row.routes : ['']).map(routeForm(hierarchyDoseForm(row.doseForm)))
				: [],
		narrow: (row, value) => ({
			...row,
			routes: row.routes.filter(
				(route) => routeForm(row.doseForm ? hierarchyDoseForm(row.doseForm) : '')(route) === value
			)
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
				return name ? [titleCase(name)] : [];
			})
	},
	{
		key: 'ingredientCombo',
		label: 'Ingredient',
		hint: 'Combination products stay together',
		variant: { key: 'ingredient', mode: 'Combinations', hidden: true },
		values: (row) =>
			row.ingredients.some((item) => clean(item.name))
				? [comboKey(row) ?? titleCase(row.ingredients.find((item) => clean(item.name))!.name)]
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
		values: (row) => (clean(row.labeler) ? [clean(row.labeler)!] : [])
	}
];

export const DIMENSION_BY_KEY = new Map(DIMENSIONS.map((dimension) => [dimension.key, dimension]));

export const DEFAULT_LEVELS = ['routeClass', 'routeForm', 'formularyItem', 'packaging'];

export type TreeNode = {
	/** Stable path key, e.g. "routeClass=Enteral|route=Oral route". */
	id: string;
	dimension: string;
	label: string;
	count: number;
	children: TreeNode[];
	rows: FormularyRow[];
};

const compare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

/**
 * Group rows by each dimension in turn. The last level's nodes hold the rows
 * (packages); an empty level list returns a single flat root.
 */
export function buildTree(rows: FormularyRow[], levels: string[], parent = ''): TreeNode[] {
	const [key, ...rest] = levels;
	const dimension = key ? DIMENSION_BY_KEY.get(key) : undefined;
	if (!dimension) return rest.length ? buildTree(rows, rest, parent) : [];
	const buckets = new Map<string, FormularyRow[]>();
	for (const row of rows) {
		const values = [...new Set(dimension.values(row))];
		for (const value of values.length ? values : [NOT_SPECIFIED])
			buckets.set(value, [
				...(buckets.get(value) ?? []),
				dimension.narrow && values.length ? dimension.narrow(row, value) : row
			]);
	}
	return [...buckets]
		.sort(([a], [b]) => (a === NOT_SPECIFIED ? 1 : b === NOT_SPECIFIED ? -1 : compare(a, b)))
		.map(([label, members]) => {
			const id = `${parent}${parent ? '|' : ''}${key}=${label}`;
			const children = buildTree(members, rest, id);
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
						)
			};
		});
}

/** Parse `?levels=a,b,c`, dropping unknown and duplicate keys. */
export function parseLevels(value: string | null, fallback = DEFAULT_LEVELS): string[] {
	if (value === null) return fallback;
	return [...new Set(value.split(',').filter((key) => DIMENSION_BY_KEY.has(key)))];
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
