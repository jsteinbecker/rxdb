/**
 * The formulary's strength display rules on the client, and helpers that show
 * names and strengths the way those rules (or an item's own style) ask.
 *
 * @module
 */
import { page } from '$app/state';
import {
	applyStrengthStyles,
	parseItemStrengthStyle,
	styledIngredientStrength,
	stylesForItem,
	type StrengthStyleRule
} from '$lib/medication/strength-style';

/** The formulary's strength display rules, loaded once by the root layout. */
export function strengthRules(
	/** A formulary item's own style, which replaces the rules for its packages. */
	itemStyle?: string | null
): StrengthStyleRule[] {
	const rules = page.data.strengthStyles;
	return stylesForItem(Array.isArray(rules) ? rules : [], parseItemStrengthStyle(itemStyle));
}

/** A name or title with its strengths shown as the formulary's rules (or its item's style) ask. */
export const styledName = (text: string, itemStyle?: string | null) =>
	applyStrengthStyles(text, strengthRules(itemStyle));

/** One ingredient's stored strength as the rules show it, or null to show it as stored. */
export const styledStrength = (
	ingredient: { name: string; strength: string | null | undefined },
	formContext: string | null | undefined,
	others: string[] = [],
	itemStyle?: string | null
) => styledIngredientStrength(strengthRules(itemStyle), ingredient, formContext, others);
