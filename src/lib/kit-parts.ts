// ── What is in a kit, and which kit this NDC is ──────────────────────────────
// A powder-for-oral-solution kit is two bottles in a carton: the drug, and a
// drug-free flavored diluent measured to make it up. Firvanq 65628-206-05 is
// a 7.5 g bottle of vancomycin and a 145 mL bottle of grape diluent, which
// together make 150 mL at 50 mg/mL. Nothing upstream says that plainly:
//
// - The NDC directory lists no active ingredients for a kit, and its package
//   description names each part as a peer ("7.5 g in 1 BOTTLE * 145 mL in 1
//   BOTTLE"), so the first parser to look at it reads the diluent's 145 mL as
//   the package.
// - The SPL states the powder's strength per its own measure — `1 g/1 g`,
//   pure drug by weight — and its quantity on the enclosing `<part>`, so the
//   content is the product of two elements, neither of which is it.
// - Some labelers list one kit product whose parts cover two sizes (Aurobindo
//   59651-670 lists 7.5 g, 145 mL, 15 g and 289 mL for both its cartons), and
//   only the How Supplied table says which pair is in which carton.
//
// This module settles the parts for one NDC; the callers turn them into a
// content mass, a unit of use and a reconstitution.

import type { SplProduct } from './spl-ingredients';
import { toNdc11 } from './ndc';
import { mlPer, toMg } from './units';

export type KitPartRole = 'active' | 'diluent';

export interface KitPart {
	/** `active` holds the drug; `diluent` carries only excipients (flavored vehicle). */
	role: KitPartRole;
	name: string | null;
	doseForm: string | null;
	/** How much of the part the kit holds: `7.5` `g`, `145` `mL`. */
	amount: number | null;
	unit: string | null;
	/** The part's own container, `BOTTLE`, when the SPL names one. */
	container: string | null;
	productCode: string | null;
}

/** How the NDC's parts were told apart from a sibling kit's sharing its SPL product. */
export type KitSelection = 'spl' | 'how-supplied' | 'description' | 'ambiguous';

export interface KitComposition {
	parts: KitPart[];
	selectedBy: KitSelection;
	/** Set when the NDC is itself one part of a kit: the kit cartons it is sold in. */
	partOf?: string[];
}

const roleOf = (product: SplProduct): KitPartRole =>
	product.ingredients.some((ingredient) => ingredient.kind === 'active') ? 'active' : 'diluent';

export const kitPartOf = (product: SplProduct): KitPart => ({
	role: roleOf(product),
	name: product.name,
	doseForm: product.doseForm,
	amount: product.part?.amount ?? product.presentation?.amount ?? null,
	unit: product.part?.amountUnit ?? product.presentation?.amountUnit ?? null,
	container: product.presentation?.form ?? null,
	productCode: product.productCode
});

/** A part's amount in mg (mass parts) or mL (liquid parts); null otherwise. */
const partMg = (part: KitPart) =>
	part.amount === null ? null : toMg(part.amount, part.unit);
const partMl = (part: KitPart) => {
	const factor = mlPer(part.unit);
	return part.amount === null || factor === null ? null : part.amount * factor;
};

const near = (a: number, b: number) => Math.abs(a - b) <= 0.005 * Math.max(a, b);

/** What one package row of a label's NDC table states beside the NDC. */
export interface SuppliedRow {
	massMg: number | null;
	volumeMl: number | null;
}

// "65628‑206‑05" with a non-breaking hyphen, "67877- 751- 81" split across
// table cells: every hyphen-like character, and the whitespace a flattened
// table leaves around it, read as one plain hyphen.
const normalizeNdcs = (text: string) =>
	text.replace(/[‐-―−]/g, '-').replace(/(\d)\s*-\s*(?=\d)/g, '$1-');

const NDC_TOKEN = /\b\d{4,5}-\d{3,4}-\d{1,2}\b/g;
const MASS = /(\d+(?:\.\d+)?)\s*(mcg|mg|g)\b/gi;
const VOLUME = /(\d+(?:\.\d+)?)\s*mL\b/gi;

/**
 * The mass and volume a label's How Supplied states for one NDC: the cells
 * between the previous NDC in the text and this one. Table 5 of the
 * vancomycin kit labels flattens to "7.5 g 145 mL 59651-670-55 15 g 289 mL
 * 59651-670-03"; ANI's bottle list to "80 mL bottle (4 g*) NDC 62559-830-80".
 * Null when the NDC is not named, or nothing measured precedes it.
 */
export function suppliedRowFor(text: string | null | undefined, ndc: string): SuppliedRow | null {
	if (!text) return null;
	const plain = normalizeNdcs(text);
	let previousEnd = 0;
	for (const match of plain.matchAll(NDC_TOKEN)) {
		const start = match.index ?? 0;
		if (toNdc11(match[0]) === ndc) {
			// A row's cells sit just before its NDC; anything further back is a
			// heading or prose about the whole table.
			const window = plain.slice(Math.max(previousEnd, start - 60), start);
			const masses = [...window.matchAll(MASS)];
			const volumes = [...window.matchAll(VOLUME)];
			const mass = masses.at(-1);
			const volume = volumes.at(-1);
			const row = {
				massMg: mass ? toMg(Number(mass[1]), mass[2]) : null,
				volumeMl: volume ? Number(volume[1]) : null
			};
			return row.massMg === null && row.volumeMl === null ? null : row;
		}
		previousEnd = start + match[0].length;
	}
	return null;
}

