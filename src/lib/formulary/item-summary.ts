/**
 * One formulary item's facts consolidated across every package linked into it,
 * each value tallied with the NDCs that state it.
 *
 * @module
 */
import { convertQuantity, formatQuantity, parseQuantity } from '../medication/quantity';
import { multiply, parseRational } from '../medication/rational';
import { rxNormStrengths, type RxStrength } from '../labels/spl-strength-checks';
import { naturalCompare } from '../shared/natural-sort';
import { packageSize, projectDoseForm, projectRows, type FormularyRow } from './hierarchy';
import { appearanceText, hasAppearance } from '../labels/spl-characteristics';
import type { ExternalPackage } from '../catalog/types';
import { scdShownStrength } from '../catalog/package-title';

/** A value and the NDCs that state it; `raw` keeps the stored spellings a grouped value gathers. */
export type Tally = { value: string; ndcs: string[]; raw?: string[] };
/** A dose type and the NDCs it applies to; `inherited` lists the ones a sibling lent it to. */
export type DoseTypeTally = Tally & { reasons: Record<string, string>; inherited: string[] };
export type ActiveIngredient = {
	name: string;
	unii: string | null;
	moieties: string[];
	strengths: Tally[];
	ndcs: string[];
};
export type Application = {
	number: string;
	category: string | null;
	labelers: string[];
	ndcs: string[];
};
export type LabelSource = {
	setId: string;
	title: string | null;
	effective: string | null;
	version: string | null;
	ndcs: string[];
};
export type RxcuiSource = {
	rxcui: string;
	name: string | null;
	status: string | null;
	ndcs: string[];
};

/** One formulary item's facts, consolidated across every package linked into it. */
export type ItemSummary = {
	packageCount: number;
	/** Packages with enrichment data; facts below only come from these. */
	enriched: number;
	labelers: Tally[];
	products: Tally[];
	doseForms: Tally[];
	routes: Tally[];
	sizes: Tally[];
	/** Injectable dose types (SDV, MDV, …) from the hierarchy's classifier, siblings filling gaps. */
	doseTypes: DoseTypeTally[];
	dryFill: string[];
	kits: string[];
	samples: string[];
	active: ActiveIngredient[];
	inactive: Tally[];
	productTypes: Tally[];
	marketingCategories: Tally[];
	applications: Application[];
	deaSchedules: Tally[];
	pharmClasses: Tally[];
	marketingStart: { earliest: string; latest: string } | null;
	listingExpires: { earliest: string; latest: string } | null;
	ended: Tally[];
	unlisted: string[];
	inactivated: string[];
	veterinary: string[];
	rxcuis: RxcuiSource[];
	labels: LabelSource[];
	appearances: Tally[];
	statuses: Tally[];
};

/** Collects NDCs under keys, remembering the first display value for each key. */
class Tallier {
	private entries = new Map<string, Tally>();
	add(value: string | null | undefined, ndc: string, key = value?.trim().toUpperCase()) {
		const text = value?.trim();
		if (!text || !key) return;
		const entry = this.entries.get(key) ?? { value: text, ndcs: [] };
		if (!entry.ndcs.includes(ndc)) entry.ndcs.push(ndc);
		this.entries.set(key, entry);
	}
	/** Most widely shared first, then by name. */
	list(): Tally[] {
		return [...this.entries.values()].sort(
			(a, b) => b.ndcs.length - a.ndcs.length || naturalCompare(a.value, b.value)
		);
	}
}

/** openFDA writes `20190314`; ISO strings keep their date part. */
export function isoDate(value: string | null | undefined): string | null {
	if (!value) return null;
	const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
	if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
	const iso = /^\d{4}-\d{2}-\d{2}/.exec(value.trim());
	return iso ? iso[0] : null;
}

function span(dates: (string | null)[]): { earliest: string; latest: string } | null {
	const known = dates.filter((date): date is string => date !== null).sort();
	return known.length ? { earliest: known[0], latest: known[known.length - 1] } : null;
}

/**
 * Consolidate what the catalog knows about each of an item's packages into one
 * summary. `rows` carry the formulary's own view (labeler, product, size);
 * `snapshots` carry the enrichment detail behind it, keyed by NDC.
 */
