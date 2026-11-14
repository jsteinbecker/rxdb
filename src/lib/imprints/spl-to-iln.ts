/**
 * First-pass conversion of FDA SPL appearance characteristics
 * (SPLCOLOR, SPLSHAPE, SPLSIZE, SPLSCORE, SPLIMPRINT, SPLSYMBOL, ...)
 * into Imprint Layout Notation (ILN).
 *
 * SPL does not encode layout. Its imprint is a flat string in which ";"
 * may separate faces OR lines, and SPLSCORE says how many pieces a tablet
 * breaks into, not where the score is. Every result is therefore a guess
 * and comes with a confidence level, notes on each assumption made, and
 * ranked alternative readings.
 *
 * Converter-only conventions (extensions to base ILN):
 *
 * | Token | Means |
 * | --- | --- |
 * | `blank` | may appear as an operand inside a layout: `B: blank \| blank` is a scored face with no markings |
 * | `<logo>` | a logo whose identity is unknown (the SPL imprint said "LOGO") |
 * | `<symbol>` | SPLSYMBOL=true, but the imprint doesn't say what or where |
 * | `+` | without an anchor: "also on this face, position unknown" |
 *
 * Text and symbol nodes may carry modifiers (e.g. location codes from
 * iln-location.ts), serialized as "ACME"[RIM:W>N>E, small].
 *
 * Dependency-free. Input may be SPL XML, parsed characteristics, or a
 * flat record (Pillbox-style keys such as splimprint, splcolor_text).
 *
 * @module
 */

import { findShape, isElongated } from './shapes.ts';

// ───────────────────────── Types ─────────────────────────

export interface SplCharacteristic {
	/** Characteristic code: SPLCOLOR, SPLSHAPE, SPLSIZE, SPLSCORE, SPLIMPRINT, SPLSYMBOL, SPLCOATING, … */
	code: string;
	/** The value's `xsi:type`: CE, PQ, INT, ST or BL. */
	xsiType?: string;
	/** The `<value>` element's `value` attribute. */
	value?: string;
	/** The `<value>` element's `code` attribute (the NCI Thesaurus code for CE values). */
	valueCode?: string;
	/** The `<value>` element's `displayName` attribute. */
	displayName?: string;
	/** The `<value>` element's `unit` attribute (PQ values). */
	unit?: string;
	/** Element text (ST values, e.g. the imprint). */
	text?: string;
}

export interface SplAppearance {
	name?: string;
	/** The `formCode` display name, e.g. "TABLET, FILM COATED" or "CAPSULE". */
	dosageForm?: string;
	/** SPLCOLOR values in SPL listing order, e.g. `["WHITE", "BLUE"]`. */
	colors: string[];
	/** SPLSHAPE term, e.g. "ROUND", "OVAL" or "CAPSULE". */
	shape?: string;
	sizeMm?: number;
	/** SPLSCORE: 1 means unscored; 2–4 is the number of pieces the score breaks it into. */
	score?: number;
	/** Raw SPLIMPRINT text, with faces separated by `;`, e.g. "M;30". */
	imprint?: string;
	symbol?: boolean;
	coating?: boolean;
}

export type PillForm = 'tablet' | 'capsule' | 'softgel';
export type Confidence = 'high' | 'medium' | 'low';

export interface IlnAlternative {
	iln: string;
	reason: string;
}

export interface IlnGuess {
	iln: string;
	form: PillForm;
	confidence: Confidence;
	notes: string[];
	alternatives: IlnAlternative[];
}

/**
 * ILN layout tree. Any node may carry modifiers; groups with modifiers serialize as (...)[mods].
 * A `text` node is imprint text; U+FFFD in its `v` marks an illegible character, written `\?` in ILN.
 */
export type Node = (
	| { k: 'text'; v: string }
	/** A symbol, `<name>`, or a symbol enclosing a node, `<name: inner>`. */
	| { k: 'sym'; name: string; inner?: Node }
	/** An explicitly blank region. */
	| { k: 'blank' }
	/** Juxtaposition: items on the same line, left to right. */
	| { k: 'line'; items: Node[] }
	/** `/`: lines from top to bottom. */
	| { k: 'stack'; items: Node[] }
	/** Score lines (`|` vertical, `-` horizontal) separating the items. */
	| { k: 'score'; dir: '|' | '-'; items: Node[] }
	/** `+`: out-of-flow additions. */
	| { k: 'plus'; items: Node[] }
) & { mods?: string[] };

