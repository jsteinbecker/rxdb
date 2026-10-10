import { imprintFaces } from '../spl-characteristics';
import type { MeasuredElement, MeasuredFace, PillImageLayout } from '../pill-image-layout';

// ── Measuring a label photo ──────────────────────────────────────────────────
// A label's SPLIMAGE is a studio photo: one to three pills, usually both faces
// of the same tablet, on a flat grey or white backdrop, sometimes with a mm
// ruler along two edges. This finds each pill, finds the imprint's glyphs on
// it, and works out which run of glyphs is which imprint section.
//
// The sections are known — the label states them — so this never has to read
// text cold. It only has to decide which run is which, and for that a glyph
// count is often enough on its own (`G` beside `786`). OCR, when a reader is
// supplied, settles the rest (`APO` against `GLP`); it is given a whitelist of
// the imprint's own characters, which is what makes it usable at all on a
// debossed face, where the letters are shadows rather than ink.
//
// Pure: pixels in, layout out. Fetching, decoding and the OCR process live
// elsewhere, so this runs in a test on a synthetic image.

/** An 8-bit RGB raster, three bytes per pixel, row-major. */
export interface RgbImage {
	width: number;
	height: number;
	data: Uint8Array;
}

/** An 8-bit greyscale raster handed to OCR: dark strokes on white, upright. */
export interface GrayCrop {
	width: number;
	height: number;
	data: Uint8Array;
}

/** Reads a crop; `whitelist` is every character the imprint uses. */
export type CropReader = (crop: GrayCrop, whitelist: string) => Promise<string | null>;

/** Above this a run of glyphs is not that section at all. */
const MAX_MATCH_COST = 0.6;
/** What leaving a section unplaced costs: worse than any acceptable match. */
const UNPLACED_COST = 0.75;
/** What each glyph matched to no section costs — usually a logo or glint. */
const LEFTOVER_COST = 0.03;

// ── Raster primitives ────────────────────────────────────────────────────────

/** Sum of each `(2r+1)²` window, outside the raster counting as zero. */
function boxSum(src: ArrayLike<number>, w: number, h: number, r: number): Float64Array {
	const integral = new Float64Array((w + 1) * (h + 1));
	for (let y = 0; y < h; y++) {
		let row = 0;
		for (let x = 0; x < w; x++) {
			row += src[y * w + x];
			integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
		}
	}
	const out = new Float64Array(w * h);
	for (let y = 0; y < h; y++) {
		const y0 = Math.max(0, y - r);
		const y1 = Math.min(h, y + r + 1);
		for (let x = 0; x < w; x++) {
			const x0 = Math.max(0, x - r);
			const x1 = Math.min(w, x + r + 1);
			out[y * w + x] =
				integral[y1 * (w + 1) + x1] -
				integral[y0 * (w + 1) + x1] -
				integral[y1 * (w + 1) + x0] +
				integral[y0 * (w + 1) + x0];
		}
	}
	return out;
}

const dilate = (mask: Uint8Array, w: number, h: number, r: number): Uint8Array => {
	if (r < 1) return mask;
	return Uint8Array.from(boxSum(mask, w, h, r), (s) => (s > 0 ? 1 : 0));
};

/** Erode; beyond the raster is background, so a mask touching the edge erodes from it. */
const erode = (mask: Uint8Array, w: number, h: number, r: number): Uint8Array => {
	if (r < 1) return mask;
	const full = (2 * r + 1) ** 2;
	return Uint8Array.from(boxSum(mask, w, h, r), (s) => (s >= full ? 1 : 0));
};

interface Blob {
	pixels: number[];
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	touchesEdge: boolean;
}

/** 8-connected components of a mask. */
function blobs(mask: Uint8Array, w: number, h: number): Blob[] {
	const seen = new Uint8Array(w * h);
	const out: Blob[] = [];
	const stack: number[] = [];
	for (let start = 0; start < w * h; start++) {
		if (!mask[start] || seen[start]) continue;
		const b: Blob = { pixels: [], minX: w, minY: h, maxX: 0, maxY: 0, touchesEdge: false };
		seen[start] = 1;
		stack.push(start);
		while (stack.length) {
			const i = stack.pop()!;
			b.pixels.push(i);
			const x = i % w;
			const y = (i - x) / w;
			if (x < b.minX) b.minX = x;
			if (x > b.maxX) b.maxX = x;
			if (y < b.minY) b.minY = y;
			if (y > b.maxY) b.maxY = y;
			if (x === 0 || y === 0 || x === w - 1 || y === h - 1) b.touchesEdge = true;
			for (let dy = -1; dy <= 1; dy++) {
				const ny = y + dy;
				if (ny < 0 || ny >= h) continue;
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					if (nx < 0 || nx >= w) continue;
					const n = ny * w + nx;
					if (mask[n] && !seen[n]) {
						seen[n] = 1;
						stack.push(n);
					}
				}
			}
		}
		out.push(b);
	}
	return out;
}

