import { quantifiedScdName } from './quantified-scd';
import { applyStrengthStyles, type StrengthStyleRule } from './strength-style';

export const MAX_NAME_OVERRIDE = 500;

export type ItemNaming = { nameOverride: string | null; strengthAsPercent: boolean };

/** A user's replacement name ("Dextrose 12500 MG/250ML Injection"); blank clears it. */
export function parseNameOverride(raw: unknown): { name: string | null } | { error: string } {
	const value = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
	if (!value) return { name: null };
	if (value.length > MAX_NAME_OVERRIDE)
		return { error: `Names are limited to ${MAX_NAME_OVERRIDE} characters.` };
	return { name: value };
}

/** Grams per mL for the units a weight-per-volume percentage can be stated from. */
const GRAMS: Record<string, number> = { G: 1, MG: 1e-3, MCG: 1e-6, UG: 1e-6 };
const AMOUNT_PER_VOLUME = /([\d.]+)\s*(G|MG|MCG|UG)\s*\/\s*([\d.]+)\s*(ML|L)\b/gi;

const percent = (value: number) => String(Number(value.toPrecision(4)));

/**
 * Restates an amount in a stated volume as a weight-per-volume percentage:
 * `Dextrose 12500 MG/250ML Injection` → `Dextrose 5% 250ML Injection`.
 * Only a name with exactly one such strength is restated; a combination
 * (`… / sodium chloride 2250 MG/250ML`) or one with no volume stays as it is.
 */
export function strengthAsPercent(name: string): string {
	const matches = [...name.matchAll(AMOUNT_PER_VOLUME)];
	if (matches.length !== 1) return name;
	const [whole, amount, unit, volume, volumeUnit] = matches[0];
	const millilitres = Number(volume) * (volumeUnit.toUpperCase() === 'L' ? 1000 : 1);
	const grams = Number(amount) * GRAMS[unit.toUpperCase()];
	if (!(millilitres > 0) || !(grams > 0)) return name;
	return name.replace(whole, `${percent((grams / millilitres) * 100)}% ${volume}${volumeUnit.toUpperCase()}`);
}

/**
 * The name a formulary item is shown by: the user's override, else the sourced
 * name, optionally as a percentage, else with the formulary's strength styles.
 */
export function itemName(
	sourced: string,
	naming: ItemNaming,
	styles: StrengthStyleRule[] = []
): string {
	const base = naming.nameOverride ?? quantifiedScdName(sourced);
	return naming.strengthAsPercent ? strengthAsPercent(base) : applyStrengthStyles(base, styles);
}
