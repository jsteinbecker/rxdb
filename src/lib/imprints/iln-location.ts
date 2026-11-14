/**
 * ILN location codes: PATH:ROUTE@PLACE.
 *
 * | Function | Does |
 * | --- | --- |
 * | {@link parseLocation} / {@link formatLocation} | string ⇄ structured code (canonical form) |
 * | {@link describeLocation} | start, end, span, center, direction and feet of curved codes |
 * | {@link parseModifiers} | an ILN modifier list, translating legacy forms (`[arc, top]`, `r90`, `vert`, `ring`, `top-left`, …) |
 * | {@link locateBaseline} | OCR baseline points + face geometry → code |
 * | {@link buildFace} | located elements → ILN face layout |
 *
 * Conventions (canonical view): compass degrees run clockwise from N.
 * Image coordinates are y-down pixels; the canonical frame is y-up.
 *
 * @module
 */

import type { Node } from './spl-to-iln.ts';

// ───────────────────────── Types ─────────────────────────

export type Compass = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export type Zone = Compass | 'C';
export type Dir = 'cw' | 'ccw';
export type CurveTrack = 'RIM' | 'MID' | 'HOLE' | 'ORBIT' | 'BEVEL' | 'BAND';
export type Side = 'N' | 'S' | 'E' | 'W';

export type LocationCode =
	| {
			path: 'curve';
			track: CurveTrack;
			orbitOf?: string; // ORBIT only, e.g. "<heart>"
			points: number[]; // compass degrees; one point = centered form
			dir: Dir;
			ring: boolean;
			centered: boolean;
			feet?: 'F' | 'B'; // BAND only
	  }
	| { path: 'line'; heading: Compass; zone: Zone }
	| { path: 'stack'; zone: Zone }
	| { path: 'band-across'; at: number }
	| { path: 'score'; rel: 'ALONG' | 'ACROSS' | 'GAP' | 'END'; side?: Side }
	| { path: 'section'; kind: 'HALF' | 'QUAD' | 'THIRD'; at: Zone }
	| {
			path: 'capsule';
			part: 'CAP' | 'BODY' | 'SPAN';
			zone?: 'TIP' | 'MID' | 'SEAM';
			orient: 'AX' | 'AX<' | 'RAD>N' | 'RAD>S' | 'RING';
			around?: number; // degrees around the long axis from the cap's front print
	  };

export interface CurveInfo {
	startDeg: number;
	endDeg: number;
	/** Angular extent in degrees, or null for a centered form whose extent is unknown. */
	spanDeg: number | null;
	centerDeg: number;
	dir: Dir;
	feet: 'in' | 'out' | 'toward F' | 'toward B';
}

export class LocationError extends Error {
	readonly input: string;
	constructor(message: string, input: string) {
		super(`${message} in "${input}"`);
		this.name = 'LocationError';
		this.input = input;
	}
}

// ───────────────────────── Compass helpers ─────────────────────────

export const COMPASS_DEG: Record<Compass, number> = {
	N: 0,
	NE: 45,
	E: 90,
	SE: 135,
	S: 180,
	SW: 225,
	W: 270,
	NW: 315
};
const DEG_COMPASS = new Map<number, Compass>(
	Object.entries(COMPASS_DEG).map(([k, v]) => [v, k as Compass])
);
const isCompass = (s: string): s is Compass => Object.prototype.hasOwnProperty.call(COMPASS_DEG, s);
const isZone = (s: string): s is Zone => s === 'C' || isCompass(s);
const norm360 = (d: number) => ((d % 360) + 360) % 360;
const dirSpan = (a: number, b: number, dir: Dir) =>
	dir === 'cw' ? norm360(b - a) : norm360(a - b);

export function formatPoint(deg: number): string {
	const d = norm360(Math.round(deg));
	return DEG_COMPASS.get(d) ?? String(d);
}

function parsePoint(s: string, input: string): number {
	const t = s.trim().toUpperCase();
	if (isCompass(t)) return COMPASS_DEG[t];
	if (/^\d{1,3}$/.test(t) && Number(t) < 360) return Number(t);
	throw new LocationError(`Bad point "${s.trim()}" (use a compass point or 0–359)`, input);
}

