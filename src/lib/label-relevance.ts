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

/** `VIAL, SINGLE-USE` → `vial`: the noun a label would use. */
const containerWordOf = (form: string) => form.split(',')[0].trim().toLowerCase();

function containerOf(description: string | null): { ml: number; form: string } | null {
	const match = /(\d+(?:\.\d+)?)\s*mL\s+in\s+1\s+([A-Z]+)/i.exec(description ?? '');
	return match ? { ml: Number(match[1]), form: containerWordOf(match[2]) } : null;
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
			: (container?.form ??
				(presentation?.form ? containerWordOf(presentation.form) : null) ??
				formLabelOf(family, product.doseForm));
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
		text: `${trimNumber(active.strength)} ${active.strengthUnit ?? ''} ${containerWord}`.replace(
			/\s+/g,
			' '
		),
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
	const add = (
		into: Map<string, LabelProduct>,
		family: FormFamily,
		doseForm: string | null,
		strength: LabelStrength | null
	) => {
		const formLabel = formLabelOf(family, doseForm);
		const entry = into.get(formLabel) ?? { family, formLabel, strengths: [] };
		into.set(formLabel, entry);
		if (strength && !entry.strengths.some((s) => sameStrength(s, strength)))
			entry.strengths.push(strength);
	};
	for (const product of products) {
		// A kit's carton and its drug-free diluent are not dose forms of the drug.
		if (!isActive(product)) continue;
		const family = formFamilyOf(product.doseForm);
		const codes = product.packageCodes.length ? product.packageCodes : [null];
		for (const code of codes) {
			const key = code ? toNdc11(code) : null;
			const strength = strengthOf(
				product,
				family,
				containerOf(key ? (descriptions.get(key) ?? null) : null)
			);
			if (key === ndc && !own) {
				own = {
					family,
					formLabel: formLabelOf(family, product.doseForm),
					strengths: strength ? [strength] : []
				};
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
	injection:
		/\binject(?:ion|able)s?\b|\bvials?\b|\bintravenous(?:ly)?\b|\bintramuscular(?:ly)?\b|\binfusions?\b/i,
	topical: null,
	ophthalmic: /\bophthalmic\b|\beye\s+drops?\b/i,
	other: null
};

// Making a powder up. A tablet or capsule never is, so on an oral solid's
// label this is always about a sibling — the one $lib/ingredient-content.ts's
// `isOralSolidForm` relies on too.
const RECONSTITUTION =
	/\b(?:re)?constitut|\bshake\s+(?:well|the\s+bottle)|\badd\b[^.]*\bwater\b|\bdiluent\b/i;

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
		// One line per kind of omission: the others it was for are merged.
		const key = `${reason}|${unit}`;
		const entry = this.counts.get(key);
		if (entry) {
			entry.count++;
			for (const other of others) if (!entry.others.includes(other)) entry.others.push(other);
		} else
			this.counts.set(key, {
				reason,
				count: 1,
				unit,
				others: [...others],
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

// ── Strength ─────────────────────────────────────────────────────────────────
// A dilution table or a bottle-size list leads each row with the vial or
// bottle it is for: "1 g", "1 gram vial", "1 g (IV)", "80 mL – add 80 mL".

const LEADING_QUANTITY = /^\s*(\d+(?:\.\d+)?)\s*(mcg|mg|grams?|gm|g|mL|milliliters?)(?![\w/])/i;

function leadingQuantity(text: string): { mg: number | null; ml: number | null } | null {
	const match = LEADING_QUANTITY.exec(text);
	if (!match) return null;
	const value = Number(match[1]);
	const unit = match[2].toLowerCase();
	if (unit === 'ml' || unit.startsWith('milli')) return { mg: null, ml: value };
	return { mg: toMg(value, unit.startsWith('gram') || unit === 'gm' ? 'g' : unit), ml: null };
}

// Only a table or list about the containers themselves is sorted by size: a
// pharmacokinetic table's "0.5 g IV" and "2 g IV" rows are doses studied,
// true of every vial. Read from a table's caption and header, a list's text.
const PREPARATION =
	/\bvials?\b|\bbottles?\b|\bcontainers?\b|\bpackages?\b|\bdiluent|\b(?:re)?constitut|\bdilut|\bsizes?\b|\bwater\b/i;

const near = (a: number, b: number) => Math.abs(a - b) <= 0.005 * Math.max(a, b);

/**
 * How a row's leading quantity is matched against this label's strengths:
 * by mass when this NDC has one, else by container volume. Null when the
 * label has no same-family sibling strength to tell apart.
 */
function strengthMatcher(scope: LabelScope) {
	const own = scope.own.strengths;
	const siblings = scope.siblings
		.filter((s) => s.family === scope.own.family)
		.flatMap((s) => s.strengths);
	if (!own.length || !siblings.length) return null;
	const byMass = own.every((s) => s.mg !== null);
	const measure = (s: LabelStrength) => (byMass ? s.mg : s.containerMl);
	const quantityOf = (text: string) => {
		const q = leadingQuantity(text);
		return q ? (byMass ? q.mg : q.ml) : null;
	};
	/** The sibling a row is for, or null when it is this NDC's or nobody's. */
	return (text: string): { sibling: LabelStrength | null; known: boolean } => {
		const value = quantityOf(text);
		if (value === null) return { sibling: null, known: false };
		if (own.some((s) => measure(s) !== null && near(measure(s)!, value)))
			return { sibling: null, known: true };
		const sibling = siblings.find((s) => measure(s) !== null && near(measure(s)!, value)) ?? null;
		return { sibling, known: sibling !== null };
	};
}

/** Rows (as text) with sibling strengths removed, only when ≥2 rows name label strengths. */
function filterRows<T>(
	rows: T[],
	textOf: (row: T) => string,
	scope: LabelScope,
	tally: Tally
): T[] {
	const match = strengthMatcher(scope);
	if (!match) return rows;
	const matched = rows.map((row) => match(textOf(row)));
	const distinct = new Set(
		rows.flatMap((row, i) =>
			matched[i].known ? [leadingQuantity(textOf(row))?.mg ?? leadingQuantity(textOf(row))?.ml] : []
		)
	);
	if (distinct.size < 2) return rows;
	return rows.filter((_, i) => {
		const sibling = matched[i].sibling;
		if (sibling) tally.add('strength', 'row', [sibling.text]);
		return !sibling;
	});
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
		const sized = PREPARATION.test(blockText({ ...block, items }))
			? filterRows(items, (item) => item.map(blockText).join(' '), scope, tally)
			: items;
		return sized.length ? { ...block, items: sized } : null;
	}
	const others = otherFormsIn(blockText(block), scope);
	if (others) {
		tally.add('form', 'passage', others);
		return null;
	}
	const about =
		block.type === 'table'
			? [block.caption ?? '', ...block.head.flat().map((c) => runsText(c.runs))].join(' ')
			: '';
	if (block.type === 'table' && PREPARATION.test(about)) {
		// Header rows always stay; a body row is told apart by its stub cell.
		const body = filterRows(
			block.body,
			(row) => (row[0] ? runsText(row[0].runs) : ''),
			scope,
			tally
		);
		if (!body.length) return null;
		return body.length === block.body.length ? block : { ...block, body };
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

// ── Disclaimer copy ──────────────────────────────────────────────────────────

const joined = (items: string[]) =>
	items.length < 2
		? (items[0] ?? '')
		: `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// "for tablets", but "for oral suspension": a liquid is a mass noun.
const plural = (formLabel: string) =>
	formLabel === 'tablet' || formLabel === 'capsule' ? `${formLabel}s` : formLabel;

/** "Hidden: 2 passages for oral suspension. This NDC is a tablet." */
export function omissionNote(o: Omission): string {
	// A row is a table row or one line of a bottle-size list, so "entry".
	const noun =
		o.unit === 'passage'
			? o.count === 1
				? 'passage'
				: 'passages'
			: o.count === 1
				? 'entry'
				: 'entries';
	const others = o.reason === 'strength' ? `the ${joined(o.others)}` : joined(o.others.map(plural));
	return `Hidden: ${o.count} ${noun} for ${others}. This NDC is ${o.own}.`;
}