export interface Surface {
	/** Which surface this is: F (front), B (back), E (edge), CAP, BODY or CAP+BODY. */
	label: string;
	color?: string;
	/** Shape direction tag, e.g. "TIP@E"; see `shapes.ts`. */
	orient?: string;
	/** The surface's layout tree, or null when the surface is blank. */
	body: Node | null;
}

// ───────────────────────── XML input ─────────────────────────

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
		}
		return NAMED_ENTITIES[e.toLowerCase()] ?? m;
	});
}

function attrs(tagSource: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of tagSource.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
		out[m[1]] = decodeXml(m[2] ?? m[3] ?? '');
	}
	return out;
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

/** Extract every <characteristic> in an SPL XML string or fragment. */
export function parseSplCharacteristics(xml: string): SplCharacteristic[] {
	const out: SplCharacteristic[] = [];
	for (const [, body] of xml.matchAll(/<characteristic\b[^>]*>([\s\S]*?)<\/characteristic>/g)) {
		const codeTag = body.match(/<code\b[^>]*>/);
		const code = codeTag ? attrs(codeTag[0]).code : undefined;
		if (!code) continue;
		const v = body.match(/<value\b([^>]*?)(?:\/>|>([\s\S]*?)<\/value>)/);
		const va = v ? attrs(v[1]) : {};
		const text = v?.[2] !== undefined ? decodeXml(stripTags(v[2]).trim()) : '';
		out.push({
			code: code.toUpperCase(),
			xsiType: va['xsi:type'],
			value: va.value,
			valueCode: va.code,
			displayName: va.displayName,
			unit: va.unit,
			text: text || undefined
		});
	}
	return out;
}

/**
 * Parse a full SPL document (or fragment) into one appearance per product.
 * Products are taken from <subject> blocks containing characteristics; if
 * there are none, the whole input is treated as one product.
 * Limitation: kit parts (<part><partProduct>) inside one product are merged.
 */
export function parseSplXml(xml: string): SplAppearance[] {
	const blocks = [...xml.matchAll(/<subject\b[^>]*>([\s\S]*?)<\/subject>/g)]
		.map((m) => m[1])
		.filter((b) => /<characteristic\b/.test(b));
	const sources = blocks.length ? blocks : [xml];
	return sources.map((src) => {
		const formTag = src.match(/<formCode\b[^>]*>/);
		const nameMatch = src.match(/<name\b[^>]*>([\s\S]*?)<\/name>/);
		return fromCharacteristics(parseSplCharacteristics(src), {
			dosageForm: formTag ? attrs(formTag[0]).displayName : undefined,
			name: nameMatch ? decodeXml(stripTags(nameMatch[1]).trim()) : undefined
		});
	});
}

const isTrue = (s: string | undefined) => /^(true|1|y|yes)$/i.test((s ?? '').trim());

export function fromCharacteristics(
	chars: SplCharacteristic[],
	extra: Partial<SplAppearance> = {}
): SplAppearance {
	const app: SplAppearance = { ...extra, colors: [...(extra.colors ?? [])] };
	const label = (c: SplCharacteristic) => (c.displayName ?? c.text ?? c.value ?? '').trim();
	for (const c of chars) {
		const raw = c.value ?? c.text;
		switch (c.code) {
			case 'SPLCOLOR': {
				const n = label(c);
				if (n) app.colors.push(n.toUpperCase());
				break;
			}
			case 'SPLSHAPE':
				app.shape = label(c).toUpperCase() || app.shape;
				break;
			case 'SPLSIZE': {
				const n = parseFloat(raw ?? '');
				if (Number.isFinite(n)) app.sizeMm = n;
				break;
			}
			case 'SPLSCORE': {
				const n = parseInt(raw ?? '', 10);
				if (Number.isFinite(n)) app.score = n;
				break;
			}
			case 'SPLIMPRINT':
				app.imprint = c.text ?? c.value ?? app.imprint;
				break;
			case 'SPLSYMBOL':
				app.symbol = isTrue(raw);
				break;
			case 'SPLCOATING':
				app.coating = isTrue(raw);
				break;
		}
	}
	return app;
}