/** Validate an open route; every leg goes the short way and all legs turn the same way. */
function analyzeRoute(points: number[], input: string): { dir: Dir; span: number } {
	let dir: Dir | undefined;
	let span = 0;
	for (let i = 1; i < points.length; i++) {
		const delta = norm360(points[i] - points[i - 1]);
		if (delta === 0)
			throw new LocationError('Repeated point (write a ring as A>A(cw) or A>A(ccw))', input);
		if (delta === 180) throw new LocationError('A 180° leg is ambiguous; add a via point', input);
		const legDir: Dir = delta < 180 ? 'cw' : 'ccw';
		if (dir && legDir !== dir) throw new LocationError('Route changes direction', input);
		dir = legDir;
		span += legDir === 'cw' ? delta : 360 - delta;
	}
	if (span > 360) throw new LocationError('Route wraps more than once', input);
	return { dir: dir!, span };
}

// ───────────────────────── Parsing ─────────────────────────

const CURVE_RE = /^(RIM|MID|HOLE|BEVEL|BAND|ORBIT)(?:\((<[^<>]+>)\))?:([^()]+?)(?:\(([^()]*)\))?$/;
const SECTION_ZONES: Record<'HALF' | 'QUAD' | 'THIRD', Zone[]> = {
	HALF: ['N', 'S', 'E', 'W'],
	QUAD: ['NE', 'NW', 'SE', 'SW'],
	THIRD: ['W', 'C', 'E', 'N', 'S']
};

export function parseLocation(input: string): LocationCode {
	const code = input.trim();
	let m: RegExpMatchArray | null;

	if ((m = code.match(/^BAND:ACROSS@(\w+)$/))) {
		return { path: 'band-across', at: parsePoint(m[1], code) };
	}

	if ((m = code.match(CURVE_RE))) {
		const [, track, sym, route, optStr] = m as unknown as [
			string,
			CurveTrack,
			string | undefined,
			string,
			string | undefined
		];
		if (track === 'ORBIT' && !sym)
			throw new LocationError('ORBIT needs the element it circles, e.g. ORBIT(<heart>)', code);
		if (sym && track !== 'ORBIT') throw new LocationError('Only ORBIT takes an element', code);

		let dirOpt: Dir | undefined;
		let feet: 'F' | 'B' | undefined;
		for (const raw of (optStr ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)) {
			if (raw === 'cw' || raw === 'ccw') dirOpt = raw;
			else if (/^feet [FB]$/.test(raw)) {
				if (track !== 'BAND') throw new LocationError('"feet" applies only to BAND', code);
				feet = raw.endsWith('F') ? 'F' : 'B';
			} else throw new LocationError(`Unknown option "${raw}"`, code);
		}
		const base = {
			path: 'curve' as const,
			track,
			...(sym ? { orbitOf: sym } : {}),
			...(feet ? { feet } : {})
		};
		const points = route.split('>').map((p) => parsePoint(p, code));

		if (points.length === 1) {
			if (!dirOpt) throw new LocationError('Centered form needs (cw) or (ccw)', code);
			return { ...base, points, dir: dirOpt, ring: false, centered: true };
		}
		if (points.length === 2 && points[0] === points[1]) {
			if (!dirOpt) throw new LocationError('A ring needs (cw) or (ccw)', code);
			return { ...base, points, dir: dirOpt, ring: true, centered: false };
		}
		const { dir, span } = analyzeRoute(points, code);
		if (dirOpt && dirOpt !== dir)
			throw new LocationError(`Stated (${dirOpt}) contradicts the route`, code);
		return { ...base, points, dir, ring: span === 360, centered: false };
	}

	if ((m = code.match(/^LINE(?:>(\w+))?(?:@(\w+))?$/))) {
		const heading = m[1] ?? 'E';
		const zone = m[2] ?? 'C';
		if (!isCompass(heading))
			throw new LocationError(`Bad heading "${heading}" (use one of 8 compass points)`, code);
		if (!isZone(zone)) throw new LocationError(`Bad zone "${zone}"`, code);
		return { path: 'line', heading, zone };
	}

	if ((m = code.match(/^STACK(?:@(\w+))?$/))) {
		const zone = m[1] ?? 'C';
		if (!isZone(zone)) throw new LocationError(`Bad zone "${zone}"`, code);
		return { path: 'stack', zone };
	}

	if ((m = code.match(/^SCORE:(ALONG|END)\.([NSEW])$/))) {
		return { path: 'score', rel: m[1] as 'ALONG' | 'END', side: m[2] as Side };
	}
	if ((m = code.match(/^SCORE:(ACROSS|GAP)$/))) {
		return { path: 'score', rel: m[1] as 'ACROSS' | 'GAP' };
	}

	if ((m = code.match(/^(HALF|QUAD|THIRD)\.(\w+)$/))) {
		const kind = m[1] as 'HALF' | 'QUAD' | 'THIRD';
		if (!isZone(m[2]) || !SECTION_ZONES[kind].includes(m[2])) {
			throw new LocationError(`${kind} takes ${SECTION_ZONES[kind].join('/')}`, code);
		}
		return { path: 'section', kind, at: m[2] };
	}

	if (
		(m = code.match(
			/^(?:(CAP|BODY)\.(TIP|MID|SEAM)|(SPAN)):(AX<?|RAD>[NS]|RING)(?:@(back|front|\d{1,3}))?$/
		))
	) {
		const part = (m[1] ?? m[3]) as 'CAP' | 'BODY' | 'SPAN';
		const orient = m[4] as 'AX' | 'AX<' | 'RAD>N' | 'RAD>S' | 'RING';
		if (part === 'SPAN' && !orient.startsWith('AX'))
			throw new LocationError('SPAN text is axial (AX or AX<)', code);
		const aroundRaw = m[5];
		let around: number | undefined;
		if (aroundRaw === 'back') around = 180;
		else if (aroundRaw && aroundRaw !== 'front') {
			around = Number(aroundRaw);
			if (around >= 360) throw new LocationError(`Bad rotation "${aroundRaw}"`, code);
		}
		return {
			path: 'capsule',
			part,
			...(m[2] ? { zone: m[2] as 'TIP' | 'MID' | 'SEAM' } : {}),
			orient,
			...(around ? { around } : {})
		};
	}

	throw new LocationError('Unknown location code', code);
}

