/**
 * Strength display styles.
 *
 * Some ingredients are conventionally stated in special terms: sterile water and
 * sodium chloride as a percentage, epinephrine in local anaesthetics as a ratio.
 * A rule pairs an ingredient (optionally only beside other ingredients, and
 * optionally per dose form) with the style its strength is shown in. Only the
 * display changes: stored strengths are never rewritten.
 *
 * @module
 */

import { mgPer, mlPer } from './units';
import { parseStrengthParts } from './strength';

export type StrengthStyle = 'percent' | 'ratio';

/** An item's own choice: a style, `stored` for the strength as stored, or null to follow the formulary's rules. */
export type ItemStrengthStyle = StrengthStyle | 'stored';

export type StrengthStyleRule = {
	/** Ingredient as named in RxNorm, matched case-insensitively ("sodium chloride"). */
	ingredient: string;
	/** Other ingredients the product must also contain ("lidocaine"); empty for any product. */
	withIngredients: string[];
	/** Dose form text the name must contain ("Injection"); null for any form. */
	doseForm: string | null;
	style: StrengthStyle;
};

export const STRENGTH_STYLES: { value: StrengthStyle; label: string; example: string }[] = [
	{ value: 'percent', label: 'Percent', example: '0.9%' },
	{ value: 'ratio', label: 'Ratio', example: '1:100,000' }
];

export const ITEM_STRENGTH_STYLES: { value: ItemStrengthStyle | null; label: string }[] = [
	{ value: null, label: 'Formulary rules' },
	{ value: 'percent', label: 'Percent' },
	{ value: 'ratio', label: 'Ratio' },
	{ value: 'stored', label: 'As stored' }
];

export function parseItemStrengthStyle(value: unknown): ItemStrengthStyle | null {
	return value === 'percent' || value === 'ratio' || value === 'stored' ? value : null;
}

const clean = (value: unknown) =>
	typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

/** Matches every ingredient; only an item's own style uses it. */
const ANY_INGREDIENT = '*';

function cleanList(value: unknown): string[] {
	const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,/]/) : [];
	const byKey = new Map<string, string>();
	for (const name of list.map(clean)) if (name) byKey.set(name.toLowerCase(), byKey.get(name.toLowerCase()) ?? name);
	return [...byKey.values()];
}

export function parseStrengthStyleRule(value: unknown): StrengthStyleRule | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const ingredient = clean(raw.ingredient);
	const style = STRENGTH_STYLES.find((option) => option.value === raw.style)?.value;
	if (!ingredient || ingredient === ANY_INGREDIENT || !style) return null;
	const withIngredients = cleanList(raw.withIngredients).filter(
		(name) => name.toLowerCase() !== ingredient.toLowerCase()
	);
	return { ingredient, withIngredients, doseForm: clean(raw.doseForm) || null, style };
}

/** Valid rules, one per ingredient, companions and dose form (the later one wins). */
export function parseStrengthStyles(value: unknown): StrengthStyleRule[] {
	if (!Array.isArray(value)) return [];
	const byKey = new Map<string, StrengthStyleRule>();
	for (const rule of value.map(parseStrengthStyleRule)) {
		if (rule) byKey.set(ruleKey(rule), rule);
	}
	return [...byKey.values()];
}

export const ruleKey = (
	rule: Pick<StrengthStyleRule, 'ingredient' | 'doseForm'> & { withIngredients?: string[] }
) =>
	[
		rule.ingredient.toLowerCase(),
		(rule.withIngredients ?? []).map((name) => name.toLowerCase()).sort().join('+'),
		(rule.doseForm ?? '').toLowerCase()
	].join('|');

/** The rules an item is named with: its own style for every ingredient, none, or the formulary's. */
export function stylesForItem(
	rules: StrengthStyleRule[],
	itemStyle: ItemStrengthStyle | null | undefined
): StrengthStyleRule[] {
	if (!itemStyle) return rules;
	if (itemStyle === 'stored') return [];
	return [{ ingredient: ANY_INGREDIENT, withIngredients: [], doseForm: null, style: itemStyle }];
}

// ── Restating one strength ───────────────────────────────────────────────────

const significant = (value: number) => String(Number(value.toPrecision(4)));

/**
 * The fraction a strength is a percentage or ratio of: weight in volume (g/mL),
 * weight in weight (g/g) or volume in volume (mL/mL). Null for anything else
 * (mEq, units, an amount per tablet).
 */
function concentration(amount: number, unit: string, per: number, perUnit: string): number | null {
	const mass = mgPer(unit);
	const volume = mlPer(unit);
	const perMass = mgPer(perUnit);
	const perVolume = mlPer(perUnit);
	let fraction: number | null = null;
	if (mass !== null && perVolume !== null) fraction = (amount * mass) / 1000 / (per * perVolume);
	else if (mass !== null && perMass !== null) fraction = (amount * mass) / (per * perMass);
	else if (volume !== null && perVolume !== null) fraction = (amount * volume) / (per * perVolume);
	return fraction !== null && fraction > 0 && Number.isFinite(fraction) ? fraction : null;
}

function restate(style: StrengthStyle, fraction: number): string | null {
	if (style === 'percent') return `${significant(fraction * 100)}%`;
	const parts = Math.round(1 / fraction);
	return parts >= 1 && fraction <= 1 ? `1:${parts.toLocaleString('en-US')}` : null;
}

/** A stored strength ("0.01 mg/mL", "900 MG/100ML") in a style ("1:100,000", "0.9%"), or null when it cannot be. */
export function styleStrength(strength: string | null | undefined, style: StrengthStyle): string | null {
	const parts = parseStrengthParts(strength);
	if (!parts) return null;
	const fraction = concentration(Number(parts.value), parts.unit, Number(parts.per), parts.perUnit);
	return fraction === null ? null : restate(style, fraction);
}

