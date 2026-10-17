import type { UnitOfUseSize } from './ndc-packaging';
import { hierarchyDoseForm } from './formulary-hierarchy';
import { LEADING_PERIOD, timeReleaseAfterRelease } from './time-release';
import { withBiosimilarSuffix } from './biosimilar';
import { ingredientGroup } from './ingredient-group';
import { dryFillStrength, pharmacyBulkFillMl } from './ingredient-content';
import { mgPer, mlPer } from './units';
import { rxNormStrengths } from './spl-strength-checks';
import { formatNdc } from './ndc';
import { splitBrand } from './brand-name';
import { quantifiedScdName } from './quantified-scd';

type Ingredient = { name: string; strength: string | null };

/** The package facts a title is built from; every field is optional. */
export type PackageTitleSource = {
	ndc?: string;
	description?: string | null;
	doseForm?: string | null;
	brandName?: string | null;
	genericName?: string | null;
	labelerName?: string | null;
	ingredients?: Ingredient[] | null;
	size?: UnitOfUseSize | null;
	isMultiDose?: boolean | null;
	isDryFill?: boolean | null;
	splTitle?: string | null;
	details?: {
		rxnav?: { conceptName?: string | null } | null;
		spl?: { ingredients: { name: string; kind: string; strength: string | null }[] } | null;
	} | null;
};

/**
 * The package's active ingredients with the strengths its NDC page shows: the
 * label's corrected figure (the active moiety, per vial rather than per the
 * directory's `1 g/20mL` or salt `1.13 g/1`) where the label lists that
 * ingredient, else the directory's, read per vial for a dry fill.
 */
export function correctedIngredients(item: PackageTitleSource): Ingredient[] {
	// A biosimilar is its own ingredient: `ADALIMUMAB` on a product whose generic
	// name is `adalimumab-adaz` reads `ADALIMUMAB-ADAZ`, never the reference's.
	const texts = [
		item.genericName,
		item.splTitle,
		item.details?.rxnav?.conceptName,
		...(item.details?.spl?.ingredients ?? []).map((ingredient) => ingredient.name)
	];
	const named = (ingredient: Ingredient): Ingredient => ({
		...ingredient,
		name: withBiosimilarSuffix(ingredient.name, texts)
	});
	const spl = (item.details?.spl?.ingredients ?? [])
		.filter((ingredient) => ingredient.kind === 'active')
		// The substance name, as the FDA directory gives it; the hierarchy groups
		// salts itself, and a moiety name reads `POTASSIUM CATION` for an electrolyte.
		.map((ingredient) => named({ name: ingredient.name, strength: ingredient.strength }));
	if (!item.ingredients?.length) return spl;
	const size = item.size;
	const fillVolumeMl = size?.kind === 'volume' ? size.value * (size.unit === 'L' ? 1000 : 1) : null;
	const bulkFillMl = pharmacyBulkFillMl(item.description ?? size?.container, fillVolumeMl);
	const key = (name: string) => ingredientGroup(name).toLowerCase();
	const labeled = new Map(
		spl.flatMap((entry) => (entry.strength ? [[key(entry.name), entry.strength] as const] : []))
	);
	return item.ingredients.map(named).map((ingredient) => ({
		name: ingredient.name,
		strength:
			labeled.get(key(ingredient.name)) ??
			(item.isDryFill
				? dryFillStrength(ingredient.strength, item.doseForm, bulkFillMl, fillVolumeMl)
				: ingredient.strength)
	}));
}

const UNITS: Record<string, string> = {
	'[iu]': 'units',
	iu: 'units',
	"[usp'u]": 'USP units',
	"[hp'_x]": 'X',
	'[pnu]': 'PNU',
	ug: 'mcg',
	µg: 'mcg',
	ml: 'mL',
	l: 'L',
	meq: 'mEq',
	mmol: 'mmol'
};
const MEASURE = /^(?:m?g|mcg|k?g|ml|l|oz|cm2?|actuat|\[?iu\]?)$/i;