export function summarizeItem(
	rows: FormularyRow[],
	snapshots: Map<string, ExternalPackage>,
	title?: string | null
): ItemSummary {
	const nominal = rxNormStrengths(title);
	const t = () => new Tallier();
	const labelers = t(),
		products = t(),
		doseForms = t(),
		routes = t(),
		sizes = t();
	const inactive = t(),
		productTypes = t(),
		categories = t(),
		dea = t(),
		classes = t();
	const ended = t(),
		appearances = t(),
		statuses = t();
	const doseTypes = new Map<string, DoseTypeTally>();
	const formRaw = new Map<string, Set<string>>();
	const dryFill: string[] = [],
		kits: string[] = [],
		samples: string[] = [];
	const unlisted: string[] = [],
		inactivated: string[] = [],
		veterinary: string[] = [];
	const active = new Map<string, ActiveIngredient & { strengthTally: Tallier }>();
	const applications = new Map<string, Application>();
	const rxcuis = new Map<string, RxcuiSource>();
	const labels = new Map<string, LabelSource>();
	const starts: (string | null)[] = [],
		expirations: (string | null)[] = [];
	const unlabeled: { name: string; strength: string | null; ndc: string; sole: boolean }[] = [];
	let enriched = 0;

	const addActive = (
		ingredient: {
			name: string;
			unii: string | null;
			strength: string | null;
			moieties: { name: string }[];
		},
		ndc: string,
		sole: boolean,
		key = ingredient.unii ?? ingredient.name.toUpperCase()
	) => {
		const entry = active.get(key) ?? {
			name: ingredient.name,
			unii: ingredient.unii,
			moieties: [],
			strengths: [],
			ndcs: [],
			strengthTally: new Tallier()
		};
		for (const moiety of ingredient.moieties)
			if (!entry.moieties.some((known) => known.toUpperCase() === moiety.name.toUpperCase()))
				entry.moieties.push(moiety.name);
		const strength = nominalStrength(ingredient.strength, titleUnit(nominal, ingredient, sole));
		entry.strengthTally.add(strength, ndc);
		if (!entry.ndcs.includes(ndc)) entry.ndcs.push(ndc);
		active.set(key, entry);
	};

	// Unprojected rows still get the hierarchy's dose types, without equivalence groups.
	const projected = rows.some((row) => row.doseType === undefined) ? projectRows(rows) : rows;
	for (const row of projected) {
		const { ndc } = row;
		labelers.add(row.labeler, ndc);
		products.add(row.brandName ?? row.genericName, ndc);
		// Rows from `projectRows` carry their equivalence group's display.
		const form = projectDoseForm(row.doseForm);
		if (form) {
			const display = row.doseFormLabel ?? form.display;
			doseForms.add(display, ndc);
			formRaw.set(
				display.toUpperCase(),
				(formRaw.get(display.toUpperCase()) ?? new Set()).add(form.raw)
			);
		}
		for (const route of row.routes) routes.add(route, ndc);
		sizes.add(packageSize(row), ndc);
		statuses.add(row.status, ndc);
		if (row.doseType) {
			const entry = doseTypes.get(row.doseType.value) ?? {
				value: row.doseType.value,
				ndcs: [],
				reasons: {},
				inherited: []
			};
			entry.ndcs.push(ndc);
			entry.reasons[ndc] = row.doseType.reason;
			if (row.doseType.from) entry.inherited.push(ndc);
			doseTypes.set(row.doseType.value, entry);
		}
		if (row.kit?.parts.length) kits.push(ndc);

		const item = snapshots.get(ndc);
		if (!item) continue;
		enriched++;
		const { product, packaging, label, spl, rxnav } = item.details ?? {};
		if (item.isDryFill) dryFill.push(ndc);
		if (packaging?.sample) samples.push(ndc);
		// An inner package (a carton's bag) has no entry of its own, but its product
		// matched through a listed sibling and was enriched from it; nothing is missing.
		if (item.listed === false && !packaging?.siblings.length) unlisted.push(ndc);
		if (item.splInactivated) inactivated.push(ndc);
		if (item.isVeterinary) veterinary.push(ndc);
		ended.add(isoDate(item.marketingEndDate), ndc);

		productTypes.add(product?.productType, ndc);
		categories.add(product?.marketingCategory, ndc);
		dea.add(product?.deaSchedule, ndc);
		for (const pharmClass of product?.pharmClasses ?? []) classes.add(pharmClass, ndc);
		starts.push(isoDate(packaging?.marketingStartDate ?? product?.marketingStartDate));
		expirations.push(isoDate(product?.listingExpirationDate));
		if (product?.applicationNumber) {
			const application = applications.get(product.applicationNumber) ?? {
				number: product.applicationNumber,
				category: product.marketingCategory,
				labelers: [],
				ndcs: []
			};
			if (row.labeler && !application.labelers.includes(row.labeler))
				application.labelers.push(row.labeler);
			application.ndcs.push(ndc);
			applications.set(product.applicationNumber, application);
		}

		// SPL ingredients carry UNIIs and moieties; the directory's are the fallback,
		// merged after the loop into a same-named SPL ingredient when one exists.
		const actives = spl?.ingredients.filter((ingredient) => ingredient.kind === 'active') ?? [];
		if (actives.length)
			for (const ingredient of actives)
				addActive(
					// A liquid's SCD figure (`0.25 MG/ML`) over the label's container total.
					{ ...ingredient, strength: scdShownStrength(item, ingredient) ?? ingredient.strength },
					ndc,
					actives.length === 1
				);
		else
			for (const ingredient of item.ingredients)
				unlabeled.push({ ...ingredient, ndc, sole: item.ingredients.length === 1 });
		for (const ingredient of spl?.ingredients ?? [])
			if (ingredient.kind === 'inactive')
				inactive.add(ingredient.name, ndc, ingredient.unii ?? ingredient.name.toUpperCase());

		const rxcui = rxnav?.rxcui ?? product?.rxcuis[0] ?? null;
		if (rxcui) {
			const source = rxcuis.get(rxcui) ?? {
				rxcui,
				name: rxnav?.conceptName ?? null,
				status: rxnav?.conceptStatus ?? rxnav?.status ?? null,
				ndcs: []
			};
			source.ndcs.push(ndc);
			rxcuis.set(rxcui, source);
		}

		const setId = item.splSetId ?? label?.setId ?? null;
		if (setId) {
			const source = labels.get(setId) ?? {
				setId,
				title: item.splTitle,
				effective: isoDate(label?.effectiveTime ?? spl?.publishedDate),
				version: label?.version ?? spl?.version ?? null,
				ndcs: []
			};
			source.ndcs.push(ndc);
			labels.set(setId, source);
		}

		for (const appearance of spl?.appearances ?? [])
			if (hasAppearance(appearance)) appearances.add(appearanceText(appearance), ndc);
	}

	for (const ingredient of unlabeled) {
		const name = ingredient.name.toUpperCase();
		const match = [...active].find(([, entry]) => entry.name.toUpperCase() === name);
		addActive(
			{ ...ingredient, unii: null, moieties: [] },
			ingredient.ndc,
			ingredient.sole,
			match?.[0] ?? name
		);
	}

	const byReach = <T extends { ndcs: string[] }>(list: T[], name: (entry: T) => string) =>
		list.sort((a, b) => b.ndcs.length - a.ndcs.length || naturalCompare(name(a), name(b)));

	return {
		packageCount: rows.length,
		enriched,
		labelers: labelers.list(),
		products: products.list(),
		doseForms: doseForms.list().map((entry) => {
			const raw = [...(formRaw.get(entry.value.toUpperCase()) ?? [])].sort(naturalCompare);
			return raw.length === 1 && raw[0] === entry.value ? entry : { ...entry, raw };
		}),
		routes: routes.list(),
		sizes: sizes.list(),
		doseTypes: [...doseTypes.values()].sort(
			(a, b) => b.ndcs.length - a.ndcs.length || naturalCompare(a.value, b.value)
		),
		dryFill,
		kits,
		samples,
		active: byReach(
			[...active.values()].map(({ strengthTally, ...entry }) => ({
				...entry,
				strengths: strengthTally.list()
			})),
			(entry) => entry.name
		),
		inactive: inactive.list(),
		productTypes: productTypes.list(),
		marketingCategories: categories.list(),
		applications: byReach([...applications.values()], (entry) => entry.number),
		deaSchedules: dea.list(),
		pharmClasses: classes.list(),
		marketingStart: span(starts),
		listingExpires: span(expirations),
		ended: ended.list(),
		unlisted,
		inactivated,
		veterinary,
		rxcuis: byReach([...rxcuis.values()], (entry) => entry.rxcui),
		labels: byReach([...labels.values()], (entry) => entry.title ?? entry.setId),
		appearances: appearances.list(),
		statuses: statuses.list()
	};
}