export function tryParseLocation(input: string): LocationCode | undefined {
	try {
		return parseLocation(input);
	} catch {
		return undefined;
	}
}

// ───────────────────────── Formatting ─────────────────────────

export function formatLocation(loc: LocationCode): string {
	switch (loc.path) {
		case 'curve': {
			const head = loc.track + (loc.orbitOf ? `(${loc.orbitOf})` : '');
			const opts: string[] = [];
			if (loc.centered || (loc.ring && loc.points.length === 2)) opts.push(loc.dir);
			if (loc.feet === 'F') opts.push('feet F');
			return `${head}:${loc.points.map(formatPoint).join('>')}${opts.length ? `(${opts.join(', ')})` : ''}`;
		}
		case 'line':
			return `LINE${loc.heading === 'E' ? '' : `>${loc.heading}`}@${loc.zone}`;
		case 'stack':
			return `STACK@${loc.zone}`;
		case 'band-across':
			return `BAND:ACROSS@${formatPoint(loc.at)}`;
		case 'score':
			return `SCORE:${loc.rel}${loc.side ? `.${loc.side}` : ''}`;
		case 'section':
			return `${loc.kind}.${loc.at}`;
		case 'capsule': {
			const head = loc.part === 'SPAN' ? 'SPAN' : `${loc.part}.${loc.zone}`;
			const around = loc.around ? `@${loc.around === 180 ? 'back' : loc.around}` : '';
			return `${head}:${loc.orient}${around}`;
		}
	}
}

/** Geometry of a curved code; undefined for non-curved codes. */
export function describeLocation(loc: LocationCode): CurveInfo | undefined {
	if (loc.path !== 'curve') return undefined;
	const start = loc.points[0];
	const end = loc.points[loc.points.length - 1];
	const feet: CurveInfo['feet'] =
		loc.track === 'BAND'
			? loc.feet === 'F'
				? 'toward F'
				: 'toward B'
			: loc.dir === 'cw'
				? 'in'
				: 'out';
	if (loc.centered)
		return { startDeg: start, endDeg: start, spanDeg: null, centerDeg: start, dir: loc.dir, feet };
	const span = loc.ring ? 360 : analyzeRoute(loc.points, formatLocation(loc)).span;
	const center = loc.ring ? start : norm360(start + (loc.dir === 'cw' ? 1 : -1) * (span / 2));
	return { startDeg: start, endDeg: end, spanDeg: span, centerDeg: center, dir: loc.dir, feet };
}

// ───────────────────────── Modifier lists (incl. legacy) ─────────────────────────

