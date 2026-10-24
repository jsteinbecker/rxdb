/**
 * The label's prescribing information, with its shape intact.
 *
 * openFDA's `/drug/label` fields are the SPL sections flattened to one string
 * apiece: subsection titles run into the paragraph before them, list items lose
 * their bullets, and a dosing table becomes a row of numbers with no columns.
 * The SPL document itself still has all of it — `<section>`, `<title>`,
 * `<paragraph>`, `<list>` and `<table>` — so this reads the sections out of the
 * XML, finds each one by its LOINC code, and keeps the structure as blocks the
 * page can render.
 *
 * Everything is pure and shared: the server stores what `labelSectionBlocks`
 * returns, and `LabelBlocks.svelte` draws it. Anything the reader does not
 * recognize is either walked through for its text or skipped, never thrown on.
 *
 * @module
 */

/** A run of inline text with the one emphasis SPL gave it. */
export interface LabelRun {
	text: string;
	style?: 'bold' | 'italic' | 'underline' | 'sup' | 'sub';
}

export interface LabelCell {
	runs: LabelRun[];
	header: boolean;
	colspan?: number;
	rowspan?: number;
}

export type LabelBlock =
	| { type: 'heading'; level: number; text: string }
	| { type: 'paragraph'; runs: LabelRun[] }
	| { type: 'list'; ordered: boolean; items: LabelBlock[][] }
	| {
			type: 'table';
			caption: string | null;
			head: LabelCell[][];
			body: LabelCell[][];
			foot: LabelCell[][];
	  };

/** LOINC section codes for the openFDA label keys this app shows. */
export const SECTION_CODES: Record<string, string[]> = {
	boxed_warning: ['34066-1'],
	indications_and_usage: ['34067-9'],
	dosage_and_administration: ['34068-7'],
	dosage_forms_and_strengths: ['43678-2'],
	contraindications: ['34070-3'],
	warnings_and_cautions: ['43685-7', '34071-1'],
	adverse_reactions: ['34084-4'],
	drug_interactions: ['34073-7'],
	use_in_specific_populations: ['43684-0'],
	description: ['34089-3'],
	clinical_pharmacology: ['34090-1'],
	how_supplied: ['34069-5'],
	storage_and_handling: ['44425-7'],
	instructions_for_use: ['59845-8'],
	package_label_principal_display_panel: ['51945-4']
};

// ── A mixed-content XML reader ───────────────────────────────────────────────
// Unlike the one in $lib/labels/spl-ingredients.ts, prose needs text kept in order
// between child elements, so children here are nodes *or* strings.

interface Node {
	tag: string;
	attrs: Record<string, string>;
	children: (Node | string)[];
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

const decode = (text: string): string =>
	text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, body: string) => {
		if (body[0] === '#') {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[body] ?? whole;
	});

function attrsOf(source: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g))
		attrs[match[1]] = decode(match[2]);
	return attrs;
}

/** Local name, so a namespace prefix never hides a tag. */
const local = (tag: string) => tag.slice(tag.indexOf(':') + 1);

function parse(xml: string): Node {
	const root: Node = { tag: '#root', attrs: {}, children: [] };
	const stack: Node[] = [root];
	const body = xml
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) =>
			text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
		)
		.replace(/<\?[\s\S]*?\?>/g, '')
		.replace(/<!DOCTYPE[^>]*>/gi, '');
	const tags = /<\s*(\/?)\s*([\w:.-]+)((?:"[^"]*"|[^>"])*?)(\/?)\s*>/g;
	let cursor = 0;
	for (const match of body.matchAll(tags)) {
		const [whole, closing, rawTag, rawAttrs, selfClosing] = match;
		const parent = stack[stack.length - 1];
		const between = body.slice(cursor, match.index);
		if (between) parent.children.push(decode(between));
		cursor = match.index + whole.length;
		const tag = local(rawTag);
		if (closing) {
			const depth = stack.findLastIndex((node) => node.tag === tag);
			if (depth > 0) stack.length = depth;
			continue;
		}
		const node: Node = { tag, attrs: attrsOf(rawAttrs), children: [] };
		parent.children.push(node);
		if (!selfClosing) stack.push(node);
	}
	return root;
}

