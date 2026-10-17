// ── Strength display styles ──────────────────────────────────────────────────
// Some ingredients are conventionally stated in special terms: sterile water and
// sodium chloride as a percentage, epinephrine in local anaesthetics as a ratio.
// A rule pairs an ingredient (and optionally a dose form) with the style its
// strength is shown in; item names are restated per ingredient when shown.

export type StrengthStyle = 'percent' | 'ratio';

export type StrengthStyleRule = {
	/** Ingredient as named in RxNorm, matched case-insensitively ("sodium chloride"). */
	ingredient: string;
	/** Dose form text the name must contain ("Injection"); null for any form. */
	doseForm: string | null;
	style: StrengthStyle;
};

export const STRENGTH_STYLES: { value: StrengthStyle; label: string; example: string }[] = [
	{ value: 'percent', label: 'Percent', example: '0.9%' },
	{ value: 'ratio', label: 'Ratio', example: '1:100000' }
];

const clean = (value: unknown) =>
	typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

export function parseStrengthStyleRule(value: unknown): StrengthStyleRule | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const ingredient = clean(raw.ingredient);
	const style = STRENGTH_STYLES.find((option) => option.value === raw.style)?.value;
	if (!ingredient || !style) return null;
	return { ingredient, doseForm: clean(raw.doseForm) || null, style };
}

/** Valid rules, one per ingredient and dose form (the later one wins). */
export function parseStrengthStyles(value: unknown): StrengthStyleRule[] {
	if (!Array.isArray(value)) return [];
	const byKey = new Map<string, StrengthStyleRule>();
	for (const rule of value.map(parseStrengthStyleRule)) {
		if (rule) byKey.set(ruleKey(rule), rule);
	}
	return [...byKey.values()];
}

export const ruleKey = (rule: Pick<StrengthStyleRule, 'ingredient' | 'doseForm'>) =>
	`${rule.ingredient.toLowerCase()}|${(rule.doseForm ?? '').toLowerCase()}`;

/** Grams (or mL, for a volume) per unit a percentage or ratio can be stated from. */
const AMOUNT: Record<string, number> = { G: 1, MG: 1e-3, MCG: 1e-6, UG: 1e-6, ML: 1, L: 1000 };
const STRENGTH = /(\d*\.?\d+)\s*(G|MG|MCG|UG|ML|L)\s*\/\s*(\d*\.?\d+)?\s*(ML|L)\b/i;
const QUANTITY_PREFIX = /^\d*\.?\d+\s*(?:ML|L)\s+/i;

const significant = (value: number) => String(Number(value.toPrecision(4)));

function restate(style: StrengthStyle, perMl: number): string {
	if (style === 'percent') return `${significant(perMl * 100)}%`;
	return `1:${Math.round(1 / perMl)}`;
}

/** Whether the rule's ingredient names this one: equal, or the start of a salt ("lidocaine hydrochloride"). */
function namesIngredient(rule: string, ingredient: string): boolean {
	const a = rule.toLowerCase();
	const b = ingredient.toLowerCase();
	return b === a || b.startsWith(`${a} `);
}

/** Lowercase with `-ion`/`-able` endings dropped, so "Injection" matches "Injectable Solution". */
const formStem = (form: string) => form.toLowerCase().replace(/(?:ion|able)\b/g, '');

/** The rule for an ingredient in a dose form; one naming the form beats one for any form. */
export function ruleFor(
	rules: StrengthStyleRule[],
	ingredient: string,
	doseForm: string
): StrengthStyleRule | null {
	const form = formStem(doseForm);
	const matching = rules.filter(
		(rule) =>
			namesIngredient(rule.ingredient, ingredient) &&
			(!rule.doseForm || form.includes(formStem(rule.doseForm)))
	);
	return matching.find((rule) => rule.doseForm) ?? matching[0] ?? null;
}

/**
 * Restates each ingredient's strength in the style its rule asks for:
 * `EPINEPHrine 0.01 MG/ML / lidocaine hydrochloride 10 MG/ML Injectable Solution`
 * with epinephrine as a ratio → `EPINEPHrine 1:100000 / lidocaine hydrochloride 10 MG/ML Injectable Solution`.
 * A stated volume is kept (`Sodium Chloride 0.9% 100ML Injection`). Ingredients
 * without a rule, or whose strength is not an amount per volume, stay as they are.
 */
export function applyStrengthStyles(name: string, rules: StrengthStyleRule[]): string {
	if (!rules.length) return name;
	const parts = name.split(' / ');
	const last = parts[parts.length - 1];
	const lastMatch = last.match(STRENGTH);
	const doseForm = lastMatch ? last.slice(lastMatch.index! + lastMatch[0].length).trim() : '';
	return parts
		.map((part, index) => {
			const match = part.match(STRENGTH);
			if (!match) return part;
			const prefix = part.slice(0, match.index);
			const ingredient = (index === 0 ? prefix.replace(QUANTITY_PREFIX, '') : prefix).trim();
			const rule = ruleFor(rules, ingredient, doseForm);
			if (!rule) return part;
			const [whole, amount, unit, volume, volumeUnit] = match;
			const millilitres = Number(volume ?? 1) * AMOUNT[volumeUnit.toUpperCase()];
			const perMl = (Number(amount) * AMOUNT[unit.toUpperCase()]) / millilitres;
			if (!(perMl > 0) || !Number.isFinite(perMl)) return part;
			const stated = volume && Number(volume) !== 1 ? ` ${volume}${volumeUnit.toUpperCase()}` : '';
			return part.replace(whole, `${restate(rule.style, perMl)}${stated}`);
		})
		.join(' / ');
}