// ── Choosing a rule ──────────────────────────────────────────────────────────

/** Whether a rule's ingredient names this one: equal, or the start of a salt ("lidocaine hydrochloride"). */
function namesIngredient(rule: string, ingredient: string): boolean {
	if (rule === ANY_INGREDIENT) return true;
	const a = rule.toLowerCase();
	const b = ingredient.trim().toLowerCase();
	return b === a || b.startsWith(`${a} `);
}

/** Lowercase with `-ion`/`-able` endings dropped, so "Injection" matches "Injectable Solution". */
const formStem = (form: string) => form.toLowerCase().replace(/(?:ion|able)\b/g, '');

/**
 * The rule for an ingredient in a dose form, beside the product's other
 * ingredients. The most specific wins: more companions named, then a dose form.
 */
export function ruleFor(
	rules: StrengthStyleRule[],
	ingredient: string,
	doseForm: string,
	others: string[] = []
): StrengthStyleRule | null {
	const form = formStem(doseForm);
	const matching = rules.filter(
		(rule) =>
			namesIngredient(rule.ingredient, ingredient) &&
			(!rule.doseForm || form.includes(formStem(rule.doseForm))) &&
			rule.withIngredients.every((companion) =>
				others.some((other) => namesIngredient(companion, other))
			)
	);
	const rank = (rule: StrengthStyleRule) => rule.withIngredients.length * 2 + (rule.doseForm ? 1 : 0);
	return matching.reduce<StrengthStyleRule | null>(
		(best, rule) => (!best || rank(rule) > rank(best) ? rule : best),
		null
	);
}

/** A stored ingredient strength as the rules show it, or null when it stays as stored. */
export function styledIngredientStrength(
	rules: StrengthStyleRule[],
	ingredient: { name: string; strength: string | null | undefined },
	doseForm: string | null | undefined,
	others: string[] = []
): string | null {
	if (!rules.length || !ingredient.strength) return null;
	const rule = ruleFor(rules, ingredient.name, doseForm ?? '', others);
	return rule ? styleStrength(ingredient.strength, rule.style) : null;
}

// ── Restating a name ─────────────────────────────────────────────────────────

const STRENGTH =
	/(\d*\.?\d+)\s*(G|GM|MG|MCG|UG|ML|L)\s*\/\s*(\d*\.?\d+)?\s*(ML|L|G|GM|MG)\b/i;
const QUANTITY_PREFIX = /^\d*\.?\d+\s*(?:ML|L)\s+/i;

/**
 * Restates each ingredient's strength in the style its rule asks for:
 * `EPINEPHrine 0.01 MG/ML / lidocaine hydrochloride 10 MG/ML Injectable Solution`
 * with epinephrine as a ratio → `EPINEPHrine 1:100,000 / lidocaine hydrochloride 10 MG/ML Injectable Solution`.
 * A stated volume is kept (`Sodium Chloride 0.9% 100ML Injection`). Ingredients
 * without a rule, or whose strength is not a concentration, stay as they are.
 */
export function applyStrengthStyles(
	name: string,
	rules: StrengthStyleRule[],
	/** The dose form text to match, for a strength list that names none ("vancomycin 1.25 g/250 mL"). */
	form?: string | null
): string {
	if (!rules.length) return name;
	const parts = name.split(' / ');
	const last = parts[parts.length - 1];
	const lastMatch = last.match(STRENGTH);
	const doseForm =
		form ?? (lastMatch ? last.slice(lastMatch.index! + lastMatch[0].length).trim() : '');
	const matches = parts.map((part) => part.match(STRENGTH));
	const ingredients = parts.map((part, index) => {
		const match = matches[index];
		const prefix = match ? part.slice(0, match.index) : part;
		return (index === 0 ? prefix.replace(QUANTITY_PREFIX, '') : prefix).trim();
	});
	return parts
		.map((part, index) => {
			const match = matches[index];
			if (!match) return part;
			const others = ingredients.filter((_, at) => at !== index);
			const rule = ruleFor(rules, ingredients[index], doseForm, others);
			if (!rule) return part;
			const [whole, amount, unit, volume, volumeUnit] = match;
			const fraction = concentration(Number(amount), unit, Number(volume ?? 1), volumeUnit);
			const styled = fraction === null ? null : restate(rule.style, fraction);
			if (!styled) return part;
			// "/1 ML" is a bare concentration; any other stated amount (100ML, 1 L) is the container's.
			const bare = Number(volume ?? 1) === 1 && volumeUnit.toUpperCase() === 'ML';
			const stated = volume && !bare ? ` ${volume}${volumeUnit.toUpperCase()}` : '';
			return part.replace(whole, `${styled}${stated}`);
		})
		.join(' / ');
}

/**
 * The dose form text a rule's form is matched against outside a name: the form
 * a title ends in ("Topical Cream"), plus the label's dose form and routes, so
 * "Topical" and "Injection" match the same products they do in names.
 */
export function formContext(
	title: string | null | undefined,
	doseForm?: string | null,
	routes: string[] = []
): string {
	const last = title?.split(' / ').pop() ?? '';
	const match = last.match(STRENGTH) ?? last.match(/\d*\.?\d+\s*[A-Z%]+\b/i);
	const tail = match ? last.slice(match.index! + match[0].length) : '';
	return [tail.replace(/\[[^\]]*\]/g, ''), doseForm ?? '', ...routes]
		.map((part) => part.trim())
		.filter(Boolean)
		.join(' ');
}