// ───────────────────────── Flat-record input ─────────────────────────

/** Accepts Pillbox-style keys (splimprint, splcolor_text, ...) or plain ones (imprint, color, ...). */
export function fromRecord(rec: Record<string, unknown>): SplAppearance {
	const lower = new Map(Object.entries(rec).map(([k, v]) => [k.toLowerCase(), v]));
	const get = (...keys: string[]): string | undefined => {
		for (const k of keys) {
			const v = lower.get(k);
			if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
		}
		return undefined;
	};
	const num = (s?: string) =>
		s !== undefined && Number.isFinite(parseFloat(s)) ? parseFloat(s) : undefined;
	const colorField = get('splcolor_text', 'splcolor', 'colors', 'color');
	const symbolField = get('splsymbol', 'symbol');
	const scoreField = num(get('splscore', 'score'));
	return {
		name: get('medicine_name', 'name', 'title'),
		dosageForm: get('dosage_form', 'dosageform', 'form'),
		colors: colorField
			? colorField
					.split(/[;,]/)
					.map((s) => s.trim().toUpperCase())
					.filter(Boolean)
			: [],
		shape: get('splshape_text', 'splshape', 'shape')?.toUpperCase(),
		sizeMm: num(get('splsize', 'size')),
		score: scoreField !== undefined ? Math.round(scoreField) : undefined,
		imprint: get('splimprint', 'imprint'),
		symbol: symbolField !== undefined ? isTrue(symbolField) : undefined
	};
}

// ───────────────────────── Serializer ─────────────────────────

const LEVEL: Record<Node['k'], number> = {
	text: 0,
	sym: 0,
	blank: 0,
	line: 1,
	stack: 2,
	score: 3,
	plus: 4
};

const formatMods = (mods?: string[]) => (mods && mods.length ? `[${mods.join(', ')}]` : '');

const quote = (v: string) =>
	`"${v
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\uFFFD/g, '\\?')}"`;

export function serializeNode(n: Node, parentLevel = Infinity): string {
	let s: string;
	switch (n.k) {
		case 'text':
			s = quote(n.v);
			break;
		case 'sym':
			s = `<${n.name}${n.inner ? `: ${serializeNode(n.inner)}` : ''}>`;
			break;
		case 'blank':
			s = 'blank';
			break;
		case 'line':
			s = n.items.map((i) => serializeNode(i, LEVEL.line)).join(' ');
			break;
		case 'stack':
			s = n.items.map((i) => serializeNode(i, LEVEL.stack)).join(' / ');
			break;
		case 'score':
			s = n.items.map((i) => serializeNode(i, LEVEL.score)).join(` ${n.dir} `);
			break;
		case 'plus':
			s = n.items.map((i) => serializeNode(i, LEVEL.plus)).join(' + ');
			break;
	}
	const lvl = LEVEL[n.k];
	const hasMods = !!n.mods?.length;
	if (lvl > 0 && (lvl >= parentLevel || hasMods)) s = `(${s})`;
	return s + formatMods(n.mods);
}

export function serializeSurfaces(surfaces: Surface[]): string {
	return surfaces
		.map((s) => {
			const color = s.color ? `(${s.color.toLowerCase()})` : '';
			const orient = s.orient ? `[${s.orient}]` : '';
			return `${s.label}${color}${orient}: ${s.body ? serializeNode(s.body) : 'blank'}`;
		})
		.join(' ; ');
}

// ───────────────────────── Heuristic helpers ─────────────────────────

const LOGO_TOKEN = /^(logo|symbol)$/i;
const NUMERIC = /^\d+(\.\d+)?$/;
const BLANK: Node = { k: 'blank' };

const splitSegments = (imprint?: string) =>
	(imprint ?? '')
		.split(';')
		.map((s) => s.trim().replace(/\s+/g, ' '))
		.filter(Boolean);

