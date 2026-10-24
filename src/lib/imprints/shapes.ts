/**
 * Shape definitions used by ILN: the 19 FDA SPL shapes (NCI value set C48557)
 * plus ILN extension shapes, and the per-face direction tag that records which
 * way a directional outline points in the canonical view, e.g. F[TIP@E].
 *
 * The canonical view is set by the face's text, so a tear-shaped tablet whose
 * text reads upright may have its tip at E or W; the tag records which. Faces
 * without straight text are oriented to the shape's default, which is omitted.
 *
 * @module
 */

import { COMPASS_DEG, formatPoint } from './iln-location.ts';

export type Feature = 'TIP' | 'FLAT' | 'BASE' | 'CORNER' | 'LOBE' | 'NOTCH';

export interface ShapeDef {
	id: string;
	label: string;
	source: 'SPL' | 'ILN';
	/** The official SPL shape term and its NCI code; absent for ILN extensions. */
	spl?: { term: string; code: string };
	/** For ILN extensions: the SPL terms to fall back to where only SPL vocabulary is allowed. */
	splFallback?: string[];
	/** The Drugs.com pill-identifier shape term, when there is a clear match. */
	drugsCom?: string;
	/** Whether the outline is elongated; its long axis is horizontal in the canonical view. */
	elongated: boolean;
	/** Direction features this outline has; empty when it has none. */
	features: Feature[];
	/** Orientation to assume when no imprint text decides it. */
	defaultOrient?: { feature: Feature; deg: number };
	/**
	 * Compass degrees where the feature may sit in the canonical view.
	 * @defaultValue anywhere
	 */
	allowedDegs?: number[];
	/** `HOLES` id, for composite shapes such as DONUT. */
	hole?: string;
	description: string;
	aliases: string[];
}

/** Letters that can be through-holes, and those that look the same mirrored left to right. */
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const SYMMETRIC_LETTERS = 'AHIMOTUVWXY'.split('');

const spl = (term: string, code: string) => ({ term, code });
/** Compass degrees of the ends of an elongated outline. */
const EW = [90, 270];
/** Compass degrees of the long sides of an elongated outline. */
const NS = [0, 180];

