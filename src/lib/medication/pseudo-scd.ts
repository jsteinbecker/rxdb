/**
 * Pseudo-SCDs for bulk dry fills.
 *
 * RxNorm quantifies a unit-dose dry-fill vial by its content (`vancomycin
 * 1000 MG Injection`) but a pharmacy bulk package by the concentration it is
 * reconstituted to (`vancomycin 100 MG/ML Injectable Solution`). That puts the
 * 5 g, 10 g and 100 g vancomycin bulk packages side by side under concentration
 * concepts, and splits one 10 g vial across two of them depending on the
 * diluent volume a labeler chose.
 *
 * A pseudo-SCD restates such a package the way RxNorm states the unit-dose
 * vials, by the moiety content sealed in the container: `vancomycin 10000 MG
 * Injection (Bulk)`. It is minted locally and keyed by what it contains, so
 * every labeler's 10 g bulk vial lands on the same concept. The RxNorm concept
 * stays linked as provenance.
 *
 * Derivation is conservative. A package qualifies only when its content can be
 * read from the directory's own strength without guessing: an unscaled per-vial
 * figure, or a concentration times the labeled volume it names. Anything else
 * stays under its RxNorm concept.
 *
 * @module
 */

import { ingredientGroup } from './ingredient-group';
import { isVialForm } from './ingredient-content';
import { rxNormStrengths } from '../labels/spl-strength-checks';
import type { UnitOfUseSize } from '../catalog/ndc-packaging';
import { mgPer, mlPer, toMg } from './units';

/** The package facts a pseudo-SCD is derived from. */
export type PseudoScdSource = {
	isDryFill?: boolean | null;
	ingredients?: { name: string; strength: string | null }[] | null;
	size?: UnitOfUseSize | null;
	reconstitution?: readonly { vialMassMg: number | null }[] | null;
	details?: {
		rxnav?: { rxcui?: string | null; conceptName?: string | null } | null;
		spl?: { ingredients: { name: string; kind: string; strength: string | null }[] } | null;
	} | null;
};

export type PseudoScd = {
	/** Stable identity: the same contents always give the same key. */
	key: string;
	/** RxNorm-style name, e.g. `vancomycin 10000 MG Injection (Bulk)`. */
	name: string;
	ingredients: { name: string; mg: number }[];
	/** The concentration concept the package was coded to. */
	fromRxcui: string | null;
};

export const PSEUDO_SCD_TTY = 'PSCD';

/** A quantity-led RxNorm name: `4 ML pembrolizumab 25 MG/ML Injection [Keytruda]`. */
const QUANTIFIED_CONCEPT = /^\s*[\d.]+\s*(?:ML|MG|G|L|\[?IU\]?)\s+\D/i;

/** Same tolerance vial-size matching uses for salt versus moiety masses. */
const SALT_TOLERANCE = 0.1;

const near = (a: number, b: number) => Math.abs(a - b) <= SALT_TOLERANCE * Math.max(a, b);

/**
 * Content of one ingredient per container, in mg, or null when the strength
 * does not say. `5 g/1` and `5.13 g/g` are per container; `500 mg/10mL`
 * scales by the labeled volume (a 100 mL bulk vial of it holds 5 g); a bare
 * `500 mg` beside a volume could be either, so it is not read at all.
 */
function contentMg(strength: string | null, size: UnitOfUseSize | null | undefined): number | null {
	const match = strength?.trim().match(/^([\d.]+)\s*([a-zµ]+)\s*(?:\/\s*([\d.]*)\s*([a-z]*))?/i);
	if (!match) return null;
	const scale = mgPer(match[2]);
	const value = Number(match[1]);
	if (!scale || !(value > 0)) return null;
	const mg = value * scale;
	const denominatorUnit = match[4]?.toLowerCase() ?? '';
	const perMl = mlPer(denominatorUnit);
	if (perMl) {
		if (size?.kind !== 'volume' || !size.unit) return null;
		const sizeMl = size.value * (mlPer(size.unit) ?? NaN);
		const denominatorMl = Number(match[3] || 1) * perMl;
		return sizeMl > 0 ? (mg * sizeMl) / denominatorMl : null;
	}
	// No denominator at all next to a labeled volume is ambiguous.
	if (match[3] === undefined && !denominatorUnit && size?.kind === 'volume') return null;
	return mg;
}

/**
 * A salt's content restated as the moiety's vial size, when the label or the
 * package's own unit of use names one within salt distance: Hikma's `5.13 g`
 * of vancomycin hydrochloride is the 5 g vial.
 */
function moietyMg(mg: number, source: PseudoScdSource): number {
	const labeled = [
		...new Set((source.reconstitution ?? []).flatMap((row) => row.vialMassMg ?? []))
	].filter((vial) => near(vial, mg));
	if (labeled.length === 1) return labeled[0];
	const size = source.size;
	const sized = size?.kind === 'mass' ? toMg(size.value, size.unit) : null;
	if (sized !== null) {
		if (near(sized, mg)) return sized;
	}
	return mg;
}

const round = (mg: number) => Number(mg.toPrecision(6));

/**
 * The pseudo-SCD a package belongs to, or null when RxNorm already quantifies
 * it by content, it is not a dry fill, or its content cannot be read exactly.
 */
export function pseudoScdFor(source: PseudoScdSource): PseudoScd | null {
	const conceptName = source.details?.rxnav?.conceptName;
	if (!source.isDryFill || !conceptName || !isVialForm(conceptName)) return null;
	// `4 ML pembrolizumab 25 MG/ML Injection` is a quantified drug: RxNorm
	// already fixes its content, so it is no concentration-coded bulk fill.
	if (QUANTIFIED_CONCEPT.test(conceptName)) return null;
	const concept = rxNormStrengths(conceptName);
	// Only concentration concepts misstate a dry fill.
	if (!concept.length || !concept.every((entry) => entry.perUnit?.toUpperCase() === 'ML'))
		return null;
	// An NDC the FDA directory doesn't list has no directory ingredients; the
	// label's active ingredients stand in, as they do for its title.
	const ingredients = source.ingredients?.length
		? source.ingredients
		: (source.details?.spl?.ingredients ?? []).filter((item) => item.kind === 'active');
	if (ingredients.length !== concept.length) return null;

	const group = (name: string) => ingredientGroup(name).toLowerCase();
	const contents: { name: string; mg: number }[] = [];
	for (const entry of concept) {
		const wanted = group(entry.name);
		const matches = ingredients.filter((item) => {
			const have = group(item.name);
			return have === wanted || have.includes(wanted) || wanted.includes(have);
		});
		if (matches.length !== 1) return null;
		const mg = contentMg(matches[0].strength, source.size);
		if (mg === null) return null;
		contents.push({
			name: entry.name.toLowerCase(),
			mg: round(concept.length === 1 ? moietyMg(mg, source) : mg)
		});
	}

	const parts = contents.map((item) => `${item.name} ${item.mg} MG`);
	const sorted = [...parts].sort();
	return {
		key: `${sorted.join(' / ').toLowerCase()}|injection|bulk`,
		name: `${parts.join(' / ')} Injection (Bulk)`,
		ingredients: contents,
		fromRxcui: source.details?.rxnav?.rxcui ?? null
	};
}
