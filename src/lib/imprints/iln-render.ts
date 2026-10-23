/**
 * From ILN to a drawing.
 *
 * `spl-to-iln` turns SPL's flat imprint string into Imprint Layout Notation: a
 * guess, with confidence, at which face each segment sits on, where the score
 * falls and what it divides. This reads that notation back into a tree and
 * lays it out as marks on a 100×100 box per face — the same box
 * `shapeGeometry` draws its outlines in — so `PillMockup.svelte` only has to
 * paint what this places.
 *
 * Layout follows the notation's own structure: "/" stacks lines top to
 * bottom, juxtaposition runs left to right, "|" and "-" divide the region
 * they sit in with a score line, and anything carrying a location code is
 * placed by that code: arcs and rings along the rim, a mid-radius track, the
 * hole or another symbol; straight text in a zone at any heading; stacked
 * letters; score- and section-relative spots; capsule zones and print turned
 * around the long axis; and the edge band, drawn as its own unrolled view.
 *
 * @module
 */
import { guessIln, type IlnGuess, type Node, type SplAppearance, type Surface } from './spl-to-iln';
import { markingStyle, parseIln, validateIln } from './iln-parse';
import {
	COMPASS_DEG,
	describeLocation,
	type LocationCode,
	parseModifiers,
	type Zone
} from './iln-location';
import {
	type Feature,
	findShape,
	holeFromName,
	isHoleName,
	isHoleTagToken,
	parseHoleOrient,
	parseShapeOrient
} from './shapes';
import { type PillAppearance, shapeGeometry, swatchOf } from '../labels/spl-characteristics';
import { type FillForm, parseShell, ShellError } from './capsule-shell';
import type { MeasuredFace, PillImageLayout } from './pill-image-layout'; // ── From ILN to a drawing ────────────────────────────────────────────────────

// ── Parsing ──────────────────────────────────────────────────────────────────
// The full parser lives in `iln-parse`: it reads modifiers and location codes
// (`"ACME"[RIM:W>N>E]`) and symbols with markings inside (`<circle: "5">`).

export { parseIln };

// ── Marks ────────────────────────────────────────────────────────────────────

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** How a symbol is painted: a solid mark, an outline enclosing other marks, or a cut through the tablet. */
export type SymbolStyle = 'fill' | 'outline' | 'hole';

/** How a mark is applied. Unset marks take their view's finish. */
export type Finish = 'deboss' | 'emboss' | 'ink';

/** A marking method set in the notation (`[emboss]`, `[ink:blue]`), overriding the view's finish. */
interface Styled {
	finish?: Finish;
	/** Ink color as a hex swatch; printed marks only. */
	ink?: string;
}

export type Mark =
	| (Styled & {
			kind: 'text';
			x: number;
			y: number;
			size: number;
			text: string;
			/** Degrees clockwise; 90 reads downward. */
			rotate?: number;
			/** Foreshortening of capsule print turned away around the long axis. */
			scaleY?: number;
			opacity?: number;
			/** No size modifier of its own: takes the face's uniform size when that preference is on. */
			auto?: boolean;
	  })
	| (Styled & {
			kind: 'arc';
			/** The baseline track, in reading order. */
			d: string;
			size: number;
			text: string;
			/** `middle` centres the text on the track; a full ring starts at its first point. */
			anchor: 'middle' | 'start';
	  })
	| { kind: 'score'; x1: number; y1: number; x2: number; y2: number }
	| (Styled & {
			kind: 'symbol';
			name: string;
			x: number;
			y: number;
			r: number;
			rotate?: number;
			mirror?: boolean;
			style: SymbolStyle;
			opacity?: number;
	  });

// ── Modifiers ────────────────────────────────────────────────────────────────

interface Mods {
	loc?: LocationCode;
	/** small / large relative to the face's other markings. */
	scale: number;
	/** Grow to most of the space available. */
	fill: boolean;
	/** Printed n times around a capsule's girth. */
	repeat: number;
	/** On the far side of a capsule from the cap's front print. */
	back: boolean;
	hole?: { deg?: number; mirrored: boolean };
}

function modsOf(node: Node): Mods {
	const raw = node.mods ?? [];
	const holeTokens = raw.filter(isHoleTagToken);
	const rest = raw.filter((token) => !isHoleTagToken(token));
	let loc: LocationCode | undefined;
	let words: string[] = [];
	if (rest.length) {
		try {
			const parsed = parseModifiers(`[${rest.join(', ')}]`);
			loc = parsed.location;
			words = parsed.mods.map((word) => word.toLowerCase());
		} catch {
			// An unreadable modifier list leaves the element in the flow.
		}
	}
	let hole: Mods['hole'];
	if (holeTokens.length) {
		try {
			hole = parseHoleOrient(holeTokens.join(', '));
		} catch {
			hole = undefined;
		}
	}
	const repeat = words.map((word) => /^x(\d+)$/.exec(word)).find(Boolean);
	return {
		loc,
		scale: words.includes('small') ? 0.7 : words.includes('large') ? 1.3 : 1,
		fill: words.includes('fill'),
		repeat: repeat ? Math.max(1, Number(repeat[1])) : 1,
		back: words.includes('back'),
		hole
	};
}

/** Horizontal, centred text is the flow itself, so its code changes nothing. */
const inFlow = (loc: LocationCode | undefined) =>
	!loc || (loc.path === 'line' && loc.heading === 'E' && loc.zone === 'C');

const bare = (node: Node): Node => ({ ...node, mods: undefined });

// ── Layout ───────────────────────────────────────────────────────────────────

interface Ctx {
	/** The face outline's centre and half-extents: the frame for compass points. */
	cx: number;
	cy: number;
	rx: number;
	ry: number;
	/** Glyph height cap: imprints stay small relative to the tablet however little text there is. */
	maxSize: number;
	marks: Mark[];
	/** The through-hole's id (ROUND, V, K) and, once placed, where it is. */
	holeType: string;
	hole?: { x: number; y: number; r: number };
	/** Where each symbol landed, for ORBIT tracks. */
	anchors: Map<string, { x: number; y: number; r: number }>;
	/** Curved text waits for the hole and symbols it may orbit. */
	deferred: (() => void)[];
	/** Give every unmodified straight string on the face the same size: the smallest any of them fits. */
	uniform?: boolean;
	/** A capsule's halves, for capsule location codes. */
	capsule?: {
		cap: Box;
		body: Box;
		whole: Box;
		/** Degrees the capsule is turned about its long axis for this view: 180 shows its back. */
		turn?: number;
		/** When set, only print placed by a capsule code is collected, here; flow text sits on the front. */
		placed?: Mark[];
	};
}

/** Characters a node puts on one line, for sharing width between neighbours. */
const span = (n: Node): number => {
	if (!inFlow(modsOf(n).loc)) return 0.01;
	switch (n.k) {
		case 'text':
			return Math.max(1, n.v.length);
		case 'sym':
			return n.inner ? Math.max(1.6, span(n.inner) + 1) : 1.6;
		case 'blank':
			return 1;
		case 'line':
			return n.items.reduce((sum, i) => sum + span(i), 0);
		case 'stack':
			return Math.max(...n.items.map(span));
		case 'plus':
			return span(n.items[0]);
		case 'score':
			return n.dir === '|'
				? n.items.reduce((sum, i) => sum + span(i), 0)
				: Math.max(...n.items.map(span));
	}
};

/** U+FFFD stands for an illegible character (`\?`). */
const shown = (text: string) => text.replace(/�/g, '?');

/** Every text run in a node, joined: what a curved track carries. */
const textOf = (n: Node): string => {
	switch (n.k) {
		case 'text':
			return shown(n.v);
		case 'sym':
			return n.inner ? textOf(n.inner) : '';
		case 'blank':
			return '';
		default:
			return n.items.map(textOf).filter(Boolean).join(' ');
	}
};

/** 0.62 em is a fair average advance for the caps and digits imprints use. */
const ADVANCE = 0.62;

function textSize(text: string, box: Box, ctx: Ctx, mods: Mods): number {
	const cap = mods.fill ? Infinity : ctx.maxSize * mods.scale;
	const fit = Math.min(
		box.h * (mods.fill ? 0.9 : 0.62),
		(box.w * (mods.fill ? 0.94 : 0.86)) / (Math.max(1, text.length) * ADVANCE)
	);
	return Math.min(cap, fit * (mods.fill ? 1 : Math.min(1, mods.scale)));
}

const inkSwatch = (ink: string) => (ink.startsWith('#') ? ink : swatchOf(ink));

/**
 * Stamp a marking method onto every mark `run` adds, including curved text it defers. Inner
 * elements are stamped first, so the innermost method wins; scores and holes are cuts, not markings.
 */