const ANCHORS: Record<string, Zone> = {
	top: 'N',
	bottom: 'S',
	left: 'W',
	right: 'E',
	center: 'C',
	'top-left': 'NW',
	'top-right': 'NE',
	'bottom-left': 'SW',
	'bottom-right': 'SE'
};

/** Legacy [arc, <edge>] defaults read without turning the pill; the opposite direction flips them. */
const LEGACY_ARCS: Record<'N' | 'S' | 'W' | 'E', Record<Dir, string>> = {
	N: { cw: 'RIM:W>N>E', ccw: 'RIM:E>N>W' },
	S: { ccw: 'RIM:W>S>E', cw: 'RIM:E>S>W' },
	W: { cw: 'RIM:S>W>N', ccw: 'RIM:N>W>S' },
	E: { cw: 'RIM:N>E>S', ccw: 'RIM:S>E>N' }
};
const LEGACY_ARC_DEFAULT: Record<'N' | 'S' | 'W' | 'E', Dir> = {
	N: 'cw',
	S: 'ccw',
	W: 'cw',
	E: 'cw'
};

/** Split on commas that are not inside (), [], or <>. */
function splitTopLevel(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of s) {
		if ('([<'.includes(ch)) depth++;
		else if (')]>'.includes(ch)) depth = Math.max(0, depth - 1); // a bare '>' (route arrow) at depth 0 is a no-op
		if (ch === ',' && depth === 0) {
			out.push(cur.trim());
			cur = '';
		} else cur += ch;
	}
	if (cur.trim()) out.push(cur.trim());
	return out.filter(Boolean);
}

export interface ModifierList {
	location?: LocationCode;
	/** Every modifier that isn't a location (small, large, x2, back, …). */
	mods: string[];
	warnings: string[];
}

/**
 * Parse a modifier list such as "[RIM:W>N>E, small]" or legacy "[arc, top, x2]".
 * Legacy path/anchor/rotation words are translated into a single location code.
 */
export function parseModifiers(list: string): ModifierList {
	const body = list.trim().replace(/^\[/, '').replace(/\]$/, '');
	const result: ModifierList = { mods: [], warnings: [] };
	const legacy: { arc?: true; ring?: true; vert?: true; rot?: number; anchor?: Zone; dir?: Dir } =
		{};
	const legacyWords: string[] = [];

	for (const token of splitTopLevel(body)) {
		const loc = tryParseLocation(token);
		if (loc) {
			if (result.location) result.warnings.push(`Second location "${token}" ignored`);
			else result.location = loc;
			continue;
		}
		const lower = token.toLowerCase();
		if (lower === 'arc') legacy.arc = true;
		else if (lower === 'ring') legacy.ring = true;
		else if (lower === 'vert') legacy.vert = true;
		else if (lower === 'cw' || lower === 'ccw') legacy.dir = lower;
		else if (lower in ANCHORS) legacy.anchor = ANCHORS[lower];
		else if (/^r\d{1,3}$/.test(lower)) legacy.rot = norm360(Number(lower.slice(1)));
		else {
			result.mods.push(token);
			continue;
		}
		legacyWords.push(token);
	}

	if (!legacyWords.length) return result;
	if (result.location) {
		result.warnings.push(
			`Legacy modifiers (${legacyWords.join(', ')}) ignored because a location code is present`
		);
		return result;
	}

	let code: string | undefined;
	if (legacy.arc) {
		const edge = (
			legacy.anchor && ['N', 'S', 'W', 'E'].includes(legacy.anchor) ? legacy.anchor : 'N'
		) as 'N' | 'S' | 'W' | 'E';
		if (legacy.anchor && legacy.anchor !== edge)
			result.warnings.push(`arc with anchor ${legacy.anchor} approximated as ${edge}`);
		code = LEGACY_ARCS[edge][legacy.dir ?? LEGACY_ARC_DEFAULT[edge]];
	} else if (legacy.ring) {
		code = `RIM:N>N(${legacy.dir ?? 'cw'})`;
	} else if (legacy.vert) {
		code = `STACK@${legacy.anchor ?? 'C'}`;
	} else if (legacy.rot !== undefined) {
		const heading = DEG_COMPASS.get(norm360(90 + legacy.rot));
		if (heading) code = `LINE${heading === 'E' ? '' : `>${heading}`}@${legacy.anchor ?? 'C'}`;
		else result.mods.push(`r${legacy.rot}`); // not on the 8-point grid; keep as a plain rotation
	} else if (legacy.anchor) {
		code = `LINE@${legacy.anchor}`;
	}
	if (legacy.dir && !legacy.arc && !legacy.ring) result.mods.push(legacy.dir);
	if (code) result.location = parseLocation(code);
	return result;
}

