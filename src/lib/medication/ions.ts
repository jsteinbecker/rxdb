/**
 * Ions as constituents of a salt ingredient. Sources name them inconsistently —
 * GSRS and SPL say `CHLORIDE ION`, `SODIUM CATION`, `CHLORIDE ANION`; label
 * prose says "sodium" — so everything shown to the user goes through here and
 * reads one way: "Sodium ion (Na⁺)", "Chloride ion (Cl⁻)".
 *
 * @module
 */

type IonFacts = { symbol: string; charge: string; valence: number; massMg: number };

/** Formula weights (mg per mmol) and charges of the ions labels declare. */
const IONS: Record<string, IonFacts> = {
	sodium: { symbol: 'Na', charge: '⁺', valence: 1, massMg: 22.99 },
	potassium: { symbol: 'K', charge: '⁺', valence: 1, massMg: 39.098 },
	lithium: { symbol: 'Li', charge: '⁺', valence: 1, massMg: 6.94 },
	ammonium: { symbol: 'NH₄', charge: '⁺', valence: 1, massMg: 18.038 },
	calcium: { symbol: 'Ca', charge: '²⁺', valence: 2, massMg: 40.078 },
	magnesium: { symbol: 'Mg', charge: '²⁺', valence: 2, massMg: 24.305 },
	zinc: { symbol: 'Zn', charge: '²⁺', valence: 2, massMg: 65.38 },
	ferrous: { symbol: 'Fe', charge: '²⁺', valence: 2, massMg: 55.845 },
	ferric: { symbol: 'Fe', charge: '³⁺', valence: 3, massMg: 55.845 },
	chloride: { symbol: 'Cl', charge: '⁻', valence: 1, massMg: 35.453 },
	bromide: { symbol: 'Br', charge: '⁻', valence: 1, massMg: 79.904 },
	iodide: { symbol: 'I', charge: '⁻', valence: 1, massMg: 126.904 },
	fluoride: { symbol: 'F', charge: '⁻', valence: 1, massMg: 18.998 },
	acetate: { symbol: 'C₂H₃O₂', charge: '⁻', valence: 1, massMg: 59.044 },
	bicarbonate: { symbol: 'HCO₃', charge: '⁻', valence: 1, massMg: 61.017 },
	lactate: { symbol: 'C₃H₅O₃', charge: '⁻', valence: 1, massMg: 89.07 },
	gluconate: { symbol: 'C₆H₁₁O₇', charge: '⁻', valence: 1, massMg: 195.15 },
	citrate: { symbol: 'C₆H₅O₇', charge: '³⁻', valence: 3, massMg: 189.1 },
	sulfate: { symbol: 'SO₄', charge: '²⁻', valence: 2, massMg: 96.06 },
	phosphate: { symbol: 'PO₄', charge: '³⁻', valence: 3, massMg: 94.971 }
};

const ION_SUFFIX = /\s+(?:ion|cation|anion)$/i;

/** `CHLORIDE ION`, `SODIUM CATION`, `Chloride anion` — a substance name that is an ion. */
export const isIonName = (name: string) => ION_SUFFIX.test(name.trim());

/** `SODIUM CATION` → `sodium`; a bare element name passes through lowercased. */
export const ionKey = (name: string) =>
	name
		.trim()
		.replace(ION_SUFFIX, '')
		.replace(/\s*\(.*\)$/, '')
		.toLowerCase();

const titleCase = (text: string) => text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

/** The one way an ion reads: `Sodium ion (Na⁺)`, `Chloride ion (Cl⁻)`. */
export function ionDisplayName(name: string): string {
	const key = ionKey(name);
	const facts = IONS[key];
	return `${titleCase(key)} ion${facts ? ` (${facts.symbol}${facts.charge})` : ''}`;
}

/** An ion name normalized for display; any other substance name unchanged. */
export const constituentName = (name: string) => (isIonName(name) ? ionDisplayName(name) : name);

/** mg per mEq of the ion, when it is one we know. */
export function mgPerMEq(name: string): number | null {
	const facts = IONS[ionKey(name)];
	return facts ? facts.massMg / facts.valence : null;
}

/**
 * Whether a label's declared mg and mEq of an ion agree (within 5%, labels round),
 * with the mEq the mass implies. `null` when the ion is unknown.
 */
