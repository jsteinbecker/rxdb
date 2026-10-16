// ── Which parts of a shared label are about this NDC ─────────────────────────
// One SPL often covers several products: amoxicillin tablets and its powder
// for oral suspension, or ceftriaxone's 500 mg, 1 g and 2 g vials. The label's
// prose is written for all of them, so the tablet NDC's Dosage and
// Administration still explains how to constitute the suspension, and the
// 1 g vial's dilution table lists every vial. This module works out who else
// shares the label (`labelScope`) and drops the passages and table rows that
// positively name one of them and not the viewed NDC (`filterLabelBlocks`).
//
// It is deliberately timid: a passage that names nobody, or names this NDC
// alongside a sibling, stays. Pure and shared, like $lib/spl-sections.ts.

import type { SplProduct } from './spl-ingredients';
import { toNdc11 } from './ndc';
import { mlPer, toMg } from './units';

export type FormFamily =
	| 'tablet'
	| 'capsule'
	| 'oral-suspension'
	| 'oral-solution'
	| 'injection'
	| 'topical'
	| 'ophthalmic'
	| 'other';

/** The family a label's prose would call an SPL dose form by. */
export function formFamilyOf(doseForm: string | null): FormFamily {
	const form = (doseForm ?? '').toUpperCase();
	if (!form) return 'other';
	if (/\bINJECT|\bINFUSION|\bINTRAVENOUS/.test(form)) return 'injection';
	if (/\bOPHTHALMIC|\bEYE\b/.test(form)) return 'ophthalmic';
	if (/\bTABLET|\bCAPLET/.test(form)) return 'tablet';
	if (/\bCAPSULE/.test(form)) return 'capsule';
	if (/\bSUSPENSION/.test(form)) return 'oral-suspension';
	if (/\bSOLUTION|\bSYRUP|\bELIXIR/.test(form)) return 'oral-solution';
	if (/\bCREAM|\bOINTMENT|\bLOTION|\bGEL\b|\bPATCH|\bTOPICAL/.test(form)) return 'topical';
	return 'other';
}

const FORM_LABELS: Record<FormFamily, string | null> = {
	tablet: 'tablet',
	capsule: 'capsule',
	'oral-suspension': 'oral suspension',
	'oral-solution': 'oral solution',
	injection: 'injection',
	topical: 'topical',
	ophthalmic: 'ophthalmic',
	other: null
};

const formLabelOf = (family: FormFamily, doseForm: string | null) =>
	FORM_LABELS[family] ?? (doseForm ?? 'other').toLowerCase();

/** One strength or container size a label's products come in. */
export interface LabelStrength {
	/** Display copy: `1 g vial`, `500 mg tablet`, `150 mL bottle`. */
	text: string;
	/** Total drug per unit or container, when the label states it that way. */
	mg: number | null;
	/** The container's volume, for liquids and constituted powders. */
	containerMl: number | null;
}

export interface LabelProduct {
	family: FormFamily;
	formLabel: string;
	strengths: LabelStrength[];
}

export interface LabelScope {
	own: LabelProduct;
	siblings: LabelProduct[];
}

/** A package as the NDC directory describes it: `150 mL in 1 BOTTLE`. */
export interface LabelPackage {
	ndc: string;
	description: string | null;
}

const isActive = (product: SplProduct) =>
	product.ingredients.some((ingredient) => ingredient.kind === 'active');

const trimNumber = (value: number) => String(Number(value.toFixed(4)));

function containerOf(description: string | null): { ml: number; form: string } | null {
	const match = /(\d+(?:\.\d+)?)\s*mL\s+in\s+1\s+([A-Z]+)/i.exec(description ?? '');
	return match ? { ml: Number(match[1]), form: match[2].toLowerCase() } : null;
}

/**
 * A product's strength in one container. `containerMl`/`container` come from
 * the package when one is known, else from the SPL's own presentation.
 */
