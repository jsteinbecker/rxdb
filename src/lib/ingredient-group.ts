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

// ── One moiety, several names ────────────────────────────────────────────────
// Stripping the counterion leaves `CLAVULANATE`, but the label's moiety and some
// listings say `CLAVULANIC ACID` — the conjugate acid of the same anion. And a
// handful of drugs arrive under their INN or BAN (`ARGIPRESSIN`, `SALBUTAMOL`).
//
// Both lists are explicit rather than a suffix rule: `-ate` → `-ic acid` would
// turn methotrexate and glycopyrrolate into acids that do not exist, and a
// moiety-UNII join would merge metoprolol's salts and every prodrug ester with
// its parent. Each entry is a pair that names one substance.

/**
 * Conjugate pairs by stem: `<stem>ic acid` and `<stem>ate` are one moiety. The
 * value is the name RxNorm's ingredient uses, which is the one we show.
 */
const CONJUGATES: Record<string, 'acid' | 'base'> = {
	// Named for the anion
	alendron: 'base',
	clavulan: 'base',
	clodron: 'base',
	etidron: 'base',
	ibandron: 'base',
	pamidron: 'base',
	risedron: 'base',
	tiludron: 'base',
	hyaluron: 'base',
	meclofenam: 'base',
	edet: 'base',
	pentet: 'base',
	diatrizo: 'base',
	iothalam: 'base',
	gadoben: 'base',
	gadopentet: 'base',
	gadoter: 'base',
	gadoxet: 'base',
	// Named for the acid
	zoledron: 'acid',
	valpro: 'acid',
	ethacryn: 'acid',
	tranexam: 'acid',
	aminocapro: 'acid',
	aminolevulin: 'acid',
	aminosalicyl: 'acid',
	mefenam: 'acid',
	fusid: 'acid',
	fol: 'acid',
	ascorb: 'acid',
	aspart: 'acid',
	glutam: 'acid',
	nalidix: 'acid',
	obetichol: 'acid',
	bempedo: 'acid',
	undecylen: 'acid'
};

/** INN or BAN → the US adopted name, which is what RxNorm and US labels use. */
const SYNONYMS: Record<string, string> = {
	argipressin: 'vasopressin',
	glycopyrronium: 'glycopyrrolate',
	paracetamol: 'acetaminophen',
	salbutamol: 'albuterol',
	levosalbutamol: 'levalbuterol',
	adrenaline: 'epinephrine',
	noradrenaline: 'norepinephrine',
	isoprenaline: 'isoproterenol',
	lignocaine: 'lidocaine',
	frusemide: 'furosemide',
	glibenclamide: 'glyburide',
	ciclosporin: 'cyclosporine',
	rifampicin: 'rifampin',
	aciclovir: 'acyclovir',
	valaciclovir: 'valacyclovir',
	cefalexin: 'cephalexin',
	amoxycillin: 'amoxicillin',
	colecalciferol: 'cholecalciferol',
	phytomenadione: 'phytonadione',
	pethidine: 'meperidine',
	suxamethonium: 'succinylcholine',
	dexamfetamine: 'dextroamphetamine',
	mesalazine: 'mesalamine',
	beclometasone: 'beclomethasone',
	clomifene: 'clomiphene',
	ethinylestradiol: 'ethinyl estradiol',
	'glyceryl trinitrate': 'nitroglycerin',
	'ursodeoxycholic acid': 'ursodiol',
	'folinic acid': 'leucovorin',
	'levofolinic acid': 'levoleucovorin',
	'acetylsalicylic acid': 'aspirin'
};

/** `name` rewritten to the one name its moiety goes by, or null when it has no other. */
function canonicalName(name: string): string | null {
	const lower = name.toLowerCase();
	if (SYNONYMS[lower]) return SYNONYMS[lower];
	const acid = lower.match(/^(.+)ic acid$/);
	if (acid && CONJUGATES[acid[1]] === 'base') return `${acid[1]}ate`;
	const base = lower.match(/^(.+)ate$/);
	if (base && CONJUGATES[base[1]] === 'acid') return `${base[1]}ic acid`;
	return null;
}

/** `canonical` in the casing `source` was written in: all caps, title case or lower. */
function inCasing(source: string, canonical: string): string {
	if (source === source.toUpperCase()) return canonical.toUpperCase();
	if (/^[A-Z]/.test(source)) return canonical.replace(/(^|\s)([a-z])/g, (_, lead, c) => lead + c.toUpperCase());
	return canonical;
}

const resolved = (name: string) => {
	const canonical = canonicalName(name);
	return canonical ? inCasing(name, canonical) : name;
};

const HYDRATE = /hydrate$|^anhydrous$/;