function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
	const outside = new Uint8Array(w * h);
	const stack: number[] = [];
	const push = (i: number) => {
		if (!mask[i] && !outside[i]) (outside[i] = 1), stack.push(i);
	};
	for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
	for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
	while (stack.length) {
		const i = stack.pop()!;
		const x = i % w;
		const y = (i - x) / w;
		if (x > 0) push(i - 1);
		if (x < w - 1) push(i + 1);
		if (y > 0) push(i - w);
		if (y < h - 1) push(i + w);
	}
	return Uint8Array.from(outside, (o) => (o ? 0 : 1));
}

/** Otsu's threshold over a histogram. */
function otsu(histogram: number[]): number {
	const total = histogram.reduce((a, b) => a + b, 0);
	const sum = histogram.reduce((acc, count, value) => acc + count * value, 0);
	let below = 0;
	let belowSum = 0;
	let best = 0;
	let threshold = 0;
	for (let t = 0; t < histogram.length; t++) {
		below += histogram[t];
		if (!below) continue;
		const above = total - below;
		if (!above) break;
		belowSum += t * histogram[t];
		const between = below * above * (belowSum / below - (sum - belowSum) / above) ** 2;
		if (between > best) (best = between), (threshold = t);
	}
	return threshold;
}

const median = (values: ArrayLike<number>): number => {
	if (!values.length) return 0;
	const sorted = Float64Array.from(values).sort();
	return sorted[Math.floor(sorted.length / 2)];
};

const hex = (rgb: number[]): string =>
	'#' +
	rgb
		.map((v) =>
			Math.round(Math.max(0, Math.min(255, v)))
				.toString(16)
				.padStart(2, '0')
		)
		.join('');

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// ── Finding the pills ────────────────────────────────────────────────────────

/**
 * A pill as photographed, cut out of the photo with a small margin, with the
 * frame its imprint is measured in.
 */
interface Pill {
	/** The cut-out: its own RGB raster and the pill's mask within it. */
	w: number;
	h: number;
	rgb: Uint8Array;
	mask: Uint8Array;
	area: number;
	/** Where the cut-out sits in the photo. */
	left: number;
	top: number;
	/** Centre, in cut-out pixels. */
	cx: number;
	cy: number;
	/** The face frame: `u` along the long axis, `v` across it. */
	ux: number;
	uy: number;
	/** The face's extent in that frame, either side of the centre. */
	u0: number;
	u1: number;
	v0: number;
	v1: number;
}

/**
 * Separate the pills from the backdrop, in the photo's reading order.
 *
 * A pixel is pill if its colour is far from the backdrop's — except where it
 * is the backdrop's own hue, only darker: that is the pill's drop shadow, and
 * counting it would make a round tablet look oval and tilt its frame.
 */
function findPills(image: RgbImage, round: boolean): Pill[] {
	// A pill as dark and as grey as the backdrop's own shadow is lost to the
	// shadow test; try again without it before giving up on the photo.
	const pills = segment(image, round, true);
	return pills.length ? pills : segment(image, round, false);
}

