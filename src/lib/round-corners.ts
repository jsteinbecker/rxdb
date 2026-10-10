// Softens every sharp corner of an SVG outline: a real tablet is pressed in a
// die and never has a knife-edge point. Curves are kept exact (arcs and
// quadratics become cubics); only the joints where the outline turns by more
// than a few degrees get a short quadratic fillet through the old vertex.

type Pt = [number, number];
/** A line (`b`/`c` absent) or a cubic from `a` to `d`. */
interface Seg {
	a: Pt;
	b?: Pt;
	c?: Pt;
	d: Pt;
}

const sub = (p: Pt, q: Pt): Pt => [p[0] - q[0], p[1] - q[1]];
const lerp = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const near = (p: Pt, q: Pt) => dist(p, q) < 1e-6;

/** SVG arc (endpoint form) as cubics of at most 90° each. */
function arcToCubics(p0: Pt, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p1: Pt): Seg[] {
	if (near(p0, p1)) return [];
	if (!rx || !ry) return [{ a: p0, d: p1 }];
	rx = Math.abs(rx);
	ry = Math.abs(ry);
	const phi = (phiDeg * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const dx = (p0[0] - p1[0]) / 2;
	const dy = (p0[1] - p1[1]) / 2;
	const x1 = cos * dx + sin * dy;
	const y1 = -sin * dx + cos * dy;
	const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}
	const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
	const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
	const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
	const cx1 = (k * rx * y1) / ry;
	const cy1 = (-k * ry * x1) / rx;
	const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
	const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
	const angle = (ux: number, uy: number, vx: number, vy: number) =>
		Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
	let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
	if (!sweep && dt > 0) dt -= 2 * Math.PI;
	if (sweep && dt < 0) dt += 2 * Math.PI;
	const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
	const step = dt / n;
	const h = (4 / 3) * Math.tan(step / 4);
	const at = (t: number): Pt => {
		const x = rx * Math.cos(t);
		const y = ry * Math.sin(t);
		return [cos * x - sin * y + cx, sin * x + cos * y + cy];
	};
	const deriv = (t: number): Pt => {
		const x = -rx * Math.sin(t);
		const y = ry * Math.cos(t);
		return [cos * x - sin * y, sin * x + cos * y];
	};
	const out: Seg[] = [];
	for (let i = 0; i < n; i++) {
		const ta = t1 + i * step;
		const tb = ta + step;
		const a = i === 0 ? p0 : at(ta);
		const d = i === n - 1 ? p1 : at(tb);
		const da = deriv(ta);
		const db = deriv(tb);
		out.push({ a, b: [a[0] + h * da[0], a[1] + h * da[1]], c: [d[0] - h * db[0], d[1] - h * db[1]], d });
	}
	return out;
}