function styled(node: Node, ctx: Ctx, run: () => void): void {
	const { method, ink } = markingStyle(node.mods);
	if (!method) return run();
	const style: Styled = {
		finish: method === 'print' ? 'ink' : method,
		...(ink ? { ink: inkSwatch(ink) } : {})
	};
	const lists = [ctx.marks, ...(ctx.capsule?.placed ? [ctx.capsule.placed] : [])];
	const stamp = (starts: number[]) =>
		lists.forEach((list, i) => {
			for (const mark of list.slice(starts[i])) {
				if (mark.kind === 'score' || (mark.kind === 'symbol' && mark.style === 'hole')) continue;
				if (!mark.finish) Object.assign(mark, style);
			}
		});
	const starts = lists.map((l) => l.length);
	const deferredStart = ctx.deferred.length;
	run();
	stamp(starts);
	for (let i = deferredStart; i < ctx.deferred.length; i++) {
		const later = ctx.deferred[i];
		ctx.deferred[i] = () => {
			const at = lists.map((l) => l.length);
			later();
			stamp(at);
		};
	}
}

/** Place a node's marks inside `box`. */
export function layout(node: Node | null, box: Box, ctx: Ctx): void {
	if (!node) return;
	styled(node, ctx, () => place(node, box, ctx));
}

function place(node: Node, box: Box, ctx: Ctx): void {
	const mods = modsOf(node);
	if (!inFlow(mods.loc)) return placeLocated(node, mods, box, ctx);
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	switch (node.k) {
		case 'blank':
			break;
		case 'text':
			ctx.marks.push({
				kind: 'text',
				x: cx,
				y: cy,
				size: textSize(node.v, box, ctx, mods),
				text: shown(node.v),
				...(!mods.fill && mods.scale === 1 ? { auto: true } : {})
			});
			break;
		case 'sym':
			placeSymbol(node, mods, box, ctx);
			break;
		case 'line': {
			const total = node.items.reduce((sum, item) => sum + span(item), 0);
			let x = box.x;
			for (const item of node.items) {
				const w = (box.w * span(item)) / total;
				layout(item, { x, y: box.y, w, h: box.h }, ctx);
				x += w;
			}
			break;
		}
		case 'stack': {
			const h = box.h / node.items.length;
			node.items.forEach((item, i) =>
				layout(item, { x: box.x, y: box.y + i * h, w: box.w, h }, ctx)
			);
			break;
		}
		case 'score': {
			const n = node.items.length;
			if (node.dir === '|') {
				const w = box.w / n;
				for (let i = 1; i < n; i++) {
					const x = box.x + i * w;
					ctx.marks.push({ kind: 'score', x1: x, y1: box.y, x2: x, y2: box.y + box.h });
				}
				node.items.forEach((item, i) =>
					layout(item, { x: box.x + i * w, y: box.y, w, h: box.h }, ctx)
				);
			} else {
				const h = box.h / n;
				for (let i = 1; i < n; i++) {
					const y = box.y + i * h;
					ctx.marks.push({ kind: 'score', x1: box.x, y1: y, x2: box.x + box.w, y2: y });
				}
				node.items.forEach((item, i) =>
					layout(item, { x: box.x, y: box.y + i * h, w: box.w, h }, ctx)
				);
			}
			break;
		}
		case 'plus': {
			const isHole = (item: Node) =>
				item.k === 'sym' && (isHoleName(item.name) || /^orifice$/i.test(item.name));
			const [main, ...rest] = node.items;
			// The hole goes down first so the markings that share the face can keep clear of it.
			for (const item of rest) if (isHole(item)) layout(item, box, ctx);
			const extra = rest.filter((item) => !isHole(item));
			if (isHole(main)) layout(main, box, ctx);
			else layoutAroundHole(main, box, ctx);
			// An extra without a location shares the region when the main item left
			// the flow (it sits on a track or in a zone) or is the hole; otherwise
			// it sits in the upper right corner, out of the way.
			const side = Math.min(box.w, box.h) * 0.28;
			const free = !inFlow(modsOf(main).loc) || main.k === 'blank' || isHole(main);
			let corner = 0;
			for (const item of extra) {
				if (!inFlow(modsOf(item).loc)) layout(item, box, ctx);
				else if (free) layout(item, ctx.hole ? clearOf(box, ctx.hole) : box, ctx);
				else
					layout(
						item,
						{ x: box.x + box.w - side * ++corner, y: box.y, w: side, h: side },
						{ ...ctx, maxSize: ctx.maxSize * 0.5 }
					);
			}
			break;
		}
	}
}

/**
 * Lay out a flow item on a face that already has a hole. A scored layout keeps
 * the whole face, so its score still bisects it and runs through the hole
 * (broken where it crosses); anything else moves to the clear part of the box.
 */
function layoutAroundHole(node: Node, box: Box, ctx: Ctx): void {
	const hole = ctx.hole;
	if (!hole || !inFlow(modsOf(node).loc)) return layout(node, box, ctx);
	if (node.k !== 'score') return layout(node, clearOf(box, hole), ctx);
	const from = ctx.marks.length;
	layout(node, box, ctx);
	const reach = hole.r * HOLE_REACH;
	const added = ctx.marks.splice(from);
	for (const mark of added)
		ctx.marks.push(...(mark.kind === 'score' ? breakAt(mark, hole.x, hole.y, reach) : [mark]));
}

/** A score segment with the part inside the circle (cx, cy, r) cut out. */
function breakAt(
	seg: Extract<Mark, { kind: 'score' }>,
	cx: number,
	cy: number,
	r: number
): Extract<Mark, { kind: 'score' }>[] {
	const dx = seg.x2 - seg.x1;
	const dy = seg.y2 - seg.y1;
	const fx = seg.x1 - cx;
	const fy = seg.y1 - cy;
	const a = dx * dx + dy * dy;
	const b = 2 * (fx * dx + fy * dy);
	const c = fx * fx + fy * fy - r * r;
	const disc = b * b - 4 * a * c;
	if (!a || disc <= 0) return [seg];
	const t1 = (-b - Math.sqrt(disc)) / (2 * a);
	const t2 = (-b + Math.sqrt(disc)) / (2 * a);
	if (t2 <= 0 || t1 >= 1) return [seg];
	const at = (t: number) => ({ x: seg.x1 + dx * t, y: seg.y1 + dy * t });
	const out: Extract<Mark, { kind: 'score' }>[] = [];
	if (t1 > 0) {
		const p = at(t1);
		out.push({ ...seg, x2: p.x, y2: p.y });
	}
	if (t2 < 1) {
		const p = at(t2);
		out.push({ ...seg, x1: p.x, y1: p.y });
	}
	return out;
}

/** How far past its nominal radius a hole and its embossed lip reach. */
const HOLE_REACH = 1.3;

/** The part of `box` above or below the hole, whichever is taller (above on a tie). */
function clearOf(box: Box, hole: { x: number; y: number; r: number }): Box {
	const reach = hole.r * HOLE_REACH + 1;
	const above = hole.y - reach - box.y;
	const below = box.y + box.h - (hole.y + reach);
	return above >= below
		? { x: box.x, y: box.y, w: box.w, h: Math.max(0, above) }
		: { x: box.x, y: hole.y + reach, w: box.w, h: Math.max(0, below) };
}

/**
 * The last word on holes: a flat mark (text or symbol) whose footprint
 * reaches the hole or its lip is pushed straight away from the hole until it
 * clears, so no imprint is ever drawn across the cut.
 */
function keepOffHoles(marks: Mark[]): Mark[] {
	const holes = marks.filter(
		(m): m is Extract<Mark, { kind: 'symbol' }> => m.kind === 'symbol' && m.style === 'hole'
	);
	if (!holes.length) return marks;
	return marks.map((mark) => {
		if (mark.kind !== 'text' && !(mark.kind === 'symbol' && mark.style !== 'hole')) return mark;
		let { x, y } = mark;
		const [w, h] =
			mark.kind === 'text'
				? [mark.size * 0.62 * Math.max(1, mark.text.length), mark.size * 0.8]
				: [mark.r * 2, mark.r * 2];
		const sideways =
			mark.rotate && Math.abs(mark.rotate % 180) > 45 && Math.abs(mark.rotate % 180) < 135;
		const [hw, hh] = sideways ? [h / 2, w / 2] : [w / 2, h / 2];
		for (const hole of holes) {
			const reach = hole.r * HOLE_REACH;
			// Nearest point of the mark's box to the hole's centre.
			const nx = Math.max(x - hw, Math.min(hole.x, x + hw));
			const ny = Math.max(y - hh, Math.min(hole.y, y + hh));
			if (Math.hypot(nx - hole.x, ny - hole.y) >= reach) continue;
			// Slide along whichever axis needs the shorter move: up/down, else left/right.
			const dy = y <= hole.y ? hole.y - reach - hh - y : hole.y + reach + hh - y;
			const dx = x <= hole.x ? hole.x - reach - hw - x : hole.x + reach + hw - x;
			if (Math.abs(dy) <= Math.abs(dx)) y += dy;
			else x += dx;
		}
		return x === mark.x && y === mark.y ? mark : { ...mark, x, y };
	});
}

const ENCLOSURES = new Set([
	'circle',
	'square',
	'triangle',
	'heart',
	'diamond',
	'oval',
	'shield',
	'star',
	'hexagon',
	'pentagon',
	'octagon'
]);

