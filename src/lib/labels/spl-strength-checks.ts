/**
 * Label strengths that cannot be true as coded.
 *
 * SPL states every strength as a numerator/denominator ratio whose denominator
 * should be the unit of presentation — 1 VIAL, 1 TABLET, 1 mL. Labelers get it
 * wrong in two recurring ways, and both survive schema validation:
 *
 *   1. The denominator is coded as a mass: `513 mg in 1 mg`. Physically
 *      impossible, and what the labeler meant is "per vial", which the
 *      packaging level (`513 mg in 1 VIAL`) confirms. Every ingredient sharing
 *      that miscoded denominator — the excipients too — means the same thing.
 *   2. The basis says moiety (ACTIM) but the number is the salt's mass: 513 mg
 *      of vancomycin hydrochloride is 500 mg of vancomycin. RxNorm normalizes
 *      to the moiety, so a small excess over RxNorm's strength, on an
 *      ingredient whose name is the moiety plus a counterion, is the signature.
 *   3. The same mix-up with a heavy counterion (lysine acetate, cysteine
 *      hydrochloride). The FDA directory naming the salt at the very mass the
 *      label calls moiety strength is the shape of it, but proves nothing on
 *      its own: the directory is derived from the same SPL and names the salt
 *      under ordinary "equivalent to" labeling too (Fetroja's 1 g of
 *      cefiderocol). So the label's own text decides: a number it gives as the
 *      moiety's ("1 gram of cefiderocol") is never converted, and where RxNorm
 *      states the moiety at the label's number, only text giving the salt that
 *      mass ("L-Lysine Acetate USP 1.2 g") overrules it. GSRS molecular weights
 *      give the moiety's share. A light salt or hydrate (citric acid
 *      monohydrate coded ACTIM as anhydrous citric acid) gets the same
 *      treatment when RxNorm states no strength for its moiety to arbitrate.
 *      See docs/strength-basis-rules.md.
 *
 * Corrections are returned alongside the stated values, never instead of them:
 * the caller shows the corrected strength and a note naming what the label said.
 *
 * @module
 */
import type { SplIngredient, SplProduct, StatedStrength } from './spl-ingredients';
import { strengthText } from './spl-ingredients';
import { convertStrength, roundSignificant } from '../medication/strength-conversion';
import { mgPer, mlPer, toMg } from '../medication/units';

export type StrengthCorrectionKind = 'presentation-unit' | 'salt-equivalent' | 'moiety-equivalent';

export interface StrengthCorrection {
	kind: StrengthCorrectionKind;
	note: string;
	/** A salt correction's number as the label printed it, the salt's own mass. */
	stated?: number;
}

export interface CheckedStrength extends StatedStrength {
	corrections: StrengthCorrection[];
}

const massMg = (value: number | null, unit: string | null): number | null =>
	value === null ? null : toMg(value, unit);

const isMass = (unit: string | null): boolean => mgPer(unit) !== null;

const VOLUME = /^(?:mL|L|uL|µL)$/i;

const round = (value: number): number => Number(value.toPrecision(12));

/**
 * Maximum salt-to-moiety mass ratio treated as a salt/base mix-up. Common
 * pharmaceutical salts sit well inside it (vancomycin HCl ≈ 1.025,
 * diphenhydramine HCl ≈ 1.14); anything larger is more likely a real
 * difference in strength than a basis error.
 */
const MAX_SALT_RATIO = 1.3;
/** Below this the two strengths agree within rounding. */
const MIN_SALT_RATIO = 1.005;

/** One `name value UNIT[/UNIT]` component of an RxNorm clinical drug name. */
export interface RxStrength {
	name: string;
	value: number;
	unit: string;
	/** The denominator's amount: 100 in `900 MG/100ML`, 1 when unstated. */
	per: number;
	perUnit: string | null;
}

/** RxNorm's quantity and release-period lead-ins, always upper case: `150 ML `, `0.4 ML `, `24 HR `, `200 ACTUAT `. */
const QUANTITY_PREFIX = /^(?:[\d.]+\s+(?:ML|HR|ACTUAT)\s+)+/;

/**
 * The strengths in an RxNorm SCD/SBD name: `vancomycin 500 MG Injection`,
 * `amoxicillin 250 MG / clavulanate 62.5 MG Oral Tablet`.
 */