/** One SPL imprint segment → node; "LOGO"/"SYMBOL" tokens become <logo>. */
function segmentToNode(seg: string): Node {
	const tokens = seg.split(' ');
	if (!tokens.some((t) => LOGO_TOKEN.test(t))) return { k: 'text', v: seg };
	const items: Node[] = [];
	let buf: string[] = [];
	const flush = () => {
		if (buf.length) items.push({ k: 'text', v: buf.join(' ') });
		buf = [];
	};
	for (const t of tokens) {
		if (LOGO_TOKEN.test(t)) {
			flush();
			items.push({ k: 'sym', name: 'logo' });
		} else buf.push(t);
	}
	flush();
	return items.length === 1 ? items[0] : { k: 'line', items };
}

function faceNode(segs: string[]): Node | null {
	if (segs.length === 0) return null;
	if (segs.length === 1) return segmentToNode(segs[0]);
	return { k: 'stack', items: segs.map(segmentToNode) };
}

/** Ways a face's content could be divided into score sections. */
function splitPieces(segs: string[]): { pieces: string[]; from: 'lines' | 'tokens' } | null {
	if (segs.length > 1) return { pieces: segs, from: 'lines' };
	if (segs.length === 1) return { pieces: segs[0].split(' '), from: 'tokens' };
	return null;
}

/** Build a score layout for 2, 3 or 4 pieces (4 = cross score). */
function scoreLayout(pieces: Node[], dir: '|' | '-'): Node {
	if (pieces.length === 4) {
		return {
			k: 'score',
			dir: '-',
			items: [
				{ k: 'score', dir: '|', items: pieces.slice(0, 2) },
				{ k: 'score', dir: '|', items: pieces.slice(2) }
			]
		};
	}
	return { k: 'score', dir: pieces.length === 3 ? '|' : dir, items: pieces };
}

/** Marked-character weight used to decide which face is F. */
function weight(n: Node | null): number {
	if (!n) return 0;
	switch (n.k) {
		case 'text':
			return n.v.replace(/\s/g, '').length;
		case 'sym':
			return 1 + weight(n.inner ?? null);
		case 'blank':
			return 0;
		default:
			return n.items.reduce((sum, i) => sum + weight(i), 0);
	}
}

const hasScore = (n: Node | null): boolean =>
	!!n && (n.k === 'score' || ('items' in n && n.items.some(hasScore)));

/** ILN F/B rule: more characters, then the scored face, then lexical order. */
function orderFaces(a: Node | null, b: Node | null): [Node | null, Node | null] {
	const wa = weight(a),
		wb = weight(b);
	if (wa !== wb) return wa > wb ? [a, b] : [b, a];
	const sa = hasScore(a),
		sb = hasScore(b);
	if (sa !== sb) return sa ? [a, b] : [b, a];
	const la = a ? serializeNode(a) : 'blank',
		lb = b ? serializeNode(b) : 'blank';
	return la <= lb ? [a, b] : [b, a];
}

/** Add an unplaced symbol: fill an unmarked slot if there is one, else append with "+". */
function placeSymbol(slots: (Node | null)[], sym: Node): { slots: (Node | null)[]; note: string } {
	const empty = slots.findIndex((s) => s === null);
	if (empty >= 0) {
		const copy = [...slots];
		copy[empty] = sym;
		return {
			slots: copy,
			note: 'SPL reports a symbol but not where; placed on the unmarked surface.'
		};
	}
	const copy = [...slots];
	copy[0] = { k: 'plus', items: [copy[0]!, sym] };
	return {
		slots: copy,
		note: 'SPL reports a symbol but not where; appended with "+" (position unknown).'
	};
}

function toConfidence(penalty: number): Confidence {
	return penalty === 0 ? 'high' : penalty <= 2 ? 'medium' : 'low';
}

interface Candidate {
	iln: string;
	penalty: number;
	reason: string;
	notes: string[];
}

// ───────────────────────── Form detection ─────────────────────────