function placeSymbol(node: Extract<Node, { k: 'sym' }>, mods: Mods, box: Box, ctx: Ctx): void {
	const x = box.x + box.w / 2;
	const y = box.y + box.h / 2;
	const name = node.name.toLowerCase();
	if (isHoleName(name)) {
		// <hole:K>, <hole:hexagon> name the hole's shape; a bare <hole> takes the tablet's.
		const holeType = holeFromName(node.name)?.id ?? ctx.holeType;
		// A letter cut through the tablet is its main feature: it fills most of the centre.
		const letter = /^[A-Z]$/.test(holeType);
		const k = letter ? 0.36 : 0.24;
		const cap = letter ? 0.5 : 0.36;
		const r = Math.min(ctx.rx * k, ctx.ry * k, box.w * cap, box.h * cap) * mods.scale;
		const [rotate, mirror] = holeTurn(holeType, mods.hole);
		ctx.marks.push({
			kind: 'symbol',
			name: `hole:${holeType}`,
			x,
			y,
			r,
			rotate,
			mirror,
			style: 'hole'
		});
		ctx.hole = { x, y, r };
		return;
	}
	if (name === 'orifice') {
		ctx.marks.push({ kind: 'symbol', name: 'orifice', x, y, r: 1.4, style: 'hole' });
		return;
	}
	const reach = Math.min(box.w, box.h) / 2;
	if (node.inner) {
		// A symbol with markings inside (`<circle: "5">`): its outline, and the markings within.
		const r = reach * 0.92;
		if (ENCLOSURES.has(name)) ctx.marks.push({ kind: 'symbol', name, x, y, r, style: 'outline' });
		const inner = r * (name === 'triangle' ? 0.8 : 1.15);
		layout(
			node.inner,
			{
				x: x - inner / 2,
				y: y - inner / 2 + (name === 'triangle' ? r * 0.18 : 0),
				w: inner,
				h: inner
			},
			ctx
		);
		ctx.anchors.set(`<${node.name}>`, { x, y, r });
		return;
	}
	const r = mods.fill ? reach * 0.9 : Math.min(ctx.maxSize * 0.5 * mods.scale, reach * 0.8);
	ctx.marks.push({ kind: 'symbol', name, x, y, r, style: 'fill' });
	ctx.anchors.set(`<${node.name}>`, { x, y, r });
}

/** A hole's turn and mirroring: V's point defaults to S, every other letter's top to N. */
function holeTurn(type: string, tag: Mods['hole']): [number, boolean] {
	const native = type === 'V' ? 180 : 0;
	return [tag?.deg === undefined ? 0 : tag.deg - native, !!tag?.mirrored];
}

// ── Located elements ─────────────────────────────────────────────────────────

/** One cell of a 3×3 grid over `box`; C is the whole box. */
function zoneBox(box: Box, zone: Zone): Box {
	if (zone === 'C') return box;
	const col = zone.includes('W') ? 0 : zone.includes('E') ? 2 : 1;
	const row = zone.includes('N') ? 0 : zone.includes('S') ? 2 : 1;
	// An edge zone spans the full other axis; a corner is one cell.
	const w = col === 1 ? box.w : box.w / 3;
	const h = row === 1 ? box.h : box.h / 3;
	return {
		x: box.x + (col === 2 ? box.w - w : col === 1 ? 0 : 0),
		y: box.y + (row === 2 ? box.h - h : 0),
		w,
		h
	};
}

/** Lay `node` out unrotated in a box turned `deg` about `box`'s centre, then turn its marks. */
function turned(node: Node, box: Box, deg: number, ctx: Ctx): void {
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	const quarter = Math.abs(Math.round(deg / 90)) % 2 === 1;
	const diagonal = Math.abs(deg % 90) > 1;
	const side = Math.min(box.w, box.h);
	const w = diagonal ? Math.hypot(box.w, box.h) * 0.75 : quarter ? box.h : box.w;
	const h = diagonal ? side * 0.4 : quarter ? box.w : box.h;
	const start = ctx.marks.length;
	layout(node, { x: cx - w / 2, y: cy - h / 2, w, h }, ctx);
	if (!deg) return;
	const rad = (deg * Math.PI) / 180;
	const turn = (x: number, y: number): [number, number] => [
		cx + (x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad),
		cy + (x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad)
	];
	for (let i = start; i < ctx.marks.length; i++) {
		const m = ctx.marks[i];
		if (m.kind === 'score') {
			const [x1, y1] = turn(m.x1, m.y1);
			const [x2, y2] = turn(m.x2, m.y2);
			ctx.marks[i] = { ...m, x1, y1, x2, y2 };
		} else if (m.kind === 'text' || m.kind === 'symbol') {
			const [x, y] = turn(m.x, m.y);
			ctx.marks[i] = { ...m, x, y, rotate: (m.rotate ?? 0) + deg };
		}
	}
}

function placeLocated(node: Node, mods: Mods, box: Box, ctx: Ctx): void {
	const loc = mods.loc!;
	const plain = bare(node);
	switch (loc.path) {
		case 'curve':
			if (loc.track === 'BAND') return layout(plain, box, ctx);
			ctx.deferred.push(() => placeOnTrack(plain, loc, mods, ctx));
			return;
		case 'line': {
			const at = zoneBox(box, loc.zone);
			return turned(keepSize(plain, mods), at, COMPASS_DEG[loc.heading] - 90, ctx);
		}
		case 'stack': {
			const column = zoneBox(box, loc.zone);
			const narrow = {
				...column,
				x: column.x + column.w / 2 - Math.min(column.w, box.w * 0.22) / 2,
				w: Math.min(column.w, box.w * 0.22)
			};
			const letters: Node =
				plain.k === 'text'
					? {
							k: 'stack',
							items: [...plain.v].filter((c) => c !== ' ').map((c) => ({ k: 'text', v: c }) as Node)
						}
					: plain;
			return layout(keepSize(letters, mods), narrow, ctx);
		}
		case 'section': {
			const at = loc.at;
			const part =
				loc.kind === 'HALF'
					? at === 'N'
						? { ...box, h: box.h / 2 }
						: at === 'S'
							? { ...box, y: box.y + box.h / 2, h: box.h / 2 }
							: at === 'W'
								? { ...box, w: box.w / 2 }
								: { ...box, x: box.x + box.w / 2, w: box.w / 2 }
					: loc.kind === 'QUAD'
						? {
								x: box.x + (at.includes('E') ? box.w / 2 : 0),
								y: box.y + (at.includes('S') ? box.h / 2 : 0),
								w: box.w / 2,
								h: box.h / 2
							}
						: at === 'N' || at === 'S' || (at === 'C' && box.h > box.w)
							? {
									...box,
									y: box.y + (at === 'N' ? 0 : at === 'C' ? box.h / 3 : (2 * box.h) / 3),
									h: box.h / 3
								}
							: {
									...box,
									x: box.x + (at === 'W' ? 0 : at === 'C' ? box.w / 3 : (2 * box.w) / 3),
									w: box.w / 3
								};
			return layout(keepSize(plain, mods), part, ctx);
		}
		case 'score': {
			// Relative to the score through the middle of this region.
			const { x, y, w, h } = box;
			const strip = (b: Box, deg = 0) =>
				turned(keepSize(plain, mods), b, deg, { ...ctx, maxSize: ctx.maxSize * 0.7 });
			if (loc.rel === 'ALONG') {
				// Hugging the score, which runs through the face's centre even when this
				// element already sits in one of the sections it divides.
				const t = ctx.maxSize * 0.75;
				if (loc.side === 'N') return strip({ x, y: ctx.cy - t - 1, w, h: t });
				if (loc.side === 'S') return strip({ x, y: ctx.cy + 1, w, h: t });
				if (loc.side === 'W') return strip({ x: ctx.cx - t - 1, y, w: t, h }, 90);
				return strip({ x: ctx.cx + 1, y, w: t, h }, 90);
			}
			if (loc.rel === 'END') {
				if (loc.side === 'N') return strip({ x, y, w, h: h * 0.2 });
				if (loc.side === 'S') return strip({ x, y: y + h * 0.8, w, h: h * 0.2 });
				if (loc.side === 'W') return strip({ x, y, w: w * 0.2, h });
				return strip({ x: x + w * 0.8, y, w: w * 0.2, h });
			}
			// ACROSS (the score runs through the glyphs) and GAP (in a break of it): on the centre line.
			return strip({ x: x + w * 0.25, y: y + h * 0.35, w: w * 0.5, h: h * 0.3 });
		}
		case 'capsule':
			return placeOnCapsule(plain, loc, mods, box, ctx);
		case 'band-across':
			return turned(plain, box, 90, ctx);
	}
}

/** The node with only its size modifiers, so placement doesn't recurse. */
const keepSize = (node: Node, mods: Mods): Node =>
	mods.fill
		? { ...node, mods: ['fill'] }
		: mods.scale < 1
			? { ...node, mods: ['small'] }
			: mods.scale > 1
				? { ...node, mods: ['large'] }
				: node;

// ── Curved tracks ────────────────────────────────────────────────────────────

