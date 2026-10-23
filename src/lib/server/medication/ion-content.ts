/**
 * Ions a package's salts deliver.
 *
 * A sodium salt's sodium is a fact of the salt: its formula says how many Na
 * atoms one unit holds, its molecular weight how much one unit weighs. So the
 * ion is computed from every salt on the label, the same way for every
 * package. What a label states ("contains 3.6 mEq (83 mg) of sodium") checks
 * that number, and wins where they disagree: the label's total counts sodium
 * from buffers and excipients (Zosyn's citrate) that no active salt's formula
 * sees. It also stands in when GSRS has no formula. See docs/strength-basis-rules.md.
 *
 * @module
 */

import {
	balanceIon,
	cationsNamedIn,
	ionDisplayName,
	ionFromSalt,
	mgPerMEq
} from '../../medication/ions';
import { parseStrengthText } from '../../medication/ingredient-correction';
import { toNdc11 } from '../../catalog/ndc';
import type { LabelIngredient } from '../../catalog/types';

export type SaltFacts = { formula: string | null; mw: number | null };

/** GSRS's UNII for each cation's ion. */
const ION_UNIIS: Record<string, string> = {
	sodium: 'LYR4M0NH37',
	potassium: '295O53K152',
	calcium: '2M83C4R6ZB',
	magnesium: 'T6V3LHY838'
};

const MG_PER: Record<string, number> = { mcg: 0.001, µg: 0.001, mg: 1, g: 1000, kg: 1e6 };

/**
 * What a label states of one ion for one package: its mass and mEq. With
 * `perGramOf`, the figure is per gram of that drug (`2.84 mEq (65 mg) of
 * sodium per gram of piperacillin`) and holds for every size.
 */
export type IonDeclaration = { ion: string; massMg: number; mEq: number; perGramOf?: string };