// ───────────────────────── Geometry → location (OCR) ─────────────────────────

export interface Pt {
	x: number;
	y: number;
}

export interface FaceGeometry {
	/** Face center x, in image pixels. */
	cx: number;
	/** Face center y, in image pixels. */
	cy: number;
	/** Half-width along the canonical horizontal axis, in image pixels. */
	rx: number;
	/** Half-height along the canonical vertical axis, in image pixels. */
	ry: number;
	/** Where canonical N points in the image, in degrees clockwise from image-up. */
	upDeg?: number;
	hole?: { cx: number; cy: number; r: number };
}

export interface LocateOptions {
	/**
	 * Snap to a compass point when within this many degrees of it.
	 * @defaultValue 10
	 */
	snapToleranceDeg?: number;
	/**
	 * When not snapped, round the angle to this step in degrees.
	 * @defaultValue 5
	 */
	degreeStep?: number;
	/**
	 * Largest deviation ÷ chord length that still counts as a straight run.
	 * @defaultValue 0.04
	 */
	straightness?: number;
	/**
	 * Element name to report for off-center arcs.
	 * @defaultValue "<symbol>"
	 */
	orbitOf?: string;
}

export interface LocateResult {
	location: LocationCode;
	code: string;
	notes: string[];
	metrics: {
		kind: 'straight' | 'curved';
		/** Largest distance from the chord ÷ chord length. */
		deviation: number;
		/** Fitted arc radius, in face-radius units. */
		radius?: number;
		/** Distance of the fitted arc center from the face center, in face-radius units. */
		centerOffset?: number;
		spanDeg?: number;
	};
}