function segment(image: RgbImage, round: boolean, rejectShadow: boolean): Pill[] {
	const { width: w, height: h, data } = image;

	const border = Math.max(2, Math.round(Math.min(w, h) * 0.03));
	const channels: number[][] = [[], [], []];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (x >= border && y >= border && x < w - border && y < h - border) continue;
			const i = (y * w + x) * 3;
			for (let c = 0; c < 3; c++) channels[c].push(data[i + c]);
		}
	}
	const backdrop = channels.map(median);
	const backdropLuma = luma(backdrop[0], backdrop[1], backdrop[2]);
	const backdropChroma = backdrop.map((v) => v - backdropLuma);

	const distance = new Uint8Array(w * h);
	const histogram = new Array(256).fill(0);
	for (let i = 0; i < w * h; i++) {
		const r = data[i * 3];
		const g = data[i * 3 + 1];
		const b = data[i * 3 + 2];
		const l = luma(r, g, b);
		const chroma = Math.hypot(
			r - l - backdropChroma[0],
			g - l - backdropChroma[1],
			b - l - backdropChroma[2]
		);
		const shadow = rejectShadow && l < backdropLuma && chroma < 9;
		const d = shadow ? 0 : Math.min(255, Math.round(Math.hypot(r - backdrop[0], g - backdrop[1], b - backdrop[2])));
		distance[i] = d;
		histogram[d]++;
	}
	const threshold = Math.max(14, otsu(histogram));

	let mask: Uint8Array = Uint8Array.from(distance, (d) => (d > threshold ? 1 : 0));
	// Open hard enough to cut a ruler's axis and ticks away from a pill that
	// rests against them; a pill is far thicker than any of its lines.
	const open = Math.max(2, Math.round(Math.min(w, h) * 0.015));
	mask = dilate(erode(mask, w, h, open), w, h, open);
	// Close, then fill holes: an imprint the colour of the backdrop must not
	// punch through the face.
	const close = Math.max(1, Math.round(Math.min(w, h) * 0.008));
	mask = erode(dilate(mask, w, h, close), w, h, close);
	mask = fillHoles(mask, w, h);

	return blobs(mask, w, h)
		.filter((b) => b.pixels.length >= w * h * 0.01 && b.pixels.length < w * h * 0.7)
		.filter((b) => {
			const bw = b.maxX - b.minX + 1;
			const bh = b.maxY - b.minY + 1;
			// A ruler strip touches the edge and is long and thin; and a pill
			// fills most of its box, which a ruler's ticks and numbers do not.
			if (b.touchesEdge && Math.max(bw / bh, bh / bw) > 4) return false;
			return b.pixels.length / (bw * bh) > 0.45;
		})
		.sort((a, b) => b.pixels.length - a.pixels.length)
		.slice(0, 4)
		.sort((a, b) => a.minY - b.minY || a.minX - b.minX)
		.map((b) => cutOut(image, b, round));
}

/**
 * Cut a pill out and give it its own frame. An elongated pill is turned so
 * its long axis runs along `u`; a round one keeps the photo's axes, since its
 * principal axis is noise and the photographer has already set its imprint
 * upright.
 */
function cutOut(image: RgbImage, b: Blob, round: boolean): Pill {
	const margin = 3;
	const left = Math.max(0, b.minX - margin);
	const top = Math.max(0, b.minY - margin);
	const w = Math.min(image.width, b.maxX + margin + 1) - left;
	const h = Math.min(image.height, b.maxY + margin + 1) - top;
	const rgb = new Uint8Array(w * h * 3);
	for (let y = 0; y < h; y++) {
		const from = ((top + y) * image.width + left) * 3;
		rgb.set(image.data.subarray(from, from + w * 3), y * w * 3);
	}
	const mask = new Uint8Array(w * h);
	let sx = 0;
	let sy = 0;
	for (const i of b.pixels) {
		const x = (i % image.width) - left;
		const y = Math.floor(i / image.width) - top;
		mask[y * w + x] = 1;
		sx += x;
		sy += y;
	}
	const n = b.pixels.length;
	const cx = sx / n;
	const cy = sy / n;

	let xx = 0;
	let yy = 0;
	let xy = 0;
	for (let i = 0; i < w * h; i++) {
		if (!mask[i]) continue;
		const dx = (i % w) - cx;
		const dy = Math.floor(i / w) - cy;
		xx += dx * dx;
		yy += dy * dy;
		xy += dx * dy;
	}
	const spread = Math.sqrt(((xx - yy) / n) ** 2 + 4 * (xy / n) ** 2);
	const major = (xx + yy) / n / 2 + spread / 2;
	const minor = (xx + yy) / n / 2 - spread / 2;
	let angle = 0;
	if (!round && minor > 0 && Math.sqrt(major / minor) > 1.12) {
		angle = 0.5 * Math.atan2(2 * xy, xx - yy);
		// Snap to the photo's axes when nearly aligned: a frame a degree off
		// costs more in resampled crops than it gains.
		const snap = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
		if (Math.abs(angle - snap) < 0.06) angle = snap;
	}
	const ux = Math.cos(angle);
	const uy = Math.sin(angle);

	let u0 = Infinity;
	let u1 = -Infinity;
	let v0 = Infinity;
	let v1 = -Infinity;
	for (let i = 0; i < w * h; i++) {
		if (!mask[i]) continue;
		const dx = (i % w) - cx;
		const dy = Math.floor(i / w) - cy;
		const u = dx * ux + dy * uy;
		const v = -dx * uy + dy * ux;
		if (u < u0) u0 = u;
		if (u > u1) u1 = u;
		if (v < v0) v0 = v;
		if (v > v1) v1 = v;
	}
	return { w, h, rgb, mask, area: n, left, top, cx, cy, ux, uy, u0, u1, v0, v1 };
}

// ── Finding the imprint on a pill ────────────────────────────────────────────

/** One glyph — or a glyph-sized mark — in face-frame pixels. */
interface Glyph {
	u0: number;
	u1: number;
	v0: number;
	v1: number;
	pixels: number[];
}