/** A point at compass bearing `deg` on an ellipse. */
const onEllipse = (
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	deg: number
): [number, number] => {
	const rad = (deg * Math.PI) / 180;
	return [cx + rx * Math.sin(rad), cy - ry * Math.cos(rad)];
};

/** A polyline along an ellipse from `start`, `spanDeg` degrees in direction `dir`. */
function trackPath(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	start: number,
	spanDeg: number,
	dir: 'cw' | 'ccw'
): string {
	const steps = Math.max(2, Math.ceil(spanDeg / 3));
	const sign = dir === 'cw' ? 1 : -1;
	const points = Array.from({ length: steps + 1 }, (_, i) =>
		onEllipse(cx, cy, rx, ry, start + (sign * spanDeg * i) / steps)
			.map((v) => v.toFixed(2))
			.join(',')
	);
	return `M${points.join('L')}`;
}

/**
 * Text (or a symbol) along a rim arc, ring, mid-radius track, around the hole
 * or around another symbol. Travelling clockwise puts glyph tops outward and
 * counter-clockwise inward — SVG sets a glyph's top to the left of its path —
 * which is exactly ILN's letter-feet rule, so the route order alone decides it.
 */
function placeOnTrack(
	node: Node,
	loc: Extract<LocationCode, { path: 'curve' }>,
	mods: Mods,
	ctx: Ctx
): void {
	const info = describeLocation(loc);
	if (!info) return;
	let cx = ctx.cx;
	let cy = ctx.cy;
	let rx = ctx.rx;
	let ry = ctx.ry;
	let outward = false;
	if (loc.track === 'MID') {
		rx *= 0.62;
		ry *= 0.62;
	} else if (loc.track === 'HOLE' || loc.track === 'ORBIT') {
		const around = loc.track === 'HOLE' ? ctx.hole : ctx.anchors.get(loc.orbitOf ?? '');
		const r = around?.r ?? Math.min(rx, ry) * 0.18;
		cx = around?.x ?? cx;
		cy = around?.y ?? cy;
		rx = ry = r;
		outward = true;
	}
	const text = textOf(node);
	const mean = (rx + ry) / 2;
	const room = outward ? Math.min(ctx.rx, ctx.ry) - mean : Math.min(rx, ry);
	let size = mods.fill ? room * 0.42 : Math.min(ctx.maxSize * 0.62 * mods.scale, room * 0.36);
	const chars = Math.max(1, text.length);
	const toDeg = (length: number, radius: number) => (length / radius) * (180 / Math.PI);
	let spanDeg = info.spanDeg;
	if (spanDeg !== null && spanDeg < 360)
		size = Math.min(size, (((spanDeg * Math.PI) / 180) * mean * 0.92) / (chars * ADVANCE));
	// Centre the glyphs on the track: inset from the rim, out from a hole.
	const offset =
		loc.track === 'BEVEL' ? -size * 0.42 : outward ? size * 0.62 + 1 : -(size * 0.62 + 1.2);
	if (loc.track !== 'MID') {
		rx += offset;
		ry += offset;
	}
	const radius = (rx + ry) / 2;
	if (node.k === 'sym' && !node.inner) {
		// A symbol on a track sits at its centre, top pointing outward on a clockwise track.
		const [x, y] = onEllipse(cx, cy, rx, ry, info.centerDeg);
		ctx.marks.push({
			kind: 'symbol',
			name: node.name.toLowerCase(),
			x,
			y,
			r: size * 0.55,
			rotate: info.centerDeg + (info.dir === 'cw' ? 0 : 180),
			style: 'fill'
		});
		return;
	}
	if (!text) return;
	if (spanDeg === null) spanDeg = Math.min(340, toDeg(chars * ADVANCE * size * 1.08, radius));
	const ring = loc.ring || spanDeg >= 360;
	const start =
		ring || info.spanDeg !== null
			? info.startDeg
			: info.centerDeg - ((info.dir === 'cw' ? 1 : -1) * spanDeg) / 2;
	if (ring) size = Math.min(size, (2 * Math.PI * radius * 0.95) / (chars * ADVANCE));
	ctx.marks.push({
		kind: 'arc',
		d: trackPath(cx, cy, rx, ry, start, ring ? 359.5 : spanDeg, info.dir),
		size,
		text,
		anchor: ring ? 'start' : 'middle'
	});
}

// ── Capsules ─────────────────────────────────────────────────────────────────

/**
 * Where print turned `around` degrees about the capsule's long axis (0 = facing
 * the viewer) appears in the side view: its vertical offset from the half's
 * centre line, how much it is squashed vertically, and how visible it is.
 * Null when it faces away and can't be seen.
 */
export function projectAround(
	around: number,
	ry: number
): { dy: number; squash: number; opacity: number } | null {
	// Print on a cylinder seen side-on: at angle θ it sits ry·sin θ off the centre
	// line (positive turns it downward) and is foreshortened by cos θ. Past ~70°
	// it is a sliver too thin to read, so it is hidden rather than drawn as noise.
	const rad = (around * Math.PI) / 180;
	const squash = Math.cos(rad);
	if (squash < 0.34) return null;
	return { dy: ry * Math.sin(rad) * 0.8, squash, opacity: 0.55 + 0.45 * squash };
}

function placeOnCapsule(
	node: Node,
	loc: Extract<LocationCode, { path: 'capsule' }>,
	mods: Mods,
	box: Box,
	ctx: Ctx
): void {
	const parts = ctx.capsule;
	const half = !parts
		? box
		: loc.part === 'CAP'
			? parts.cap
			: loc.part === 'BODY'
				? parts.body
				: parts.whole;
	// TIP is the domed end, SEAM the overlap: the cap's tip is on the left, the body's on the right.
	const third = half.w / 3;
	const index =
		!loc.zone || loc.zone === 'MID' || loc.part === 'SPAN'
			? 1
			: (loc.zone === 'TIP') === (loc.part === 'CAP')
				? 0
				: 2;
	const zone =
		loc.zone && loc.part !== 'SPAN' ? { ...half, x: half.x + index * third, w: third } : half;
	const deg =
		loc.orient === 'AX<' ? 180 : loc.orient === 'RAD>N' ? -90 : loc.orient === 'RAD>S' ? 90 : 0;
	const base = (loc.around ?? 0) + (mods.back ? 180 : 0) + (parts?.turn ?? 0);
	const out = parts?.placed ?? ctx.marks;
	const sub: Ctx = { ...ctx, marks: [] };
	turned(
		keepSize(node, mods),
		loc.orient === 'RING' ? { ...zone, x: zone.x + zone.w * 0.3, w: zone.w * 0.4 } : zone,
		deg,
		sub
	);
	if (loc.orient === 'RING') {
		const x = zone.x + zone.w / 2;
		out.push({
			kind: 'score',
			x1: x - zone.w * 0.32,
			y1: half.y,
			x2: x - zone.w * 0.32,
			y2: half.y + half.h
		});
	}
	const cy = half.y + half.h / 2;
	for (let k = 0; k < mods.repeat; k++) {
		const view = projectAround(base + (360 * k) / mods.repeat, half.h / 2);
		if (!view) continue;
		for (const m of sub.marks) {
			if (m.kind === 'text')
				out.push({
					...m,
					y: cy + (m.y - cy) * view.squash + view.dy,
					scaleY: (m.scaleY ?? 1) * view.squash,
					opacity: view.opacity
				});
			else if (m.kind === 'symbol')
				out.push({ ...m, y: cy + (m.y - cy) * view.squash + view.dy, opacity: view.opacity });
			else out.push(m);
		}
	}
}

// ── Symbol outlines ──────────────────────────────────────────────────────────

const star = (points: number, inner: number) => (x: number, y: number, r: number) =>
	`M${Array.from({ length: points * 2 }, (_, i) => {
		const a = (Math.PI * i) / points - Math.PI / 2;
		const d = i % 2 ? r * inner : r;
		return `${(x + d * Math.cos(a)).toFixed(2)},${(y + d * Math.sin(a)).toFixed(2)}`;
	}).join('L')}z`;

