/**
 * A formulary item's page: its packages laid out as labeler › product › package
 * with shared facts summarized, and related items worth jumping to.
 *
 * @module
 */
import { naturalCompare } from '../shared/natural-sort';
import { packageTitle } from '../catalog/package-title';
import {
	applyStrengthStyles,
	formContext,
	styledIngredientStrength,
	type StrengthStyleRule
} from '../medication/strength-style';
import {
	hierarchyDoseForm,
	ingredientLabel,
	labelerLabel,
	normalizeStrength,
	packageSize,
	projectDoseForm,
	projectRows,
	type DoseType,
	type FormularyRow
} from './hierarchy';

/** The packages one formulary item linked in, best preference first, then by NDC. */
export function itemPackages(rows: FormularyRow[], formularyItemId: string): FormularyRow[] {
	return rows
		.filter((row) => row.formularyItemId === formularyItemId)
		.sort((a, b) => a.preferenceRank - b.preferenceRank || a.ndc.localeCompare(b.ndc));
}

export type RelatedItem = { id: string; name: string; doseForm: string | null };
export type RelatedItems = { basis: 'ingredient+doseForm' | 'ingredient'; items: RelatedItem[] };

type ItemProfile = { id: string; name: string; ingredients: string; doseForm: string | null };

function profiles(rows: FormularyRow[]): Map<string, ItemProfile> {
	const byItem = new Map<string, ItemProfile & { names: Set<string> }>();
	for (const row of rows) {
		const entry = byItem.get(row.formularyItemId) ?? {
			id: row.formularyItemId,
			name: row.formularyItem,
			ingredients: '',
			doseForm: row.doseForm ? hierarchyDoseForm(row.doseForm) : null,
			names: new Set<string>()
		};
		for (const ingredient of row.ingredients) entry.names.add(ingredientLabel(ingredient.name));
		byItem.set(row.formularyItemId, entry);
	}
	for (const entry of byItem.values())
		entry.ingredients = [...entry.names].sort(naturalCompare).join(' / ');
	return byItem;
}

/**
 * Other formulary items worth jumping to from this one: those with the same
 * ingredient(s) and dose form when any exist, otherwise those with the same
 * ingredient(s) in any dose form. Null when the item has no ingredients or no kin.
 */
export function relatedItems(rows: FormularyRow[], formularyItemId: string): RelatedItems | null {
	const all = profiles(rows);
	const self = all.get(formularyItemId);
	if (!self?.ingredients) return null;
	const kin = [...all.values()]
		.filter((other) => other.id !== formularyItemId && other.ingredients === self.ingredients)
		.sort((a, b) => naturalCompare(a.name, b.name));
	const sameForm = kin.filter((other) => other.doseForm === self.doseForm);
	const basis = sameForm.length > 0 ? 'ingredient+doseForm' : 'ingredient';
	const chosen = basis === 'ingredient+doseForm' ? sameForm : kin;
	if (chosen.length === 0) return null;
	return {
		basis,
		items: chosen.map(({ id, name, doseForm }) => ({ id, name, doseForm }))
	};
}

export type PackageLine = {
	packageId: string;
	ndc: string;
	/** The package's own title, which its NDC link names for the page it opens. */
	title: string;
	pack: string | null;
	/** The injectable dose type the hierarchy classes this package as. */
	doseType: DoseType | null;
	/** Dose form as its equivalence group shows it; `doseFormRaw` is the stored spelling. */
	doseForm: string | null;
	doseFormRaw: string | null;
	routes: string[];
	rank: number;
	status: string;
	inferred?: FormularyRow['inferred'];
};
export type ProductGroup = { product: string; packages: PackageLine[] };
export type LabelerGroup = { labeler: string; count: number; products: ProductGroup[] };
/** A labeler's packages that have no provider data yet: only their NDCs are worth listing. */
export type PendingLabeler = { labeler: string; ndcs: string[] };
export type PackageLayout = {
	shared: string[];
	sharedRoutes: string[];
	showDoseForm: boolean;
	showRoutes: boolean;
	showRank: boolean;
	/** Enriched packages, as labeler > product > package tables. */
	groups: LabelerGroup[];
	/** Packages not enriched yet, by labeler, most packages first. */
	pending: PendingLabeler[];
	pendingCount: number;
};

/** Each ingredient and strength; with display rules, strengths read as they ask ("1:4,000"). */
const strengthLine = (row: FormularyRow, normalize = false, rules: StrengthStyleRule[] = []) => {
	const form = rules.length ? formContext(row.displayTitle, row.doseForm, row.routes) : '';
	return row.ingredients
		.map((i) =>
			// A label's "/1" (per tablet, per vial) adds nothing a reader needs.
			[
				ingredientLabel(i.name),
				i.strength &&
					(normalize
						? normalizeStrength(i.strength)
						: (styledIngredientStrength(
								rules,
								i,
								form,
								row.ingredients.filter((other) => other !== i).map((other) => other.name)
							) ?? i.strength.replace(/\s*\/\s*1$/, '')))
			]
				.filter(Boolean)
				.join(' ')
		)
		.sort(naturalCompare)
		.join(' / ');
};