export const SHAPES: ShapeDef[] = [
	{
		id: 'BULLET',
		label: 'Bullet',
		source: 'SPL',
		spl: spl('BULLET', 'C48335'),
		elongated: true,
		features: ['TIP'],
		defaultOrient: { feature: 'TIP', deg: 90 },
		allowedDegs: EW,
		description:
			'Elongated; one end rounded or pointed, the other flat or blunt. TIP marks the pointed end.',
		aliases: []
	},
	{
		id: 'CAPSULE',
		label: 'Capsule-shaped',
		source: 'SPL',
		spl: spl('CAPSULE', 'C48336'),
		drugsCom: 'Capsule/Oblong',
		elongated: true,
		features: [],
		description:
			'Straight long sides with semicircular ends (stadium). The shape, not the capsule dosage form.',
		aliases: ['OBLONG', 'CAPLET', 'STADIUM']
	},
	{
		id: 'CLOVER',
		label: 'Clover',
		source: 'SPL',
		spl: spl('CLOVER', 'C48337'),
		elongated: false,
		features: ['LOBE'],
		defaultOrient: { feature: 'LOBE', deg: 0 },
		description: 'Lobed outline. LOBE gives the direction of one lobe.',
		aliases: []
	},
	{
		id: 'DIAMOND',
		label: 'Diamond',
		source: 'SPL',
		spl: spl('DIAMOND', 'C48338'),
		elongated: false,
		features: ['CORNER'],
		defaultOrient: { feature: 'CORNER', deg: 0 },
		description: 'Rhombus. CORNER gives the direction of a corner.',
		aliases: ['RHOMBUS']
	},
	{
		id: 'DOUBLE CIRCLE',
		label: 'Double circle',
		source: 'SPL',
		spl: spl('DOUBLE CIRCLE', 'C48339'),
		drugsCom: 'Figure eight-shape',
		elongated: true,
		features: [],
		description: 'Two overlapping circles (figure-eight outline).',
		aliases: ['FIGURE EIGHT', 'FIGURE 8']
	},
	{
		id: 'FREEFORM',
		label: 'Freeform',
		source: 'SPL',
		spl: spl('FREEFORM', 'C48340'),
		elongated: false,
		features: [],
		description: 'Any outline not covered by another term. Orient by text only.',
		aliases: []
	},
	{
		id: 'GEAR',
		label: 'Gear',
		source: 'SPL',
		spl: spl('GEAR', 'C48341'),
		drugsCom: 'Gear-shape',
		elongated: false,
		features: [],
		description: 'Toothed outline. Rim codes follow the teeth.',
		aliases: []
	},
	{
		id: 'HEPTAGON',
		label: 'Heptagon',
		source: 'SPL',
		spl: spl('HEPTAGON (7 sided)', 'C48342'),
		drugsCom: 'Seven-sided',
		elongated: false,
		features: ['TIP'],
		defaultOrient: { feature: 'TIP', deg: 0 },
		description: 'Seven sides. TIP gives the vertex opposite a flat side.',
		aliases: ['7 SIDED']
	},
	{
		id: 'HEXAGON',
		label: 'Hexagon',
		source: 'SPL',
		spl: spl('HEXAGON (6 sided)', 'C48343'),
		drugsCom: 'Six-sided',
		elongated: false,
		features: ['FLAT', 'CORNER'],
		defaultOrient: { feature: 'FLAT', deg: 0 },
		description: 'Six sides. FLAT@N = flat top; CORNER@N = pointed top.',
		aliases: ['6 SIDED']
	},
	{
		id: 'OCTAGON',
		label: 'Octagon',
		source: 'SPL',
		spl: spl('OCTAGON (8 sided)', 'C48344'),
		drugsCom: 'Eight-sided',
		elongated: false,
		features: ['FLAT', 'CORNER'],
		defaultOrient: { feature: 'FLAT', deg: 0 },
		description: 'Eight sides. FLAT@N = flat top; CORNER@N = pointed top.',
		aliases: ['8 SIDED']
	},
	{
		id: 'OVAL',
		label: 'Oval',
		source: 'SPL',
		spl: spl('OVAL', 'C48345'),
		drugsCom: 'Oval',
		elongated: true,
		features: [],
		description: 'Ellipse-like, curved all the way round.',
		aliases: ['ELLIPTICAL', 'ELLIPSE']
	},
	{
		id: 'PENTAGON',
		label: 'Pentagon',
		source: 'SPL',
		spl: spl('PENTAGON (5 sided)', 'C48346'),
		drugsCom: 'Five-sided',
		elongated: false,
		features: ['TIP'],
		defaultOrient: { feature: 'TIP', deg: 0 },
		description: 'Five sides. TIP gives the vertex opposite a flat side.',
		aliases: ['5 SIDED']
	},
	{
		id: 'RECTANGLE',
		label: 'Rectangle',
		source: 'SPL',
		spl: spl('RECTANGLE', 'C48347'),
		drugsCom: 'Rectangle',
		elongated: true,
		features: [],
		description: 'Four straight sides, square or slightly rounded corners.',
		aliases: []
	},
	{
		id: 'ROUND',
		label: 'Round',
		source: 'SPL',
		spl: spl('ROUND', 'C48348'),
		drugsCom: 'Round',
		elongated: false,
		features: [],
		description: 'Circular.',
		aliases: ['CIRCLE', 'CIRCULAR']
	},
	{
		id: 'SEMI-CIRCLE',
		label: 'Semicircle',
		source: 'SPL',
		spl: spl('SEMI-CIRCLE', 'C48349'),
		elongated: false,
		features: ['FLAT'],
		defaultOrient: { feature: 'FLAT', deg: 180 },
		description: 'Half circle. FLAT gives the direction of the straight side.',
		aliases: ['SEMICIRCLE', 'HALF CIRCLE', 'D SHAPE']
	},
	{
		id: 'SQUARE',
		label: 'Square',
		source: 'SPL',
		spl: spl('SQUARE', 'C48350'),
		elongated: false,
		features: ['FLAT', 'CORNER'],
		defaultOrient: { feature: 'FLAT', deg: 0 },
		description: 'Four equal sides. CORNER@N = turned 45° (diamond-like presentation).',
		aliases: []
	},
	{
		id: 'TEAR',
		label: 'Tear',
		source: 'SPL',
		spl: spl('TEAR', 'C48351'),
		elongated: true,
		features: ['TIP'],
		defaultOrient: { feature: 'TIP', deg: 90 },
		allowedDegs: EW,
		description: 'Teardrop; rounded at one end, pointed at the other. TIP marks the point.',
		aliases: ['TEARDROP']
	},
	{
		id: 'TRAPEZOID',
		label: 'Trapezoid',
		source: 'SPL',
		spl: spl('TRAPEZOID', 'C48352'),
		elongated: false,
		features: ['BASE'],
		defaultOrient: { feature: 'BASE', deg: 180 },
		description:
			'Four sides, one pair parallel. BASE gives the direction of the longer parallel side.',
		aliases: []
	},
	{
		id: 'TRIANGLE',
		label: 'Triangle',
		source: 'SPL',
		spl: spl('TRIANGLE', 'C48353'),
		drugsCom: 'Three-sided',
		elongated: false,
		features: ['TIP'],
		defaultOrient: { feature: 'TIP', deg: 0 },
		description: 'Three sides. TIP gives the direction of the apex.',
		aliases: []
	},

	// ── ILN extensions (no SPL code; report the fallback term in SPL) ──
	{
		id: 'THIN OVAL',
		label: 'Thin oval',
		source: 'ILN',
		splFallback: ['OVAL'],
		elongated: true,
		features: [],
		description: 'Oval whose length is at least twice its width.',
		aliases: ['NARROW OVAL', 'SLIM OVAL', 'ELONGATED OVAL']
	},
	{
		id: 'PAREN',
		label: '() shape',
		source: 'ILN',
		splFallback: ['CAPSULE', 'RECTANGLE'],
		elongated: true,
		features: [],
		description:
			'Straight top and bottom edges with shallow outward-curved ends, like "( )". The ends are flatter than the semicircular ends of CAPSULE.',
		aliases: ['()', '( )', 'PARENTHESES', 'ARCHED RECTANGLE', 'BARREL END']
	},
	{
		id: 'BARREL',
		label: 'Barrel',
		source: 'ILN',
		drugsCom: 'Barrel',
		splFallback: ['RECTANGLE', 'CAPSULE'],
		elongated: true,
		features: [],
		description:
			'Drugs.com category: rectangle-like outline with bowed (convex) sides. Possibly the same outline as PAREN; merge them if your images agree.',
		aliases: []
	},
	{
		id: 'U-SHAPE',
		label: 'U-shape',
		source: 'ILN',
		drugsCom: 'U-shape',
		splFallback: ['SEMI-CIRCLE', 'FREEFORM'],
		elongated: false,
		features: ['FLAT'],
		defaultOrient: { feature: 'FLAT', deg: 0 },
		description:
			'One straight (or nearly straight) edge with the opposite end fully rounded, like a filled letter U; taller than a semicircle. FLAT gives the straight edge.',
		aliases: ['U SHAPED', 'U']
	},
	{
		id: 'SHIELD',
		label: 'Shield',
		source: 'ILN',
		splFallback: ['FREEFORM'],
		elongated: false,
		features: ['TIP'],
		defaultOrient: { feature: 'TIP', deg: 180 },
		description:
			'Flat or slightly convex top edge with sides curving down to a rounded point, like a heraldic shield. TIP gives the point. Drugs.com files many of these under U-shape.',
		aliases: ['SHIELD SHAPED', 'SHIELD SHAPE']
	},
	{
		id: 'EGG',
		label: 'Egg',
		source: 'ILN',
		drugsCom: 'Egg-shape',
		splFallback: ['OVAL'],
		elongated: true,
		features: ['TIP'],
		defaultOrient: { feature: 'TIP', deg: 90 },
		allowedDegs: EW,
		description: 'Oval with one end narrower than the other. TIP gives the narrow end.',
		aliases: ['OVOID', 'EGG SHAPED']
	},
	{
		id: 'HEART',
		label: 'Heart',
		source: 'ILN',
		drugsCom: 'Heart-shape',
		splFallback: ['FREEFORM'],
		elongated: false,
		features: ['TIP'],
		defaultOrient: { feature: 'TIP', deg: 180 },
		description: 'Heart outline. TIP gives the point opposite the two lobes.',
		aliases: ['HEART SHAPED']
	},
	{
		id: 'KIDNEY',
		label: 'Kidney',
		source: 'ILN',
		drugsCom: 'Kidney-shape',
		splFallback: ['FREEFORM', 'OVAL'],
		elongated: true,
		features: ['NOTCH'],
		defaultOrient: { feature: 'NOTCH', deg: 0 },
		allowedDegs: NS,
		description: 'Bean outline, one long side concave. NOTCH gives the concave side.',
		aliases: ['BEAN', 'KIDNEY SHAPED']
	},
	{
		id: 'CHARACTER',
		label: 'Character',
		source: 'ILN',
		drugsCom: 'Character-shape',
		splFallback: ['FREEFORM'],
		elongated: false,
		features: [],
		description:
			'Figurative outline (animal, cartoon character). Describe the figure in a free-text field; orient by text, else by the figure standing upright.',
		aliases: ['CHARACTER SHAPED', 'ANIMAL', 'NOVELTY']
	},
	{
		id: 'DONUT',
		label: 'Donut',
		source: 'ILN',
		splFallback: ['ROUND'],
		hole: 'ROUND',
		elongated: false,
		features: [],
		description:
			'Round outline with a round through-hole in the center. Report the hole separately (hole field = ROUND) and place markings relative to <hole>.',
		aliases: ['DOUGHNUT', 'RING', 'TORUS', 'ANNULAR']
	},
	{
		id: 'V-DONUT',
		label: 'V-donut',
		source: 'ILN',
		splFallback: ['ROUND'],
		hole: 'V',
		elongated: false,
		features: [],
		description:
			'Round outline with a V-shaped through-hole. Record which way the V points with a hole tag: <hole>[TIP@...].',
		aliases: ['V DONUT', 'VDONUT']
	},
	{
		id: 'K-DONUT',
		label: 'K-donut',
		source: 'ILN',
		splFallback: ['ROUND'],
		hole: 'K',
		elongated: false,
		features: [],
		description:
			'Round outline with a K-shaped through-hole. Record the letter direction, and mirroring on the face where it reads backwards: <hole>[UP@..., MIRROR].',
		aliases: ['K DONUT', 'KDONUT']
	}
];