const regular = (sides: number) => (x: number, y: number, r: number) =>
	`M${Array.from({ length: sides }, (_, i) => {
		const a = (2 * Math.PI * i) / sides - Math.PI / 2;
		return `${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`;
	}).join('L')}z`;

const circle = (x: number, y: number, r: number) =>
	`M${x - r},${y}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0z`;

/** Outlines drawn on a unit frame centred at 0,0 with radius 1, scaled into place. */
const UNIT: Record<string, string> = {
	heart:
		'M0,0.9L-0.85,0.05C-1.2,-0.35 -0.95,-0.95 -0.45,-0.95C-0.2,-0.95 -0.05,-0.75 0,-0.55C0.05,-0.75 0.2,-0.95 0.45,-0.95C0.95,-0.95 1.2,-0.35 0.85,0.05z',
	line: 'M-1,-0.16H1V0.16H-1z',
	moon: 'M0.3,-0.95A1,1 0 1 0 0.3,0.95A1.25,1.25 0 0 1 0.3,-0.95z',
	cross: 'M-0.3,-1H0.3V-0.3H1V0.3H0.3V1H-0.3V0.3H-1V-0.3H-0.3z',
	arrow: 'M0,-1L0.75,-0.1H0.28V1H-0.28V-0.1H-0.75z',
	oval: 'M-1,0A1,0.62 0 1 0 1,0A1,0.62 0 1 0 -1,0z',
	shield: 'M-0.8,-0.9H0.8V-0.1C0.8,0.4 0.4,0.75 0,1C-0.4,0.75 -0.8,0.4 -0.8,-0.1z'
};

/**
 * Letter holes, upright, as filled outlines on the unit frame. Cut from Oswald
 * Bold (SIL OFL): a bold condensed sans with flat sides, so each letter fills
 * its box. Every glyph is fitted to its own ink bounds (height -0.9..0.9, width
 * in proportion, at most -1..1) rather than its advance width, and keeps only
 * its outer contours: a hole cut through a tablet can't leave a floating island
 * inside a P or B, so the counters are cut out too.
 */
const LETTER_OUTLINES: Record<string, string> = {
	A: 'M-0.19,0.9L-0.56,0.9L-0.22,-0.9L0.23,-0.9L0.56,0.9L0.2,0.9L0.14,0.52L-0.13,0.52L-0.19,0.9',
	B: 'M0,0.9L-0.55,0.9L-0.55,-0.9L-0.08,-0.9Q0.04,-0.9 0.14,-0.88Q0.24,-0.86 0.32,-0.81Q0.4,-0.76 0.45,-0.67Q0.49,-0.58 0.49,-0.43L0.49,-0.43Q0.49,-0.32 0.46,-0.25Q0.43,-0.17 0.37,-0.13Q0.31,-0.08 0.23,-0.07L0.23,-0.07Q0.33,-0.05 0.4,0Q0.48,0.06 0.51,0.15Q0.55,0.24 0.55,0.37L0.55,0.37Q0.55,0.51 0.51,0.61Q0.48,0.71 0.41,0.77Q0.34,0.84 0.24,0.87Q0.14,0.9 0,0.9L0,0.9',
	C: 'M0.01,0.9L0.01,0.9Q-0.19,0.9 -0.3,0.83Q-0.42,0.76 -0.47,0.62Q-0.51,0.49 -0.51,0.32L-0.51,0.32L-0.51,-0.31Q-0.51,-0.5 -0.47,-0.63Q-0.42,-0.76 -0.3,-0.83Q-0.19,-0.9 0.01,-0.9L0.01,-0.9Q0.21,-0.9 0.31,-0.84Q0.42,-0.77 0.47,-0.66Q0.51,-0.54 0.51,-0.39L0.51,-0.39L0.51,-0.24L0.14,-0.24L0.14,-0.42Q0.14,-0.47 0.13,-0.52Q0.13,-0.57 0.1,-0.6Q0.07,-0.63 0.01,-0.63L0.01,-0.63Q-0.05,-0.63 -0.08,-0.6Q-0.11,-0.56 -0.12,-0.51Q-0.12,-0.47 -0.12,-0.41L-0.12,-0.41L-0.12,0.41Q-0.12,0.47 -0.11,0.52Q-0.1,0.57 -0.07,0.6Q-0.05,0.63 0.01,0.63L0.01,0.63Q0.07,0.63 0.1,0.59Q0.12,0.56 0.13,0.51Q0.14,0.46 0.14,0.41L0.14,0.41L0.14,0.23L0.51,0.23L0.51,0.38Q0.51,0.53 0.47,0.65Q0.43,0.76 0.32,0.83Q0.21,0.9 0.01,0.9',
	D: 'M-0.07,0.9L-0.53,0.9L-0.53,-0.9L-0.07,-0.9Q0.16,-0.9 0.29,-0.84Q0.42,-0.78 0.48,-0.66Q0.53,-0.53 0.53,-0.33L0.53,-0.33L0.53,0.32Q0.53,0.52 0.48,0.65Q0.42,0.78 0.29,0.84Q0.16,0.9 -0.07,0.9L-0.07,0.9',
	E: 'M0.41,0.9L-0.41,0.9L-0.41,-0.9L0.4,-0.9L0.4,-0.63L-0.01,-0.63L-0.01,-0.18L0.3,-0.18L0.3,0.09L-0.01,0.09L-0.01,0.63L0.41,0.63L0.41,0.9',
	F: 'M0.01,0.9L-0.39,0.9L-0.39,-0.9L0.39,-0.9L0.39,-0.63L0.01,-0.63L0.01,-0.18L0.34,-0.18L0.34,0.1L0.01,0.1L0.01,0.9',
	G: 'M-0.04,0.9L-0.04,0.9Q-0.22,0.9 -0.33,0.82Q-0.43,0.75 -0.48,0.61Q-0.52,0.47 -0.52,0.29L-0.52,0.29L-0.52,-0.29Q-0.52,-0.48 -0.47,-0.61Q-0.42,-0.75 -0.31,-0.83Q-0.19,-0.9 0.01,-0.9L0.01,-0.9Q0.2,-0.9 0.31,-0.84Q0.42,-0.77 0.47,-0.66Q0.52,-0.54 0.52,-0.39L0.52,-0.39L0.52,-0.28L0.14,-0.28L0.14,-0.42Q0.14,-0.47 0.13,-0.52Q0.12,-0.57 0.1,-0.6Q0.07,-0.63 0.01,-0.63L0.01,-0.63Q-0.05,-0.63 -0.08,-0.59Q-0.11,-0.56 -0.12,-0.51Q-0.12,-0.46 -0.12,-0.41L-0.12,-0.41L-0.12,0.4Q-0.12,0.46 -0.11,0.51Q-0.1,0.56 -0.07,0.59Q-0.04,0.63 0.02,0.63L0.02,0.63Q0.08,0.63 0.11,0.59Q0.15,0.56 0.16,0.51Q0.17,0.46 0.17,0.4L0.17,0.4L0.17,0.19L0.01,0.19L0.01,-0.03L0.52,-0.03L0.52,0.87L0.26,0.87L0.24,0.73Q0.21,0.8 0.14,0.85Q0.07,0.9 -0.04,0.9',
	H: 'M-0.14,0.9L-0.54,0.9L-0.54,-0.9L-0.14,-0.9L-0.14,-0.17L0.14,-0.17L0.14,-0.9L0.54,-0.9L0.54,0.9L0.14,0.9L0.14,0.11L-0.14,0.11L-0.14,0.9',
	I: 'M0.2,0.9L-0.2,0.9L-0.2,-0.9L0.2,-0.9L0.2,0.9',
	J: 'M-0.11,0.9L-0.3,0.9L-0.3,0.63Q-0.24,0.63 -0.2,0.62Q-0.16,0.62 -0.13,0.6Q-0.11,0.58 -0.1,0.54Q-0.09,0.51 -0.09,0.45L-0.09,0.45L-0.09,-0.9L0.3,-0.9L0.3,0.47Q0.3,0.61 0.26,0.71Q0.23,0.8 0.14,0.85Q0.05,0.9 -0.11,0.9L-0.11,0.9',
	K: 'M-0.15,0.9L-0.55,0.9L-0.55,-0.9L-0.15,-0.9L-0.15,-0.16L0.15,-0.9L0.54,-0.9L0.2,-0.09L0.55,0.9L0.15,0.9L-0.11,0.1L-0.15,0.18L-0.15,0.9',
	L: 'M0.41,0.9L-0.41,0.9L-0.41,-0.9L-0.01,-0.9L-0.01,0.63L0.41,0.63L0.41,0.9',
	M: 'M-0.37,0.9L-0.66,0.9L-0.62,-0.9L-0.2,-0.9L0,0.15L0.21,-0.9L0.62,-0.9L0.66,0.9L0.37,0.9L0.34,-0.3L0.13,0.9L-0.12,0.9L-0.34,-0.31L-0.37,0.9',
	N: 'M-0.15,0.9L-0.49,0.9L-0.49,-0.9L-0.21,-0.9L0.16,-0.03L0.16,-0.9L0.49,-0.9L0.49,0.9L0.22,0.9L-0.15,-0.03L-0.15,0.9',
	O: 'M0,0.9L0,0.9Q-0.2,0.9 -0.31,0.83Q-0.43,0.76 -0.48,0.63Q-0.53,0.5 -0.53,0.32L-0.53,0.32L-0.53,-0.33Q-0.53,-0.51 -0.48,-0.64Q-0.43,-0.76 -0.31,-0.83Q-0.2,-0.9 0,-0.9L0,-0.9Q0.2,-0.9 0.31,-0.83Q0.43,-0.76 0.48,-0.64Q0.53,-0.51 0.53,-0.33L0.53,-0.33L0.53,0.32Q0.53,0.5 0.48,0.63Q0.43,0.76 0.31,0.83Q0.2,0.9 0,0.9',
	P: 'M-0.14,0.9L-0.54,0.9L-0.54,-0.9L0.07,-0.9Q0.23,-0.9 0.33,-0.84Q0.44,-0.78 0.49,-0.66Q0.54,-0.54 0.54,-0.38L0.54,-0.38Q0.54,-0.17 0.47,-0.06Q0.4,0.05 0.28,0.09Q0.17,0.14 0.02,0.14L0.02,0.14L-0.14,0.14L-0.14,0.9',
	Q: 'M0.4,0.71L0.33,0.9Q0.29,0.88 0.24,0.84Q0.18,0.8 0.12,0.74Q0.07,0.69 0.03,0.63L0.03,0.63Q0.02,0.63 0.01,0.63L0.01,0.63L0,0.63Q-0.17,0.63 -0.27,0.57Q-0.36,0.51 -0.41,0.4Q-0.45,0.29 -0.45,0.14L-0.45,0.14L-0.45,-0.41Q-0.45,-0.57 -0.41,-0.68Q-0.36,-0.78 -0.27,-0.84Q-0.17,-0.9 0,-0.9L0,-0.9Q0.17,-0.9 0.27,-0.84Q0.36,-0.78 0.41,-0.68Q0.45,-0.57 0.45,-0.41L0.45,-0.41L0.45,0.14Q0.45,0.24 0.43,0.33Q0.41,0.41 0.37,0.48Q0.32,0.54 0.25,0.57L0.25,0.57Q0.28,0.6 0.3,0.63Q0.33,0.65 0.35,0.67Q0.38,0.69 0.4,0.71L0.4,0.71',
	R: 'M-0.16,0.9L-0.56,0.9L-0.56,-0.9L-0.06,-0.9Q0.12,-0.9 0.25,-0.86Q0.38,-0.82 0.46,-0.72Q0.53,-0.61 0.53,-0.42L0.53,-0.42Q0.53,-0.31 0.52,-0.23Q0.5,-0.14 0.45,-0.08Q0.4,-0.01 0.31,0.03L0.31,0.03L0.56,0.9L0.15,0.9L-0.05,0.09L-0.16,0.09L-0.16,0.9',
	S: 'M0.02,0.9L0.02,0.9Q-0.14,0.9 -0.25,0.84Q-0.36,0.78 -0.42,0.66Q-0.47,0.54 -0.48,0.34L-0.48,0.34L-0.15,0.29Q-0.15,0.41 -0.13,0.48Q-0.11,0.55 -0.08,0.58Q-0.04,0.61 0,0.61L0,0.61Q0.06,0.61 0.08,0.57Q0.1,0.52 0.1,0.48L0.1,0.48Q0.1,0.37 0.05,0.3Q0,0.22 -0.09,0.15L-0.09,0.15L-0.24,0.01Q-0.34,-0.07 -0.41,-0.18Q-0.48,-0.28 -0.48,-0.44L-0.48,-0.44Q-0.48,-0.66 -0.35,-0.78Q-0.22,-0.9 0.01,-0.9L0.01,-0.9Q0.15,-0.9 0.24,-0.85Q0.32,-0.8 0.37,-0.73Q0.41,-0.65 0.43,-0.57Q0.44,-0.48 0.45,-0.4L0.45,-0.4L0.11,-0.36Q0.11,-0.44 0.1,-0.5Q0.1,-0.55 0.07,-0.59Q0.05,-0.62 0,-0.62L0,-0.62Q-0.06,-0.62 -0.08,-0.57Q-0.1,-0.53 -0.1,-0.48L-0.1,-0.48Q-0.1,-0.38 -0.06,-0.32Q-0.01,-0.26 0.06,-0.19L0.06,-0.19L0.21,-0.07Q0.32,0.03 0.4,0.15Q0.48,0.28 0.48,0.46L0.48,0.46Q0.48,0.58 0.42,0.68Q0.37,0.78 0.27,0.84Q0.16,0.9 0.02,0.9',
	T: 'M0.2,0.9L-0.2,0.9L-0.2,-0.6L-0.47,-0.6L-0.47,-0.9L0.47,-0.9L0.47,-0.6L0.2,-0.6L0.2,0.9',
	U: 'M0,0.9L0,0.9Q-0.2,0.9 -0.32,0.83Q-0.43,0.77 -0.48,0.64Q-0.53,0.51 -0.53,0.32L-0.53,0.32L-0.53,-0.9L-0.14,-0.9L-0.14,0.38Q-0.14,0.44 -0.13,0.49Q-0.12,0.55 -0.09,0.58Q-0.06,0.62 0,0.62L0,0.62Q0.06,0.62 0.09,0.58Q0.12,0.55 0.13,0.49Q0.14,0.44 0.14,0.38L0.14,0.38L0.14,-0.9L0.53,-0.9L0.53,0.32Q0.53,0.51 0.48,0.64Q0.43,0.77 0.32,0.83Q0.2,0.9 0,0.9',
	V: 'M0.21,0.9L-0.21,0.9L-0.54,-0.9L-0.2,-0.9L0,0.32L0.18,-0.9L0.54,-0.9L0.21,0.9',
	W: 'M-0.15,0.9L-0.5,0.9L-0.71,-0.9L-0.38,-0.9L-0.27,0.15L-0.13,-0.9L0.13,-0.9L0.27,0.14L0.38,-0.9L0.71,-0.9L0.5,0.9L0.15,0.9L0,-0.19L-0.15,0.9',
	X: 'M-0.23,0.9L-0.56,0.9L-0.21,-0.07L-0.54,-0.9L-0.17,-0.9L0.03,-0.41L0.19,-0.9L0.52,-0.9L0.21,0.04L0.56,0.9L0.18,0.9L-0.04,0.36L-0.23,0.9',
	Y: 'M0.19,0.9L-0.19,0.9L-0.19,0.16L-0.53,-0.9L-0.15,-0.9L0.02,-0.33L0.17,-0.9L0.53,-0.9L0.19,0.16L0.19,0.9',
	Z: 'M0.42,0.9L-0.42,0.9L-0.42,0.66L0.02,-0.63L-0.4,-0.63L-0.4,-0.9L0.41,-0.9L0.41,-0.68L-0.03,0.63L0.42,0.63L0.42,0.9'
};

const letterOf = (name: string) => /^hole:([A-Z])$/.exec(name)?.[1];

/**
 * How far a hole's bevelled wall reaches out from the cut, in box units. A
 * letter's bevel is broad enough to fill the notches between its strokes (the
 * openings of a K or V), the way a pressed letter hole's chamfer does.
 */
export function holeBevel(mark: Extract<Mark, { kind: 'symbol' }>): number {
	return letterOf(mark.name) ? Math.max(2.8, mark.r * 0.8) : 2.8;
}

/** `d` for a symbol mark, turned and mirrored about its centre. */
export function symbolPath(mark: Extract<Mark, { kind: 'symbol' }>): string {
	const { x, y, r } = mark;
	const name = mark.name.replace(/^logo:.*/, 'logo').replace(/^hole:([a-z]+)$/, '$1');
	let d: string | null = null;
	switch (name) {
		case 'star':
			d = star(5, 0.45)(x, y, r);
			break;
		case 'triangle':
			d = regular(3)(x, y + r * 0.15, r);
			break;
		case 'diamond':
			d = regular(4)(x, y, r);
			break;
		case 'square':
			d = `M${x - r * 0.8},${y - r * 0.8}h${r * 1.6}v${r * 1.6}h${-r * 1.6}z`;
			break;
		case 'pentagon':
			d = regular(5)(x, y, r);
			break;
		case 'hexagon':
			d = regular(6)(x, y, r);
			break;
		case 'octagon':
			d = regular(8)(x, y, r);
			break;
		case 'circle':
		case 'dot':
		case 'hole:ROUND':
		case 'orifice':
			d = circle(x, y, name === 'dot' ? r * 0.5 : r);
			break;
	}
	if (d) return d;
	const unit = UNIT[name] ?? LETTER_OUTLINES[letterOf(name) ?? ''];
	// Unknown names, <logo>, <logo:…> and <symbol>: a four-point mark that says "a symbol is here".
	if (!unit) return star(4, 0.3)(x, y, r);
	return unitPath(unit, x, y, r);
}

/** A unit-frame path scaled by `r` and moved to (x, y). */
function unitPath(unit: string, x: number, y: number, r: number): string {
	const n = (v: string) => Number(v);
	const at = (a: string, b: string) => `${(x + n(a) * r).toFixed(2)},${(y + n(b) * r).toFixed(2)}`;
	// Arc segments first: their radii scale but don't move, and their endpoint moves.
	return unit
		.replace(
			/A(-?[\d.]+),(-?[\d.]+) (\d) (\d) (\d) (-?[\d.]+),(-?[\d.]+)/g,
			(
				_,
				rx: string,
				ry: string,
				rot: string,
				large: string,
				sweep: string,
				ex: string,
				ey: string
			) =>
				`A${(n(rx) * r).toFixed(2)} ${(n(ry) * r).toFixed(2)} ${rot} ${large} ${sweep} ${at(ex, ey).replace(',', ' ')}`
		)
		.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, a: string, b: string) => at(a, b))
		.replace(
			/([HV])(-?[\d.]+)/g,
			(_, axis: string, v: string) =>
				`${axis}${(axis === 'H' ? x + n(v) * r : y + n(v) * r).toFixed(2)}`
		);
}

