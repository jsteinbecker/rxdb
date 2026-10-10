// RxNorm names every concept by a term type (TTY): SCD, SBD, BN, DF… They are
// precise but opaque, so the search shows a plain name and keeps the code and
// its meaning in a tooltip.

const TERM_TYPES: Record<string, { label: string; meaning: string }> = {
	SCD: { label: 'Generic drug', meaning: 'Semantic clinical drug: ingredient, strength and dose form' },
	SBD: { label: 'Brand drug', meaning: 'Semantic branded drug: a brand of a clinical drug' },
	GPCK: { label: 'Generic pack', meaning: 'Generic pack: several clinical drugs sold together' },
	BPCK: { label: 'Brand pack', meaning: 'Branded pack: several drugs sold together under a brand' },
	SCDF: { label: 'Drug + form', meaning: 'Clinical drug form: ingredient and dose form, any strength' },
	SBDF: { label: 'Brand + form', meaning: 'Branded drug form: brand and dose form, any strength' },
	SCDFP: { label: 'Drug + form', meaning: 'Clinical drug form, precise ingredient' },
	SBDFP: { label: 'Brand + form', meaning: 'Branded drug form, precise ingredient' },
	SCDG: { label: 'Drug + form group', meaning: 'Clinical dose form group: ingredient and a family of forms' },
	SCDGP: { label: 'Drug + form group', meaning: 'Clinical dose form group, precise ingredient' },
	SBDG: { label: 'Brand + form group', meaning: 'Branded dose form group: brand and a family of forms' },
	IN: { label: 'Ingredient', meaning: 'Ingredient' },
	PIN: { label: 'Precise ingredient', meaning: 'Precise ingredient: a specific salt or form' },
	MIN: { label: 'Multiple ingredients', meaning: 'Multiple ingredients, as one combination' },
	BN: { label: 'Brand name', meaning: 'Brand name' },
	DF: { label: 'Dose form', meaning: 'Dose form' },
	DFG: { label: 'Dose form group', meaning: 'Dose form group: a family of dose forms' }
};

/** A plain name for a term type, or the code itself when it is not a known one. */
export const ttyLabel = (tty: string | null | undefined) =>
	tty ? (TERM_TYPES[tty]?.label ?? tty) : 'Concept';

/** The code and what it means, for a tooltip: `SCD — Semantic clinical drug: …`. */
export const ttyTitle = (tty: string | null | undefined) =>
	tty ? `${tty} — ${TERM_TYPES[tty]?.meaning ?? 'RxNorm term type'}` : 'RxNorm concept';
