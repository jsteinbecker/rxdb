/**
 * Generic component selection for the compound builder.
 *
 * A technician thinks "ampicillin IV, 2 g", not "the ampicillin 2 g vial".
 * Formulary packages are grouped into generics — the same active ingredients
 * given by the same injection route — and a dose is met by proposing
 * combinations of the generic's vial strengths: 2 g = 1 × 2 g, 2 × 1 g,
 * 1 × 1 g + 2 × 500 mg, …
 *
 * Pure and offline.
 *
 * @module
 */
import { ingredientLabel } from '../formulary/hierarchy';
import { add, compare, multiply, rational, type Rational } from '../medication/rational';
import { convertQuantity, parseQuantity } from '../medication/quantity';
import { INJECTION_ROUTES } from '../labels/reconstitution-terms';

export type InjectionRoute = (typeof INJECTION_ROUTES)[number];

const ROUTE_NAMES: Record<string, InjectionRoute> = {
	INTRAVENOUS: 'IV',
	IV: 'IV',
	INTRAMUSCULAR: 'IM',
	IM: 'IM',
	SUBCUTANEOUS: 'SC',
	SC: 'SC'
};

/** The injection routes a package's listing names ("INTRAVENOUS" → IV), in INJECTION_ROUTES order. */
export function injectionRoutes(routes: readonly string[]): InjectionRoute[] {
	const found = new Set(routes.map((route) => ROUTE_NAMES[route.trim().toUpperCase()]).filter(Boolean));
	return INJECTION_ROUTES.filter((route) => found.has(route));
}

/** "Ampicillin", "Piperacillin / Tazobactam": the ingredients, alphabetical, salts dropped. */
export function genericName(ingredients: readonly { name: string }[]): string | null {
	const names = [...new Set(ingredients.map((item) => ingredientLabel(item.name)))].sort((a, b) =>
		a.localeCompare(b)
	);
	return names.length ? names.join(' / ') : null;
}

/** Key of a generic: its name and route ("Ampicillin|IV"). */
export const genericKey = (name: string, route: InjectionRoute | null) => `${name}|${route ?? ''}`;

/**
 * What one vial holds, in a mass or unit amount, when the label says so plainly:
 * a single-ingredient dry fill ("1 g", "500 mg", "1,000,000 UNT"). Solutions and
 * combinations return null — they are measured by volume, not counted in vials.
 */
export function vialContent(
	ingredients: readonly { name: string; strength: string | null }[]
): { amount: Rational; unit: string } | null {
	if (ingredients.length !== 1) return null;
	const quantity = parseQuantity(ingredients[0].strength);
	if (!quantity || quantity.kind !== 'amount' || !quantity.unit) return null;
	// Masses are compared in mg; other amount units (units, mEq) as stated.
	const inMg = convertQuantity(quantity, 'mg');
	return inMg ? { amount: inMg.rational, unit: 'mg' } : { amount: quantity.rational, unit: quantity.unit };
}

export interface Vial {
	packageId: string;
	/** Per-vial content in `unit`. */
	amount: Rational;
	unit: string;
}

export interface VialPick {
	packageId: string;
	amount: Rational;
	count: number;
}

export interface Combination {
	picks: VialPick[];
	/** Total content of the vials pulled. */
	total: Rational;
	/** Content left over after the dose is drawn (0 when exact). */
	waste: Rational;
	vials: number;
}

export interface CombinationOptions {
	/** Most vials a proposal may use. Default 6. */
	maxVials?: number;
	/** Most proposals returned. Default 4. */
	limit?: number;
}

const ZERO: Rational = { n: 0, d: 1 };
const sub = (a: Rational, b: Rational): Rational | null => add(a, { n: -b.n, d: b.d });

/**
 * Plausible ways to pull `dose` from the available vials, best first: exact
 * fills before overfills, then the least left over, then the fewest vials.
 * Each strength appears once (the first package listed for it, so pass them in
 * preference order). Only vials in the dose's unit take part.
 */
export function vialCombinations(
	dose: Rational,
	unit: string,
	vials: readonly Vial[],
	{ maxVials = 6, limit = 4 }: CombinationOptions = {}
): Combination[] {
	if (dose.n <= 0) return [];
	// One package per distinct strength, largest first.
	const strengths: Vial[] = [];
	for (const vial of vials) {
		if (vial.unit !== unit || vial.amount.n <= 0) continue;
		if (!strengths.some((seen) => compare(seen.amount, vial.amount) === 0)) strengths.push(vial);
	}
	strengths.sort((a, b) => compare(b.amount, a.amount));

	const found: Combination[] = [];
	const counts: number[] = new Array(strengths.length).fill(0);

	const walk = (index: number, used: number, total: Rational) => {
		if (compare(total, dose) >= 0) {
			const picks = strengths
				.map((vial, at) => ({ packageId: vial.packageId, amount: vial.amount, count: counts[at] }))
				.filter((pick) => pick.count > 0);
			const waste = sub(total, dose);
			if (waste) found.push({ picks, total, waste, vials: used });
			return; // adding more vials only adds waste
		}
		if (index >= strengths.length || used >= maxVials) return;
		const vial = strengths[index];
		for (let count = maxVials - used; count >= 0; count--) {
			const more = multiply(vial.amount, { n: count, d: 1 });
			const next = more && add(total, more);
			if (!next) continue;
			counts[index] = count;
			walk(index + 1, used + count, next);
		}
		counts[index] = 0;
	};
	walk(0, 0, ZERO);

	// Drop proposals that only add a vial on top of a smaller one that already meets the dose.
	const useful = found.filter(
		(combo) =>
			!combo.picks.some((pick) => {
				const less = sub(combo.total, pick.amount);
				return less && compare(less, dose) >= 0;
			})
	);
	useful.sort(
		(a, b) =>
			Number(a.waste.n > 0) - Number(b.waste.n > 0) ||
			compare(a.waste, b.waste) ||
			a.vials - b.vials
	);
	return useful.slice(0, limit);
}



/** An amount as a person reads it: 2000 mg as 2 g, 1500 mg as 1.5 g, 500 mg as is. */
export function readable(amount: Rational, unit: string): { value: Rational; unit: string } {
	if (unit === 'mg' && compare(amount, { n: 1000, d: 1 }) >= 0) {
		const grams = multiply(amount, { n: 1, d: 1000 });
		if (grams && 1000 % grams.d === 0) return { value: grams, unit: 'g' };
	}
	return { value: amount, unit };
}