const unitText = (unit: string) => UNITS[unit.toLowerCase()] ?? unit.toLowerCase();
const number = (value: number) => String(Number(value.toPrecision(6)));

/**
 * "1.25 g/250mL" → "5 mg/mL", "80 mg/1" → "80 mg", "1000 mg/1 VIAL" → "1 g". Every volume
 * reads per mL, so one concentration reads the same on every bag size; an absolute amount in a
 * liquid package reads over the package volume, so a vial's `1000 [iU]` in 10 mL is "100 units/mL".
 */
function strengthText(strength: string, volume: { value: number; unit: string } | null) {
	const match = strength
		.trim()
		.match(/^([\d.,]+)\s*([^\s\d/][^/]*?)\s*(?:\/\s*([\d.]*)\s*([^\d\s][^/]*?)?\s*)?$/);
	if (!match) return strength.trim();
	let value = Number(match[1].replace(/,/g, ''));
	let unit = unitText(match[2]);
	if (!Number.isFinite(value)) return strength.trim();
	const perUnit = match[4]?.trim();
	const perValue = match[3] ? Number(match[3]) : 1;
	// The volume the amount is in: the strength's own denominator, else the package's.
	const ml = perUnit
		? (mlPer(perUnit) ?? 0) * perValue
		: !match[3] && volume
			? (mlPer(volume.unit) ?? 0) * volume.value
			: 0;
	if (ml > 0) {
		value /= ml;
		// A mass per mL reads in mg, or in grams from a gram up.
		const mg = mgPer(unit);
		if (mg !== null) [value, unit] = value * mg >= 1000 ? [(value * mg) / 1000, 'g'] : [value * mg, 'mg'];
		return `${number(value)} ${unit}/mL`;
	}
	// A sub-gram mass of a gram or more reads in grams; kg stays as written.
	const mg = mgPer(unit);
	if (mg !== null && mg < 1000 && value * mg >= 1000) {
		value = (value * mg) / 1000;
		unit = 'g';
	}
	// "/1", "/1 VIAL", "/1 TABLET": one dose unit adds nothing to the label.
	const per =
		perUnit && MEASURE.test(perUnit)
			? `/${match[3] && perValue !== 1 ? `${number(perValue)} ` : ''}${unitText(perUnit)}`
			: '';
	return `${number(value)} ${unit}${per}`;
}

/** A strength as titles show it, every volume read per mL: `1.4 g/100mL` → `14 mg/mL`. */
export const strengthDisplay = (strength: string) => strengthText(strength, null);

/** Significant figures a written number states; an integer's every digit counts (`800` is 3). */
function significantFigures(text: string): number {
	if (!text.includes('.')) return text.replace(/^0+/, '').length || 1;
	return text.replace('.', '').replace(/^0+/, '').length || 1;
}

/**
 * Strengths rounded to the precision most of them are written in, so a converted or corrected
 * figure (`cysteine hydrochloride 0.16556 mg/mL` beside `leucine 14 mg/mL`) reads like the rest
 * (`0.17 mg/mL`). The most common figure count wins, the larger on a tie; only fractional digits
 * are ever dropped, so `800 mg` beside `2.5 mg` stays as it is.
 */
function matchedPrecision(strengths: (string | null)[]): (string | null)[] {
	const lead = (text: string) => text.match(/^[\d.]+/)?.[0] ?? null;
	const counts = new Map<number, number>();
	for (const text of strengths) {
		const number = text && lead(text);
		if (number) counts.set(significantFigures(number), (counts.get(significantFigures(number)) ?? 0) + 1);
	}
	if (counts.size < 2) return strengths;
	const [target] = [...counts].sort(([a, n], [b, m]) => m - n || b - a)[0];
	return strengths.map((text) => {
		const written = text && lead(text);
		if (!written || !written.includes('.') || significantFigures(written) <= target) return text;
		const value = Number(written);
		const integerDigits = Math.max(Math.floor(Math.log10(Math.abs(value))) + 1, 0);
		const rounded = String(Number(value.toPrecision(Math.max(target, integerDigits, 1))));
		return rounded + text!.slice(written.length);
	});
}

