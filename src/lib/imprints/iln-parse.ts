/**
 * Read ILN strings back in.
 *
 * | Function | Does |
 * | --- | --- |
 * | {@link parseIln} | string → `Surface[]`; throws {@link IlnSyntaxError} with column and caret |
 * | {@link validateIln} | syntax and semantic checks → `{ ok, surfaces, issues }` |
 * | {@link formatIln} | canonical rewrite: legacy modifiers → location codes, surface order, defaults dropped |
 * | {@link explainIln} | plain-English description, one line per surface |
 *
 * See `docs/iln.md` for the notation itself.
 *
 * @module
 */

import { type Node, serializeSurfaces, type Surface } from './spl-to-iln.ts';
import {
	describeLocation,
	formatLocation,
	formatPoint,
	type LocationCode,
	LocationError,
	parseLocation,
	parseModifiers,
	tryParseLocation
} from './iln-location.ts';
import {
	checkHoleOrient,
	checkShapeOrient,
	describeHoleOrient,
	describeShapeOrient,
	findHole,
	holeFromName,
	isHoleName,
	checkShapeProportion,
	findShape,
	formatHoleOrient,
	formatShapeOrient,
	type HoleDef,
	isDefaultHoleOrient,
	isDefaultOrient,
	isHoleTagToken,
	parseHoleOrient,
	parseShapeOrient,
	type ShapeDef
} from './shapes.ts';
import { describeShell, formatShell, parseShell, ShellError } from './capsule-shell.ts';

/** Split a <hole> node's modifiers into its direction tag and everything else. */
function splitHoleMods(n: Node): { tag: string[]; rest: string[] } {
	const mods = n.mods ?? [];
	if (n.k !== 'sym' || !isHoleName(n.name)) return { tag: [], rest: mods };
	return { tag: mods.filter(isHoleTagToken), rest: mods.filter((m) => !isHoleTagToken(m)) };
}

// ───────────────────────── Parser ─────────────────────────

export class IlnSyntaxError extends Error {
	readonly column: number;
	constructor(message: string, index: number, src: string) {
		super(`${message} at column ${index + 1}\n  ${src}\n  ${' '.repeat(index)}^`);
		this.name = 'IlnSyntaxError';
		this.column = index + 1;
	}
}

const LABEL_RE = /^(CAP\+BODY|CAP|BODY|F|B|E)(?![\w+])/;

/** Split a modifier list on commas outside (), <>. */
export function splitMods(raw: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of raw) {
		if (ch === '(' || ch === '<') depth++;
		else if ((ch === ')' || ch === '>') && depth > 0) depth--;
		if (ch === ',' && depth === 0) {
			out.push(cur.trim());
			cur = '';
		} else cur += ch;
	}
	out.push(cur.trim());
	return out.filter(Boolean);
}

class Parser {
	private i = 0;
	private readonly src: string;
	constructor(src: string) {
		this.src = src;
	}

	marking(): Surface[] {
		const out = [this.surface()];
		while (this.eat(';')) out.push(this.surface());
		if (this.peek() !== undefined) this.fail('Unexpected text');
		return out;
	}

	private ws() {
		while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++;
	}

	private peek(): string | undefined {
		this.ws();
		return this.src[this.i];
	}

	private eat(ch: string): boolean {
		if (this.peek() === ch) {
			this.i++;
			return true;
		}
		return false;
	}

	private expect(ch: string) {
		if (!this.eat(ch)) this.fail(`Expected "${ch}"`);
	}

	private fail(msg: string, at = this.i): never {
		throw new IlnSyntaxError(msg, at, this.src);
	}

	private atBlank(): boolean {
		return /^blank(?![\w])/.test(this.src.slice(this.i));
	}

	private surface(): Surface {
		this.ws();
		const m = LABEL_RE.exec(this.src.slice(this.i));
		if (!m) this.fail('Expected a surface label (F, B, E, CAP, BODY or CAP+BODY)');
		this.i += m[1].length;
		let color: string | undefined;
		if (this.src[this.i] === '(') {
			const close = this.src.indexOf(')', this.i);
			if (close < 0) this.fail('Unclosed "(" in surface color');
			color = this.src.slice(this.i + 1, close).trim();
			if (!color) this.fail('Empty surface color', this.i + 1);
			this.i = close + 1;
		}
		let orient: string | undefined;
		if (this.src[this.i] === '[') {
			const close = this.src.indexOf(']', this.i);
			if (close < 0) this.fail('Unclosed "[" in shape direction tag');
			try {
				orient = formatShapeOrient(parseShapeOrient(this.src.slice(this.i + 1, close)));
			} catch (e) {
				this.fail(e instanceof Error ? e.message : String(e), this.i + 1);
			}
			this.i = close + 1;
		}
		this.expect(':');
		const body = this.layout();
		return {
			label: m[1],
			...(color ? { color } : {}),
			...(orient ? { orient } : {}),
			body: body.k === 'blank' && !body.mods ? null : body
		};
	}