/** The SVG transform that turns and mirrors a mark about its own centre. */
export function markTransform(mark: {
	x: number;
	y: number;
	rotate?: number;
	mirror?: boolean;
	scaleY?: number;
}): string | undefined {
	const parts = [
		mark.rotate
			? `rotate(${mark.rotate.toFixed(2)} ${mark.x.toFixed(2)} ${mark.y.toFixed(2)})`
			: '',
		mark.mirror || (mark.scaleY ?? 1) !== 1
			? `translate(${mark.x} ${mark.y}) scale(${mark.mirror ? -1 : 1} ${mark.scaleY ?? 1}) translate(${-mark.x} ${-mark.y})`
			: ''
	].filter(Boolean);
	return parts.length ? parts.join(' ') : undefined;
}

// ── Views ────────────────────────────────────────────────────────────────────

/** A see-through capsule half: the shell's tint (null when clear) over its contents. */
export interface ShellLook {
	tint: string | null;
	form: FillForm;
}

/** A capsule half's look from its color slot: the fill to paint, plus the shell when it is see-through. */
function shellOf(
	s: Surface | undefined,
	fallback: string
): { fill: string; look: ShellLook | null } {
	if (!s?.color || s.color === 'unknown') return { fill: fallback, look: null };
	try {
		const shell = parseShell(s.color);
		if (shell.kind === 'opaque') return { fill: swatchOf(shell.color!), look: null };
		return {
			fill: swatchOf(shell.contents!.color),
			look: { tint: shell.color ? swatchOf(shell.color) : null, form: shell.contents!.form }
		};
	} catch (e) {
		if (e instanceof ShellError) return { fill: swatchOf(s.color), look: null };
		throw e;
	}
}

