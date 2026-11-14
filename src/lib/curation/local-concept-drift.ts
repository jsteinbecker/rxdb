/**
 * What a change to a superseded RxNorm concept means for the local concept that
 * supersedes it: the concept went inactive, was renamed, or caught up with the
 * local ingredients.
 *
 * @module
 */
import {
	asConceptIngredient,
	diffIngredients,
	parseScdName,
	type LocalIngredient
} from './local-concept.ts';

export type Drift = {
	severity: 'info' | 'warning';
	reason: 'renamed' | 'inactive' | 'caught_up';
} | null;

/**
 * What a change to a superseded RxNorm concept means for the local concept.
 * Precedence: inactive, then caught up (RxNorm now matches the local ingredients),
 * then renamed. A null `supersededName` carries no rename information.
 */
export function classifyDrift(
	mapping: { supersededName: string | null },
	concept: { name: string; inactive: boolean },
	local: LocalIngredient[]
): Drift {
	if (concept.inactive) return { severity: 'warning', reason: 'inactive' };
	if (mapping.supersededName === null || mapping.supersededName === concept.name) return null;
	const parsed = parseScdName(concept.name);
	if (parsed) {
		const diff = diffIngredients(parsed.ingredients, local.map(asConceptIngredient));
		if (diff.every((row) => row.change === 'same'))
			return { severity: 'info', reason: 'caught_up' };
	}
	return { severity: 'info', reason: 'renamed' };
}