/** Absolute subpaths of lines and cubics. */
function parse(path: string): Seg[][] {
	const tokens = path.match(/[MmLlHhVvCcSsQqAaZz]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ?? [];
	const subpaths: Seg[][] = [];
	let segs: Seg[] = [];
	let cur: Pt = [0, 0];
	let start: Pt = [0, 0];
	let lastCtrl: Pt | null = null;
	let cmd = '';
	let i = 0;
	const num = () => Number(tokens[i++]);
	const close = () => {
		if (!near(cur, start)) segs.push({ a: cur, d: start });
		if (segs.length) subpaths.push(segs);
		segs = [];
		cur = start;
	};
	while (i < tokens.length) {
		if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
		const rel = cmd === cmd.toLowerCase();
		const pt = (): Pt => {
			const x = num();
			const y = num();
			return rel ? [cur[0] + x, cur[1] + y] : [x, y];
		};
		let ctrl: Pt | null = null;
		switch (cmd.toUpperCase()) {
			case 'M':
				if (segs.length) close();
				cur = start = pt();
				cmd = rel ? 'l' : 'L';
				break;
			case 'L': {
				const d = pt();
				segs.push({ a: cur, d });
				cur = d;
				break;
			}
			case 'H': {
				const x = num();
				const d: Pt = [rel ? cur[0] + x : x, cur[1]];
				segs.push({ a: cur, d });
				cur = d;
				break;
			}
			case 'V': {
				const y = num();
				const d: Pt = [cur[0], rel ? cur[1] + y : y];
				segs.push({ a: cur, d });
				cur = d;
				break;
			}
			case 'C': {
				const b = pt();
				const c = pt();
				const d = pt();
				segs.push({ a: cur, b, c, d });
				cur = d;
				ctrl = c;
				break;
			}
			case 'S': {
				const b: Pt = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
				const c = pt();
				const d = pt();
				segs.push({ a: cur, b, c, d });
				cur = d;
				ctrl = c;
				break;
			}
			case 'Q': {
				const q = pt();
				const d = pt();
				segs.push({ a: cur, b: lerp(cur, q, 2 / 3), c: lerp(d, q, 2 / 3), d });
				cur = d;
				break;
			}
			case 'A': {
				const rx = num();
				const ry = num();
				const rot = num();
				const large = num() !== 0;
				const sweep = num() !== 0;
				const d = pt();
				segs.push(...arcToCubics(cur, rx, ry, rot, large, sweep, d));
				cur = d;
				break;
			}
			case 'Z':
				close();
				break;
			default:
				i++;
		}
		lastCtrl = ctrl;
	}
	if (segs.length) close();
	return subpaths.map((s) => s.filter((seg) => !near(seg.a, seg.d) || seg.b));
}

const unit = (v: Pt): Pt => {
	const l = Math.hypot(v[0], v[1]);
	return l ? [v[0] / l, v[1] / l] : [0, 0];
};
/** Direction the segment leaves its start / arrives at its end, skipping coincident control points. */
const tangentOut = (s: Seg): Pt => unit(sub([s.b, s.c, s.d].find((p) => p && !near(p, s.a)) ?? s.d, s.a));
const tangentIn = (s: Seg): Pt => unit(sub(s.d, [s.c, s.b, s.a].find((p) => p && !near(p, s.d)) ?? s.a));
const pointAt = (s: Seg, t: number): Pt => {
	if (!s.b || !s.c) return lerp(s.a, s.d, t);
	const u = 1 - t;
	const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
	return [
		w[0] * s.a[0] + w[1] * s.b[0] + w[2] * s.c[0] + w[3] * s.d[0],
		w[0] * s.a[1] + w[1] * s.b[1] + w[2] * s.c[1] + w[3] * s.d[1]
	];
};

/** Parameter at which `len` of arc length has been walked from the start (or, `fromEnd`, back from the end). */
function paramAt(s: Seg, len: number, fromEnd: boolean): number {
	const N = 64;
	let walked = 0;
	let prev = pointAt(s, fromEnd ? 1 : 0);
	for (let k = 1; k <= N; k++) {
		const t = fromEnd ? 1 - k / N : k / N;
		const p = pointAt(s, t);
		walked += dist(prev, p);
		if (walked >= len) return fromEnd ? 1 - t : t;
		prev = p;
	}
	return 1;
}

/** The part of `s` between parameters `t0` and `t1`. */
function slice(s: Seg, t0: number, t1: number): Seg {
	if (!s.b || !s.c) return { a: lerp(s.a, s.d, t0), d: lerp(s.a, s.d, t1) };
	const split = (seg: Required<Seg>, t: number): [Required<Seg>, Required<Seg>] => {
		const ab = lerp(seg.a, seg.b, t);
		const bc = lerp(seg.b, seg.c, t);
		const cd = lerp(seg.c, seg.d, t);
		const abc = lerp(ab, bc, t);
		const bcd = lerp(bc, cd, t);
		const m = lerp(abc, bcd, t);
		return [
			{ a: seg.a, b: ab, c: abc, d: m },
			{ a: m, b: bcd, c: cd, d: seg.d }
		];
	};
	let seg = s as Required<Seg>;
	if (t1 < 1) seg = split(seg, t1)[0];
	if (t0 > 0) seg = split(seg, t0 / t1)[1];
	return seg;
}

const f = (p: Pt) => `${+p[0].toFixed(2)},${+p[1].toFixed(2)}`;

/**
 * `path` with a fillet of about `radius` box units wherever two segments meet
 * at more than `minTurnDeg`. Smooth joints, and so circles and ellipses, are
 * left as they are.
 */
export function roundCorners(path: string, radius = 3, minTurnDeg = 12): string {
	const minCos = Math.cos((minTurnDeg * Math.PI) / 180);
	return parse(path)
		.map((segs) => {
			const n = segs.length;
			const sharp = segs.map((s, k) => {
				const next = segs[(k + 1) % n];
				const u = tangentIn(s);
				const v = tangentOut(next);
				return u[0] * v[0] + u[1] * v[1] < minCos;
			});
			// How much of each segment's parameter range each fillet eats, never more than 40%.
			const trim = (s: Seg, fromEnd: boolean) => Math.min(0.4, paramAt(s, radius, fromEnd));
			const kept = segs.map((s, k) =>
				slice(s, sharp[(k - 1 + n) % n] ? trim(s, false) : 0, sharp[k] ? 1 - trim(s, true) : 1)
			);
			let d = `M${f(kept[0].a)}`;
			kept.forEach((s, k) => {
				d += s.b && s.c ? `C${f(s.b)} ${f(s.c)} ${f(s.d)}` : `L${f(s.d)}`;
				if (sharp[k]) d += `Q${f(segs[k].d)} ${f(kept[(k + 1) % n].a)}`;
			});
			return d + 'z';
		})
		.join(' ');
}