export function rxNormStrengths(name: string | null | undefined): RxStrength[] {
	if (!name) return [];
	const plain = name.replace(/\[[^\]]*\]/g, '');
	// A pack, `{21 (norgestimate 0.25 MG / … Oral Tablet) / 7 (…) } Pack`: each
	// component drug in its parentheses.
	if (/^\s*\{/.test(plain))
		return [...plain.matchAll(/\(([^()]+)\)/g)].flatMap((group) => rxNormStrengths(group[1]));
	const out: RxStrength[] = [];
	for (const part of plain.split(/\s+\/\s+/)) {
		const match = part.match(/^\s*(.+?)\s+([\d.]+)\s*([A-Za-z]+)(?:\/([\d.]*)\s*([A-Za-z]+))?\b/);
		if (!match) continue;
		// `150 ML vancomycin`, `24 HR venlafaxine`: a quantity or release period, not the ingredient.
		const ingredient = match[1].replace(QUANTITY_PREFIX, '').trim();
		if (!ingredient) continue;
		const value = Number(match[2]);
		if (!Number.isFinite(value)) continue;
		const per = match[4] ? Number(match[4]) : 1;
		if (!Number.isFinite(per) || per <= 0) continue;
		out.push({ name: ingredient, value, unit: match[3], per, perUnit: match[5] ?? null });
	}
	return out;
}

/**
 * The strengths of `name` when it is an SCD's or SBD's, else none. RxNav names
 * some NDCs in the listing's own words (`Citric Acid Monohydrate 0.80 g in
 * 100 mL / …`), which neither spells as RxNorm nor states moieties: its
 * hydrate is the hydrate, and arbitrating with it read the hydrate's mass as
 * citric acid's. An SCD's units are always upper case (`MG`, `ML`, `UNT`).
 */