/**
 * Lay an item's packages out as labeler > product > package. Facts identical across
 * every package move to a one-line summary; only differing ones become columns.
 * Packages without provider data would only fill those columns with dashes, so they
 * are listed apart, by labeler. Groups and rows keep the best-preference-first order.
 */
export function packageLayout(
	rows: FormularyRow[],
	/** Strength display rules for the shared strength line and package titles. */
	rules: StrengthStyleRule[] = []
): PackageLayout {
	// Unprojected rows still get the hierarchy's dose types, without equivalence groups.
	const packages = rows.some((row) => row.doseType === undefined) ? projectRows(rows) : rows;
	const enriched = packages.filter((row) => row.enriched !== false);
	const distinct = (rows: FormularyRow[], pick: (row: FormularyRow) => string) =>
		new Set(rows.map(pick));
	const formOf = (row: FormularyRow) =>
		row.doseFormLabel ?? projectDoseForm(row.doseForm)?.display ?? '';
	const doseForms = distinct(packages, formOf);
	// Columns describe the tables, so only the packages shown in them decide them.
	const tableForms = distinct(enriched, formOf);
	const routes = distinct(enriched, (r) => [...r.routes].sort().join(', '));
	// Compared in one spelling: a concept's `500 MG` and a label's `500 mg/1` are the same strength.
	const strengths = distinct(packages, (row) => strengthLine(row, true));
	const first = packages[0];
	const showDoseForm = tableForms.size > 1;
	const showRoutes = routes.size > 1;
	const shared = first
		? [
				strengths.size === 1 ? strengthLine(first, false, rules) : '',
				doseForms.size === 1 ? formOf(first) : ''
			].filter(Boolean)
		: [];

	const sharedRoutes = enriched[0] && !showRoutes ? [...enriched[0].routes].sort() : [];
	// One heading per company, however each source spells it.
	// A company no source names is still kept apart from the others by its labeler code.
	const labelerOf = (row: FormularyRow) =>
		row.labeler ? labelerLabel(row.labeler) : `Labeler ${row.ndc.slice(0, 5)}`;

	const labelers = new Map<string, Map<string, PackageLine[]>>();
	const pending = new Map<string, string[]>();
	for (const row of packages) {
		const labeler = labelerOf(row);
		if (row.enriched === false) {
			pending.set(labeler, [...(pending.get(labeler) ?? []), row.ndc]);
			continue;
		}
		const product =
			row.brandName ?? row.genericName ?? `Product ${row.ndc.slice(0, 5)}-${row.ndc.slice(5, 9)}`;
		const products = labelers.get(labeler) ?? new Map<string, PackageLine[]>();
		const lines = products.get(product) ?? [];
		lines.push({
			packageId: row.packageId,
			ndc: row.ndc,
			title: applyStrengthStyles(packageTitle(row), rules),
			pack: packageSize(row),
			doseType: row.doseType ?? null,
			doseForm: formOf(row) || null,
			doseFormRaw: row.doseForm,
			routes: [...row.routes].sort(),
			rank: row.preferenceRank,
			status: row.status,
			inferred: row.inferred
		});
		products.set(product, lines);
		labelers.set(labeler, products);
	}
	return {
		shared,
		sharedRoutes,
		showDoseForm,
		showRoutes,
		showRank: packages.length > 1 && new Set(packages.map((r) => r.preferenceRank)).size > 1,
		groups: [...labelers].map(([labeler, products]) => ({
			labeler,
			count: [...products.values()].reduce((sum, lines) => sum + lines.length, 0),
			products: [...products].map(([product, lines]) => ({ product, packages: lines }))
		})),
		pending: [...pending]
			.map(([labeler, ndcs]) => ({ labeler, ndcs }))
			.sort((a, b) => b.ndcs.length - a.ndcs.length || naturalCompare(a.labeler, b.labeler)),
		pendingCount: packages.length - enriched.length
	};
}

/**
 * Row spans that merge adjacent equal keys into one cell: the first row of each
 * run gets the run's length, the rows it covers get 0 (render no cell).
 * `null` keys never merge, so a missing value is shown on every row it's missing from.
 */
export function runSpans(keys: (string | null)[]): number[] {
	const spans = keys.map(() => 1);
	let start = 0;
	for (let i = 1; i <= keys.length; i++) {
		if (i < keys.length && keys[i] !== null && keys[i] === keys[start]) continue;
		spans[start] = i - start;
		for (let j = start + 1; j < i; j++) spans[j] = 0;
		start = i;
	}
	return spans;
}