// Any other capital letter can be a through-hole too (A-DONUT, X-DONUT ...);
// only V and K above are spelled out because V points and K came first.
for (const letter of LETTERS) {
	if (SHAPES.some((s) => s.id === `${letter}-DONUT`)) continue;
	SHAPES.push({
		id: `${letter}-DONUT`,
		label: `${letter}-donut`,
		source: 'ILN',
		splFallback: ['ROUND'],
		hole: letter,
		elongated: false,
		features: [],
		description: `Round outline with a ${letter}-shaped through-hole. Record the letter direction with <hole>[UP@...]${SYMMETRIC_LETTERS.includes(letter) ? '' : ', and MIRROR on the face where it reads backwards'}.`,
		aliases: [`${letter} DONUT`, `${letter}DONUT`]
	});
}

// ───────────────────────── Holes ─────────────────────────

export type HoleFeature = 'TIP' | 'UP';

export interface HoleDef {
	id: string;
	label: string;
	/** Whether the hole passes all the way through the tablet. */
	through: boolean;
	/** Direction features; empty when there are none. */
	features: HoleFeature[];
	defaultOrient?: { feature: HoleFeature; deg: number };
	/** Whether it looks different mirrored, so it reads backwards from one face. */
	chiral: boolean;
	description: string;
	aliases: string[];
}

