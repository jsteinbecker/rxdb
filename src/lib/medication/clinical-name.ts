/**
 * The shared parser for clinical drug names; source and display adapters decide
 * which forms they can use.
 *
 * @module
 */
import { quantifiedScdName } from './quantified-scd';
import { parseStrengthParts, STRENGTH_PATTERN, type StrengthParts } from './strength';

export type ClinicalName = {
	ingredients: { name: string; strength: StrengthParts; text: string }[];
	doseForm: string | null;
	brand: string | null;
};

const COMPONENT = new RegExp(String.raw`^(.+?)\s+(${STRENGTH_PATTERN})(?:\s+(.+))?$`, 'i');

function parseCore(text: string): Omit<ClinicalName, 'brand'> | null {
	const segments = text.split(' / ');
	const ingredients: ClinicalName['ingredients'] = [];
	let doseForm: string | null = null;
	for (let index = 0; index < segments.length; index++) {
		const match = segments[index].match(COMPONENT);
		if (!match || (index < segments.length - 1 && match[3])) return null;
		const strength = parseStrengthParts(match[2]);
		if (!strength) return null;
		ingredients.push({
			name: match[1].replace(/\s*\((?:USP|NF)\)\s*$/i, '').trim(),
			strength,
			text: match[2]
		});
		if (index === segments.length - 1) doseForm = match[3]?.trim() || null;
	}
	return { ingredients, doseForm };
}

/** Parse one clinical drug name; source/display adapters decide what forms they can use. */
export function parseClinicalName(name: string): ClinicalName | null {
	const text = quantifiedScdName(name.trim());
	if (!text || text.startsWith('{')) return null;
	const brand = /\s+\[([^\]]+)\]$/.exec(text);
	// A terminal [IU] may be the strength unit rather than a brand.
	if (brand) {
		const parsed = parseCore(text.slice(0, brand.index));
		if (parsed) return { ...parsed, brand: brand[1] };
	}
	const parsed = parseCore(text);
	return parsed ? { ...parsed, brand: null } : null;
}