	private layout(): Node {
		const items = [this.scored()];
		while (this.eat('+')) items.push(this.scored());
		return items.length === 1 ? items[0] : { k: 'plus', items };
	}

	private scored(): Node {
		const first = this.stack();
		const op = this.peek();
		if (op !== '|' && op !== '-') return first;
		const items = [first];
		for (;;) {
			const c = this.peek();
			if (c === op) {
				this.i++;
				items.push(this.stack());
			} else if (c === '|' || c === '-') {
				this.fail('Mixing "|" and "-" needs parentheses, e.g. ("A" | "B") - ("C" | "D")');
			} else break;
		}
		return { k: 'score', dir: op, items };
	}

	private stack(): Node {
		const items = [this.line()];
		while (this.eat('/')) items.push(this.line());
		return items.length === 1 ? items[0] : { k: 'stack', items };
	}

	private line(): Node {
		const items = [this.item()];
		for (;;) {
			const c = this.peek();
			if (c === '"' || c === '<' || c === '(' || this.atBlank()) items.push(this.item());
			else break;
		}
		return items.length === 1 ? items[0] : { k: 'line', items };
	}

	private item(): Node {
		const node = this.atom();
		if (this.peek() === '[') {
			const open = this.i;
			const close = this.src.indexOf(']', open);
			if (close < 0) this.fail('Unclosed "["', open);
			node.mods = splitMods(this.src.slice(open + 1, close));
			this.i = close + 1;
		}
		return node;
	}

	private atom(): Node {
		const c = this.peek();
		if (c === '"') return this.text();
		if (c === '<') return this.symbol();
		if (c === '(') {
			this.i++;
			const inner = this.layout();
			this.expect(')');
			return inner;
		}
		if (this.atBlank()) {
			this.i += 5;
			return { k: 'blank' };
		}
		return this.fail('Expected text, a symbol, "(" or blank');
	}

	private text(): Node {
		const start = this.i;
		this.i++; // opening quote
		let v = '';
		while (this.i < this.src.length) {
			const ch = this.src[this.i];
			if (ch === '"') {
				this.i++;
				return { k: 'text', v };
			}
			if (ch === '\\') {
				const nx = this.src[this.i + 1];
				if (nx === '"' || nx === '\\') v += nx;
				else if (nx === '?') v += '\uFFFD';
				else this.fail(`Unknown escape "\\${nx ?? ''}" (use \\" \\\\ or \\?)`);
				this.i += 2;
			} else {
				v += ch;
				this.i++;
			}
		}
		return this.fail('Unterminated text (missing closing ")', start);
	}

	private symbol(): Node {
		this.i++; // <
		const m = /^[A-Za-z][\w-]*/.exec(this.src.slice(this.i));
		if (!m) this.fail('Expected a symbol name after "<"');
		this.i += m[0].length;
		let name = m[0];
		let inner: Node | undefined;
		if (this.src[this.i] === ':') {
			if (/\s/.test(this.src[this.i + 1] ?? '')) {
				// <name: layout>  (containment; note the space)
				this.i++;
				inner = this.layout();
			} else {
				// <logo:Teva>  (qualified name)
				const close = this.src.indexOf('>', this.i);
				if (close < 0) this.fail('Expected ">"');
				name += this.src.slice(this.i, close);
				this.i = close;
			}
		}
		this.expect('>');
		return inner ? { k: 'sym', name, inner } : { k: 'sym', name };
	}
}

export function parseIln(src: string): Surface[] {
	return new Parser(src).marking();
}

// ───────────────────────── Modifier analysis ─────────────────────────

const PLAIN_MOD = /^(small|large|fill|back|x\d+)$/;
const LEGACY_MOD =
	/^(arc|ring|vert|cw|ccw|r\d{1,3}|top|bottom|left|right|center|top-left|top-right|bottom-left|bottom-right)$/i;