export const HOLES: HoleDef[] = [
	{
		id: 'ROUND',
		label: 'Round through-hole',
		through: true,
		features: [],
		chiral: false,
		description:
			'Circular hole through the tablet, normally centered (donut/ring tablets). Use <hole> in ILN to place markings around it.',
		aliases: ['CIRCLE', 'CIRCULAR', 'DONUT']
	},
	{
		id: 'ORIFICE',
		label: 'Drilled orifice',
		through: false,
		features: [],
		chiral: false,
		description:
			'Small laser-drilled delivery port on one face of an osmotic extended-release tablet (OROS-type). Not a through-hole; mark it on its face with <orifice> and a location code.',
		aliases: ['LASER DRILLED', 'LASER DRILLED HOLE', 'PORT', 'OROS']
	},
	{
		id: 'V',
		label: 'V-shaped hole',
		through: true,
		features: ['TIP'],
		defaultOrient: { feature: 'TIP', deg: 180 },
		chiral: false,
		description:
			'Through-hole shaped like the letter V. TIP gives the direction of the point (default TIP@S, an upright V). Symmetric, so it never needs MIRROR.',
		aliases: ['V SHAPED', 'V SHAPE', 'V HOLE']
	},
	{
		id: 'K',
		label: 'K-shaped hole',
		through: true,
		features: ['UP'],
		defaultOrient: { feature: 'UP', deg: 0 },
		chiral: true,
		description:
			'Through-hole shaped like the letter K. UP gives the direction of the top of the letter. Being a through-hole, it reads normally from one face and mirror-reversed from the other; tag the reversed face with MIRROR.',
		aliases: ['K SHAPED', 'K SHAPE', 'K HOLE']
	}
];

