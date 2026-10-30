/**
 * The name a formulary item is shown by: a user's override, else the sourced name,
 * with strengths in the item's own style or the formulary's rules.
 *
 * @module
 */
import { quantifiedScdName } from '../medication/quantified-scd';
import {
	applyStrengthStyles,
	type ItemStrengthStyle,
	parseItemStrengthStyle,
	type StrengthStyleRule,
	stylesForItem
} from '../medication/strength-style';

export const MAX_NAME_OVERRIDE = 500;

/** `strengthStyle` is the stored text; anything unrecognised follows the formulary's rules. */
export type ItemNaming = { nameOverride: string | null; strengthStyle: string | null };

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
	const base = naming.nameOverride ?? quantifiedScdName(sourced);
	return applyStrengthStyles(base, stylesForItem(styles, itemStrengthStyle(naming)));
}