const LOOKS_LIKE_CODE = /[:@>.]|^(LINE|STACK)$/;
/** How a marking is applied: cut in, raised, or printed. */
export const METHOD_MOD = /^(deboss|emboss|print)$/;
/** Ink for a printed marking: a color word (`ink:black`, `ink:dark blue`) or hex (`ink:#1a3c8f`). */
export const INK_MOD = /^ink:([a-z][a-z ]*[a-z]|[a-z]|#[0-9a-f]{3}|#[0-9a-f]{6})$/i;

/** The marking method and ink an element's own modifiers set; `ink:` alone implies `print`. */
export function markingStyle(mods: string[] | undefined): {
	method?: 'deboss' | 'emboss' | 'print';
	ink?: string;
} {
	const method = mods?.find((m) => METHOD_MOD.test(m)) as 'deboss' | 'emboss' | 'print' | undefined;
	const ink = mods?.map((m) => INK_MOD.exec(m)?.[1]).find(Boolean);
	return {
		method: method ?? (ink ? 'print' : undefined),
		...(ink ? { ink: ink.toLowerCase() } : {})
	};
}

interface ModAnalysis {
	location?: LocationCode;
	errors: string[];
	warnings: string[];
}

function analyzeMods(mods: string[]): ModAnalysis {
	const out: ModAnalysis = { errors: [], warnings: [] };
	const legacy: string[] = [];
	for (const m of mods) {
		const loc = tryParseLocation(m);
		if (loc) {
			if (out.location) out.errors.push(`More than one location code ("${m}")`);
			else out.location = loc;
		} else if (PLAIN_MOD.test(m) || METHOD_MOD.test(m) || INK_MOD.test(m)) {
			// fine
		} else if (/^ink\b/i.test(m)) {
			out.errors.push(`Bad ink "${m}"; write ink:<color>, e.g. ink:black or ink:#1a3c8f`);
		} else if (LEGACY_MOD.test(m)) {
			legacy.push(m);
		} else if (LOOKS_LIKE_CODE.test(m)) {
			try {
				parseLocation(m);
			} catch (e) {
				out.errors.push(e instanceof LocationError ? e.message : String(e));
			}
		} else {
			out.warnings.push(`Unknown modifier "${m}"`);
		}
	}
	if (legacy.length) {
		const translated = parseModifiers(legacy.join(', ')).location;
		out.warnings.push(
			translated
				? `Legacy modifier(s) [${legacy.join(', ')}]; write ${formatLocation(translated)} instead`
				: `Legacy modifier(s) [${legacy.join(', ')}]`
		);
		if (!out.location && translated) out.location = translated;
	}
	return out;
}

/** In-flow locations: horizontal LINE text. Everything else should be attached with "+". */
const isFlowLocation = (loc: LocationCode) => loc.path === 'line' && loc.heading === 'E';

// ───────────────────────── Validation ─────────────────────────

export interface Issue {
	level: 'error' | 'warning';
	message: string;
	surface?: string;
}

export interface ValidationResult {
	/** True when there are no errors; warnings are allowed. */
	ok: boolean;
	surfaces?: Surface[];
	issues: Issue[];
}

const TABLET_LABELS = ['F', 'B', 'E'];
const CAPSULE_LABELS = ['CAP', 'BODY', 'CAP+BODY'];

function children(n: Node): Node[] {
	if (n.k === 'sym') return n.inner ? [n.inner] : [];
	return 'items' in n ? n.items : [];
}

const hasText = (n: Node | null): boolean => !!n && (n.k === 'text' || children(n).some(hasText));

function markedWeight(n: Node | null): number {
	if (!n) return 0;
	if (n.k === 'text') return n.v.replace(/\s/g, '').length;
	if (n.k === 'sym') return (isHoleName(n.name) ? 0 : 1) + markedWeight(n.inner ?? null);
	return children(n).reduce((s, c) => s + markedWeight(c), 0);
}

function symbolNames(n: Node | null, acc = new Set<string>()): Set<string> {
	if (!n) return acc;
	if (n.k === 'sym') acc.add(isHoleName(n.name) ? '<hole>' : `<${n.name}>`);
	for (const c of children(n)) symbolNames(c, acc);
	return acc;
}

export interface IlnOptions {
	/** SPL shape term, NCI code or ILN extension name; when given, enables shape checks. */
	shape?: string;
}

export function validateIln(src: string, opts: IlnOptions = {}): ValidationResult {
	let surfaces: Surface[];
	try {
		surfaces = parseIln(src);
	} catch (e) {
		return {
			ok: false,
			issues: [{ level: 'error', message: e instanceof Error ? e.message : String(e) }]
		};
	}
	const issues: Issue[] = [];
	const add = (level: Issue['level'], message: string, surface?: string) =>
		issues.push({ level, message, ...(surface ? { surface } : {}) });

	// Surface set
	const labels = surfaces.map((s) => s.label);
	const seen = new Set<string>();
	for (const l of labels) {
		if (seen.has(l)) add('error', `Duplicate surface ${l}`, l);
		seen.add(l);
	}
	const tablet = labels.some((l) => TABLET_LABELS.includes(l));
	const capsule = labels.some((l) => CAPSULE_LABELS.includes(l));
	if (tablet && capsule)
		add('error', 'Cannot mix tablet surfaces (F/B/E) with capsule surfaces (CAP/BODY)');
	if (tablet && !capsule) {
		for (const l of ['F', 'B'])
			if (!seen.has(l))
				add('warning', `Surface ${l} is missing; list it as "${l}: blank" if unmarked`);
		const f = surfaces.find((s) => s.label === 'F');
		const b = surfaces.find((s) => s.label === 'B');
		if (f && b && markedWeight(b.body) > markedWeight(f.body)) {
			add('warning', 'B has more marked characters than F; by the F/B rule, swap them');
		}
	}
	if (capsule && !tablet) {
		for (const l of ['CAP', 'BODY'])
			if (!seen.has(l))
				add('warning', `Surface ${l} is missing; list it as "${l}(color): blank" if unprinted`);
		for (const s of surfaces) {
			if ((s.label === 'CAP' || s.label === 'BODY') && !s.color)
				add('warning', `${s.label} should state its color, e.g. ${s.label}(white)`, s.label);
			if ((s.label === 'CAP' || s.label === 'BODY') && s.color) {
				try {
					parseShell(s.color);
				} catch (e) {
					if (!(e instanceof ShellError)) throw e;
					add('error', `${s.label}: ${e.message}`, s.label);
				}
			}
		}
	}

	// Shape direction tags
	const shape = opts.shape ? findShape(opts.shape) : undefined;
	if (opts.shape && !shape)
		add(
			'warning',
			`Unknown shape "${opts.shape}"; shape checks skipped (run "shapes" to list known shapes)`
		);
	if (shape) checkShapeProportion(opts.shape!).forEach((m) => add('error', m));
	for (const s of surfaces) {
		if (!s.orient) continue;
		if (s.label !== 'F' && s.label !== 'B') {
			add('error', `Shape direction tags apply to faces (F/B), not ${s.label}`, s.label);
		} else {
			if (shape)
				checkShapeOrient(shape, parseShapeOrient(s.orient)).forEach((m) =>
					add('error', m, s.label)
				);
			if (!hasText(s.body)) {
				add(
					'warning',
					`Face ${s.label} has no text, so it is oriented by the shape's default direction; drop the tag`,
					s.label
				);
			}
		}
	}

	// Node walk
	let hole: HoleDef | undefined = shape?.hole ? findHole(shape.hole) : undefined;
	const holeMirrored = new Map<string, boolean>(); // face label → mirrored, for faces with a hole tag
	const named = new Set<string>(); // faces whose <hole:…> names its shape
	for (const s of surfaces) {
		const walk = (n: Node) => {
			if (n.k === 'sym' && isHoleName(n.name)) {
				const def = holeFromName(n.name);
				if (def === null) add('error', `Unknown hole shape in <${n.name}>`, s.label);
				else if (def) {
					if (hole && named.size && hole.id !== def.id)
						add(
							'error',
							`The hole goes through the tablet, so every face names the same shape`,
							s.label
						);
					hole = def;
					named.add(s.label);
				}
			}
			children(n).forEach(walk);
		};
		if (s.body) walk(s.body);
	}
	for (const s of surfaces) {
		const symbols = symbolNames(s.body);
		if (shape && !shape.hole && symbols.has('<hole>') && !named.has(s.label)) {
			add('warning', `<hole> used, but ${shape.label} has no hole`, s.label);
		}
		const walk = (n: Node, parent: Node['k'] | 'root') => {
			const { tag, rest } = splitHoleMods(n);
			if (tag.length) {
				try {
					const o = parseHoleOrient(tag.join(', '));
					const own = n.k === 'sym' ? holeFromName(n.name) : undefined;
					const h = own ?? hole;
					if (h) checkHoleOrient(h, o).forEach((m) => add('error', m, s.label));
					holeMirrored.set(s.label, o.mirrored);
				} catch (e) {
					add('error', e instanceof Error ? e.message : String(e), s.label);
				}
			}
			if (rest.length) {
				const a = analyzeMods(rest);
				a.errors.forEach((m) => add('error', m, s.label));
				a.warnings.forEach((m) => add('warning', m, s.label));
				const loc = a.location;
				if (loc) {
					// Out-of-flow elements belong after "+". Exception: a LINE/STACK code on an element that is a
					// whole score section is fine, since codes are relative to the enclosing region.
					const sectionRotation =
						parent === 'score' && (loc.path === 'line' || loc.path === 'stack');
					if (
						!isFlowLocation(loc) &&
						(parent === 'line' || parent === 'stack' || parent === 'score') &&
						!sectionRotation
					) {
						add(
							'warning',
							`Element placed by ${formatLocation(loc)} should be attached with "+", not written in the flow`,
							s.label
						);
					}
					if (loc.path === 'capsule' && !CAPSULE_LABELS.includes(s.label)) {
						add(
							'error',
							`Capsule code ${formatLocation(loc)} used on non-capsule surface ${s.label}`,
							s.label
						);
					}
					if (loc.path !== 'capsule' && CAPSULE_LABELS.includes(s.label)) {
						add(
							'warning',
							`Face code ${formatLocation(loc)} on capsule surface ${s.label}; capsule zone codes (e.g. ${s.label === 'CAP+BODY' ? 'SPAN:AX' : `${s.label}.MID:AX`}) are expected`,
							s.label
						);
					}
					if (loc.path === 'curve' && loc.track === 'BAND' && s.label !== 'E') {
						add('warning', `BAND codes describe the edge; put this on surface E`, s.label);
					}
					if (
						loc.path === 'curve' &&
						loc.track === 'ORBIT' &&
						loc.orbitOf &&
						!symbols.has(loc.orbitOf)
					) {
						add(
							'warning',
							`ORBIT refers to ${loc.orbitOf}, which is not on surface ${s.label}`,
							s.label
						);
					}
					if (loc.path === 'curve' && loc.track === 'HOLE' && !symbols.has('<hole>')) {
						add(
							'warning',
							`HOLE code used but no <hole> placeholder on surface ${s.label}`,
							s.label
						);
					}
				}
			}
			const methods = rest.filter((m) => METHOD_MOD.test(m));
			const inks = rest.filter((m) => INK_MOD.test(m));
			if (methods.length > 1)
				add('error', `More than one marking method (${methods.join(', ')})`, s.label);
			if (inks.length > 1) add('error', `More than one ink (${inks.join(', ')})`, s.label);
			if (inks.length && methods.some((m) => m !== 'print'))
				add(
					'error',
					`Ink applies to printed markings, not ${methods.find((m) => m !== 'print')}ed ones`,
					s.label
				);
			if (
				(methods.length || inks.length) &&
				(n.k === 'blank' || (n.k === 'sym' && (isHoleName(n.name) || n.name === 'orifice')))
			)
				add(
					'warning',
					`A marking method on ${n.k === 'blank' ? 'blank' : `<${n.name}>`} has nothing to mark`,
					s.label
				);
			if (rest.includes('fill')) {
				if (rest.includes('small') || rest.includes('large')) {
					add('error', 'fill sets the size itself; drop small/large', s.label);
				}
				if (n.k === 'blank') add('warning', 'fill on blank has nothing to size', s.label);
			}
			for (const c of children(n)) walk(c, n.k);
		};
		if (s.body) walk(s.body, 'root');
	}
	if (
		hole?.chiral &&
		holeMirrored.has('F') &&
		holeMirrored.has('B') &&
		holeMirrored.get('F') === holeMirrored.get('B')
	) {
		add(
			'error',
			`The ${hole.label} goes through the tablet, so it reads mirror-reversed on exactly one face; tag that face's <hole> with MIRROR`
		);
	}

	return { ok: !issues.some((i) => i.level === 'error'), surfaces, issues };
}

// ───────────────────────── Formatting ─────────────────────────

const SURFACE_ORDER = ['F', 'B', 'E', 'CAP', 'BODY', 'CAP+BODY'];
const MOD_ORDER = (m: string) =>
	/^(small|large|fill)$/.test(m)
		? 1
		: /^x\d+$/.test(m)
			? 2
			: m === 'back'
				? 3
				: METHOD_MOD.test(m)
					? 4
					: INK_MOD.test(m)
						? 5
						: 6;

/** Lowercase method words and inks; `print` is implied by an ink, so it is dropped beside one. */
function canonicalStyle(mods: string[]): string[] {
	const out = mods.map((m) =>
		METHOD_MOD.test(m.toLowerCase())
			? m.toLowerCase()
			: INK_MOD.test(m)
				? `ink:${INK_MOD.exec(m)![1].toLowerCase()}`
				: m
	);
	return out.some((m) => INK_MOD.test(m)) ? out.filter((m) => m !== 'print') : out;
}

function canonicalNode(n: Node, shape?: ShapeDef): Node {
	const copy: Node = { ...n } as Node;
	if (copy.k === 'sym' && copy.inner) copy.inner = canonicalNode(copy.inner, shape);
	if ('items' in copy) copy.items = copy.items.map((c) => canonicalNode(c, shape));
	if (n.mods?.length) {
		const { tag, rest: other } = splitHoleMods(n);
		let holeTag: string[] = [];
		if (tag.length) {
			const o = parseHoleOrient(tag.join(', '));
			const hole =
				(n.k === 'sym' ? holeFromName(n.name) : undefined) ??
				(shape?.hole ? findHole(shape.hole) : undefined);
			if (!(hole && isDefaultHoleOrient(hole, o)))
				holeTag = formatHoleOrient(o).split(', ').filter(Boolean);
		}
		const { location, mods } = parseModifiers(other.join(', '));
		const rest = canonicalStyle(mods).sort((a, b) => MOD_ORDER(a) - MOD_ORDER(b));
		const keepLoc =
			location && !(location.path === 'line' && location.heading === 'E' && location.zone === 'C');
		const all = [...holeTag, ...(keepLoc ? [formatLocation(location)] : []), ...rest];
		if (all.length) copy.mods = all;
		else delete copy.mods;
	}
	return copy;
}

/** Canonical ILN: surface order, translated legacy modifiers, default LINE@C dropped, modifier order,
 *  and (when the shape is given) default direction tags dropped. */
export function formatIln(src: string, opts: IlnOptions = {}): string {
	const shape = findShape(opts.shape);
	const surfaces = parseIln(src)
		.map((s) => {
			const out: Surface = { ...s, body: s.body ? canonicalNode(s.body, shape) : null };
			if ((s.label === 'CAP' || s.label === 'BODY') && s.color) out.color = shellText(s.color);
			if (shape && s.orient && isDefaultOrient(shape, parseShapeOrient(s.orient)))
				delete out.orient;
			return out;
		})
		.sort((a, b) => SURFACE_ORDER.indexOf(a.label) - SURFACE_ORDER.indexOf(b.label));
	return serializeSurfaces(surfaces);
}

/** A capsule half's color slot, canonical when it reads as a shell, else unchanged. */
function shellText(slot: string, describe = false): string {
	try {
		const shell = parseShell(slot);
		return describe ? describeShell(shell) : formatShell(shell);
	} catch (e) {
		if (e instanceof ShellError) return slot.toLowerCase();
		throw e;
	}
}

// ───────────────────────── Explanation ─────────────────────────

const ZONE_WORD: Record<string, string> = {
	C: 'center',
	N: 'upper',
	S: 'lower',
	W: 'left',
	E: 'right',
	NW: 'upper-left',
	NE: 'upper-right',
	SW: 'lower-left',
	SE: 'lower-right'
};
const HEADING_WORD: Record<string, string> = {
	E: 'left to right',
	W: 'upside down',
	S: 'downward',
	N: 'upward',
	NE: 'diagonally upward',
	SE: 'diagonally downward',
	NW: 'diagonally upward, inverted',
	SW: 'diagonally downward, inverted'
};
const TRACK_WORD: Record<string, string> = {
	RIM: 'along the face edge',
	MID: 'on an inner circle',
	HOLE: 'around the hole',
	BEVEL: 'on the bevel',
	BAND: 'on the side band'
};
const SIDE_WORD: Record<string, string> = {
	N: 'just above',
	S: 'just below',
	W: 'just left of',
	E: 'just right of'
};

function explainLocation(loc: LocationCode): string {
	switch (loc.path) {
		case 'curve': {
			const where = loc.track === 'ORBIT' ? `circling ${loc.orbitOf}` : TRACK_WORD[loc.track];
			const info = describeLocation(loc)!;
			const reading = info.dir === 'cw' ? 'clockwise' : 'counterclockwise';
			const feet =
				info.feet === 'in'
					? 'letter bottoms toward the center'
					: info.feet === 'out'
						? 'letter bottoms toward the edge'
						: `letter bottoms toward the ${info.feet === 'toward F' ? 'front' : 'back'} face`;
			const pts = loc.points.map(formatPoint);
			let route: string;
			if (loc.centered) route = `centered at ${pts[0]}`;
			else if (loc.ring) route = `in a full circle starting at ${pts[0]}`;
			else if (pts.length === 2) route = `from ${pts[0]} to ${pts[1]}`;
			else
				route = `from ${pts[0]} through ${pts.slice(1, -1).join(' and ')} to ${pts[pts.length - 1]}`;
			return `${where} ${route}, reading ${reading}, ${feet}`;
		}
		case 'line':
			if (loc.heading === 'E') return loc.zone === 'C' ? '' : `in the ${ZONE_WORD[loc.zone]} area`;
			return `straight, reading ${HEADING_WORD[loc.heading]}, in the ${ZONE_WORD[loc.zone]} area`;
		case 'stack':
			return `as upright letters stacked vertically in the ${ZONE_WORD[loc.zone]} area`;
		case 'band-across':
			return `across the side band at ${formatPoint(loc.at)}`;
		case 'score':
			if (loc.rel === 'ALONG') return `running ${SIDE_WORD[loc.side!]} the score`;
			if (loc.rel === 'ACROSS') return 'with the score running through it';
			if (loc.rel === 'GAP') return 'in a gap in the score';
			return `beyond the ${loc.side} end of the score`;
		case 'section': {
			const part = { HALF: 'half', QUAD: 'quarter', THIRD: 'third' }[loc.kind];
			return `in the ${ZONE_WORD[loc.at]} ${part}`;
		}
		case 'capsule': {
			const part =
				loc.part === 'SPAN'
					? 'across the seam'
					: `on the ${loc.part.toLowerCase()}, ${{ TIP: 'near the tip', MID: 'mid-length', SEAM: 'near the seam' }[loc.zone!]}`;
			const orient = {
				AX: 'printed along the length',
				'AX<': 'printed along the length, upside down',
				'RAD>N': 'printed around the girth, reading upward',
				'RAD>S': 'printed around the girth, reading downward',
				RING: 'printed all the way around'
			}[loc.orient];
			const around = loc.around
				? loc.around === 180
					? ', on the back'
					: `, rotated ${loc.around}° around`
				: '';
			return `${part}, ${orient}${around}`;
		}
	}
}

function explainMods(mods: string[] | undefined): string[] {
	if (!mods?.length) return [];
	const { location, mods: rest } = parseModifiers(mods.join(', '));
	const parts: string[] = [];
	if (location) {
		const l = explainLocation(location);
		if (l) parts.push(l);
	}
	for (const m of rest) {
		const x = /^x(\d+)$/.exec(m);
		if (x) parts.push(x[1] === '2' ? 'printed twice around' : `printed ${x[1]} times around`);
		else if (m === 'small' || m === 'large') parts.push(m);
		else if (m === 'fill') parts.push('sized to fill its space');
		else if (m === 'back') parts.push('on the back side');
		else if (m === 'deboss') parts.push('debossed');
		else if (m === 'emboss') parts.push('embossed');
		else if (m === 'print') {
			if (!rest.some((o) => INK_MOD.test(o))) parts.push('printed');
		} else if (INK_MOD.test(m)) parts.push(`printed in ${INK_MOD.exec(m)![1].toLowerCase()} ink`);
		else parts.push(`[${m}]`);
	}
	return parts;
}

function symbolWord(name: string): string {
	if (name === 'logo') return 'an unidentified logo';
	if (name === 'symbol') return 'an unidentified symbol';
	if (name === 'hole') return 'the hole';
	if (name === 'orifice') return 'a drilled orifice';
	if (name === 'line') return 'a decorative bar';
	const q = /^(\w+):(.+)$/.exec(name);
	if (q) return q[1] === 'logo' ? `the ${q[2]} logo` : `a ${q[1]} (${q[2]})`;
	return `a ${name} symbol`;
}

/** Explanation context: set by explainIln for the duration of one call. */
let explainCtx: { holeLabel?: string; fillPeers?: WeakMap<Node, string[]> } = {};

const hasFill = (n: Node) => !!n.mods?.includes('fill');

function shortLabel(n: Node): string {
	if (n.k === 'text') return `"${n.v.replace(/\uFFFD/g, '?')}"`;
	if (n.k === 'sym') return isHoleName(n.name) ? 'the hole' : symbolWord(n.name);
	return 'the group';
}

/** fill items compete within a region: the face, or a single score section. */
function fillPeers(body: Node | null): WeakMap<Node, string[]> {
	const peers = new WeakMap<Node, string[]>();
	if (!body) return peers;
	const regions: Node[][] = [];
	const visit = (n: Node, region: Node[]) => {
		if (hasFill(n)) region.push(n);
		if (n.k === 'score') {
			for (const c of n.items) {
				const section: Node[] = [];
				regions.push(section);
				visit(c, section);
			}
		} else for (const c of children(n)) visit(c, region);
	};
	const top: Node[] = [];
	regions.push(top);
	visit(body, top);
	for (const r of regions) {
		if (r.length < 2) continue;
		for (const n of r) peers.set(n, r.filter((o) => o !== n).map(shortLabel));
	}
	return peers;
}

const allBlank = (n: Node): boolean =>
	n.k === 'blank' || (n.k === 'score' && n.items.every(allBlank));

function explainNode(n: Node): string {
	let s: string;
	switch (n.k) {
		case 'text': {
			const illegible = [...n.v].filter((c) => c === '\uFFFD').length;
			s =
				`"${n.v.replace(/\uFFFD/g, '?')}"` +
				(illegible ? ` (${illegible} illegible character${illegible > 1 ? 's' : ''})` : '');
			break;
		}
		case 'sym': {
			if (isHoleName(n.name)) {
				const { tag } = splitHoleMods(n);
				const dir = tag.length ? describeHoleOrient(parseHoleOrient(tag.join(', '))) : '';
				s = `the ${holeFromName(n.name)?.label ?? explainCtx.holeLabel ?? 'hole'}${dir ? `, ${dir}` : ''}`;
			} else {
				s = symbolWord(n.name) + (n.inner ? ` containing ${explainNode(n.inner)}` : '');
			}
			break;
		}
		case 'blank':
			s = 'an empty section';
			break;
		case 'line':
			s = `${n.items.map(explainNode).join(', then ')} (same line)`;
			break;
		case 'stack':
			s = n.items.map(explainNode).join(' above ');
			break;
		case 'score': {
			const kind = n.dir === '|' ? 'vertical' : 'horizontal';
			if (allBlank(n)) {
				s = n.items.some((i) => i.k === 'score')
					? 'a cross score with no markings'
					: `${n.items.length === 2 ? 'a' : n.items.length - 1} ${kind} score${n.items.length > 2 ? 's' : ''} with no markings`;
			} else if (n.items.length === 2) {
				const [a, b] = n.items.map((i) =>
					i.k === 'score' || i.k === 'plus' ? `(${explainNode(i)})` : explainNode(i)
				);
				s =
					n.dir === '|'
						? `${a} left of a vertical score, ${b} right of it`
						: `${a} above a horizontal score, ${b} below it`;
			} else {
				s = `${n.items.map(explainNode).join('; ')}, separated by ${kind} scores (${n.dir === '|' ? 'left to right' : 'top to bottom'})`;
			}
			break;
		}
		case 'plus':
			s = `${explainNode(n.items[0])}; also ${n.items.slice(1).map(explainNode).join('; also ')}`;
			break;
	}
	const extra = explainMods(splitHoleMods(n).rest);
	const peers = explainCtx.fillPeers?.get(n);
	if (peers?.length) extra.push(`growing equally with ${peers.join(' and ')}`);
	if (!extra.length) return s;
	return n.k === 'text' || n.k === 'sym'
		? `${s} ${extra.join(', ')}`
		: `(${s}) ${extra.join(', ')}`;
}

const SURFACE_WORD: Record<string, string> = {
	F: 'Front',
	B: 'Back',
	E: 'Edge',
	CAP: 'Cap',
	BODY: 'Body',
	'CAP+BODY': 'Across the seam'
};

/** Plain-English description, one line per surface. */
export function explainIln(src: string, opts: IlnOptions = {}): string {
	const shape = findShape(opts.shape);
	explainCtx = { holeLabel: shape?.hole ? findHole(shape.hole)?.label : undefined };
	try {
		return explainSurfaces(src);
	} finally {
		explainCtx = {};
	}
}

function explainSurfaces(src: string): string {
	return parseIln(src)
		.map((s) => {
			const extra = [
				...(s.color
					? [
							s.label === 'CAP' || s.label === 'BODY'
								? shellText(s.color, true)
								: s.color.toLowerCase()
						]
					: []),
				...(s.orient ? [describeShapeOrient(parseShapeOrient(s.orient))] : [])
			];
			const head = SURFACE_WORD[s.label] + (extra.length ? ` (${extra.join('; ')})` : '');
			explainCtx.fillPeers = fillPeers(s.body);
			return `${head}: ${s.body ? explainNode(s.body) : 'blank'}`;
		})
		.join('\n');
}