const isConcentration = (strength: string | null) => {
	const per = strength?.match(/\/\s*[\d.]*\s*([^\d\s/][^/]*?)\s*$/)?.[1];
	return !!per && MEASURE.test(per);
};

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const brandCase = (value: string) =>
	value === value.toUpperCase()
		? value.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, lead, char) => lead + char.toUpperCase())
		: value;

const FORM_WORD =
	/^(?:for|oral|solution|suspension|injection|injectable|powder|usp|kit|and|tablets?|capsules?|syrup|elixir|of)$/;
const words = (text: string) =>
	text
		.toLowerCase()
		.split(/[^a-z0-9.%]+/)
		.filter(Boolean);

/**
 * Whether a proprietary name is only the generic in other words: its
 * ingredients and dose-form words, led by an ingredient. "Vancomycin
 * Hydrochloride for Oral Solution" and "Ampicillin and Sulbactam" are; a name
 * adding anything else — "Vasopressin in 0.9% Sodium Chloride", "Cefepime
 * Hydrochloride And Dextrose" — says something the ingredients don't.
 */
function isGenericWording(brand: string, names: (string | null | undefined)[]): boolean {
	const known = new Set(
		names.flatMap((name) => (name ? [...words(name), ...words(ingredientGroup(name))] : []))
	);
	const brandWords = words(brand);
	return (
		brandWords.length > 0 &&
		known.has(brandWords[0]) &&
		brandWords.every((word) => known.has(word) || FORM_WORD.test(word))
	);
}

/** The package's ingredients, and their strengths joined as "a 5 mg / b 10 mg". */
function activesParts(item: PackageTitleSource) {
	// A concentration the directory states ("100 mg/5mL", ".7 mL/mL") reads
	// better than the label's per-package total; a dry fill has no concentration
	// until it is reconstituted, and a per-unit figure ("1.13 g/1") takes the
	// label's moiety correction.
	const stated = new Map(
		(item.isDryFill
			? []
			: (item.ingredients ?? []).map((ingredient) => ({
					...ingredient,
					name: withBiosimilarSuffix(ingredient.name, [
						item.genericName,
						item.splTitle,
						item.details?.rxnav?.conceptName
					])
				}))
		).flatMap((ingredient) =>
			isConcentration(ingredient.strength)
				? [[ingredientGroup(ingredient.name).toLowerCase(), ingredient.strength!] as const]
				: []
		)
	);
	const ingredients = correctedIngredients(item)
		.filter((ingredient) => ingredient.name.trim())
		.map((ingredient) => ({
			...ingredient,
			strength: stated.get(ingredientGroup(ingredient.name).toLowerCase()) ?? ingredient.strength
		}));
	if (!ingredients.length) return null;

	const size = item.size;
	// A dry fill's stated volume is the vial's, not the solution's.
	const volume =
		size?.kind === 'volume' && size.unit && !item.isDryFill
			? { value: size.value, unit: size.unit }
			: null;
	const strengths = matchedPrecision(
		ingredients.map((ingredient) =>
			ingredient.strength?.trim() ? strengthText(ingredient.strength, volume) : null
		)
	);
	const actives = ingredients
		.map((ingredient, index) =>
			[ingredient.name.trim().toLowerCase(), strengths[index]].filter(Boolean).join(' ')
		)
		.join(' / ');
	return { actives, ingredients };
}

/** "vancomycin 1.25 g/250 mL" — the package's ingredients with their strengths, null without ingredients. */
export function packageStrengthText(item: PackageTitleSource): string | null {
	return activesParts(item)?.actives ?? null;
}