function detectForm(app: SplAppearance): { form: PillForm; penalty: number; note?: string } {
	const df = (app.dosageForm ?? '').toUpperCase();
	if (df.includes('CAPSULE')) {
		if (/LIQUID FILLED|SOFT/.test(df)) {
			return {
				form: 'softgel',
				penalty: 0,
				note: `Dosage form "${app.dosageForm}" treated as a one-piece softgel (F/B faces).`
			};
		}
		return { form: 'capsule', penalty: 0 };
	}
	if (df) return { form: 'tablet', penalty: 0 };
	// `LONG CAPSULE` and `CAPSULE 2.6:1` are still the capsule outline.
	const capsuleShape = findShape(app.shape)?.id === 'CAPSULE';
	if (capsuleShape && app.colors.length === 2) {
		return {
			form: 'capsule',
			penalty: 1,
			note: 'No dosage form given; capsule shape + two colors read as a two-piece capsule.'
		};
	}
	return {
		form: 'tablet',
		penalty: capsuleShape ? 1 : 0,
		note: capsuleShape
			? 'No dosage form given; capsule-shaped item treated as a tablet (caplet).'
			: undefined
	};
}

// ───────────────────────── Tablets & softgels ─────────────────────────

interface FaceSplit {
	faces: [string[], string[]];
	reason: string;
	penalty: number;
	note?: string;
}

function faceSplits(segs: string[]): FaceSplit[] {
	const n = segs.length;
	if (n === 0) return [{ faces: [[], []], reason: 'no imprint', penalty: 0 }];
	if (n === 1)
		return [{ faces: [segs, []], reason: 'single imprint segment on one face', penalty: 0 }];
	if (n === 2) {
		return [
			{
				faces: [[segs[0]], [segs[1]]],
				reason: '";" read as a face separator',
				penalty: 1,
				note: 'Assumed ";" separates faces; SPL also uses it between lines on one face.'
			},
			{ faces: [segs, []], reason: '";" read as a line break on one face', penalty: 2 }
		];
	}
	const note = `Imprint has ${n} ";"-separated segments; the face/line split is a guess.`;
	return [
		{
			faces: [[segs[0]], segs.slice(1)],
			reason: `first segment alone, other ${n - 1} stacked on the opposite face`,
			penalty: 2,
			note
		},
		{
			faces: [segs.slice(0, -1), [segs[n - 1]]],
			reason: 'last segment alone on the opposite face',
			penalty: 3,
			note
		},
		{ faces: [segs, []], reason: 'all segments stacked on one face', penalty: 3, note }
	];
}

interface ScorePlacement {
	nodes: [Node | null, Node | null];
	reason?: string;
	note?: string;
	penalty: number;
}

function scorePlacements(
	faces: [string[], string[]],
	parts: number,
	elongated: boolean
): ScorePlacement[] {
	const plain: [Node | null, Node | null] = [faceNode(faces[0]), faceNode(faces[1])];
	if (parts < 2) return [{ nodes: plain, penalty: 0 }];
	if (parts > 4) {
		return [
			{ nodes: plain, penalty: 2, note: `SPLSCORE=${parts} is outside 2–4; score not encoded.` }
		];
	}

	const crossNote =
		parts === 4
			? ' SPLSCORE=4 does not distinguish a cross score from three parallel scores; cross assumed.'
			: '';
	const crossPenalty = parts === 4 ? 1 : 0;
	const options: (ScorePlacement & { rank: number })[] = [];

	faces.forEach((segs, i) => {
		const sp = splitPieces(segs);
		if (sp && sp.pieces.length === parts) {
			const uniform = sp.pieces.every((p) => NUMERIC.test(p)) || new Set(sp.pieces).size === 1;
			const dir = sp.from === 'lines' && !elongated ? '-' : '|';
			const nodes = [...plain] as [Node | null, Node | null];
			nodes[i] = scoreLayout(sp.pieces.map(segmentToNode), dir);
			const rank = uniform ? 0 : 2;
			options.push({
				nodes,
				rank,
				penalty: (uniform ? 1 : 2) + crossPenalty,
				reason: `score divides ${sp.pieces.map(quote).join(', ')}`,
				note: `Score placed between ${sp.pieces.map(quote).join(' and ')} (SPL gives score count, not position).${crossNote}`
			});
		}
		if (segs.length === 0) {
			const nodes = [...plain] as [Node | null, Node | null];
			nodes[i] = scoreLayout(Array<Node>(parts).fill(BLANK), '|');
			options.push({
				nodes,
				rank: 1,
				penalty: 1 + crossPenalty,
				reason: 'score on the unmarked face',
				note: `Score assumed to be on the unmarked face.${crossNote}`
			});
		}
	});

	options.sort((a, b) => a.rank - b.rank);
	options.push({
		nodes: plain,
		rank: 9,
		penalty: 3,
		reason: 'score not encoded',
		note: `SPLSCORE=${parts}, but no face could be divided into ${parts} sections; score location not encoded.`
	});
	return options;
}