/**
 * Keep the parts that match `row`: an active part whose mass is the row's,
 * and a diluent whose volume is. Null unless both roles end up with exactly
 * one part each (or the role had none to begin with).
 */
function partsMatching(parts: KitPart[], massMg: number | null, volumeMl: number | null) {
	const actives = parts.filter((part) => part.role === 'active');
	const diluents = parts.filter((part) => part.role === 'diluent');
	const active =
		actives.length <= 1
			? actives
			: massMg === null
				? []
				: actives.filter((part) => {
						const mg = partMg(part);
						return mg !== null && near(mg, massMg);
					});
	const diluent =
		diluents.length <= 1
			? diluents
			: volumeMl === null
				? []
				: diluents.filter((part) => {
						const ml = partMl(part);
						return ml !== null && near(ml, volumeMl);
					});
	if (actives.length && active.length !== 1) return null;
	if (diluents.length && diluent.length !== 1) return null;
	return [...active, ...diluent];
}

/**
 * The parts of `products` (this NDC's SPL products) that make up the kit `ndc`
 * is, with how they were chosen. Null when none of the products is a kit part.
 *
 * One active part and at most one diluent is unambiguous. More than that means
 * the SPL lists a sibling size's parts under this carton too; the How Supplied
 * row for the NDC picks the pair, failing that a description naming the parts'
 * own NDCs, failing that a description with just one mass and one volume.
 * Anything still ambiguous keeps every part, marked so.
 */
export function kitComposition(
	products: SplProduct[],
	ndc: string,
	evidence: { howSupplied?: string | null; description?: string | null } = {}
): KitComposition | null {
	const parts = products.filter((product) => product.part).map(kitPartOf);
	if (!parts.length) return null;
	const count = (role: KitPartRole) => parts.filter((part) => part.role === role).length;
	if (count('active') <= 1 && count('diluent') <= 1) return { parts, selectedBy: 'spl' };

	const row = suppliedRowFor(evidence.howSupplied, ndc);
	const supplied = row && partsMatching(parts, row.massMg, row.volumeMl);
	if (supplied) return { parts: supplied, selectedBy: 'how-supplied' };

	const description = evidence.description ?? '';
	const named = parts.filter(
		(part) =>
			part.productCode &&
			[...normalizeNdcs(description).matchAll(NDC_TOKEN)].some((match) =>
				match[0].startsWith(`${part.productCode}-`)
			)
	);
	if (named.length && partsMatching(named, null, null))
		return { parts: named, selectedBy: 'description' };

	const components = description.split(/\s+\*\s+/).slice(1);
	const masses = components.flatMap((component) => {
		const match = /^\s*([\d.]+)\s*(mcg|mg|g|kg)\s+in\s+1\b/i.exec(component);
		return match ? [toMg(Number(match[1]), match[2])!] : [];
	});
	const volumes = components.flatMap((component) => {
		const match = /^\s*([\d.]+)\s*mL\s+in\s+1\b/i.exec(component);
		return match ? [Number(match[1])] : [];
	});
	if (masses.length <= 1 && volumes.length <= 1) {
		const described = partsMatching(parts, masses[0] ?? null, volumes[0] ?? null);
		if (described) return { parts: described, selectedBy: 'description' };
	}
	return { parts, selectedBy: 'ambiguous' };
}

/** The products behind `composition`'s parts, in `products` order. */
export const productsOfComposition = (products: SplProduct[], composition: KitComposition) =>
	products.filter(
		(product) =>
			!product.part ||
			composition.parts.some(
				(part) =>
					part.productCode === product.productCode &&
					part.name === product.name &&
					part.amount === (product.part?.amount ?? product.presentation?.amount ?? null)
			)
	);

/**
 * The content of an active kit part, in the strength's unit: a `1 g/1 g`
 * powder in a 7.5 g bottle is 7.5 g. Null unless the strength is a ratio of
 * like measures (mass per mass, volume per volume) and the part's quantity is
 * in that measure.
 */
export function partContent(
	strength: { strength: number | null; strengthUnit: string | null; per: number | null; perUnit: string | null },
	part: { amount: number | null; amountUnit: string | null } | null
): { value: number; unit: string } | null {
	if (!part || part.amount === null || strength.strength === null || !strength.strengthUnit)
		return null;
	const per = strength.per ?? 1;
	if (per <= 0) return null;
	const mgPerUnit = toMg(1, strength.perUnit);
	const mlPerUnit = mlPer(strength.perUnit);
	const amountMg = toMg(part.amount, part.amountUnit);
	const amountMl = mlPer(part.amountUnit) === null ? null : part.amount * mlPer(part.amountUnit)!;
	const units =
		mgPerUnit !== null && amountMg !== null
			? amountMg / mgPerUnit
			: mlPerUnit !== null && amountMl !== null
				? amountMl / mlPerUnit
				: null;
	if (units === null) return null;
	return {
		value: Number(((strength.strength * units) / per).toPrecision(12)),
		unit: strength.strengthUnit
	};
}
