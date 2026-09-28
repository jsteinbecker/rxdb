// ── Which ingredient a product is "of", for grouping ─────────────────────────
// Sources disagree on how to name an active ingredient. The FDA directory names
// the salt (`CEFEPIME HYDROCHLORIDE`), RxNorm and some labels name the moiety
// (`cefepime`), so a hierarchy keyed on the raw name splits one drug in two.
//
// The fix is to group by the moiety — drop a trailing counterion or hydrate —
// except where the salt *is* the clinical identity:
//
//   • Electrolytes and minerals. Strip `CHLORIDE` from `POTASSIUM CHLORIDE` and
//     what is left is an element; potassium chloride, phosphate and acetate are
//     different therapies, and so are calcium gluconate and chloride.
//   • Depot and prodrug esters. Decanoate, palmitate, benzathine and their kin
//     exist to change release; haloperidol decanoate is not haloperidol lactate.
//   • A short list of moieties whose salts are not interchangeable — metoprolol
//     tartrate (IR) vs succinate (ER), phenytoin vs phenytoin sodium, the
//     corticosteroid esters (acetate depot vs sodium succinate/phosphate IV).
//
// Stripping is by whole trailing words only, so an ester that is part of the
// drug — tenofovir *disoproxil*, mycophenolate *mofetil* — is never removed,
// and TDF stays apart from TAF even though the label's moiety is tenofovir.

/** Counterions and hydrate words that do not change what the drug is. */
const INCIDENTAL = new Set([
	// Anions
	'hydrochloride',
	'dihydrochloride',
	'monohydrochloride',
	'hydrobromide',
	'hydroiodide',
	'sulfate',
	'sulphate',
	'bisulfate',
	'hemisulfate',
	'mesylate',
	'dimesylate',
	'methanesulfonate',
	'besylate',
	'besilate',
	'tosylate',
	'maleate',
	'fumarate',
	'hemifumarate',
	'tartrate',
	'bitartrate',
	'hemitartrate',
	'citrate',
	'phosphate',
	'diphosphate',
	'acetate',
	'diacetate',
	'lactate',
	'gluconate',
	'succinate',
	'hyclate',
	'nitrate',
	'bromide',
	'chloride',
	'iodide',
	'oxalate',
	'malate',
	'mandelate',
	'napsylate',
	'edisylate',
	'isethionate',
	'xinafoate',
	'trifenatate',
	'fosamil',
	// Cations and amine bases
	'sodium',
	'disodium',
	'trisodium',
	'potassium',
	'dipotassium',
	'calcium',
	'magnesium',
	'meglumine',
	'tromethamine',
	'olamine',
	'diolamine',
	'lysine',
	'arginine',
	// Hydration state
	'hydrate',
	'monohydrate',
	'dihydrate',
	'trihydrate',
	'tetrahydrate',
	'pentahydrate',
	'hexahydrate',
	'heptahydrate',
	'hemihydrate',
	'sesquihydrate',
	'anhydrous'
]);

const ABBREVIATIONS: Record<string, string> = { hcl: 'hydrochloride', hbr: 'hydrobromide' };

/** Whatever is left of an electrolyte or mineral salt once the anion goes. */
const ELEMENTS = new Set([
	'sodium',
	'potassium',
	'calcium',
	'magnesium',
	'lithium',
	'ammonium',
	'aluminum',
	'aluminium',
	'zinc',
	'iron',
	'ferrous',
	'ferric',
	'copper',
	'cupric',
	'manganese',
	'selenium',
	'chromium',
	'chromic'
]);

/** Salts whose job is to change release; always kept. */
const DEPOT =
	/\b(?:decanoate|palmitate|enanthate|cypionate|undecanoate|valerate|benzathine|procaine|pamoate|lauroxil|estolate|ethylsuccinate|stearate|lactobionate)\b/i;

/**
 * Moieties whose salts differ in release, bioavailability or labeled dosing, so
 * each salt is its own group. Matched against the stripped name.
 */
const SALT_SENSITIVE = new Set([
	'metoprolol',
	'phenytoin',
	'diclofenac',
	'mycophenolate',
	'mycophenolic acid',
	'erythromycin',
	'quinidine',
	'bupropion',
	'hydrocortisone',
	'methylprednisolone',
	'prednisolone',
	'dexamethasone',
	'betamethasone',
	'triamcinolone'
]);

const HYDRATE = /hydrate$|^anhydrous$/;

/**
 * The name to group an active ingredient under, in its source casing:
 * `CEFEPIME HYDROCHLORIDE` → `CEFEPIME`, `Metoprolol Succinate` unchanged,
 * `POTASSIUM CHLORIDE` unchanged. Hydrate words are always dropped.
 */
export function ingredientGroup(name: string): string {
	const words = name
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean)
		.map((word) => ABBREVIATIONS[word.toLowerCase()] ?? word);
	const lower = (word: string) => word.toLowerCase();

	// Hydration never matters; drop it first so `X SULFATE PENTAHYDRATE` reads as `X SULFATE`.
	while (words.length > 1 && HYDRATE.test(lower(words.at(-1)!))) words.pop();
	const salt = words.join(' ');
	if (DEPOT.test(salt)) return salt;

	const base = [...words];
	while (base.length > 1 && INCIDENTAL.has(lower(base.at(-1)!))) base.pop();
	if (base.length === words.length) return salt;
	if (base.length === 1 && ELEMENTS.has(lower(base[0]))) return salt;
	if (SALT_SENSITIVE.has(base.map(lower).join(' '))) return salt;
	return base.join(' ');
}
