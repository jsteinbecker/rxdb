/**
 * The name a formulary item is shown by: a user's override, else the sourced name,
 * with strengths in the item's own style or the formulary's rules.
 *
 * @module
 */
import { orderNameIngredients } from '../medication/ingredient-order';
import { quantifiedScdName } from '../medication/quantified-scd';
import {
	applyStrengthStyles,
	type ItemStrengthStyle,
	parseItemStrengthStyle,
	type StrengthStyleRule,
	stylesForItem
} from '../medication/strength-style';

export const MAX_NAME_OVERRIDE = 500;

/**
 * `strengthStyle` is the stored text; anything unrecognised follows the formulary's rules.
 * `ingredientOrder` lists a combination's ingredient keys first-shown first.
 */
export type ItemNaming = {
	nameOverride: string | null;
	strengthStyle: string | null;
	ingredientOrder?: readonly string[] | null;
};

export const itemStrengthStyle = (naming: Pick<ItemNaming, 'strengthStyle'>): ItemStrengthStyle | null =>
	parseItemStrengthStyle(naming.strengthStyle);

/** A user's replacement name ("Dextrose 12500 MG/250ML Injection"); blank clears it. */
export function parseNameOverride(raw: unknown): { name: string | null } | { error: string } {
	const value = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
	if (!value) return { name: null };
	if (value.length > MAX_NAME_OVERRIDE)
		return { error: `Names are limited to ${MAX_NAME_OVERRIDE} characters.` };
	return { name: value };
}

/**
 * The name a formulary item is shown by: the user's override, else the sourced
 * name, with strengths in the item's own style or else the formulary's rules.
 */
export function itemName(
	sourced: string,
	naming: ItemNaming,
	styles: StrengthStyleRule[] = []
): string {
	// Ordered before styling, so each ingredient moves with its own strength as sourced.
	const base = orderNameIngredients(
		naming.nameOverride ?? quantifiedScdName(sourced),
		naming.ingredientOrder
	);
	return applyStrengthStyles(base, stylesForItem(styles, itemStrengthStyle(naming)));
}