export interface PillView {
	/** ILN surface label: F, B, E (the unrolled edge band), or CAPSULE for a two-piece capsule's one view. */
	label: string;
	/** Outline in the 100×100 box, and its extent there (centred on 50,50) after `rotate`. */
	path: string;
	width: number;
	height: number;
	/** Degrees the outline is turned about 50,50 to put a directional shape's feature where the face's tag says. */
	rotate: number;
	/** Fill per region, left to right: one for a tablet, cap then body for a capsule. */
	fills: string[];
	/** Per region like `fills`: a clear or translucent capsule half, whose `fills` entry is then its contents' color. */
	shells?: (ShellLook | null)[];
	/** Deboss (tablets) or printed ink (capsules, softgels). */
	finish: 'deboss' | 'ink';
	marks: Mark[];
}

export interface PillDrawing {
	guess: IlnGuess;
	views: PillView[];
	/** The photo layout the views were placed from, when one was used instead of the guess. */
	measured: PillImageLayout | null;
	/** The hand-saved ILN the views were drawn from, when the appearance carries one. */
	saved: string | null;
}

/** The `spl-to-iln` input for a decoded appearance. */
export const toSplAppearance = (
	appearance: PillAppearance,
	doseForm: string | null
): SplAppearance => ({
	dosageForm: doseForm ?? undefined,
	colors: appearance.colors.map((c) => c.toUpperCase()),
	shape: appearance.shape ?? undefined,
	sizeMm: appearance.sizeMm ?? undefined,
	score: appearance.score ?? undefined,
	imprint: appearance.imprint ?? undefined
});

/** The region a face's imprint may occupy: the outline's bounding box, inset. */
const faceBox = (width: number, height: number, inset: number): Box => ({
	x: 50 - (width * inset) / 2,
	y: 50 - (height * inset) / 2,
	w: width * inset,
	h: height * inset
});

/** Where each direction feature points in `shapeGeometry`'s own drawing of an outline. */
const DRAWN: Record<string, Partial<Record<Feature, number>>> = {
	TEAR: { TIP: 0 },
	BULLET: { TIP: 0 },
	'SEMI-CIRCLE': { FLAT: 180 },
	TRAPEZOID: { BASE: 180 },
	TRIANGLE: { TIP: 0, CORNER: 0 },
	SQUARE: { FLAT: 0, CORNER: 45 },
	DIAMOND: { CORNER: 0, FLAT: 45 },
	PENTAGON: { TIP: 0, CORNER: 0 },
	HEXAGON: { CORNER: 0, FLAT: 30 },
	HEPTAGON: { TIP: 0, CORNER: 0 },
	OCTAGON: { CORNER: 0, FLAT: 22.5 },
	HEART: { TIP: 180, LOBE: 0 },
	'U-SHAPE': { FLAT: 0 },
	SHIELD: { TIP: 180 },
	EGG: { TIP: 0 },
	CLOVER: { LOBE: 0 }
};

/** Degrees to turn a shape's drawn outline so its feature sits where the face's tag (or the shape's default) says. */
/** Odd-sided polygons: a vertex faces a flat side, so a straight score runs vertex to flat. */
const ODD_POLYGONS = new Set(['TRIANGLE', 'PENTAGON', 'HEPTAGON']);

/** The face's main score direction: its top-level score, or the first part of a `+` group. */
const primaryScore = (body: Node | null | undefined): '-' | '|' | null => {
	const main = body?.k === 'plus' ? body.items[0] : body;
	return main?.k === 'score' ? (main.dir === '|' ? '|' : '-') : null;
};

function outlineTurn(shape: string | null, tag: string | undefined, body?: Node | null): number {
	const def = findShape(shape ?? undefined);
	if (!def) return 0;
	let want = def.defaultOrient;
	// Untagged, a `-` score on an odd polygon starts from the vertex on the right.
	if (!tag && ODD_POLYGONS.has(def.id) && primaryScore(body) === '-')
		want = { feature: 'TIP', deg: 90 };
	if (tag) {
		try {
			want = parseShapeOrient(tag);
		} catch {
			// An unreadable tag keeps the default.
		}
	}
	const native = want ? DRAWN[def.id]?.[want.feature] : undefined;
	return want && native !== undefined ? (((want.deg - native) % 360) + 360) % 360 : 0;
}

function context(width: number, height: number, holeType = 'ROUND', uniform = false): Ctx {
	return {
		uniform,
		cx: 50,
		cy: 50,
		rx: width / 2,
		ry: height / 2,
		maxSize: Math.min(width, height) * 0.3,
		marks: [],
		holeType,
		anchors: new Map(),
		deferred: []
	};
}

function finish(ctx: Ctx): Mark[] {
	for (const run of ctx.deferred) run();
	uniformSizes(ctx.uniform ? ctx.marks : [], ctx.marks);
	return keepOffHoles(ctx.marks);
}

/**
 * Bring every unmodified string down to the smallest of their sizes, so a face reads as
 * one typeface size; strings marked small, large or fill keep their own. `pool` holds the
 * strings to equalize (empty when the preference is off); `all` is stripped of the flag.
 */
function uniformSizes(pool: Mark[], all: Mark[]): void {
	const auto = pool.filter(
		(m): m is Extract<Mark, { kind: 'text' }> => m.kind === 'text' && !!m.auto
	);
	const size = Math.min(...auto.map((m) => m.size));
	for (const mark of auto) mark.size = size;
	for (const mark of all) if (mark.kind === 'text') delete mark.auto;
}

export interface DrawOptions {
	/** Same size for every string on a face that has no size modifier of its own. */
	uniformText?: boolean;
}

/**
 * A two-piece capsule's outline: the stated shape when it is a (possibly
 * proportioned) capsule outline, so `LONG CAPSULE` draws a longer shell.
 */
const capsuleOutline = (shape: string | null): string =>
	shape && findShape(shape)?.id === 'CAPSULE' ? shape : 'CAPSULE';

/**
 * Guess the imprint layout for an appearance and lay out every view of it.
 *
 * A tablet or softgel gets a front and a back; the back is dropped only when
 * both are blank, since one plain outline says as much. A marked edge band
 * adds an unrolled strip. A two-piece capsule gets one view with cap and body
 * side by side and the seam between them.
 */