interface FaceMarks {
	glyphs: Glyph[];
	/** Glyph indices per line of text, left to right. */
	lines: number[][];
	scores: { dir: 'h' | 'v'; at: number }[];
	/** How far each pixel departs from its neighbourhood, for OCR crops. */
	detail: Float32Array;
	threshold: number;
	/** Which glyph each pixel belongs to, plus one; 0 for none. */
	owner: Int32Array;
	marks: Uint8Array;
}

const frameOf = (pill: Pill, i: number): [number, number] => {
	const dx = (i % pill.w) - pill.cx;
	const dy = Math.floor(i / pill.w) - pill.cy;
	return [dx * pill.ux + dy * pill.uy, -dx * pill.uy + dy * pill.ux];
};

/**
 * Imprint marks are where the face departs sharply from its own local mean:
 * a debossed letter is a shadow beside a highlight, a printed one is ink.
 * The face is eroded first, so the bevel's shading at the rim is not read as
 * a mark.
 */
function findMarks(pill: Pill, capsule: boolean): FaceMarks {
	const { w, h, rgb } = pill;
	const extentU = pill.u1 - pill.u0;
	const extentV = pill.v1 - pill.v0;
	const size = Math.min(extentU, extentV);
	const interior = erode(pill.mask, w, h, Math.max(2, Math.round(size * 0.06)));

	const gray = new Float32Array(w * h);
	for (let i = 0; i < w * h; i++) gray[i] = luma(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
	const r = Math.max(2, Math.round(size * 0.12));
	// Mean over the face only, so the backdrop beyond the rim never bleeds in.
	const sums = boxSum(
		Float32Array.from(gray, (g, i) => (pill.mask[i] ? g : 0)),
		w,
		h,
		r
	);
	const counts = boxSum(pill.mask, w, h, r);

	const detail = new Float32Array(w * h);
	const magnitudes: number[] = [];
	for (let i = 0; i < w * h; i++) {
		if (!interior[i]) continue;
		detail[i] = gray[i] - sums[i] / Math.max(1, counts[i]);
		magnitudes.push(Math.abs(detail[i]));
	}
	const sigma = 1.4826 * median(magnitudes) || 1;
	const threshold = Math.max(6, sigma * 3.2);

	// Glyphs are segmented in one sign only. Printed ink is dark (or, on a
	// dark capsule, light) and ringed by a halo of the opposite sign where the
	// local mean dips beside it; taking both signs joins a word's letters
	// through their halos. A debossed letter is a shadow and a highlight, and
	// its shadow is the deeper of the two, so it is found in the dark sign too.
	// Light wins only where strongly light marks clearly outnumber dark ones.
	let dark = 0;
	let light = 0;
	for (let i = 0; i < w * h; i++) {
		if (!interior[i]) continue;
		if (detail[i] < -threshold * 3) dark++;
		else if (detail[i] > threshold * 3) light++;
	}
	const sign = light > dark * 2 ? 1 : -1;
	let marks: Uint8Array = Uint8Array.from(detail, (d, i) => (interior[i] && d * sign > threshold ? 1 : 0));
	const join = Math.max(1, Math.round(size * 0.006));
	marks = erode(dilate(marks, w, h, join), w, h, join);
	for (let i = 0; i < w * h; i++) if (!interior[i]) marks[i] = 0;

	const scores: FaceMarks['scores'] = [];
	const raw: Glyph[] = [];
	for (const b of blobs(marks, w, h)) {
		let u0 = Infinity;
		let u1 = -Infinity;
		let v0 = Infinity;
		let v1 = -Infinity;
		for (const i of b.pixels) {
			const [u, v] = frameOf(pill, i);
			if (u < u0) u0 = u;
			if (u > u1) u1 = u;
			if (v < v0) v0 = v;
			if (v > v1) v1 = v;
		}
		const du = u1 - u0;
		const dv = v1 - v0;
		// Specks: texture, dust, a glint.
		if (Math.max(du, dv) < size * 0.045) continue;
		// A long thin mark across the face is a score — or, on a capsule, the
		// seam and the cap's ridges, which are not imprint either way.
		if (du > extentU * 0.45 && dv < extentV * 0.09) {
			if (!capsule) scores.push({ dir: 'h', at: ((v0 + v1) / 2 - pill.v0) / extentV });
			continue;
		}
		if (dv > extentV * 0.45 && du < extentU * 0.09) {
			if (!capsule) scores.push({ dir: 'v', at: ((u0 + u1) / 2 - pill.u0) / extentU });
			continue;
		}
		// Shading over much of the face is lighting, not a letter.
		if (b.pixels.length > pill.area * 0.2 || du > extentU * 0.7 || dv > extentV * 0.6) continue;
		raw.push({ u0, u1, v0, v1, pixels: b.pixels });
	}

	const glyphs = mergeGlyphs(raw);
	const owner = new Int32Array(w * h);
	glyphs.forEach((g, k) => g.pixels.forEach((i) => (owner[i] = k + 1)));
	return { glyphs, lines: linesOf(glyphs), scores: dedupeScores(scores), detail, threshold, owner, marks };
}

/** Two halves of a score's groove read as two lines; keep one. */
function dedupeScores(scores: FaceMarks['scores']): FaceMarks['scores'] {
	const out: FaceMarks['scores'] = [];
	for (const s of scores) {
		if (!out.some((o) => o.dir === s.dir && Math.abs(o.at - s.at) < 0.08)) out.push(s);
	}
	return out;
}

/**
 * A debossed letter can come apart into its shadow and its highlight, and an
 * `i` into stem and dot: marks whose boxes mostly overlap, or that stack
 * tightly within one column, are one glyph.
 */
function mergeGlyphs(raw: Glyph[]): Glyph[] {
	const parent = raw.map((_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	const typical = median(raw.map((g) => g.v1 - g.v0)) || 1;
	for (let a = 0; a < raw.length; a++) {
		for (let b = a + 1; b < raw.length; b++) {
			const ga = raw[a];
			const gb = raw[b];
			const ou = Math.min(ga.u1, gb.u1) - Math.max(ga.u0, gb.u0);
			const ov = Math.min(ga.v1, gb.v1) - Math.max(ga.v0, gb.v0);
			const areaA = (ga.u1 - ga.u0) * (ga.v1 - ga.v0);
			const areaB = (gb.u1 - gb.u0) * (gb.v1 - gb.v0);
			const overlapping = ou > 0 && ov > 0 && ou * ov > Math.min(areaA, areaB) * 0.35;
			const narrower = Math.max(1, Math.min(ga.u1 - ga.u0, gb.u1 - gb.u0));
			const gapV = Math.max(ga.v0, gb.v0) - Math.min(ga.v1, gb.v1);
			const stacked = ou > narrower * 0.6 && gapV < typical * 0.2 && Math.max(ga.v1, gb.v1) - Math.min(ga.v0, gb.v0) < typical * 1.3;
			if (overlapping || stacked) parent[find(a)] = find(b);
		}
	}
	const merged = new Map<number, Glyph>();
	raw.forEach((g, i) => {
		const root = find(i);
		const held = merged.get(root);
		if (!held) return merged.set(root, { ...g, pixels: [...g.pixels] });
		held.u0 = Math.min(held.u0, g.u0);
		held.u1 = Math.max(held.u1, g.u1);
		held.v0 = Math.min(held.v0, g.v0);
		held.v1 = Math.max(held.v1, g.v1);
		held.pixels.push(...g.pixels);
	});
	return [...merged.values()];
}

/**
 * Glyphs into lines: neighbours that share most of their height and sit
 * within a couple of letters of each other. A wider gap starts a new line
 * even at the same height — `SO | 80` across a score are two.
 */
function linesOf(glyphs: Glyph[]): number[][] {
	const parent = glyphs.map((_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	for (let a = 0; a < glyphs.length; a++) {
		for (let b = a + 1; b < glyphs.length; b++) {
			const ga = glyphs[a];
			const gb = glyphs[b];
			const ov = Math.min(ga.v1, gb.v1) - Math.max(ga.v0, gb.v0);
			const shorter = Math.max(1, Math.min(ga.v1 - ga.v0, gb.v1 - gb.v0));
			const taller = Math.max(ga.v1 - ga.v0, gb.v1 - gb.v0);
			const gapU = Math.max(ga.u0, gb.u0) - Math.min(ga.u1, gb.u1);
			if (ov > shorter * 0.5 && gapU < taller * 1.2) parent[find(a)] = find(b);
		}
	}
	const lines = new Map<number, number[]>();
	glyphs.forEach((_, i) => lines.set(find(i), [...(lines.get(find(i)) ?? []), i]));
	return [...lines.values()].map((line) => line.sort((a, b) => glyphs[a].u0 - glyphs[b].u0));
}

// ── Reading and matching ─────────────────────────────────────────────────────

/** Case- and punctuation-blind form for comparing a reading to a section. */
const norm = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');

function levenshtein(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let previous = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const held = row[j];
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
			previous = held;
		}
	}
	return row[b.length];
}

/** A run of neighbouring glyphs on one line that one section might be. */
interface Candidate {
	face: number;
	glyphs: number[];
	u0: number;
	u1: number;
	v0: number;
	v1: number;
	/** Readings: upright, then turned half round when the pill can be. */
	reads: string[];
	/**
	 * Well under the face's typical letter height: a chip off a letter, a
	 * superscript, a glint — rarely a section of its own.
	 */
	short: boolean;
}

/** Every contiguous run on a line, up to the longest section plus slack. */
function candidatesOf(face: number, marks: FaceMarks, longest: number): Candidate[] {
	const out: Candidate[] = [];
	const typical = median(marks.glyphs.map((g) => g.v1 - g.v0));
	for (const line of marks.lines) {
		for (let s = 0; s < line.length; s++) {
			for (let e = s; e < line.length && e - s < longest + 2; e++) {
				const run = line.slice(s, e + 1).map((k) => marks.glyphs[k]);
				out.push({
					face,
					glyphs: line.slice(s, e + 1),
					u0: Math.min(...run.map((g) => g.u0)),
					u1: Math.max(...run.map((g) => g.u1)),
					v0: Math.min(...run.map((g) => g.v0)),
					v1: Math.max(...run.map((g) => g.v1)),
					reads: [],
					short: Math.max(...run.map((g) => g.v1 - g.v0)) < typical * 0.6
				});
			}
		}
	}
	return out;
}

/**
 * A candidate's glyphs rendered upright as dark strokes on white, from the
 * face's local contrast rather than its raw grey: a debossed letter's shadow
 * and highlight both come out dark, which is the closest a photo of a groove
 * gets to ink. Pixels of glyphs outside the run are left white so a
 * neighbour's edge never reads as a letter.
 */
function cropOf(pill: Pill, marks: FaceMarks, box: Candidate, flip: boolean): GrayCrop {
	const height0 = box.v1 - box.v0;
	const pad = height0 * 0.35 + 2;
	const scale = Math.max(1, 56 / Math.max(1, height0));
	const width = Math.max(8, Math.round((box.u1 - box.u0 + 2 * pad) * scale));
	const height = Math.max(8, Math.round((height0 + 2 * pad) * scale));
	const data = new Uint8Array(width * height).fill(255);
	const inRun = new Set(box.glyphs.map((k) => k + 1));
	const gain = 255 / (marks.threshold * 2.5);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const fx = flip ? width - 1 - x : x;
			const fy = flip ? height - 1 - y : y;
			const u = box.u0 - pad + fx / scale;
			const v = box.v0 - pad + fy / scale;
			const px = pill.cx + u * pill.ux - v * pill.uy;
			const py = pill.cy + u * pill.uy + v * pill.ux;
			const x0 = Math.floor(px);
			const y0 = Math.floor(py);
			if (x0 < 0 || y0 < 0 || x0 + 1 >= pill.w || y0 + 1 >= pill.h) continue;
			const nearest = Math.round(py) * pill.w + Math.round(px);
			const who = marks.owner[nearest];
			if (who && !inRun.has(who)) continue;
			// Bilinear: the crop is scaled up several times, and nearest-neighbour
			// blocks read to tesseract as serifs and breaks.
			const fx0 = px - x0;
			const fy0 = py - y0;
			const at = (xx: number, yy: number) => Math.abs(marks.detail[yy * pill.w + xx]);
			const d =
				at(x0, y0) * (1 - fx0) * (1 - fy0) +
				at(x0 + 1, y0) * fx0 * (1 - fy0) +
				at(x0, y0 + 1) * (1 - fx0) * fy0 +
				at(x0 + 1, y0 + 1) * fx0 * fy0;
			if (d < marks.threshold * 0.6) continue;
			data[y * width + x] = 255 - Math.min(255, d * gain);
		}
	}
	return { width, height, data };
}

/** How poorly a run of glyphs matches a section: 0 is perfect, 1 hopeless. */
function costOf(section: string, candidate: Candidate): number {
	return Math.min(1, textCost(section, candidate) + (candidate.short ? 0.2 : 0));
}

function textCost(section: string, candidate: Candidate): number {
	const want = norm(section);
	const glyphs = candidate.glyphs.length;
	const count = Math.abs(want.length - glyphs) / Math.max(want.length, glyphs, 1);
	// Glyph count alone is evidence, not proof; it never scores as well as a
	// good reading. A bad reading, though, is no evidence against: OCR misreads
	// a debossed 3 far more often than a photo shows the wrong digit.
	const byCount = Math.min(1, 0.3 + count);
	const readings = candidate.reads.map(norm).filter(Boolean);
	if (!readings.length) return byCount;
	const read = Math.min(...readings.map((r) => levenshtein(want, r) / Math.max(want.length, r.length)));
	return Math.min(byCount, 0.7 * read + 0.3 * count);
}

/**
 * The cheapest way to give each section its own run of glyphs. A section may
 * go unplaced, at a price above any acceptable match; a glyph left over costs
 * a little; and a later section placed above or before an earlier one on the
 * same face, or a change of face between consecutive sections, costs a
 * little, since labels list an imprint face by face in reading order.
 */
function assign(sections: string[], candidates: Candidate[], glyphCount: number): (Candidate | null)[] {
	const costs = sections.map((s) => candidates.map((c) => costOf(s, c)));
	const orders = costs.map((row) =>
		row
			.map((cost, i) => ({ cost, i }))
			.filter((entry) => entry.cost <= MAX_MATCH_COST)
			.sort((a, b) => a.cost - b.cost)
			.map((entry) => entry.i)
	);
	let best: { total: number; picks: number[] } = { total: Infinity, picks: [] };
	const used = new Set<string>();
	const picks: number[] = [];
	const keysOf = (c: Candidate) => c.glyphs.map((g) => `${c.face}:${g}`);

	// Labels list an imprint face by face, so consecutive sections on
	// different faces cost a little more than the same sections kept together.
	const outOfOrder = () => {
		let penalty = 0;
		const faces = picks.filter((p) => p >= 0).map((p) => candidates[p].face);
		for (let k = 1; k < faces.length; k++) if (faces[k] !== faces[k - 1]) penalty += 0.05;
		for (let a = 0; a < picks.length; a++) {
			for (let b = a + 1; b < picks.length; b++) {
				if (picks[a] < 0 || picks[b] < 0) continue;
				const ca = candidates[picks[a]];
				const cb = candidates[picks[b]];
				if (ca.face !== cb.face) continue;
				const above = cb.v1 < (ca.v0 + ca.v1) / 2;
				const before = !above && cb.u1 < ca.u0 && Math.min(ca.v1, cb.v1) > Math.max(ca.v0, cb.v0);
				if (above || before) penalty += 0.04;
			}
		}
		return penalty;
	};

	const search = (index: number, total: number) => {
		if (total >= best.total) return;
		if (index === sections.length) {
			const leftover = (glyphCount - used.size) * LEFTOVER_COST;
			const full = total + leftover + outOfOrder();
			if (full < best.total) best = { total: full, picks: [...picks] };
			return;
		}
		for (const c of orders[index]) {
			const keys = keysOf(candidates[c]);
			if (keys.some((k) => used.has(k))) continue;
			keys.forEach((k) => used.add(k));
			picks.push(c);
			search(index + 1, total + costs[index][c]);
			picks.pop();
			keys.forEach((k) => used.delete(k));
		}
		picks.push(-1);
		search(index + 1, total + UNPLACED_COST);
		picks.pop();
	};
	search(0, 0);
	return best.picks.map((p) => (p < 0 ? null : candidates[p]));
}

/** Median colour of a face's pixels that pass `keep`, imprint excluded. */
function colourOf(pill: Pill, marks: FaceMarks, keep: (i: number) => boolean): string {
	const channels: number[][] = [[], [], []];
	for (let i = 0; i < pill.w * pill.h; i++) {
		if (!pill.mask[i] || marks.marks[i] || !keep(i)) continue;
		for (let c = 0; c < 3; c++) channels[c].push(pill.rgb[i * 3 + c]);
	}
	return hex(channels.map(median));
}

// ── The whole measurement ────────────────────────────────────────────────────

export interface AnalyzeOptions {
	/** Reads a crop of glyphs; omit to match on glyph counts alone. */
	read?: CropReader;
	/** The label's coded shape. A round face keeps the photo's own axes. */
	shape?: string | null;
	/** Measure as a two-piece capsule: no score lines, and the seam is not a mark. */
	capsule?: boolean;
	/** Receives every box found, in photo pixels, for tuning by eye. */
	debug?: (boxes: DebugBox[]) => void;
}

/** A box as photographed, and the section it was matched to, if any. */
export interface DebugBox {
	corners: [number, number][];
	kind: 'pill' | 'glyph' | 'match';
	label: string | null;
	read: string[];
}

/**
 * Measure where an imprint's sections sit in a photo of the pill.
 *
 * Null when the photo shows no pill this can separate from its backdrop, or
 * the imprint states nothing to look for.
 */
export async function analyzePillImage(
	image: RgbImage,
	imprint: string | null,
	options: AnalyzeOptions = {}
): Promise<PillImageLayout | null> {
	const sections = imprintFaces(imprint);
	if (!sections.length) return null;
	const round = (options.shape ?? '').toUpperCase() === 'ROUND';
	const pills = findPills(image, round);
	if (!pills.length) return null;

	const measured = pills.map((pill) => ({ pill, marks: findMarks(pill, !!options.capsule) }));
	const longest = Math.max(...sections.map((s) => norm(s).length));
	const candidates = measured.flatMap((m, face) => candidatesOf(face, m.marks, longest));

	const whitelist = [...new Set(sections.join('').replace(/\s/g, ''))].join('');
	if (options.read && whitelist) {
		// Only runs whose length could be some section are worth a reading.
		const lengths = new Set(sections.map((s) => norm(s).length));
		const worth = (c: Candidate) => [...lengths].some((n) => Math.abs(n - c.glyphs.length) <= 1);
		for (const candidate of candidates.filter(worth)) {
			const { pill, marks } = measured[candidate.face];
			for (const flip of round ? [false] : [false, true]) {
				candidate.reads.push((await options.read(cropOf(pill, marks, candidate, flip), whitelist)) ?? '');
			}
		}
	}

	const glyphCount = measured.reduce((n, m) => n + m.marks.glyphs.length, 0);
	const placed = assign(sections, candidates, glyphCount);

	// Whether each pill reads better turned half round, decided by which
	// orientation its matched runs read closer in.
	const flipped = measured.map((_, face) => {
		let upright = 0;
		let turned = 0;
		placed.forEach((c, s) => {
			if (!c || c.face !== face || c.reads.length < 2) return;
			const want = norm(sections[s]);
			upright += levenshtein(want, norm(c.reads[0]));
			turned += levenshtein(want, norm(c.reads[1]));
		});
		return turned < upright;
	});

	if (options.debug) options.debug(debugBoxes(measured, placed, sections));

	const faces = measured.map(({ pill, marks }, face) => {
		const extentU = pill.u1 - pill.u0;
		const extentV = pill.v1 - pill.v0;
		const flip = flipped[face];
		const turn = (t: number) => (flip ? 1 - t : t);
		const elements: MeasuredElement[] = [];
		placed.forEach((c, segment) => {
			if (!c || c.face !== face) return;
			elements.push({
				segment,
				text: sections[segment],
				x: round3(turn(((c.u0 + c.u1) / 2 - pill.u0) / extentU)),
				y: round3(turn(((c.v0 + c.v1) / 2 - pill.v0) / extentV)),
				w: round3((c.u1 - c.u0) / extentU),
				h: round3((c.v1 - c.v0) / extentV),
				read: c.reads[flip ? 1 : 0] || null,
				cost: round3(costOf(sections[segment], c))
			});
		});
		const used = new Set(placed.flatMap((c) => (c && c.face === face ? c.glyphs : [])));
		const side = (i: number) => frameOf(pill, i)[0] * (flip ? -1 : 1) < 0;
		const result: MeasuredFace = {
			aspect: round3(Math.max(extentU, extentV) / Math.max(1, Math.min(extentU, extentV))),
			fill: colourOf(pill, marks, () => true),
			halves: [colourOf(pill, marks, side), colourOf(pill, marks, (i) => !side(i))],
			elements,
			scores: marks.scores.map((s) => ({ dir: s.dir, at: round3(turn(s.at)) })),
			unmatched: marks.glyphs.length - used.size
		};
		return result;
	});

	// The face carrying the earliest section is the front; faces with nothing
	// placed follow in the photo's order, which is how a blank back is shown.
	const firstSection = (f: MeasuredFace) => (f.elements.length ? f.elements[0].segment : Infinity);
	const ordered = faces
		.map((face, index) => ({ face, index }))
		.sort((a, b) => firstSection(a.face) - firstSection(b.face) || a.index - b.index)
		.map((entry) => entry.face);

	const quality = placed.reduce((sum, c, s) => sum + (c ? 1 - costOf(sections[s], c) : 0), 0);
	return {
		faces: ordered,
		missing: placed.flatMap((c, s) => (c ? [] : [s])),
		confidence: round3(quality / sections.length)
	};
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function debugBoxes(
	measured: { pill: Pill; marks: FaceMarks }[],
	placed: (Candidate | null)[],
	sections: string[]
): DebugBox[] {
	const boxes: DebugBox[] = [];
	measured.forEach(({ pill, marks }, face) => {
		const corners = (b: { u0: number; u1: number; v0: number; v1: number }): [number, number][] =>
			[
				[b.u0, b.v0],
				[b.u1, b.v0],
				[b.u1, b.v1],
				[b.u0, b.v1]
			].map(([u, v]) => [
				Math.round(pill.left + pill.cx + u * pill.ux - v * pill.uy),
				Math.round(pill.top + pill.cy + u * pill.uy + v * pill.ux)
			]);
		boxes.push({ corners: corners(pill), kind: 'pill', label: `pill ${face}`, read: [] });
		for (const g of marks.glyphs) boxes.push({ corners: corners(g), kind: 'glyph', label: null, read: [] });
		placed.forEach((c, s) => {
			if (c && c.face === face) boxes.push({ corners: corners(c), kind: 'match', label: sections[s], read: c.reads });
		});
	});
	return boxes;
}