const decode = (text: string) =>
	text
		.replace(/<[^>]*>/g, ' ')
		.replace(/&#x([\da-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/\s+/g, ' ');

/**
 * The ion amounts a label states for package `ndc`. A statement counts only
 * when this NDC is the next one after it: "each vial contains 3.6 mEq" read
 * against another size's NDC, or a per-gram figure, is not this package's.
 * Both orders are read: `2.5 mEq (57.5 mg) of sodium`, `57.5 mg (2.5 mEq) sodium`,
 * `sodium content … 2.5 mEq (57.5 mg)`.
 */
export function ionDeclarationsFromLabel(texts: (string | null)[], ndc: string): IonDeclaration[] {
	const found = new Map<string, IonDeclaration>();
	const amount = String.raw`(?:(?<eqFirst>[\d,.]+)\s*mEq\s*\(\s*(?<mgSecond>[\d,.]+)\s*mg\s*\)|(?<mgFirst>[\d,.]+)\s*mg\s*\(\s*(?<eqSecond>[\d,.]+)\s*mEq\s*\))`;
	const ions = Object.keys(ION_UNIIS).join('|');
	const patterns = [
		new RegExp(`${amount}\\s*(?:of\\s+)?(?<ion>${ions})\\b`, 'gi'),
		new RegExp(`\\b(?<ion>${ions})\\s+(?:content|ion)?[^.\\d]{0,40}?${amount}`, 'gi')
	];
	const perGram = new RegExp(
		`${amount}\\s*(?:of\\s+)?(?<ion>${ions})\\b[^.\\d]{0,30}?\\bper\\s+(?:gram|g)\\s+of\\s+(?<drug>[a-z]+)`,
		'gi'
	);
	const perGramFound = new Map<string, IonDeclaration>();
	for (const text of texts) {
		if (!text) continue;
		const plain = decode(text);
		for (const match of plain.matchAll(perGram)) {
			const groups = match.groups!;
			const mEq = Number((groups.eqFirst ?? groups.eqSecond).replaceAll(',', ''));
			const massMg = Number((groups.mgFirst ?? groups.mgSecond).replaceAll(',', ''));
			const ion = groups.ion.toLowerCase();
			if (mEq > 0 && massMg > 0 && !perGramFound.has(ion))
				perGramFound.set(ion, { ion, massMg, mEq, perGramOf: groups.drug.toLowerCase() });
		}
		for (const match of patterns.flatMap((pattern) => [...plain.matchAll(pattern)])) {
			const groups = match.groups!;
			const start = (match.index ?? 0) + match[0].length;
			const ndcMatch = plain.slice(start, start + 240).match(/\bNDC\s*[:#]?\s*([\d-]{10,})/i);
			if (!ndcMatch || toNdc11(ndcMatch[1]) !== ndc) continue;
			const mEq = Number((groups.eqFirst ?? groups.eqSecond).replaceAll(',', ''));
			const massMg = Number((groups.mgFirst ?? groups.mgSecond).replaceAll(',', ''));
			const ion = groups.ion.toLowerCase();
			if (mEq > 0 && massMg > 0 && !found.has(ion)) found.set(ion, { ion, massMg, mEq });
		}
	}
	// A statement for this very NDC outranks a per-gram one.
	for (const [ion, declaration] of perGramFound) if (!found.has(ion)) found.set(ion, declaration);
	return [...found.values()];
}

/**
 * A per-gram statement as this package's total: scaled by the grams of the
 * drug it names, read from an active row measuring that drug itself (its
 * moiety basis, or the bare drug) per package. Null when no row does.
 */
function perPackage(statement: IonDeclaration, active: LabelIngredient[]): IonDeclaration | null {
	if (!statement.perGramOf) return statement;
	const drug = statement.perGramOf;
	const measuresDrug = (ingredient: LabelIngredient) =>
		ingredient.basis === 'moiety'
			? ingredient.moieties.some((moiety) => moiety.name.toLowerCase().split(/\s+/).includes(drug))
			: ingredient.name.toLowerCase() === drug;
	const row = active.find(measuresDrug);
	const strength = row && parseStrengthText(row.strength);
	const scale =
		strength && !strength.perUnit && strength.per === '1'
			? MG_PER[strength.unit.toLowerCase()]
			: undefined;
	if (!strength || !scale) return null;
	const grams = (Number(strength.value) * scale) / 1000;
	return {
		ion: statement.ion,
		massMg: Number((statement.massMg * grams).toPrecision(3)),
		mEq: Number((statement.mEq * grams).toPrecision(3)),
		perGramOf: drug
	};
}

/** The salt's own mass in a row: the printed salt figure, else the strength unless it is the moiety's. */
function saltStrength(ingredient: LabelIngredient, factors: Map<string, number>) {
	if (ingredient.labelStrength && ingredient.labelStrength.unii === ingredient.unii)
		return parseStrengthText(ingredient.labelStrength.strength);
	const parsed = parseStrengthText(ingredient.strength);
	if (!parsed || ingredient.basis !== 'moiety') return parsed;
	const factor = ingredient.unii ? factors.get(ingredient.unii) : undefined;
	return factor ? { ...parsed, value: String(Number(parsed.value) / factor) } : null;
}

/** A strength's denominator as a suffix: `/mL`, `/5 mL`, or nothing for a whole unit. */
const per = ({ per, perUnit }: { per: string; perUnit: string }) =>
	per === '1' && !perUnit ? '' : `/${per === '1' ? '' : `${per} `}${perUnit}`;

/**
 * One ion row per cation the label's salts deliver, computed from each salt's
 * GSRS formula and added across salts that share a denominator. A label's
 * own statement checks the sum, and stands in for an ion no salt could be
 * computed for.
 */
export function ionRows(
	ingredients: LabelIngredient[],
	salts: Map<string, SaltFacts>,
	factors: Map<string, number>,
	declared: IonDeclaration[]
): LabelIngredient[] {
	const active = ingredients.filter((i) => i.kind === 'active');
	const cations = [...new Set(active.flatMap((i) => cationsNamedIn(i.name)))];
	const rows: LabelIngredient[] = [];
	for (const ion of cations) {
		const sources = active.filter((i) => cationsNamedIn(i.name).includes(ion));
		const stated = declared.find((d) => d.ion === ion);
		const statement = stated ? perPackage(stated, active) : null;
		const parts = sources.map((ingredient) => {
			const salt = ingredient.unii ? salts.get(ingredient.unii) : undefined;
			const strength = saltStrength(ingredient, factors);
			const scale = strength ? MG_PER[strength.unit.toLowerCase()] : undefined;
			const content =
				salt && strength && scale ? ionFromSalt(salt, Number(strength.value) * scale, ion) : null;
			return content && strength ? { content, denominator: per(strength) } : null;
		});
		const computed =
			parts.length && parts.every((part) => part && part.denominator === parts[0]!.denominator)
				? {
						massMg: Number(
							parts.reduce((sum, part) => sum + part!.content.massMg, 0).toPrecision(3)
						),
						mEq: Number(parts.reduce((sum, part) => sum + part!.content.mEq, 0).toPrecision(3)),
						denominator: parts[0]!.denominator
					}
				: null;
		// A per-package statement checks only a per-unit computation.
		const disagrees =
			!!computed &&
			!!statement &&
			!computed.denominator &&
			Math.abs(computed.massMg - statement.massMg) / statement.massMg > 0.05;
		const declaredTotal = statement
			? { massMg: statement.massMg, mEq: statement.mEq, denominator: '' }
			: null;
		const amount = disagrees ? declaredTotal : (computed ?? declaredTotal);
		if (!amount) continue;
		const notes: string[] = [];
		const labelBalance = statement && balanceIon(ion, statement.massMg, statement.mEq);
		if (statement && labelBalance && !labelBalance.balanced)
			notes.push(
				`The label states ${statement.massMg} mg and ${statement.mEq} mEq of ${ion}, which disagree: ${statement.massMg} mg is ${labelBalance.expectedMEq} mEq`
			);
		if (disagrees) {
			const perMEq = mgPerMEq(ion)!;
			const source = stated?.perGramOf
				? `${stated.massMg} mg (${stated.mEq} mEq) of ${ion} per gram of ${stated.perGramOf}, ${statement!.massMg} mg (${statement!.mEq} mEq) here`
				: `${statement!.massMg} mg (${statement!.mEq} mEq) of ${ion}`;
			notes.push(
				`The label states ${source}; the salt's formula gives ${computed!.massMg} mg (${Number((computed!.massMg / perMEq).toPrecision(3))} mEq) from the active salts alone`
			);
		}
		rows.push({
			name: ionDisplayName(ion),
			unii: ION_UNIIS[ion] ?? null,
			kind: 'ionic',
			basis:
				amount === computed
					? 'ion constituent (from salt formula)'
					: 'ion constituent (label total)',
			strength: `${amount.massMg} mg${amount.denominator} (${amount.mEq} mEq${amount.denominator})`,
			moieties: [],
			productCode: null,
			...(notes.length ? { strengthNotes: notes } : {}),
			ionicContent: {
				element: ion,
				massMg: amount.massMg,
				mEq: amount.mEq,
				sourceIngredients: sources.map((i) => i.name),
				nonAdditive: true
			}
		});
	}
	return rows;
}