interface UV {
	u: number;
	v: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const bearing = (du: number, dv: number) => norm360(deg(Math.atan2(du, dv)));

/** Image px → canonical, face-normalized coordinates (rim ≈ radius 1, v up). */
function toUnit(face: FaceGeometry, p: Pt): UV {
	const dx = p.x - face.cx;
	const dy = -(p.y - face.cy);
	const phi = rad(face.upDeg ?? 0);
	const u = dx * Math.cos(phi) - dy * Math.sin(phi);
	const v = dy * Math.cos(phi) + dx * Math.sin(phi);
	return { u: u / face.rx, v: v / face.ry };
}

/** Algebraic (Kåsa) circle fit. */
function fitCircle(pts: UV[]): { a: number; b: number; r: number } | null {
	let suu = 0,
		suv = 0,
		svv = 0,
		su = 0,
		sv = 0,
		suz = 0,
		svz = 0,
		sz = 0;
	for (const { u, v } of pts) {
		const z = u * u + v * v;
		suu += u * u;
		suv += u * v;
		svv += v * v;
		su += u;
		sv += v;
		suz += u * z;
		svz += v * z;
		sz += z;
	}
	const n = pts.length;
	const M = [
		[suu, suv, su],
		[suv, svv, sv],
		[su, sv, n]
	];
	const rhs = [-suz, -svz, -sz];
	const det3 = (m: number[][]) =>
		m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
		m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
		m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
	const D = det3(M);
	if (Math.abs(D) < 1e-12) return null;
	const solve = (col: number) =>
		det3(M.map((row, i) => row.map((x, j) => (j === col ? rhs[i] : x)))) / D;
	const [Dc, Ec, Fc] = [solve(0), solve(1), solve(2)];
	const a = -Dc / 2,
		b = -Ec / 2;
	const r2 = a * a + b * b - Fc;
	return r2 > 0 ? { a, b, r: Math.sqrt(r2) } : null;
}

function chordDeviation(pts: UV[]): number {
	const p0 = pts[0],
		p1 = pts[pts.length - 1];
	const len = Math.hypot(p1.u - p0.u, p1.v - p0.v);
	if (len < 1e-9) return Infinity;
	let max = 0;
	for (const p of pts) {
		const d = Math.abs((p1.u - p0.u) * (p0.v - p.v) - (p0.u - p.u) * (p1.v - p0.v)) / len;
		max = Math.max(max, d);
	}
	return max / len;
}

function zoneOf(u: number, v: number): Zone {
	const row = v > 1 / 3 ? 'N' : v < -1 / 3 ? 'S' : '';
	const col = u < -1 / 3 ? 'W' : u > 1 / 3 ? 'E' : '';
	return (row + col || 'C') as Zone;
}

function makeSnapper(opts: LocateOptions) {
	const tol = opts.snapToleranceDeg ?? 10;
	const step = opts.degreeStep ?? 5;
	return (a: number, allowCompass = true): number => {
		const nearest = norm360(Math.round(a / 45) * 45);
		const diff = Math.abs(((a - nearest + 540) % 360) - 180);
		if (allowCompass && diff <= tol) return nearest;
		return norm360(Math.round(a / step) * step);
	};
}

/**
 * Turn an OCR baseline (points in reading order, image px) into a location code.
 * Straight baselines become LINE codes; curved ones are circle-fitted and become
 * RIM / MID / HOLE / ORBIT arcs or rings.
 */
export function locateBaseline(
	face: FaceGeometry,
	baseline: Pt[],
	opts: LocateOptions = {}
): LocateResult {
	if (baseline.length < 2) throw new Error('A baseline needs at least 2 points');
	const pts = baseline.map((p) => toUnit(face, p));
	const notes: string[] = [];
	const snap = makeSnapper(opts);
	const deviation = chordDeviation(pts);

	// ── Straight ──
	if (pts.length < 3 || deviation < (opts.straightness ?? 0.04)) {
		const first = pts[0],
			last = pts[pts.length - 1];
		const raw = bearing(last.u - first.u, last.v - first.v);
		const headingDeg = norm360(Math.round(raw / 45) * 45);
		if (Math.abs(((raw - headingDeg + 540) % 360) - 180) > 15) {
			notes.push(`Baseline heading ${Math.round(raw)}° snapped to ${formatPoint(headingDeg)}.`);
		}
		const cu = pts.reduce((s, p) => s + p.u, 0) / pts.length;
		const cv = pts.reduce((s, p) => s + p.v, 0) / pts.length;
		const location: LocationCode = {
			path: 'line',
			heading: DEG_COMPASS.get(headingDeg)!,
			zone: zoneOf(cu, cv)
		};
		if (Math.hypot(cu, cv) > 0.7) {
			notes.push(
				'Straight text near the edge: if the outline is flat here, a RIM code describes it better.'
			);
		}
		return {
			location,
			code: formatLocation(location),
			notes,
			metrics: { kind: 'straight', deviation }
		};
	}

	// ── Curved ──
	const circle = fitCircle(pts);
	if (!circle) throw new Error('Could not fit a curve to the baseline');
	const centerOffset = Math.hypot(circle.a, circle.b);

	let track: CurveTrack;
	let ref: UV = { u: 0, v: 0 };
	const holeUnit = face.hole ? toUnit(face, { x: face.hole.cx, y: face.hole.cy }) : undefined;
	const holeR = face.hole ? face.hole.r / ((face.rx + face.ry) / 2) : 0;

	if (centerOffset > 0.3) {
		track = 'ORBIT';
		ref = { u: circle.a, v: circle.b };
		if (!opts.orbitOf)
			notes.push('Arc is not centered on the face; set orbitOf to the element it circles.');
	} else if (holeUnit && circle.r < holeR + 0.2) {
		track = 'HOLE';
		ref = holeUnit;
	} else {
		track = circle.r >= 0.62 ? 'RIM' : 'MID';
	}

	const angles = pts.map((p) => bearing(p.u - ref.u, p.v - ref.v));
	let swept = 0;
	for (let i = 1; i < angles.length; i++) swept += ((angles[i] - angles[i - 1] + 540) % 360) - 180;
	const dir: Dir = swept >= 0 ? 'cw' : 'ccw';
	const span = Math.abs(swept);
	const base = {
		path: 'curve' as const,
		track,
		...(track === 'ORBIT' ? { orbitOf: opts.orbitOf ?? '<symbol>' } : {})
	};

	let location: LocationCode;
	if (span >= 330) {
		const start = snap(angles[0]);
		location = { ...base, points: [start, start], dir, ring: true, centered: false };
	} else {
		let start = snap(angles[0]);
		let end = snap(angles[angles.length - 1]);
		let s = dirSpan(start, end, dir);
		if (s === 0 || Math.abs(s - span) > 90) {
			// Snapping collapsed or flipped the arc; retry without compass snapping.
			start = snap(angles[0], false);
			end = snap(angles[angles.length - 1], false);
			s = dirSpan(start, end, dir);
		}
		if (s === 0) {
			const center = snap(angles[0] + (dir === 'cw' ? 1 : -1) * (span / 2));
			location = { ...base, points: [center], dir, ring: false, centered: true };
			notes.push('Arc too short to give distinct endpoints; written in centered form.');
		} else {
			const legs = s < 180 ? 1 : Math.ceil(s / 90);
			const sign = dir === 'cw' ? 1 : -1;
			const points = [start];
			for (let i = 1; i < legs; i++)
				points.push(norm360(Math.round(start + (sign * s * i) / legs)));
			points.push(end);
			location = { ...base, points, dir, ring: false, centered: false };
		}
	}

	// Sanity: the emitted code must parse back to the same thing.
	const code = formatLocation(location);
	parseLocation(code);
	return {
		location,
		code,
		notes,
		metrics: {
			kind: 'curved',
			deviation,
			radius: circle.r,
			centerOffset,
			spanDeg: Math.round(span)
		}
	};
}

// ───────────────────────── Building an ILN face ─────────────────────────

export interface PlacedElement {
	/** The text or symbol node being located. */
	node: Node;
	/** Where the node sits; undefined means centered horizontal flow. */
	loc?: LocationCode;
}

const ROW: Record<Zone, number> = { NW: 0, N: 0, NE: 0, W: 1, C: 1, E: 1, SW: 2, S: 2, SE: 2 };
const COL: Record<Zone, number> = { NW: 0, W: 0, SW: 0, N: 1, C: 1, S: 1, NE: 2, E: 2, SE: 2 };

/** Sort key for "+" items: clockwise from the top; centered/unknown positions sort last. */
function placementAngle(loc: LocationCode): number {
	switch (loc.path) {
		case 'curve':
			return describeLocation(loc)!.centerDeg;
		case 'line':
		case 'stack':
			return loc.zone === 'C' ? 400 : COMPASS_DEG[loc.zone];
		case 'band-across':
			return loc.at;
		default:
			return 500;
	}
}

function withLocation(node: Node, loc: LocationCode): Node {
	if (node.k !== 'text' && node.k !== 'sym')
		throw new Error('Only text and symbol nodes can carry a location');
	return { ...node, mods: [formatLocation(loc), ...(node.mods ?? [])] };
}

/**
 * Assemble located elements into one ILN face layout.
 * Horizontal LINE text becomes the in-flow layout (rows stacked N→S, items W→E);
 * everything else is attached with "+" in clockwise order from the top.
 */
export function buildFace(elements: PlacedElement[]): Node {
	const flow = elements.filter((e) => !e.loc || (e.loc.path === 'line' && e.loc.heading === 'E'));
	const placed = elements
		.filter((e) => !flow.includes(e))
		.map((e, i) => ({ e, i, angle: placementAngle(e.loc!) }))
		.sort((a, b) => a.angle - b.angle || a.i - b.i)
		.map(({ e }) => withLocation(e.node, e.loc!));

	let flowNode: Node | undefined;
	if (flow.length === 1) {
		const only = flow[0];
		const zone = only.loc?.path === 'line' ? only.loc.zone : 'C';
		flowNode = zone === 'C' ? only.node : withLocation(only.node, only.loc!);
	} else if (flow.length > 1) {
		const zoneOfEl = (e: PlacedElement): Zone => (e.loc?.path === 'line' ? e.loc.zone : 'C');
		const rows: Node[] = [];
		for (const r of [0, 1, 2]) {
			const items = flow
				.map((e, i) => ({ e, i }))
				.filter(({ e }) => ROW[zoneOfEl(e)] === r)
				.sort((a, b) => COL[zoneOfEl(a.e)] - COL[zoneOfEl(b.e)] || a.i - b.i)
				.map(({ e }) => e.node);
			if (items.length) rows.push(items.length === 1 ? items[0] : { k: 'line', items });
		}
		flowNode = rows.length === 1 ? rows[0] : { k: 'stack', items: rows };
	}

	const all = flowNode ? [flowNode, ...placed] : placed;
	if (!all.length) return { k: 'blank' };
	return all.length === 1 ? all[0] : { k: 'plus', items: all };
}