const withBrand = (name: string, brand: string | null | undefined) =>
	brand?.trim() && normalized(brand) !== normalized(name) ? `${name} [${brand.trim()}]` : name;

const capitalized = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/**
 * "Vancomycin 1.25 g/250 mL injection, solution" from the package's own
 * ingredients and dose form, with its brand when that is a real brand name
 * ("Humulin R") rather than the generic in other words.
 */
function generatedName(item: PackageTitleSource): { name: string; brand: string | null } | null {
	const parts = activesParts(item);
	if (!parts) return null;
	const { actives, ingredients } = parts;
	let doseForm = item.doseForm?.trim() ? hierarchyDoseForm(item.doseForm).toLowerCase() : null;
	const period = item.details?.rxnav?.conceptName?.trim().match(LEADING_PERIOD)?.[1];
	if (doseForm && period && !doseForm.includes('(')) {
		doseForm = timeReleaseAfterRelease(`${period} ${doseForm}`);
	}

	return {
		name: capitalized(`${actives}${doseForm ? ` ${doseForm}` : ''}`),
		brand: realBrand(item, ingredients)
	};
}

/** The package's proprietary name, brand-cased, unless it is only the generic in other words. */
function realBrand(item: PackageTitleSource, ingredients: Ingredient[]): string | null {
	const brand = item.brandName?.trim();
	if (!brand) return null;
	const generic = [item.genericName, ...ingredients.map((ingredient) => ingredient.name)]
		.filter((name): name is string => !!name?.trim())
		.flatMap((name) => [normalized(name), normalized(ingredientGroup(name))]);
	const isBrand =
		!generic.some((name) => name.includes(normalized(brand))) &&
		!isGenericWording(brand, [
			item.genericName,
			...ingredients.map((ingredient) => ingredient.name)
		]);
	return isBrand ? brandCase(brand) : null;
}

/**
 * The name the labeler gives the product: its brand with the generic
 * ("CroFab (ovine crotalidae venoms immune fab)"), or the generic alone.
 */
export function labelProductName(item: PackageTitleSource): string | null {
	const generic = item.genericName?.trim().toLowerCase() || null;
	const brand = realBrand(item, correctedIngredients(item));
	if (brand && generic) return `${brand} (${generic})`;
	return brand ?? generic;
}

/**
 * A readable NDC title in RxNorm's form, generated from the package's ingredients, strengths and
 * dose form, then its packaging, then its brand in brackets: "Insulin human 100 units/mL
 * injection, solution MDV [Humulin R]". RxNorm's name stands in only when the package has no
 * ingredients to build from; null when neither exists.
 */
export function packageDisplayTitle(item: PackageTitleSource): string | null {
	const rxNormName = item.details?.rxnav?.conceptName?.trim();
	const named =
		generatedName(item) ??
		(rxNormName ? splitBrand(capitalized(timeReleaseAfterRelease(rxNormName))) : null);
	return named ? withContext(named, item) : null;
}

/**
 * The package titled by its RxNorm clinical drug ("Agkistrodon piscivorus
 * antivenin 780 UNT / … Injection [CroFab]"), the normalized name it is
 * stocked by; the generated title stands in when RxNorm has no concept.
 */
export function rxNormPackageTitle(item: PackageTitleSource): string | null {
	const rxNormName = item.details?.rxnav?.conceptName?.trim();
	if (!rxNormName || contradictsRxNorm(item, rxNormName)) return packageDisplayTitle(item);
	return withContext(splitBrand(capitalized(quantifiedScdName(rxNormName))), item);
}

/** Strengths within this ratio agree: RxNorm rounds, labels round differently. */
const STRENGTH_TOLERANCE = 1.02;

// `1.2 g/100mL`, `12 MG/ML`, `500 mg/1`, `500 MG`.
const STRENGTH = /^\s*([\d.]+)\s*([A-Za-z]+)\s*(?:\/\s*([\d.]*)\s*([A-Za-z]+))?\s*$/;