const elements = (node: Node, tag?: string): Node[] =>
	node.children.filter((c): c is Node => typeof c !== 'string' && (!tag || c.tag === tag));

const tidy = (text: string) => text.replace(/[​\s]+/g, ' ');

function textOf(node: Node): string {
	return tidy(
		node.children
			.map((c) => (typeof c === 'string' ? c : c.tag === 'br' ? '\n' : textOf(c)))
			.join('')
	).trim();
}

// ── Inline runs ──────────────────────────────────────────────────────────────

function styleOf(node: Node): LabelRun['style'] {
	if (node.tag === 'sup') return 'sup';
	if (node.tag === 'sub') return 'sub';
	const code = (node.attrs.styleCode ?? '').toLowerCase();
	if (code.includes('bold')) return 'bold';
	if (code.includes('italic')) return 'italic';
	if (code.includes('underline')) return 'underline';
	return undefined;
}

const SKIPPED_INLINE = new Set(['footnote', 'renderMultiMedia', 'caption']);

function pushRun(runs: LabelRun[], text: string, style?: LabelRun['style']) {
	if (!text) return;
	const last = runs[runs.length - 1];
	if (last && last.style === style) last.text += text;
	else runs.push(style ? { text, style } : { text });
}

function runsInto(node: Node, runs: LabelRun[], inherited?: LabelRun['style']) {
	for (const child of node.children) {
		if (typeof child === 'string') pushRun(runs, tidy(child), inherited);
		else if (child.tag === 'br') pushRun(runs, '\n', inherited);
		else if (SKIPPED_INLINE.has(child.tag)) continue;
		else runsInto(child, runs, styleOf(child) ?? inherited);
	}
}

/** Trim the ends of a run list and drop what became empty. */
function trimRuns(runs: LabelRun[]): LabelRun[] {
	if (runs.length) {
		runs[0].text = runs[0].text.replace(/^\s+/, '');
		const last = runs[runs.length - 1];
		last.text = last.text.replace(/\s+$/, '');
	}
	return runs.filter((run) => run.text);
}

// ── Blocks ───────────────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set(['paragraph', 'list', 'table', 'section', 'component']);

function cellOf(node: Node): LabelCell {
	const runs: LabelRun[] = [];
	let first = true;
	// A cell may hold several paragraphs or a list; each becomes its own line.
	for (const child of node.children) {
		if (typeof child !== 'string' && (child.tag === 'paragraph' || child.tag === 'item')) {
			if (!first) pushRun(runs, '\n');
			runsInto(child, runs, styleOf(child));
		} else if (typeof child !== 'string' && child.tag === 'list') {
			for (const item of elements(child, 'item')) {
				if (!first || runs.length) pushRun(runs, '\n');
				pushRun(runs, '• ');
				runsInto(item, runs);
			}
		} else if (typeof child === 'string') pushRun(runs, tidy(child));
		else if (child.tag === 'br') pushRun(runs, '\n');
		else if (!SKIPPED_INLINE.has(child.tag)) runsInto(child, runs, styleOf(child));
		first = false;
	}
	const cell: LabelCell = {
		runs: trimRuns(runs.map((run) => ({ ...run, text: run.text.replace(/ *\n */g, '\n') }))),
		header: node.tag === 'th'
	};
	const colspan = Number(node.attrs.colspan);
	const rowspan = Number(node.attrs.rowspan);
	if (colspan > 1) cell.colspan = colspan;
	if (rowspan > 1) cell.rowspan = rowspan;
	return cell;
}

const rowsOf = (group: Node | undefined): LabelCell[][] =>
	group
		? elements(group, 'tr').map((tr) =>
				elements(tr)
					.filter((c) => c.tag === 'td' || c.tag === 'th')
					.map(cellOf)
			)
		: [];

function tableOf(node: Node): LabelBlock {
	const caption = elements(node, 'caption')[0];
	const loose = elements(node, 'tr');
	const body = [
		...elements(node, 'tbody').flatMap((b) => rowsOf(b)),
		...rowsOf(loose.length ? { ...node, children: loose } : undefined)
	];
	let head = elements(node, 'thead').flatMap((h) => rowsOf(h));
	// Most SPL tables have no <thead>: a first row that is entirely bold is one.
	if (
		!head.length &&
		body.length > 1 &&
		body[0].every((c) => c.runs.every((r) => r.style === 'bold' || !r.text.trim()))
	) {
		head = [body.shift()!.map((c) => ({ ...c, header: true }))];
	}
	return {
		type: 'table',
		caption: caption ? textOf(caption) || null : null,
		head,
		body,
		foot: elements(node, 'tfoot').flatMap((f) => rowsOf(f))
	};
}