function tabletCandidates(app: SplAppearance, segs: string[], form: PillForm): Candidate[] {
	const elongated = isElongated(app.shape);
	const parts = form === 'softgel' ? 1 : (app.score ?? 1);
	const wantsSymbol =
		!!app.symbol && !segs.some((s) => s.split(' ').some((t) => LOGO_TOKEN.test(t)));
	const out: Candidate[] = [];

	for (const split of faceSplits(segs)) {
		for (const place of scorePlacements(split.faces, parts, elongated)) {
			const notes = [split.note, place.note].filter((n): n is string => !!n);
			let slots: (Node | null)[] = [...place.nodes];
			let penalty = split.penalty + place.penalty;
			if (wantsSymbol) {
				const r = placeSymbol(slots, { k: 'sym', name: 'symbol' });
				slots = r.slots;
				notes.push(r.note);
				penalty += 1;
			}
			const [f, b] = orderFaces(slots[0], slots[1]);
			out.push({
				iln: serializeSurfaces([
					{ label: 'F', body: f },
					{ label: 'B', body: b }
				]),
				penalty,
				reason: [split.reason, place.reason].filter(Boolean).join('; '),
				notes
			});
		}
	}
	return out;
}

// ───────────────────────── Capsules ─────────────────────────

interface CapsuleLayout {
	cap: Node | null;
	body: Node | null;
	span?: Node;
	reason: string;
	penalty: number;
	note?: string;
}