function strengthOf(
	product: SplProduct,
	family: FormFamily,
	container: { ml: number; form: string } | null
): LabelStrength | null {
	const active = product.ingredients.find((ingredient) => ingredient.kind === 'active');
	if (!active || active.strength === null) return null;
	const presentation = product.presentation;
	const presentationMl =
		presentation?.amount != null && mlPer(presentation.amountUnit)
			? presentation.amount * (mlPer(presentation.amountUnit) ?? 0)
			: null;
	const containerMl = container?.ml ?? presentationMl;
	const containerWord =
		family === 'tablet' || family === 'capsule'
			? family
			: (container?.form ?? presentation?.form?.toLowerCase() ?? formLabelOf(family, product.doseForm));
	const perMl = active.per !== null ? active.per * (mlPer(active.perUnit) ?? 0) : 0;
	const stated = toMg(active.strength, active.strengthUnit);
	if (perMl) {
		// A concentration. An injection's vial is told apart by what it holds;
		// an oral liquid only by its bottle size.
		if (containerMl === null) return null;
		if (family === 'injection' && stated !== null) {
			const mg = (stated / perMl) * containerMl;
			return {
				text: `${trimNumber((active.strength / perMl) * containerMl)} ${active.strengthUnit} / ${trimNumber(containerMl)} mL ${containerWord}`,
				mg,
				containerMl
			};
		}
		return { text: `${trimNumber(containerMl)} mL ${containerWord}`, mg: null, containerMl };
	}
	return {
		text: `${trimNumber(active.strength)} ${active.strengthUnit ?? ''} ${containerWord}`.replace(/\s+/g, ' '),
		mg: stated,
		containerMl: family === 'tablet' || family === 'capsule' ? null : containerMl
	};
}

const sameStrength = (a: LabelStrength, b: LabelStrength) =>
	a.mg === b.mg && a.containerMl === b.containerMl;

/**
 * Who shares this NDC's label, and in what form and strength. Null when the
 * label covers one form family at one strength — nothing on it is about
 * another product — or when this NDC is not among its products.
 */
export function labelScope(
	products: SplProduct[],
	ndc: string,
	packages: LabelPackage[] = []
): LabelScope | null {
	const descriptions = new Map(
		packages.flatMap((pkg) => {
			const key = toNdc11(pkg.ndc);
			return key ? [[key, pkg.description] as const] : [];
		})
	);
	let own: LabelProduct | null = null;
	const others = new Map<string, LabelProduct>();
	const add = (into: Map<string, LabelProduct>, family: FormFamily, doseForm: string | null, strength: LabelStrength | null) => {
		const formLabel = formLabelOf(family, doseForm);
		const entry = into.get(formLabel) ?? { family, formLabel, strengths: [] };
		into.set(formLabel, entry);
		if (strength && !entry.strengths.some((s) => sameStrength(s, strength))) entry.strengths.push(strength);
	};
	for (const product of products) {
		// A kit's carton and its drug-free diluent are not dose forms of the drug.
		if (!isActive(product)) continue;
		const family = formFamilyOf(product.doseForm);
		const codes = product.packageCodes.length ? product.packageCodes : [null];
		for (const code of codes) {
			const key = code ? toNdc11(code) : null;
			const strength = strengthOf(product, family, containerOf(key ? (descriptions.get(key) ?? null) : null));
			if (key === ndc && !own) {
				own = { family, formLabel: formLabelOf(family, product.doseForm), strengths: strength ? [strength] : [] };
			} else add(others, family, product.doseForm, strength);
		}
	}
	if (!own) return null;
	const mine: LabelProduct = own;
	const siblings = [...others.values()]
		.map((entry) => ({
			...entry,
			strengths: entry.strengths.filter(
				(s) => entry.family !== mine.family || !mine.strengths.some((o) => sameStrength(o, s))
			)
		}))
		.filter((entry) => entry.family !== mine.family || entry.strengths.length);
	return siblings.length ? { own: mine, siblings } : null;
}