function blocksOf(node: Node, level: number, out: LabelBlock[] = []): LabelBlock[] {
	let runs: LabelRun[] = [];
	const flush = () => {
		const trimmed = trimRuns(runs);
		if (trimmed.length) out.push({ type: 'paragraph', runs: trimmed });
		runs = [];
	};
	for (const child of node.children) {
		if (typeof child === 'string') {
			// Whitespace between block elements is layout, not content.
			if (child.trim()) pushRun(runs, tidy(child));
			continue;
		}
		switch (child.tag) {
			case 'title':
			case 'code':
			case 'id':
			case 'effectiveTime':
			case 'excerpt': // Highlights of Prescribing Information, repeated in full below.
			case 'renderMultiMedia':
			case 'observationMedia':
				continue;
			case 'paragraph':
				flush();
				blocksOf(child, level, out);
				flush();
				break;
			case 'list': {
				flush();
				const ordered = child.attrs.listType === 'ordered';
				const items = elements(child, 'item').map((item) => blocksOf(item, level));
				if (items.some((item) => item.length)) out.push({ type: 'list', ordered, items });
				break;
			}
			case 'table':
				flush();
				out.push(tableOf(child));
				break;
			case 'section': {
				flush();
				const title = elements(child, 'title')[0];
				const text = title ? textOf(title) : '';
				if (text) out.push({ type: 'heading', level, text });
				blocksOf(child, level + 1, out);
				break;
			}
			case 'br':
				pushRun(runs, '\n');
				break;
			default:
				if (elements(child).some((c) => BLOCK_TAGS.has(c.tag))) {
					flush();
					blocksOf(child, level, out);
				} else if (!SKIPPED_INLINE.has(child.tag)) runsInto(child, runs, styleOf(child));
		}
	}
	flush();
	return out;
}

function sectionCode(section: Node): string | null {
	return elements(section, 'code')[0]?.attrs.code ?? null;
}

function findSections(node: Node, into: Map<string, Node> = new Map()): Map<string, Node> {
	for (const child of elements(node)) {
		if (child.tag === 'section') {
			const code = sectionCode(child);
			if (code && !into.has(code)) into.set(code, child);
		}
		findSections(child, into);
	}
	return into;
}

/**
 * Structured blocks for every label key in `SECTION_CODES` that the SPL has,
 * keyed like openFDA's fields. A key the document lacks is simply absent.
 */
export function labelSectionBlocks(xml: string): Record<string, LabelBlock[]> {
	const byCode = findSections(parse(xml));
	const out: Record<string, LabelBlock[]> = {};
	for (const [key, codes] of Object.entries(SECTION_CODES)) {
		const section = codes.map((code) => byCode.get(code)).find(Boolean);
		if (!section) continue;
		const blocks = blocksOf(section, 1);
		if (blocks.length) out[key] = blocks;
	}
	return out;
}

/**
 * A section's blocks as plain text, one line per paragraph, list item and
 * table row, so a row's NDC stays on the line with the rest of that row.
 */
export function sectionPlainText(blocks: LabelBlock[] | undefined): string | null {
	if (!blocks?.length) return null;
	const runs = (items: LabelRun[]) => items.map((run) => run.text).join('');
	const lines = (block: LabelBlock): string[] => {
		switch (block.type) {
			case 'heading':
				return [block.text];
			case 'paragraph':
				return [runs(block.runs)];
			case 'list':
				return block.items.map((item) => item.flatMap(lines).join(' '));
			case 'table':
				return [
					...(block.caption ? [block.caption] : []),
					...[...block.head, ...block.body, ...block.foot].map((row) =>
						row.map((cell) => runs(cell.runs)).join(' | ')
					)
				];
		}
	};
	return blocks.flatMap(lines).join('\n') || null;
}
