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

import type { LabelBlock } from './spl-sections';
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

// ── Filtering the label's blocks ─────────────────────────────────────────────

/** What one section lost, for the disclaimer above it. */
export interface Omission {
	reason: 'form' | 'strength';
	count: number;
	unit: 'passage' | 'row';
	/** Who the hidden text was for: `oral suspension`, `500 mg vial`. */
	others: string[];
	/** Who this NDC is: `a tablet`, `the 1 g vial`. */
	own: string;
}

export interface FilteredBlocks {
	blocks: LabelBlock[];
	omissions: Omission[];
}

/** How label prose names each family. `other` is never named. */
export const FORM_TERMS: Record<FormFamily, RegExp | null> = {
	tablet: /\btablets?\b|\bcaplets?\b/i,
	capsule: /\bcapsules?\b/i,
	'oral-suspension': /\bsuspensions?\b/i,
	'oral-solution': /\boral\s+solutions?\b|\bsyrups?\b|\belixirs?\b/i,
	injection: /\binject(?:ion|able)s?\b|\bvials?\b|\bintravenous(?:ly)?\b|\bintramuscular(?:ly)?\b|\binfusions?\b/i,
	topical: null,
	ophthalmic: /\bophthalmic\b|\beye\s+drops?\b/i,
	other: null
};

// Making a powder up. A tablet or capsule never is, so on an oral solid's
// label this is always about a sibling — the one $lib/ingredient-content.ts's
// `isOralSolidForm` relies on too.
const RECONSTITUTION = /\b(?:re)?constitut|\bshake\s+(?:well|the\s+bottle)|\badd\b[^.]*\bwater\b|\bdiluent\b/i;

const isOralSolid = (family: FormFamily) => family === 'tablet' || family === 'capsule';

const article = (text: string) => (/^[aeiou]/i.test(text) ? `an ${text}` : `a ${text}`);

const runsText = (runs: { text: string }[]) => runs.map((run) => run.text).join('');

/** Sibling forms a passage names while not naming this NDC's; null if none. */
function otherFormsIn(text: string, scope: LabelScope): string[] | null {
	if (FORM_TERMS[scope.own.family]?.test(text)) return null;
	const others = scope.siblings.filter((s) => s.family !== scope.own.family);
	let named = others.filter((s) => FORM_TERMS[s.family]?.test(text));
	if (!named.length && isOralSolid(scope.own.family) && RECONSTITUTION.test(text))
		named = others.filter((s) => !isOralSolid(s.family));
	return named.length ? [...new Set(named.map((s) => s.formLabel))] : null;
}

/** The plain text of a block, for matching. */
function blockText(block: LabelBlock): string {
	switch (block.type) {
		case 'heading':
			return block.text;
		case 'paragraph':
			return runsText(block.runs);
		case 'list':
			return block.items.map((item) => item.map(blockText).join(' ')).join(' ');
		case 'table':
			return block.caption ?? '';
	}
}

interface Section {
	kind: 'section';
	heading: Extract<LabelBlock, { type: 'heading' }> | null;
	body: (LabelBlock | Section)[];
}

// Not `'body' in item`: a table has a body too.
const isSection = (item: LabelBlock | Section): item is Section => 'kind' in item;

/** Nest the flat block list under its headings, by level. */
function nest(blocks: LabelBlock[]): Section {
	const root: Section = { kind: 'section', heading: null, body: [] };
	const stack: Section[] = [root];
	for (const block of blocks) {
		if (block.type !== 'heading') {
			stack[stack.length - 1].body.push(block);
			continue;
		}
		while (stack.length > 1 && stack[stack.length - 1].heading!.level >= block.level) stack.pop();
		const section: Section = { kind: 'section', heading: block, body: [] };
		stack[stack.length - 1].body.push(section);
		stack.push(section);
	}
	return root;
}

class Tally {
	private counts = new Map<string, Omission>();
	constructor(private scope: LabelScope) {}
	add(reason: Omission['reason'], unit: Omission['unit'], others: string[]) {
		const key = `${reason}|${unit}|${others.join('|')}`;
		const entry = this.counts.get(key);
		if (entry) entry.count++;
		else
			this.counts.set(key, {
				reason,
				count: 1,
				unit,
				others,
				own:
					reason === 'form'
						? article(this.scope.own.formLabel)
						: `the ${this.scope.own.strengths[0]?.text ?? this.scope.own.formLabel}`
			});
	}
	get omissions() {
		return [...this.counts.values()];
	}
}

/** A leaf block with what does not apply removed; null when nothing is left. */
function filterBlock(block: LabelBlock, scope: LabelScope, tally: Tally): LabelBlock | null {
	if (block.type === 'list') {
		const items = block.items.flatMap((item) => {
			const others = otherFormsIn(item.map(blockText).join(' '), scope);
			if (others) {
				tally.add('form', 'passage', others);
				return [];
			}
			return [item];
		});
		return items.length ? { ...block, items } : null;
	}
	const others = otherFormsIn(blockText(block), scope);
	if (others) {
		tally.add('form', 'passage', others);
		return null;
	}
	return block;
}

/** A section's kept blocks, flattened; a heading goes when all under it went. */
function filterSection(section: Section, scope: LabelScope, tally: Tally): LabelBlock[] {
	if (section.heading) {
		const others = otherFormsIn(section.heading.text, scope);
		if (others) {
			tally.add('form', 'passage', others);
			return [];
		}
	}
	let removed = false;
	const kept = section.body.flatMap((item) => {
		const out = isSection(item)
			? filterSection(item, scope, tally)
			: [filterBlock(item, scope, tally)].filter((b) => b !== null);
		if (!out.length) removed = true;
		return out;
	});
	if (!section.heading) return kept;
	if (removed && !kept.some((block) => block.type !== 'heading')) return [];
	return [section.heading, ...kept];
}

/**
 * The blocks of one label section that apply to the NDC `scope` describes,
 * and what was taken out. Ambiguous text is always kept.
 */
export function filterLabelBlocks(blocks: LabelBlock[], scope: LabelScope): FilteredBlocks {
	const tally = new Tally(scope);
	const kept = filterSection(nest(blocks), scope, tally);
	return { blocks: kept, omissions: tally.omissions };
}