/** A trailing solvate phrase (`PROPYLENE GLYCOL SOLVATE`, `ETHANOLATE`) — a crystal form, not a different drug. */
const SOLVATE =
	/(?:\s+(?:propylene|glycol|ethanol|methanol|isopropanol|acetone|dimethyl|sulfoxide|dmso|water))*\s+solvate$|\s+(?:ethanolate|methanolate)$/i;

// ── Explicit racemates ───────────────────────────────────────────────────────
// A label may spell out that a racemic part is racemic — `AMPHETAMINE
// DL-ASPARTATE`, `(±)-`, `rac-` — where another names the same substance plainly
// (`AMPHETAMINE ASPARTATE`). The marker adds nothing to identity, so grouping
// ignores it. A single enantiomer (`D-`, `L-`, `levo`, `dextro`) is a different
// substance and is left alone.

/** An explicit racemic prefix on a word: `DL-`, `D,L-`, `(D,L)-`, `(DL)-`, `(±)-`, `(+/-)-`, `(RS)-`, `rac-`. */
const RACEMIC = /(^|[\s,])(?:\(\s*(?:d\s*,?\s*l|±|\+\s*\/\s*-|r\s*,?\s*s)\s*\)|d\s*,\s*l|dl|±|rac)-(?=[a-z])/gi;

/** `name` with any explicit racemic marker dropped: `AMPHETAMINE DL-ASPARTATE` → `AMPHETAMINE ASPARTATE`. */
export function withoutRacemicMarker(name: string): string {
	return name.replace(RACEMIC, '$1');
}

/**
 * `name` with an explicit racemic marker written one way, `(D,L)-`, so a label's
 * optical rotation is shown rather than lost: `AMPHETAMINE DL-ASPARTATE` →
 * `AMPHETAMINE (D,L)-ASPARTATE`. Names without a marker come back unchanged.
 */
export function racemicDisplayName(name: string): string {
	return name.replace(RACEMIC, '$1(D,L)-');
}

/**
 * The name to group an active ingredient under, in its source casing:
 * `CEFEPIME HYDROCHLORIDE` → `CEFEPIME`, `Metoprolol Succinate` unchanged,
 * `POTASSIUM CHLORIDE` unchanged. Hydrate and solvate words are always dropped,
 * and a conjugate or INN spelling takes its moiety's one name: `CLAVULANIC ACID`
 * → `CLAVULANATE`, `ARGIPRESSIN` → `VASOPRESSIN`.
 */
export function ingredientGroup(name: string): string {
	const words = withoutRacemicMarker(name)
		.trim()
		.replace(SOLVATE, '')
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
	if (base.length === 1 && ELEMENTS.has(lower(base[0])) && base.length < words.length) return salt;
	if (SALT_SENSITIVE.has(base.map(lower).join(' '))) return salt;
	return resolved(base.join(' '));
}

// ── A racemate beside one of its own enantiomers ────────────────────────────
// `AMPHETAMINE` is half `DEXTROAMPHETAMINE`, half `LEVOAMPHETAMINE`. Only split
// where the product also names one of the enantiomers, so the halves have a
// whole to join; a racemate on its own stays the racemate.

const ENANTIOMER = /^(dextro|levo)(.+)$/i;

/** `word` with its `dextro`/`levo` prefix swapped for `prefix`, in the word's casing. */
const withPrefix = (word: string, prefix: 'dextro' | 'levo') => {
	const swapped = word.replace(/^(?:dextro|levo)/i, prefix);
	if (word === word.toUpperCase()) return swapped.toUpperCase();
	return /^[A-Z]/.test(word) ? swapped.replace(/^./, (c) => c.toUpperCase()) : swapped;
};

/**
 * Per name, the enantiomers it counts toward and its share of each; null when
 * no racemate in the list has an enantiomer beside it.
 */
export function enantiomerShares(names: string[]): { name: string; share: number }[][] | null {
	const heads = names.map((name) => ingredientGroup(name).trim().split(/\s+/)[0] ?? '');
	const lower = heads.map((head) => head.toLowerCase());
	// Racemate stem → the spelling its enantiomers take, from the first one listed.
	const stems = new Map<string, string>();
	for (const head of heads) {
		const match = head.match(ENANTIOMER);
		if (match && lower.includes(match[2].toLowerCase()) && !stems.has(match[2].toLowerCase()))
			stems.set(match[2].toLowerCase(), head);
	}
	if (!stems.size) return null;
	return heads.map((head, index) => {
		const stem = lower[index].match(ENANTIOMER)?.[2] ?? lower[index];
		const spelling = stems.get(stem);
		if (!spelling) return [{ name: names[index], share: 1 }];
		const dextro = withPrefix(spelling, 'dextro');
		const levo = withPrefix(spelling, 'levo');
		if (lower[index] === stem)
			return [
				{ name: dextro, share: 0.5 },
				{ name: levo, share: 0.5 }
			];
		return [{ name: /^dextro/i.test(head) ? dextro : levo, share: 1 }];
	});
}