for (const letter of LETTERS) {
	if (HOLES.some((h) => h.id === letter)) continue;
	const chiral = !SYMMETRIC_LETTERS.includes(letter);
	HOLES.push({
		id: letter,
		label: `${letter}-shaped hole`,
		through: true,
		features: ['UP'],
		defaultOrient: { feature: 'UP', deg: 0 },
		chiral,
		description: `Through-hole shaped like the letter ${letter}. UP gives the direction of the top of the letter.${chiral ? ' It reads mirror-reversed from one face; tag that face with MIRROR.' : ' Symmetric, so it never needs MIRROR.'}`,
		aliases: [`${letter} SHAPED`, `${letter} SHAPE`, `${letter} HOLE`]
	});
}

const HOLE_INDEX = new Map<string, HoleDef>();
for (const h of HOLES)
	for (const k of [h.id, h.label, ...h.aliases])
		HOLE_INDEX.set(
			k
				.toUpperCase()
				.replace(/[-_\s]+/g, ' ')
				.trim(),
			h
		);

export function findHole(name: string | undefined): HoleDef | undefined {
	return name
		? HOLE_INDEX.get(
				name
					.toUpperCase()
					.replace(/[-_\s]+/g, ' ')
					.trim()
			)
		: undefined;
}

// ───────────────────────── Lookup ─────────────────────────

