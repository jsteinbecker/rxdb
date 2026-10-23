/**
 * Dosing measure for combination products.
 *
 * A combination product has no single strength to dose by. The measure is
 * either the sum of its ingredients' strengths or one named ingredient's
 * (trimethoprim for TMP/SMX). The choice belongs to the SCD concept, not to an
 * NDC, so every package under the concept shares it.
 *
 * @module
 */

import { ingredientGroup } from './ingredient-group';
import { pseudoScdFor, type PseudoScdSource } from './pseudo-scd';
import { mgPer, mlPer } from './units';
import { strengthDisplay } from '../catalog/package-title';

export type DosingMeasure =
	/** `ingredients` lists the moiety groups summed; absent sums them all. */
	| { mode: 'sum'; ingredients?: string[] }
	/** `ingredient` is the moiety group name, lowercase, so salts do not split it. */
	| { mode: 'ingredient'; ingredient: string };

export type DosingMeasureSource = PseudoScdSource;

const group = (name: string) => ingredientGroup(name).toLowerCase();

/** The SCD-level identity a selection is stored under, or null with no concept. */
export function dosingConceptKey(item: DosingMeasureSource): string | null {
	const pseudo = pseudoScdFor(item);
	if (pseudo) return `pscd:${pseudo.key}`;
	const rxcui = item.details?.rxnav?.rxcui;
	return rxcui ? `rxcui:${rxcui}` : null;
}

/** Distinct moiety groups among the package's ingredients, in label order. */
export function ingredientGroups(item: DosingMeasureSource): string[] {
	return [...new Set((item.ingredients ?? []).map((i) => group(i.name)))];
}

export const isCombo = (item: DosingMeasureSource) => ingredientGroups(item).length > 1;

/** A strength as milligrams per `per` of its denominator, e.g. `0.974 g/500 mL`. */
type MassStrength = { mg: number; per: number; unit: 'mL' | '1' };

/** Parses a strength like `160 mg/1` or `1.4 g/100 mL`; null when it is not a mass. */
function massStrength(strength: string | null): MassStrength | null {
	const match = strength
		?.trim()
		.match(/^([\d.]+)\s*([a-zµμ]+)(?:\s*\/\s*([\d.]*)\s*([a-zµμ]*))?$/i);
	if (!match) return null;
	const scale = mgPer(match[2]);
	const value = Number(match[1]);
	if (!scale || !(value > 0)) return null;
	const count = match[3] ? Number(match[3]) : 1;
	if (!(count > 0)) return null;
	if (!match[4]) return { mg: value * scale, per: count, unit: '1' };
	const ml = mlPer(match[4]);
	return ml ? { mg: value * scale, per: count * ml, unit: 'mL' } : null;
}

/**
 * Every strength scaled to the first one's denominator, so `0.974 g/500 mL`
 * counts as 194.8 mg beside `1.4 g/100 mL`. Null when any is not a mass or
 * the denominators are of different kinds (per mL against per tablet).
 */
function summedMass(
	item: DosingMeasureSource,
	only?: string[]
): { mg: number; base: MassStrength } | null {
	const parts = (item.ingredients ?? [])
		.filter((i) => !only || only.includes(group(i.name)))
		.map((i) => massStrength(i.strength));
	const base = parts[0];
	if (!base || parts.some((part) => !part || part.unit !== base.unit)) return null;
	const mg = (parts as MassStrength[]).reduce(
		(sum, part) => sum + (part.mg * base.per) / part.per,
		0
	);
	return { mg, base };
}

/**
 * The selection as a checked value, or the reason it cannot apply to this
 * package. Summing needs every strength to be a mass; naming an ingredient
 * needs it to be one of the package's.
 */
export function parseDosingMeasure(
	item: DosingMeasureSource,
	mode: string,
	ingredient: string | null,
	ingredients: string[] = []
): { measure: DosingMeasure } | { error: string } {
	if (!isCombo(item)) return { error: 'Only combination products have a dosing measure.' };
	if (mode === 'sum') {
		const groups = ingredientGroups(item);
		const chosen = [...new Set(ingredients.map(group))];
		if (chosen.some((name) => !groups.includes(name)))
			return { error: 'Choose only this product’s ingredients.' };
		if (chosen.length === 1) return { error: 'Choose at least two ingredients to sum.' };
		// Choosing every group is the same as choosing none: sum them all.
		const subset =
			chosen.length && chosen.length < groups.length
				? groups.filter((name) => chosen.includes(name))
				: undefined;
		if (summedMass(item, subset) === null)
			return { error: 'Every summed ingredient needs a mass strength per the same kind of unit.' };
		return { measure: subset ? { mode: 'sum', ingredients: subset } : { mode: 'sum' } };
	}
	if (mode === 'ingredient') {
		const wanted = ingredient ? group(ingredient) : '';
		return ingredientGroups(item).includes(wanted)
			? { measure: { mode: 'ingredient', ingredient: wanted } }
			: { error: 'Choose one of this product’s ingredients.' };
	}
	return { error: 'Unknown dosing measure.' };
}

/** What the selection reads as for this package, e.g. `960 mg (sum)`. */
export function dosingMeasureText(
	item: DosingMeasureSource,
	measure: DosingMeasure
): string | null {
	const ingredients = item.ingredients ?? [];
	if (measure.mode === 'ingredient') {
		const match = ingredients.find((i) => group(i.name) === measure.ingredient);
		return match
			? `${ingredientGroup(match.name)}${match.strength ? ` ${strengthDisplay(match.strength)}` : ''}`
			: null;
	}
	const sum = summedMass(item, measure.ingredients);
	if (!sum) return null;
	const { base } = sum;
	// Per mL, as titles read; a per-unit sum keeps its count (`/2` tablets).
	const [mg, per] =
		base.unit === 'mL'
			? [sum.mg / base.per, '/mL']
			: [sum.mg, base.per === 1 ? '' : `/${base.per}`];
	return `${Number(mg.toPrecision(6))} mg${per} (${measure.ingredients ? `sum of ${measure.ingredients.length}` : 'sum'})`;
}