function capsuleLayouts(segs: string[]): CapsuleLayout[] {
	const n = segs.length;
	if (n === 0) return [{ cap: null, body: null, reason: 'no imprint', penalty: 0 }];
	if (n === 1) {
		const seg = segs[0];
		const wordNumber = seg.match(/^([A-Za-z][A-Za-z.&'-]*)\s+(\S*\d\S*)$/);
		const whole = segmentToNode(seg);
		const onCap: CapsuleLayout = {
			cap: whole,
			body: null,
			reason: 'whole imprint on the cap',
			penalty: 1,
			note: 'Single imprint segment assumed to be on the cap.'
		};
		const onBody: CapsuleLayout = {
			cap: null,
			body: whole,
			reason: 'whole imprint on the body',
			penalty: 2
		};
		const span: CapsuleLayout = {
			cap: null,
			body: null,
			span: whole,
			reason: 'imprint spans the seam',
			penalty: 2
		};
		if (wordNumber) {
			return [
				{
					cap: segmentToNode(wordNumber[1]),
					body: segmentToNode(wordNumber[2]),
					reason: 'word on cap, number on body',
					penalty: 1,
					note: `Split "${seg}" into cap word and body number.`
				},
				onCap,
				onBody,
				span
			];
		}
		return [onCap, onBody, span];
	}
	if (n === 2) {
		return [
			{
				cap: segmentToNode(segs[0]),
				body: segmentToNode(segs[1]),
				reason: 'first segment on cap, second on body',
				penalty: 1,
				note: 'Assumed ";" separates cap print from body print.'
			},
			{
				cap: segmentToNode(segs[1]),
				body: segmentToNode(segs[0]),
				reason: 'segments swapped between halves',
				penalty: 2
			},
			{ cap: faceNode(segs), body: null, reason: 'both segments stacked on the cap', penalty: 2 }
		];
	}
	return [
		{
			cap: segmentToNode(segs[0]),
			body: faceNode(segs.slice(1)),
			reason: 'first segment on cap, rest stacked on body',
			penalty: 2,
			note: `Imprint has ${n} segments; cap/body split is a guess.`
		},
		{
			cap: faceNode(segs.slice(0, -1)),
			body: segmentToNode(segs[n - 1]),
			reason: 'last segment alone on body',
			penalty: 3
		}
	];
}

function capsuleCandidates(app: SplAppearance, segs: string[]): Candidate[] {
	const baseNotes: string[] = [];
	let basePenalty = 0;
	const [c0, c1] = app.colors;
	const capColor = c0 ?? 'unknown';
	const bodyColor = c1 ?? c0 ?? 'unknown';
	if (c0 && c1 && c0 !== c1) {
		baseNotes.push(
			'Cap/body colors assigned in SPL listing order (first = cap); SPL does not say which half is which color.'
		);
		basePenalty += 1;
	}
	if (!c0) {
		baseNotes.push('No color in SPL data; halves labeled "unknown".');
		basePenalty += 1;
	}
	if (app.colors.length > 2)
		baseNotes.push(`SPL lists ${app.colors.length} colors; only the first two were used.`);
	if ((app.score ?? 1) > 1) baseNotes.push(`SPLSCORE=${app.score} ignored for a capsule.`);
	const wantsSymbol =
		!!app.symbol && !segs.some((s) => s.split(' ').some((t) => LOGO_TOKEN.test(t)));

	return capsuleLayouts(segs).map((layout) => {
		const notes = [...baseNotes];
		if (layout.note) notes.push(layout.note);
		let penalty = basePenalty + layout.penalty;
		let [cap, body] = [layout.cap, layout.body];
		if (wantsSymbol && !layout.span) {
			const r = placeSymbol([cap, body], { k: 'sym', name: 'symbol' });
			[cap, body] = r.slots;
			notes.push(r.note);
			penalty += 1;
		}
		const surfaces: Surface[] = [
			{ label: 'CAP', color: capColor, body: cap },
			{ label: 'BODY', color: bodyColor, body }
		];
		if (layout.span) surfaces.push({ label: 'CAP+BODY', body: layout.span });
		return { iln: serializeSurfaces(surfaces), penalty, reason: layout.reason, notes };
	});
}

// ───────────────────────── Entry points ─────────────────────────

export function guessIln(app: SplAppearance, maxAlternatives = 4): IlnGuess {
	const formInfo = detectForm(app);
	const segs = splitSegments(app.imprint);
	const candidates =
		formInfo.form === 'capsule'
			? capsuleCandidates(app, segs)
			: tabletCandidates(app, segs, formInfo.form);

	if (formInfo.form !== 'capsule' && new Set(app.colors).size === 2) {
		for (const c of candidates)
			c.notes.push(
				'Two colors listed; could be bilayer or mottled, so face colors were not assigned.'
			);
	}

	// Stable sort by penalty, dedupe identical strings.
	const ranked = candidates
		.map((c, i) => ({ ...c, penalty: c.penalty + formInfo.penalty, i }))
		.sort((a, b) => a.penalty - b.penalty || a.i - b.i);
	const seen = new Set<string>();
	const unique = ranked.filter((c) => (seen.has(c.iln) ? false : (seen.add(c.iln), true)));
	const [best, ...rest] = unique;

	return {
		iln: best.iln,
		form: formInfo.form,
		confidence: toConfidence(best.penalty),
		notes: [...(formInfo.note ? [formInfo.note] : []), ...best.notes],
		alternatives: rest.slice(0, maxAlternatives).map((c) => ({ iln: c.iln, reason: c.reason }))
	};
}

/** Convenience: every product in an SPL document → guess. */
export function guessFromSplXml(xml: string): (IlnGuess & { name?: string })[] {
	return parseSplXml(xml).map((app) => ({ name: app.name, ...guessIln(app) }));
}

/** Convenience: Pillbox-style flat record → guess. */
export function guessFromRecord(rec: Record<string, unknown>): IlnGuess {
	return guessIln(fromRecord(rec));
}