/**
 * The unit the title states this ingredient in: by name or moiety, or the
 * title's only strength when both title and label have just one — a label
 * listing a salt's ions (sodium cation, chloride ion) doesn't share the
 * salt's strength.
 */
function titleUnit(
	nominal: RxStrength[],
	ingredient: { name: string; moieties: { name: string }[] },
	sole: boolean
): string | null {
	const names = [ingredient.name, ...ingredient.moieties.map((moiety) => moiety.name)].map((name) =>
		name.trim().toLowerCase()
	);
	const match =
		nominal.find((strength) => names.includes(strength.name.toLowerCase())) ??
		(sole && nominal.length === 1 ? nominal[0] : undefined);
	if (!match) return null;
	return match.perUnit
		? `${match.unit}/${match.per === 1 ? '' : match.per}${match.perUnit}`
		: match.unit;
}

/**
 * A label's strength restated in the title's unit — "10 g" as "10000 mg",
 * "100 mg/1 mL" as "100 mg/mL", "9 g/1000 mL" against MG/100ML as "900 mg". When the label's denominator cannot be put in
 * the title's ("10 g/15 g" against mg/mL), its nominal amount stands alone in
 * the title's mass unit. Left as written when neither converts.
 */
export function nominalStrength(strength: string | null, unit: string | null): string | null {
	if (!strength?.trim() || !unit) return strength;
	const whole = parseQuantity(strength);
	// A title's denominator may carry an amount ("MG/100ML"): convert per one
	// of its unit, then scale up to the stated amount.
	const [titleTop, bottom = ''] = unit.split('/');
	const perAmount = bottom.match(/^\s*([\d.]+)\s*([A-Za-z].*)$/);
	const per = perAmount ? parseRational(perAmount[1]) : null;
	if (perAmount && per && whole) {
		const unitRate = convertQuantity(whole, `${titleTop}/${perAmount[2]}`, {
			weightInVolume: false
		});
		const scaled = unitRate && multiply(unitRate.rational, per);
		// Shown as the amount in that volume, as the title states it: "900 mg".
		if (scaled)
			return formatQuantity({ ...unitRate, rational: scaled, unit: unitRate.numeratorUnit });
	}
	const converted = whole && convertQuantity(whole, unit, { weightInVolume: false });
	if (converted) return formatQuantity(converted);
	const amount = parseQuantity(strength.split('/')[0]);
	const top = amount && convertQuantity(amount, unit.split('/')[0]);
	return top ? formatQuantity(top) : strength;
}