export function balanceIon(
	name: string,
	massMg: number,
	mEq: number
): { balanced: boolean; expectedMEq: number } | null {
	const perMEq = mgPerMEq(name);
	if (!perMEq || !(massMg > 0) || !(mEq > 0)) return null;
	const expectedMEq = Number((massMg / perMEq).toPrecision(3));
	return { balanced: Math.abs(massMg / perMEq - mEq) / mEq <= 0.05, expectedMEq };
}

/**
 * Cations a salt's formula carries as one element. Only metals: an organic
 * drug's own Cl, Br or F atoms are covalent, so counting them as chloride or
 * bromide ions would be wrong.
 */
const ELEMENT_CATIONS: Record<string, string> = {
	sodium: 'Na',
	potassium: 'K',
	lithium: 'Li',
	calcium: 'Ca',
	magnesium: 'Mg',
	zinc: 'Zn'
};

/** The cations a salt's name mentions, in `ELEMENT_CATIONS` order: `CEFTRIAXONE SODIUM` → `['sodium']`. */
export const cationsNamedIn = (name: string) =>
	Object.keys(ELEMENT_CATIONS).filter((ion) =>
		// `PEMETREXED DISODIUM`, `TRISODIUM CITRATE` deliver sodium too.
		new RegExp(`\\b(?:mono|di|tri|tetra)?${ion}\\b`, 'i').test(name)
	);

/** Atoms of each element in one formula part with no leading coefficient: `(C6H11O7)2Ca`. */
function atomsOf(part: string): Map<string, number> | null {
	const stack: Map<string, number>[] = [new Map()];
	const add = (into: Map<string, number>, element: string, count: number) =>
		into.set(element, (into.get(element) ?? 0) + count);
	const token = /([A-Z][a-z]?)(\d*)|(\()|\)(\d*)/y;
	let at = 0;
	while (at < part.length) {
		token.lastIndex = at;
		const match = token.exec(part);
		if (!match) return null;
		at = token.lastIndex;
		if (match[1]) add(stack.at(-1)!, match[1], Number(match[2] || 1));
		else if (match[0] === '(') stack.push(new Map());
		else {
			const group = stack.pop();
			if (!group || !stack.length) return null;
			const times = Number(match[4] || 1);
			for (const [element, count] of group) add(stack.at(-1)!, element, count * times);
		}
	}
	return stack.length === 1 ? stack[0] : null;
}

/**
 * How many of `ion` one formula unit holds, from a GSRS formula:
 * `C18H16N8Na2O7S3.7/2H2O` → 2 sodium. Dotted parts may lead with a count
 * (`2C6H11O7.Ca`, `7/2H2O`). Null for an unreadable formula or an ion that is
 * not a single-element cation.
 */
export function ionAtoms(formula: string, ion: string): number | null {
	const element = ELEMENT_CATIONS[ionKey(ion)];
	if (!element || !formula.trim()) return null;
	// Each dotted part: a count (`2`, `7/2`, `3.5`), then its formula. A dot after a
	// part's leading count is a decimal point, any other dot separates parts.
	const part = /(\d+(?:\/\d+)?(?:\.\d+)?)?([A-Z(][^.·•]*)(?:[.·•]|$)/y;
	const text = formula.replace(/\s+/g, '');
	let total = 0;
	let at = 0;
	while (at < text.length) {
		part.lastIndex = at;
		const match = part.exec(text);
		if (!match || part.lastIndex === at) return null;
		at = part.lastIndex;
		const [top, bottom] = (match[1] ?? '1').split('/').map(Number);
		const atoms = atomsOf(match[2]);
		if (!atoms) return null;
		total += ((atoms.get(element) ?? 0) * top) / (bottom ?? 1);
	}
	return total;
}

const threeFigures = (value: number) => Number(value.toPrecision(3));

/**
 * The mass and mEq of `ion` in `saltMassMg` of a salt, from its GSRS formula
 * and molecular weight. Null when the salt holds none or either is unknown.
 */
export function ionFromSalt(
	salt: { formula: string | null; mw: number | null },
	saltMassMg: number,
	ion: string
): { massMg: number; mEq: number } | null {
	const facts = IONS[ionKey(ion)];
	const atoms = salt.formula ? ionAtoms(salt.formula, ion) : null;
	if (!facts || !atoms || !salt.mw || !(saltMassMg > 0)) return null;
	const massMg = (saltMassMg * atoms * facts.massMg) / salt.mw;
	return {
		massMg: threeFigures(massMg),
		mEq: threeFigures((massMg / facts.massMg) * facts.valence)
	};
}
