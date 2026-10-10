// Ions as constituents of a salt ingredient. Sources name them inconsistently —
// GSRS and SPL say `CHLORIDE ION`, `SODIUM CATION`, `CHLORIDE ANION`; label
// prose says "sodium" — so everything shown to the user goes through here and
// reads one way: "Sodium ion (Na⁺)", "Chloride ion (Cl⁻)".

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