const norm = (s: string) =>
	s
		.toUpperCase()
		.replace(/\s*\(\d+\s*SIDED\)/, '')
		.replace(/[-_/]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const INDEX = new Map<string, ShapeDef>();
for (const s of SHAPES) {
	for (const key of [s.id, s.label, s.spl?.term, s.spl?.code, s.drugsCom, ...s.aliases])
		if (key) INDEX.set(norm(key), s);
	INDEX.set(norm(s.id).replace(/ /g, ''), s);
}

/** Find a shape by id, SPL term, NCI code, label or alias (case-insensitive). A proportion (`LONG CAPSULE`, `CAPSULE 2.6:1`) is ignored. */
export function findShape(name: string | undefined): ShapeDef | undefined {
	if (!name) return undefined;
	const raw = splitShapeProportion(name).base;
	if (/^\(\s*\)$/.test(raw)) return INDEX.get('()');
	const n = norm(raw);
	return INDEX.get(n) ?? INDEX.get(n.replace(/ /g, ''));
}

export function isElongated(name: string | undefined): boolean {
	return findShape(name)?.elongated ?? false;
}

// ───────────────────────── Proportion ─────────────────────────

/**
 * Outlines whose length-to-width ratio the shape value may state. The ratio
 * is the outline's length ÷ its width in the canonical view (long axis
 * horizontal); without one the outline is drawn at its default.
 */
export const PROPORTIONS: Record<string, { default: number; LONG: number; STOUT: number }> = {
	CAPSULE: { default: 96 / 36, LONG: 3.4, STOUT: 1.8 }
};
export type ProportionWord = 'LONG' | 'STOUT';
const PROPORTION_WORDS: ProportionWord[] = ['LONG', 'STOUT'];
/** A ratio of 1 is a circle; beyond this a stadium is a stick. */
export const MAX_PROPORTION = 6;

export interface ShapeProportion {
	/** The shape value without its proportion: `CAPSULE`. */
	base: string;
	/** Length ÷ width as stated (a word resolved to its ratio); null when none was. */
	ratio: number | null;
	/** `LONG` or `STOUT` when the proportion was written as a word. */
	word: ProportionWord | null;
	/** Why the proportion can't be used, when it can't; `base` and `ratio` are then still parsed. */
	error?: string;
}

/**
 * Split a shape value into its outline and its proportion:
 * `LONG CAPSULE`, `STOUT CAPSULE`, `CAPSULE 2.6:1` or `CAPSULE 19:8` (length:width,
 * e.g. in millimetres). A plain shape comes back with no ratio.
 */
export function splitShapeProportion(value: string): ShapeProportion {
	let base = value.trim();
	let word: ProportionWord | null = null;
	let ratio: number | null = null;
	const lead = /^(LONG|STOUT)\s+/i.exec(base);
	if (lead) {
		word = lead[1].toUpperCase() as ProportionWord;
		base = base.slice(lead[0].length);
	}
	const tail = /\s+(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(base);
	if (tail) {
		base = base.slice(0, tail.index).trim();
		ratio = Number(tail[1]) / Number(tail[2]);
	}
	if (!word && !tail) return { base, ratio: null, word: null };
	const preset = findShapeProportion(base);
	const label = findShape(base)?.id ?? base;
	if (word && tail)
		return {
			base,
			ratio,
			word,
			error: `Give ${label}'s proportion once: ${word} or ${tail[1]}:${tail[2]}, not both`
		};
	if (!preset)
		return {
			base,
			ratio,
			word,
			error: `${label} takes no proportion; only ${Object.keys(PROPORTIONS).join(', ')} does`
		};
	if (word) return { base, ratio: preset[word], word };
	if (!Number.isFinite(ratio) || ratio! <= 1 || ratio! > MAX_PROPORTION)
		return {
			base,
			ratio,
			word,
			error: `${label} proportion ${tail![1]}:${tail![2]} must be longer than wide and at most ${MAX_PROPORTION}:1`
		};
	return { base, ratio, word };
}

const findShapeProportion = (base: string) => {
	const id = findShape(base)?.id;
	return id ? PROPORTIONS[id] : undefined;
};

/** Length ÷ width to draw a shape value at, or null for its default outline (or a shape that takes none). */
export function shapeRatio(value: string | null | undefined): number | null {
	if (!value) return null;
	const p = splitShapeProportion(value);
	return p.error ? null : p.ratio;
}

/**
 * The canonical shape value for an outline and a ratio: the word when the
 * ratio is one, `CAPSULE 2.6:1` otherwise, and the bare outline at its default.
 */
export function formatShapeProportion(base: string, ratio: number | null): string {
	const preset = findShapeProportion(base);
	if (ratio === null || !preset) return base;
	const r = Math.round(ratio * 100) / 100;
	if (r === Math.round(preset.default * 100) / 100) return base;
	const word = PROPORTION_WORDS.find((w) => preset[w] === r);
	return word ? `${word} ${base}` : `${base} ${r}:1`;
}

/** Problems with a shape value's proportion (empty = fine, or none stated). */
export function checkShapeProportion(value: string): string[] {
	const error = splitShapeProportion(value).error;
	return error ? [error] : [];
}

// ───────────────────────── Direction tags ─────────────────────────

export interface ShapeOrient {
	feature: Feature;
	/** Compass degrees, clockwise from N. */
	deg: number;
}

const FEATURES: Feature[] = ['TIP', 'FLAT', 'BASE', 'CORNER', 'LOBE', 'NOTCH'];

export function parseShapeOrient(s: string): ShapeOrient {
	const m = /^([A-Z]+)@(\w+)$/.exec(s.trim());
	if (!m || !FEATURES.includes(m[1] as Feature)) {
		throw new Error(
			`Bad direction tag "${s.trim()}" (use ${FEATURES.join(', ')} followed by @point, e.g. TIP@E)`
		);
	}
	const p = m[2].toUpperCase();
	let deg: number;
	if (p in COMPASS_DEG) deg = COMPASS_DEG[p as keyof typeof COMPASS_DEG];
	else if (/^\d{1,3}$/.test(p) && Number(p) < 360) deg = Number(p);
	else throw new Error(`Bad point "${m[2]}" in direction tag (use a compass point or 0–359)`);
	return { feature: m[1] as Feature, deg };
}

export function formatShapeOrient(o: ShapeOrient): string {
	return `${o.feature}@${formatPoint(o.deg)}`;
}

/** Problems with using this tag on this shape (empty = fine). */
export function checkShapeOrient(shape: ShapeDef, o: ShapeOrient): string[] {
	if (!shape.features.length)
		return [`${shape.label} has no direction feature, so it takes no direction tag`];
	if (!shape.features.includes(o.feature)) {
		return [`${shape.label} has no ${o.feature}; use ${shape.features.join(' or ')}`];
	}
	if (shape.allowedDegs && !shape.allowedDegs.includes(o.deg)) {
		const where = shape.allowedDegs.map(formatPoint).join(' or ');
		return [
			`${shape.label} is elongated (long axis horizontal), so its ${o.feature} must be at ${where}`
		];
	}
	return [];
}

export function isDefaultOrient(shape: ShapeDef, o: ShapeOrient): boolean {
	const d = shape.defaultOrient;
	return !!d && d.feature === o.feature && d.deg === o.deg;
}

const FEATURE_WORD: Record<Feature, string> = {
	TIP: 'tip',
	FLAT: 'flat side',
	BASE: 'wide base',
	CORNER: 'corner',
	LOBE: 'lobe',
	NOTCH: 'concave side'
};
const DIR_WORD: Record<number, string> = {
	0: 'the top',
	45: 'the upper right',
	90: 'the right',
	135: 'the lower right',
	180: 'the bottom',
	225: 'the lower left',
	270: 'the left',
	315: 'the upper left'
};

export function describeShapeOrient(o: ShapeOrient): string {
	return `${FEATURE_WORD[o.feature]} at ${DIR_WORD[o.deg] ?? `${o.deg}°`}`;
}

// ───────────────────────── Hole direction tags ─────────────────────────
// Written as modifiers on the <hole> placeholder: <hole>[TIP@S], <hole>[UP@E, MIRROR].

export interface HoleOrient {
	feature?: HoleFeature;
	deg?: number;
	mirrored: boolean;
}

const HOLE_TAG_TOKEN = /^(?:(TIP|UP)@\w+|MIRROR(?:ED)?)$/i;

/** True if a modifier token belongs to a hole tag. */
export const isHoleTagToken = (t: string) => HOLE_TAG_TOKEN.test(t.trim());

export function parseHoleOrient(s: string): HoleOrient {
	const out: HoleOrient = { mirrored: false };
	for (const raw of s
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean)) {
		if (/^MIRROR(ED)?$/i.test(raw)) {
			out.mirrored = true;
			continue;
		}
		const m = /^([A-Z]+)@(\w+)$/i.exec(raw);
		const feature = m?.[1].toUpperCase();
		if (!m || (feature !== 'TIP' && feature !== 'UP')) {
			throw new Error(`Bad hole tag "${raw}" (use TIP@point or UP@point, optionally with MIRROR)`);
		}
		if (out.feature) throw new Error('A hole tag takes one direction');
		const p = m[2].toUpperCase();
		let deg: number;
		if (p in COMPASS_DEG) deg = COMPASS_DEG[p as keyof typeof COMPASS_DEG];
		else if (/^\d{1,3}$/.test(p) && Number(p) < 360) deg = Number(p);
		else throw new Error(`Bad point "${m[2]}" in hole tag (use a compass point or 0–359)`);
		out.feature = feature;
		out.deg = deg;
	}
	return out;
}

export function formatHoleOrient(o: HoleOrient): string {
	const parts: string[] = [];
	if (o.feature) parts.push(`${o.feature}@${formatPoint(o.deg!)}`);
	if (o.mirrored) parts.push('MIRROR');
	return parts.join(', ');
}

export function checkHoleOrient(hole: HoleDef, o: HoleOrient): string[] {
	const errs: string[] = [];
	if (!hole.features.length) {
		if (o.feature || o.mirrored)
			errs.push(`${hole.label} has no direction, so <hole> takes no tag`);
		return errs;
	}
	if (o.feature && !hole.features.includes(o.feature))
		errs.push(`${hole.label} uses ${hole.features.join(' or ')}, not ${o.feature}`);
	if (o.mirrored && !hole.chiral) errs.push(`${hole.label} looks the same mirrored; drop MIRROR`);
	return errs;
}

/** Default = default direction and not mirrored (a missing direction counts as the default). */
export function isDefaultHoleOrient(hole: HoleDef, o: HoleOrient): boolean {
	if (o.mirrored) return false;
	if (!o.feature) return true;
	const d = hole.defaultOrient;
	return !!d && d.feature === o.feature && d.deg === o.deg;
}

export function describeHoleOrient(o: HoleOrient): string {
	const parts: string[] = [];
	if (o.feature) {
		const where = DIR_WORD[o.deg!] ?? `${o.deg}°`;
		parts.push(o.feature === 'TIP' ? `point at ${where}` : `top of the letter at ${where}`);
	}
	if (o.mirrored) parts.push('mirror-reversed');
	return parts.join(', ');
}

// ───────────────────────── Holes named in the notation ─────────────────────────
// <hole:K>, <hole:V-shaped>, <hole:hexagon>: the hole's shape written on the placeholder,
// overriding (or standing in for) the shape's own hole.

/** Symbol outlines a hole may be cut as, beyond the HOLES entries. */
export const HOLE_OUTLINES = [
	'square',
	'triangle',
	'diamond',
	'pentagon',
	'hexagon',
	'octagon',
	'star',
	'heart',
	'oval',
	'shield',
	'cross',
	'moon'
];

/** True for `hole` and `hole:<shape>` symbol names. */
export const isHoleName = (name: string) => /^hole(?::|$)/i.test(name);

/**
 * The hole a `<hole:…>` name spells out: undefined for a bare `<hole>`, null
 * when the shape is unknown. Outline holes (hexagon, star…) carry no direction.
 */
export function holeFromName(name: string): HoleDef | null | undefined {
	const m = /^hole:(.+)$/i.exec(name.trim());
	if (!m) return undefined;
	const spec = m[1].trim();
	const known = findHole(spec);
	if (known) return known;
	const outline = spec.toLowerCase();
	if (!HOLE_OUTLINES.includes(outline)) return null;
	return {
		id: outline,
		label: `${outline} hole`,
		through: true,
		features: [],
		chiral: false,
		description: `Through-hole cut as a ${outline}.`,
		aliases: []
	};
}