const byReach = (a: Tally, b: Tally) => b.ndcs.length - a.ndcs.length;

/** A tally nested under the less specific tally its value contains. */
export type TallyNode = Tally & {
	/** The value with its parent's text removed, when the parent is a prefix. */
	label: string;
	children: TallyNode[];
};

/**
 * Nests tallies by substring: each value goes under the longest other value
 * found inside it (case-insensitive), so `White, round` holds
 * `White, round, 8 mm, imprint “A”`. A node's NDCs include its descendants'. Each level is ordered by NDC count, ties keeping `list` order.
 */
export function nestTallies(list: Tally[]): TallyNode[] {
	const lower = list.map((entry) => entry.value.toLowerCase());
	const nodes: TallyNode[] = list.map((entry) => ({ ...entry, label: entry.value, children: [] }));
	const roots: TallyNode[] = [];
	nodes.forEach((node, i) => {
		let parent = -1;
		lower.forEach((text, j) => {
			if (j === i || text.length >= lower[i].length || !text || !lower[i].includes(text)) return;
			if (parent < 0 || text.length > lower[parent].length) parent = j;
		});
		if (parent < 0) return void roots.push(node);
		if (lower[i].startsWith(lower[parent])) {
			const rest = node.value.slice(lower[parent].length).replace(/^[\s,;:/–-]+/, '');
			if (rest) node.label = `… ${rest}`;
		}
		nodes[parent].children.push(node);
	});
	const gather = (node: TallyNode): string[] => {
		node.ndcs = [...new Set([...node.ndcs, ...node.children.flatMap(gather)])];
		node.children.sort(byReach);
		return node.ndcs;
	};
	roots.forEach(gather);
	return roots.sort(byReach);
}