/** A strength as mg per mL (`perMl`) or mg per unit, or null when it is not a mass. */
function mgRate(value: number, unit: string, per: number, perUnit: string | null) {
	const mg = mgPer(unit);
	// A mass per mass (`2 g/3 g` of a powder blend) is not a dose; nothing to compare.
	if (mg === null || !(per > 0) || mgPer(perUnit) !== null) return null;
	const ml = mlPer(perUnit);
	if (ml !== null) return { mg: (value * mg) / (per * ml), perMl: true };
	return { mg: (value * mg) / per, perMl: false };
}

/**
 * Whether a corrected strength the package's page shows disagrees with the strength RxNorm's
 * name states for the same ingredient: TrophAmine's lysine, which RxNorm copied from a label
 * coded with the acetate salt's mass. Only like is compared with like (per mL with per mL);
 * anything that cannot be compared never counts as a contradiction.
 */
function contradictsRxNorm(item: PackageTitleSource, rxNormName: string): boolean {
	const key = (name: string) => ingredientGroup(name).toLowerCase();
	const strengths = (entries: Ingredient[]) => new Map(entries.map((entry) => [key(entry.name), entry.strength]));
	// The label's corrected figure first; the directory's where the label's is per container
	// (TrophAmine's `4.253 g` a bag) and RxNorm's per mL.
	const sources = [strengths(correctedIngredients(item)), strengths(item.ingredients ?? [])];
	const rate = (strength: string | null | undefined) => {
		const match = strength ? STRENGTH.exec(strength) : null;
		return match && mgRate(Number(match[1]), match[2], match[3] ? Number(match[3]) : 1, match[4] ?? null);
	};
	return rxNormStrengths(rxNormName).some((rx) => {
		const stated = mgRate(rx.value, rx.unit, rx.per, rx.perUnit);
		if (!stated || !(stated.mg > 0)) return false;
		const label = sources
			.map((source) => rate(source.get(key(rx.name))))
			.find((candidate) => candidate?.perMl === stated.perMl);
		if (!label) return false;
		const ratio = label.mg / stated.mg;
		return ratio > STRENGTH_TOLERANCE || ratio < 1 / STRENGTH_TOLERANCE;
	});
}

/** A title with its package context (concentrate, multi-dose, carton count), then its `[Brand]`. */
function withContext(named: { name: string; brand: string | null }, item: PackageTitleSource): string {
	const context: string[] = [];
	if (/\bCONCENTRATE\b/i.test(item.splTitle ?? '')) context.push('(Concentrate)');
	if (item.isMultiDose === true) context.push('MDV');

	const description = item.description ?? '';
	const carton = description.match(/\b(\d+)\s+([A-Z][A-Z ,/-]*?)\s+in\s+1\s+CARTON\b/i);
	if (carton) {
		const container = carton[2]
			.replace(/,?\s*(?:SINGLE|MULTI)[-\s]?DOSE\b/gi, '')
			.replace(/\s*,\s*/g, ' ')
			.trim()
			.toUpperCase();
		context.push(`CARTON of ${carton[1]} ${container}`);
	}

	return withBrand(context.length ? `${named.name} ${context.join(', ')}` : named.name, named.brand);
}

/**
 * What a package is called everywhere: its NDC page's title and every link or label naming it
 * elsewhere. The RxNorm title (`displayTitle` when a loader already computed one), else its
 * generic name with its brand, its brand alone or its listing text, else its NDC.
 */
export function packageTitle(item: PackageTitleSource & { ndc: string; displayTitle?: string | null }): string {
	const generated = item.displayTitle === undefined ? rxNormPackageTitle(item) : item.displayTitle;
	return (
		generated ??
		(item.genericName ? withBrand(item.genericName, item.brandName) : null) ??
		item.brandName ??
		item.description ??
		`NDC ${formatNdc(item.ndc)}`
	);
}

export { timeReleaseAfterRelease };