export function scdStrengths(name: string | null | undefined): RxStrength[] {
	const rx = rxNormStrengths(name);
	const upper = rx.every(
		(entry) =>
			entry.unit === entry.unit.toUpperCase() &&
			(!entry.perUnit || entry.perUnit === entry.perUnit.toUpperCase())
	);
	return upper && !/\d\s*[a-z]+\s+in\s+\d/i.test(name ?? '') ? rx : [];
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const HYDRATION_WORD =
	/\b(?:anhydrous|(?:mono|di|tri|tetra|penta|hexa|hepta|hemi|sesqui)?hydrate)\b/gi;
const withoutHydration = (name: string) =>
	name.replace(HYDRATION_WORD, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** An acid as RxNorm names its moiety, by the anion: `clavulanic acid` → `clavulanate`. */
const asAnion = (name: string) => name.replace(/\b(\w+)ic acid\b/g, '$1ate');

/**
 * The same substance whatever its water: SPL names the moiety `PIPERACILLIN
 * ANHYDROUS` or `ANHYDROUS CITRIC ACID` where RxNorm writes `piperacillin` and
 * `citric acid`. Every comparison against RxNorm goes through this; an exact
 * match missed piperacillin, and the label's 2 g was "corrected" to 1.919 g
 * beside an SCD that says 2000 MG. Nor whether an acid is named as itself or
 * its anion: SPL's `CLAVULANIC ACID` is RxNorm's `clavulanate`.
 */
export const sameSubstance = (a: string, b: string) =>
	asAnion(withoutHydration(a)) === asAnion(withoutHydration(b));

/** A salt or hydrate of `moiety`, or the moiety itself: `PIPERACILLIN SODIUM`, `CITRIC ACID MONOHYDRATE`. */
export const isFormOf = (ingredient: string, moiety: string) =>
	withoutHydration(ingredient).includes(withoutHydration(moiety));

/**
 * A salt that names its moiety and a counterion: `PIPERACILLIN SODIUM` of
 * `PIPERACILLIN ANHYDROUS`. `CITRIC ACID MONOHYDRATE` of `ANHYDROUS CITRIC
 * ACID` differs only in water, which is no counterion.
 */
const namesMoiety = (ingredient: string, moiety: string) => {
	const salt = withoutHydration(ingredient);
	const base = withoutHydration(moiety);
	return salt.includes(base) && salt.replace(base, '').trim() !== '';
};

/**
 * The label names the drug bare — `AMOXICILLIN` against moiety `AMOXICILLIN
 * ANHYDROUS` — with no salt or hydrate word of its own. FDA's UNII for the bare
 * name is sometimes the hydrate (amoxicillin's 804826J2HU is the trihydrate),
 * but a labeler who writes the bare name means the drug, so its number is
 * already the moiety's.
 */
const namesBareMoiety = (ingredient: string, moiety: string) =>
	!new RegExp(HYDRATION_WORD.source, 'i').test(ingredient) &&
	withoutHydration(ingredient) === withoutHydration(moiety);

/** `VANCOMYCIN HYDROCHLORIDE` less `VANCOMYCIN` → `hydrochloride`. */
function counterionOf(salt: string, moiety: string): string | null {
	const rest = salt.toLowerCase().replace(moiety.toLowerCase(), '').replace(/\s+/g, ' ').trim();
	return rest || null;
}

/**
 * Check and, where the coding is provably wrong, correct each ingredient's
 * strength. Returned in the same order as `product.ingredients`.
 */
export function checkProductStrengths(
	product: Pick<SplProduct, 'ingredients' | 'presentation'>,
	options: {
		rxNormName?: string | null;
		/** GSRS salt-to-moiety factors by the salt's UNII; see `MoietyFactor`. */
		moietyFactors?: ReadonlyMap<string, MoietyFactor>;
		/** The FDA directory's active ingredients, as it names and measures them. */
		directory?: readonly { name: string; strength: string | null }[];
		/** The label's text (the SPL with its markup stripped), the evidence for rule 3. */
		labelText?: string | null;
	} = {}
): CheckedStrength[] {
	const checked: CheckedStrength[] = product.ingredients.map((ingredient) => ({
		strength: ingredient.strength,
		strengthUnit: ingredient.strengthUnit,
		per: ingredient.per,
		perUnit: ingredient.perUnit,
		corrections: []
	}));

	correctMassDenominators(product, checked);
	correctSaltAsMoiety(product.ingredients, checked, options.rxNormName ?? null);
	correctHeavySaltAsMoiety(
		product.ingredients,
		checked,
		options.moietyFactors,
		options.directory,
		options.rxNormName ?? null,
		options.labelText ?? null
	);
	return checked;
}

/** Rule 1 — `X mg in 1 mg`. */
function correctMassDenominators(
	product: Pick<SplProduct, 'ingredients' | 'presentation'>,
	checked: CheckedStrength[]
): void {
	const massDenominated = checked.filter(
		(row) => row.per !== null && row.per > 0 && isMass(row.perUnit) && isMass(row.strengthUnit)
	);
	if (!massDenominated.length) return;

	// Impossible when any one ingredient outweighs the product it is "in", or
	// when the ingredients together do. The second catches the excipients of a
	// product whose active alone was the tell — 0.05 mg in 1 mg is possible in
	// isolation, but not beside 513 mg in the same 1 mg.
	const denominatorMg = (row: CheckedStrength) => massMg(row.per, row.perUnit)!;
	const total = massDenominated.reduce(
		(sum, row) => sum + massMg(row.strength, row.strengthUnit)! / denominatorMg(row),
		0
	);
	const impossible =
		total > 1 ||
		massDenominated.some((row) => massMg(row.strength, row.strengthUnit)! > denominatorMg(row));
	if (!impossible) return;

	const form = product.presentation?.form ?? null;
	const per = product.presentation?.per ?? 1;
	const presentationUnit = form ?? 'unit';
	for (const row of massDenominated) {
		const stated = `${row.per} ${row.perUnit}`;
		row.per = per;
		row.perUnit = presentationUnit;
		row.corrections.push({
			kind: 'presentation-unit',
			note: `Corrected unit of presentation to ${per} ${presentationUnit} from improper coding as ${stated}`
		});
	}
}

/** Rule 2 — a salt's mass stated as moiety strength. */
function correctSaltAsMoiety(
	ingredients: SplIngredient[],
	checked: CheckedStrength[],
	rxNormName: string | null
): void {
	const rx = scdStrengths(rxNormName);
	if (!rx.length) return;

	ingredients.forEach((ingredient, index) => {
		const row = checked[index];
		if (ingredient.kind !== 'active' || ingredient.basis !== 'moiety') return;
		if (ingredient.moieties.length !== 1 || row.strength === null) return;
		const moiety = ingredient.moieties[0];
		if (sameSubstance(ingredient.name, moiety.name)) return;
		if (!namesMoiety(ingredient.name, moiety.name)) return;

		const reference = rx.find((entry) => sameSubstance(entry.name, moiety.name));
		if (!reference) return;

		// Only compare like with like: RxNorm's per-mL against a per-mL label
		// strength, its per-unit against a per-unit (or per-container) one.
		const labelPerVolume = VOLUME.test(row.perUnit ?? '');
		if (reference.perUnit) {
			if (
				reference.per !== 1 ||
				!labelPerVolume ||
				row.per !== 1 ||
				!sameName(reference.perUnit, row.perUnit!)
			)
				return;
		} else if (labelPerVolume || isMass(row.perUnit)) return;

		const labelMg = massMg(row.strength, row.strengthUnit);
		const rxMg = massMg(reference.value, reference.unit);
		if (labelMg === null || rxMg === null || rxMg <= 0) return;
		const ratio = labelMg / rxMg;
		if (ratio <= MIN_SALT_RATIO || ratio > MAX_SALT_RATIO) return;

		const stated = strengthText({ ...row, per: null, perUnit: null })!;
		const printed = row.strength;
		const corrected = round(rxMg / (mgPer(row.strengthUnit) ?? 1));
		row.strength = corrected;
		const counterion = counterionOf(ingredient.name, moiety.name);
		row.corrections.push({
			kind: 'salt-equivalent',
			stated: printed,
			note:
				`Strength corrected from stated value of ${stated}, equivalent to ` +
				`${corrected} ${row.strengthUnit} ${moiety.name.toLowerCase()}` +
				(counterion ? ` as the ${counterion} salt` : ' as its salt')
		});
	});
}

/** How a salt's mass becomes its moiety's, per GSRS. */
export interface MoietyFactor {
	moietyUnii: string;
	/** Exact decimal `moietyCount · MW(moiety) / MW(salt)`. */
	factor: string;
}

/** A strength as mg per mL, or per one unit when it has no volume; null when unreadable. */
function concentration(
	value: number | null,
	unit: string | null,
	per: number | null,
	perUnit: string | null
): { mg: number; perVolume: boolean } | null {
	const mg = massMg(value, unit);
	if (mg === null || per === null || !(per > 0)) return null;
	const ml = mlPer(perUnit);
	return ml === null
		? { mg: mg / per, perVolume: false }
		: { mg: mg / (per * ml), perVolume: true };
}

/** `1.2 g/100mL`, `.024 g/100mL`, `500 mg/1` as the FDA directory writes them. */
function directoryConcentration(text: string | null) {
	const match = /^\s*(\d*\.?\d+)\s*([a-zµ]+)\s*(?:\/\s*(\d*\.?\d+)?\s*([a-zµ]*))?\s*$/i.exec(
		text ?? ''
	);
	if (!match) return null;
	return concentration(
		Number(match[1]),
		match[2],
		match[3] ? Number(match[3]) : 1,
		match[4] || null
	);
}

/** Within this the directory and label state the same mass. */
const SAME_MASS = 0.005;

/**
 * Whether RxNorm states `moiety` at the label's number: the same concentration
 * like with like, or, where the SCD states an amount (`cefiderocol 1000 MG`),
 * the label's numerator (`1 g/10 mL` of the reconstituted vial).
 */
function rxStatesLabelAmount(
	rx: RxStrength[],
	moiety: string,
	row: StatedStrength,
	label: { mg: number; perVolume: boolean }
): boolean {
	const same = (a: number, b: number) => Math.abs(a - b) <= SAME_MASS * b;
	const numerator = massMg(row.strength, row.strengthUnit);
	return rx.some((entry) => {
		if (!sameSubstance(entry.name, moiety)) return false;
		const stated = concentration(entry.value, entry.unit, entry.per, entry.perUnit);
		if (!stated) return false;
		if (stated.perVolume === label.perVolume && same(stated.mg, label.mg)) return true;
		return !entry.perUnit && numerator !== null && same(stated.mg, numerator);
	});
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `1.2`, `0.8` as a label writes them: `1.2`, `0.8` or `.8`, `1` or `1.0`. */
function numberPattern(value: number): string {
	const [whole, fraction] = String(value).split('.');
	const lead = whole === '0' ? '0?' : whole;
	return fraction ? `${lead}\\.${fraction}0*` : `${lead}(?:\\.0+)?`;
}

const UNIT_WORDS: Record<string, string> = {
	g: '(?:g|grams?)',
	mg: '(?:mg|milligrams?)',
	mcg: '(?:mcg|µg|ug|micrograms?)',
	ug: '(?:mcg|µg|ug|micrograms?)',
	kg: '(?:kg|kilograms?)'
};

/** A substance name as a label may write it: any case, commas or hyphens between words, an `L-`. */
function substancePattern(name: string): string {
	const words = withoutHydration(name)
		.split(/[\s,-]+/)
		.filter(Boolean)
		.map(escaped);
	return `(?:[dl]-)?${words.join('[\\s,-]+')}`;
}

/**
 * Whether the label text gives a substance the row's amount: `1 gram of
 * cefiderocol`, `L-Lysine Acetate USP 1.2 g`. Either order, a few words apart
 * at most. `as` is `salt` for the ingredient as named, whose hydrate word a
 * label may add or drop, or `moiety`, which a following counterion or hydrate
 * word makes the salt instead (`Citric Acid, Monohydrate 0.8 g` is no
 * statement about anhydrous citric acid).
 */
function statesAs(
	text: string,
	name: string,
	row: StatedStrength,
	as: { salt: true } | { moiety: true; counterion: string | null }
): boolean {
	if (row.strength === null || !row.strengthUnit) return false;
	const unit = UNIT_WORDS[row.strengthUnit.toLowerCase()];
	if (!unit) return false;
	const amount = `(?<![\\d.])${numberPattern(row.strength)}\\s*${unit}\\b`;
	// A strength pair (`Clavulanate Potassium 125 mg/31.25 mg`) is a product's
	// title, in the moiety's numbers whatever salt it names; only a formula line
	// (`L-Lysine Acetate USP 1.2 g;`) gives the salt its own mass.
	const saltAmount = `${amount}(?!\\s*\\/)`;
	const hydrate = '(?:anhydrous|\\w*hydrate)';
	const named =
		'salt' in as
			? `\\b${substancePattern(name)}(?:[\\s,]+${hydrate})?\\b`
			: `\\b${substancePattern(name)}\\b(?![\\s,]+(?:${hydrate}${as.counterion ? `|${escaped(as.counterion.split(/\s+/)[0])}` : ''})\\b)`;
	const between = '[^\\d;]{0,40}?';
	const stated = 'salt' in as ? saltAmount : amount;
	return new RegExp(`${named}${between}${stated}|${stated}\\s+(?:of\\s+)?${named}`, 'i').test(text);
}

/** Rule 3 — a heavy salt's mass stated as moiety strength, confirmed by the label. */
function correctHeavySaltAsMoiety(
	ingredients: SplIngredient[],
	checked: CheckedStrength[],
	factors: ReadonlyMap<string, MoietyFactor> | undefined,
	directory: readonly { name: string; strength: string | null }[] | undefined,
	rxNormName: string | null,
	labelText: string | null
): void {
	if (!factors?.size || !directory?.length) return;
	const rx = scdStrengths(rxNormName);
	ingredients.forEach((ingredient, index) => {
		const row = checked[index];
		if (ingredient.kind !== 'active' || ingredient.basis !== 'moiety' || !ingredient.unii) return;
		if (ingredient.moieties.length !== 1 || row.strength === null) return;
		if (row.corrections.some((correction) => correction.kind === 'salt-equivalent')) return;
		const moiety = ingredient.moieties[0];
		const known = factors.get(ingredient.unii);
		if (!known || known.moietyUnii !== moiety.unii) return;
		const factor = Number(known.factor);
		if (!(factor > 0)) return;
		if (namesBareMoiety(ingredient.name, moiety.name)) return;
		// A light salt is never this rule's to convert where RxNorm states its
		// moiety: rule 2 moves the label toward RxNorm's number, and a label that
		// already agrees with it is right. Nor where the salt names its moiety
		// (`PIPERACILLIN SODIUM`): that is ordinary "equivalent to" labeling, and
		// the directory repeats the moiety number under the salt's name, so its
		// agreeing proves nothing. Only a hydrate that does not name its moiety
		// (citric acid monohydrate, with no RxNorm) falls through.
		if (
			1 / factor <= MAX_SALT_RATIO &&
			(rx.some((entry) => sameSubstance(entry.name, moiety.name)) ||
				namesMoiety(ingredient.name, moiety.name))
		)
			return;

		const label = concentration(row.strength, row.strengthUnit, row.per, row.perUnit);
		if (!label || label.mg <= 0) return;
		const listed = directory.find((entry) => sameName(entry.name, ingredient.name));
		const stated = directoryConcentration(listed?.strength ?? null);
		if (!stated || stated.perVolume !== label.perVolume) return;
		if (Math.abs(stated.mg - label.mg) > SAME_MASS * label.mg) return;

		// The label's own words decide; see rule 3 at the top of this file.
		const counterion = counterionOf(ingredient.name, moiety.name);
		if (labelText && statesAs(labelText, moiety.name, row, { moiety: true, counterion })) return;
		if (
			rxStatesLabelAmount(rx, moiety.name, row, label) &&
			!(labelText && statesAs(labelText, ingredient.name, row, { salt: true }))
		)
			return;

		const converted = convertStrength(row.strength, known.factor);
		if (!converted) return;
		const before = strengthText({ ...row, per: null, perUnit: null })!;
		const printed = row.strength;
		row.strength = Number(roundSignificant(converted));
		row.corrections.push({
			kind: 'moiety-equivalent',
			stated: printed,
			note:
				`Strength corrected from stated value of ${before}, the mass of the ` +
				`${counterion ? `${counterion} salt` : 'salt'}, to its equivalent of ` +
				`${row.strength} ${row.strengthUnit} ${moiety.name.toLowerCase()}`
		});
	});
}