export function drawPill(
	appearance: PillAppearance,
	doseForm: string | null,
	measured: PillImageLayout | null = null,
	{ uniformText = false }: DrawOptions = {}
): PillDrawing {
	const guess = guessIln(toSplAppearance(appearance, doseForm));
	// Notation saved by hand outranks both the photo and the guess; a
	// high-confidence guess outranks the photo, whose measurement can misplace marks.
	const saved = appearance.iln && validateIln(appearance.iln).ok ? appearance.iln : null;
	if (!saved && guess.confidence !== 'high' && measured?.faces.length)
		return { guess, measured, saved: null, views: measuredViews(appearance, guess, measured) };
	const surfaces = parseIln(saved ?? guess.iln);
	const fill = swatchOf(appearance.colors[0] ?? '');
	const colorOf = (s: Surface | undefined, fallback: string) =>
		s?.color && s.color !== 'unknown' ? swatchOf(s.color) : fallback;
	const by = (label: string) => surfaces.find((s) => s.label === label);

	if (guess.form === 'capsule' || surfaces.some((s) => s.label === 'CAP' || s.label === 'BODY')) {
		const geometry = shapeGeometry(capsuleOutline(appearance.shape));
		const whole = faceBox(geometry.width, geometry.height, 0.82);
		const cap = { ...whole, w: whole.w / 2 - 2 };
		const body = { ...whole, x: whole.x + whole.w / 2 + 2, w: whole.w / 2 - 2 };
		const ctx = {
			...context(geometry.width, geometry.height, 'ROUND', uniformText),
			maxSize: whole.h * 0.5,
			capsule: { cap, body, whole }
		};
		layout(by('CAP')?.body ?? null, cap, ctx);
		layout(by('BODY')?.body ?? null, body, ctx);
		layout(by('CAP+BODY')?.body ?? null, whole, ctx);
		// The same capsule turned 180° about its long axis: print facing away from
		// the front view (`AX@back`, the far side of a radial repeat) shows here.
		const back: Mark[] = [];
		const backCtx = { ...ctx, marks: [], capsule: { cap, body, whole, turn: 180, placed: back } };
		layout(by('CAP')?.body ?? null, cap, backCtx);
		layout(by('BODY')?.body ?? null, body, backCtx);
		layout(by('CAP+BODY')?.body ?? null, whole, backCtx);
		finish(backCtx);
		uniformSizes(uniformText ? back : [], back);
		const [capFill, bodyFill = capFill] = appearance.colors.length
			? appearance.colors.map(swatchOf)
			: [fill];
		const halves = [shellOf(by('CAP'), capFill), shellOf(by('BODY'), bodyFill)];
		const fills = halves.map((h) => h.fill);
		const shells = halves.some((h) => h.look) ? { shells: halves.map((h) => h.look) } : {};
		return {
			guess,
			measured: null,
			saved,
			views: [
				{
					label: 'CAPSULE',
					path: geometry.path,
					width: geometry.width,
					height: geometry.height,
					rotate: 0,
					fills,
					...shells,
					finish: 'ink',
					marks: finish(ctx)
				},
				...(back.length
					? [
							{
								label: 'CAPSULE-BACK',
								path: geometry.path,
								width: geometry.width,
								height: geometry.height,
								rotate: 0,
								fills,
								...shells,
								finish: 'ink' as const,
								marks: back
							}
						]
					: [])
			]
		};
	}

	const geometry = shapeGeometry(appearance.shape);
	const ink = guess.form === 'softgel' ? 'ink' : 'deboss';
	const faces = surfaces.filter((s) => s.label === 'F' || s.label === 'B');
	const shownFaces = faces.every((s) => !s.body) && !geometry.hole ? faces.slice(0, 1) : faces;
	const views: PillView[] = shownFaces.map((s) => {
		const rotate = outlineTurn(appearance.shape, s.orient, s.body);
		const quarter = rotate % 180 === 90;
		const width = quarter ? geometry.height : geometry.width;
		const height = quarter ? geometry.width : geometry.height;
		const ctx = context(width, height, geometry.hole ?? 'ROUND', uniformText);
		// A through-hole the shape itself carries is cut whether or not the notation places it.
		const placesHole = /"name":"hole[:"]/i.test(JSON.stringify(s.body ?? ''));
		if (geometry.hole && !placesHole)
			layout(
				{ k: 'sym', name: 'hole' },
				faceBox(width, height, /^[A-Z]$/.test(geometry.hole) ? 0.8 : 0.5),
				ctx
			);
		// Text keeps to an inset box clear of the curved edge; score lines are drawn edge to edge.
		const face = faceBox(width, height, 0.8);
		if (s.body && s.body.k !== 'plus') layoutAroundHole(s.body, face, ctx);
		else layout(s.body, face, ctx);
		return {
			label: s.label,
			path: geometry.path,
			width,
			height,
			rotate,
			fills: [colorOf(s, fill)],
			finish: ink,
			marks: finish(ctx)
		};
	});

	const edge = by('E');
	if (edge?.body) views.push(edgeView(edge, colorOf(edge, fill), ink, uniformText));
	return { guess, measured: null, saved, views };
}

/**
 * The side wall unrolled into a strip, N at the centre as seen from the front
 * and the front's side at the top. A BAND code places text by its bearing;
 * letter bottoms point toward the back unless the code says `feet F`.
 */
function edgeView(
	surface: Surface,
	color: string,
	ink: PillView['finish'],
	uniform = false
): PillView {
	const width = 96;
	const height = 22;
	const ctx = { ...context(width, height, 'ROUND', uniform), maxSize: height * 0.62 };
	const strip = faceBox(width, height, 0.9);
	const items =
		surface.body?.k === 'plus' ? surface.body.items : surface.body ? [surface.body] : [];
	for (const item of items) {
		const mods = modsOf(item);
		const loc = mods.loc;
		const plain = keepSize(bare(item), mods);
		if (loc?.path === 'curve' && loc.track === 'BAND') {
			const info = describeLocation(loc)!;
			const centre = ((((info.centerDeg + 180) % 360) + 360) % 360) - 180;
			const box =
				loc.ring || info.spanDeg === null
					? strip
					: { ...strip, w: Math.max(12, (strip.w * (info.spanDeg ?? 90)) / 360) };
			const x = 50 + (centre / 360) * strip.w;
			const at = loc.ring ? strip : { ...box, x: x - box.w / 2 };
			turned(plain, at, loc.feet === 'F' ? 180 : 0, ctx);
		} else if (loc?.path === 'band-across') {
			const centre = ((((loc.at + 180) % 360) + 360) % 360) - 180;
			const x = 50 + (centre / 360) * strip.w;
			turned(plain, { x: x - 6, y: strip.y, w: 12, h: strip.h }, 90, ctx);
		} else layout(plain, strip, ctx);
	}
	const r = 4;
	const x = 50 - width / 2;
	const y = 50 - height / 2;
	const path = `M${x + r},${y}h${width - 2 * r}q${r},0 ${r},${r}v${height - 2 * r}q0,${r} ${-r},${r}h${-(width - 2 * r)}q${-r},0 ${-r},${-r}v${-(height - 2 * r)}q0,${-r} ${r},${-r}z`;
	return {
		label: 'E',
		path,
		width,
		height,
		rotate: 0,
		fills: [color],
		finish: ink,
		marks: finish(ctx)
	};
}

// ── Views from a measured photo ──────────────────────────────────────────────

/**
 * Lay out views where the label's photo shows the imprint, instead of where
 * the notation's guess would put it.
 *
 * The photo's measurements are fractions of each face's bounding box, in a
 * frame turned so a long face runs left to right — the same way
 * `shapeGeometry` draws an outline — so a fraction maps straight onto the
 * outline's box. Colours stay the label's: a studio photo under grey light
 * makes every white tablet a dull grey, so the photo's colour is used only
 * where the label states none.
 */
function measuredViews(
	appearance: PillAppearance,
	guess: IlnGuess,
	layout: PillImageLayout
): PillView[] {
	const capsule = guess.form === 'capsule';
	const geometry = shapeGeometry(capsule ? capsuleOutline(appearance.shape) : appearance.shape);
	const box = faceBox(geometry.width, geometry.height, 1);
	const finish = guess.form === 'tablet' ? 'deboss' : 'ink';
	// A capsule is one view: the photographed side with the imprint on it.
	const faces = capsule
		? [[...layout.faces].sort((a, b) => b.elements.length - a.elements.length)[0]]
		: layout.faces.slice(0, 2);
	return faces.map((face, index) => ({
		label: capsule ? 'CAPSULE' : index === 0 ? 'F' : 'B',
		path: geometry.path,
		width: geometry.width,
		height: geometry.height,
		rotate: 0,
		fills: fillsFor(appearance, face, capsule),
		finish,
		marks: measuredMarks(face, box)
	}));
}

function fillsFor(appearance: PillAppearance, face: MeasuredFace, capsule: boolean): string[] {
	if (!appearance.colors.length) return capsule ? [...face.halves] : [face.fill];
	const [cap, body = cap] = appearance.colors.map(swatchOf);
	return capsule ? [cap, body] : [cap];
}

function measuredMarks(face: MeasuredFace, box: Box): Mark[] {
	const marks: Mark[] = face.scores.map((score) =>
		score.dir === 'v'
			? {
					kind: 'score',
					x1: box.x + score.at * box.w,
					y1: box.y,
					x2: box.x + score.at * box.w,
					y2: box.y + box.h
				}
			: {
					kind: 'score',
					x1: box.x,
					y1: box.y + score.at * box.h,
					x2: box.x + box.w,
					y2: box.y + score.at * box.h
				}
	);
	for (const element of face.elements) {
		// Glyphs are drawn centred, so the box's centre is the text's. Size
		// comes from the box's height (a cap height is ~0.72 em), not its
		// width: a debossed glyph is often found by one shadowed edge only,
		// which measures its height truly and its width far too narrow. The
		// face's own width is the only cap.
		const height = element.h * box.h;
		const chars = Math.max(1, element.text.length);
		const size = Math.min(height / 0.72, (box.w * 0.9) / (chars * 0.62));
		marks.push({
			kind: 'text',
			x: box.x + element.x * box.w,
			y: box.y + element.y * box.h,
			size,
			text: element.text
		});
	}
	return marks;
}
