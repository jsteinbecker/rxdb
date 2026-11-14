/**
 * A formulary item's chosen ingredient order for a combination product
 * ("tazobactam / piperacillin" rather than RxNorm's alphabetical order).
 *
 * The order is stored as ingredient keys, never positions, and only ever moves
 * whole ingredients: a name always travels with its own strength. Nothing here
 * pairs a list of names with a separately ordered list of strengths, so a
 * reorder cannot hand one ingredient another's number. A name that cannot be
 * split into whole ingredient segments is left exactly as it was.
 *
 * @module
 */
import { ingredientGroup } from './ingredient-group';
import { STRENGTH_PATTERN } from './strength';

/** The most ingredients an order keeps; no combination product lists more. */
export const MAX_INGREDIENT_ORDER = 40;

/** One key per substance, salt- and case-blind: `Clavulanate Potassium` → `clavulanate`. */
export const ingredientOrderKey = (name: string) => ingredientGroup(name).trim().toLowerCase();

/** The posted or stored order, as distinct non-empty keys. */
export function parseIngredientOrder(value: unknown): string[] {
	const list = Array.isArray(value) ? value : [];
	const keys = list
		.filter((entry): entry is string => typeof entry === 'string')
		.map(ingredientOrderKey)
		.filter(Boolean);
	return [...new Set(keys)].slice(0, MAX_INGREDIENT_ORDER);
}

/**
 * `items` in the chosen order. Ingredients the order does not name keep their
 * incoming order after those it does; an empty order changes nothing.
 */
export function orderIngredients<T>(
	items: readonly T[],
	order: readonly string[] | null | undefined,
	nameOf: (item: T) => string
): T[] {
	if (!order?.length || items.length < 2) return [...items];
	const rank = new Map(order.map((key, index) => [key, index]));
	const at = (item: T) => rank.get(ingredientOrderKey(nameOf(item))) ?? order.length;
	// Array sort is stable, so equal ranks keep their incoming order.
	return [...items].sort((a, b) => at(a) - at(b));
}

const SEGMENT = new RegExp(String.raw`^(.+?)\s+(${STRENGTH_PATTERN})(?:\s+(.+))?$`, 'i');

/**
 * A clinical name's ingredient segments with the dose form tail apart:
 * `amoxicillin 875 MG / clavulanate 125 MG Oral Tablet` →
 * `['amoxicillin 875 MG', 'clavulanate 125 MG']`, `' Oral Tablet'`. Null unless
 * every segment is one ingredient with its own strength.
 */
function nameSegments(name: string): { segments: { name: string; text: string }[]; tail: string } | null {
	const parts = name.split(' / ');
	if (parts.length < 2) return null;
	const segments: { name: string; text: string }[] = [];
	let tail = '';
	for (const [index, part] of parts.entries()) {
		const match = part.match(SEGMENT);
		if (!match) return null;
		const last = index === parts.length - 1;
		// A middle segment followed by more words is not a whole ingredient.
		if (match[3] && !last) return null;
		const text = match[3] ? part.slice(0, part.length - match[3].length).trimEnd() : part;
		segments.push({ name: match[1], text });
		if (last && match[3]) tail = part.slice(text.length);
	}
	return { segments, tail };
}

/** The ingredient names a clinical name lists, in its own order; empty when it cannot be split. */
export function nameIngredients(name: string): string[] {
	return nameSegments(name)?.segments.map((segment) => segment.name) ?? [];
}

/**
 * A clinical name with its ingredients in the chosen order, each keeping its
 * own strength: `amoxicillin 875 MG / clavulanate 125 MG Oral Tablet` with
 * clavulanate first → `clavulanate 125 MG / amoxicillin 875 MG Oral Tablet`.
 */
export function orderNameIngredients(name: string, order: readonly string[] | null | undefined): string {
	if (!order?.length) return name;
	const parsed = nameSegments(name);
	if (!parsed) return name;
	const ordered = orderIngredients(parsed.segments, order, (segment) => segment.name);
	return ordered.map((segment) => segment.text).join(' / ') + parsed.tail;
}
