import type { SplCharacteristic, SplProduct } from './spl-ingredients';
import { roundCorners } from './round-corners';

// ── What the pill in the bottle looks like ───────────────────────────────────
// The decoding half of the `<characteristic>` observations $lib/spl-ingredients.ts
// parses, and the geometry the mockup is drawn from.
//
// Appearance is the one fact about a solid oral that a person can check against
// the thing in their hand. Nothing else in this app can: RxNorm names the drug
// and its strength, the FDA NDC directory adds the dosage form and the package,
// and neither has ever carried a colour, a shape or an imprint. The SPL does,
// in five observations hung off the product — and openFDA's own `/drug/ndc`
// endpoint does not expose them either, so the label document is the only
// source, which is why this rides along with the excipient scrape rather than
// asking anywhere new.
//
// Everything here is pure and shared: the server stores what `appearanceOf`
// decodes, the API returns it unchanged, and `PillMockup.svelte` draws it with
// `shapeGeometry` and `swatchesFor`. A rendering decision made here is made
// once.

/** The five observations that describe a pill, and the photo of it. Everything else is skipped. */
const COLOR = 'SPLCOLOR';
const SHAPE = 'SPLSHAPE';
const SIZE = 'SPLSIZE';
const SCORE = 'SPLSCORE';
const IMPRINT = 'SPLIMPRINT';
const IMAGE = 'SPLIMAGE';

/**
 * A product's appearance as its label states it.
 *
 * Every field is independently optional, because labelers state them
 * independently: a capsule with no imprint, a tablet with a colour and no size,
 * a scored tablet that never says what shape it is. `null` means the label did
 * not say — never a default, and never a guess from the dosage form.
 */
export interface PillAppearance {
	/**
	 * The product element that carried the observations, hyphenated as the
	 * label writes it. Identity, not decoration: a kit's parts share the kit's
	 * package NDC and can look nothing like each other.
	 */
	productCode: string | null;

	/**
	 * Coded colours, lowercased, in the order the label lists them.
	 *
	 * Plural because a two-tone capsule is two `SPLCOLOR` observations — cap
	 * first, body second, which is the order the mockup draws them in.
	 */
	colors: string[];
	/** What the labeler wrote before the code flattened it: `pale yellow`. */
	colorText: string | null;

	/**
	 * Canonical shape term: `ROUND`, `CAPSULE`, `HEXAGON`. Taken from the NCI
	 * code when the label carries one, so spelling variants in `displayName`
	 * (`HEXAGON (6 SIDED)`, `SEMI-CIRCLE`) all land on the same term.
	 */
	shape: string | null;
	/** The NCI Thesaurus code the shape was stated with: `C48348`. */
	shapeCode: string | null;
	/** The labeler's own words: `round, biconvex`. */
	shapeText: string | null;

	/** Longest dimension in millimetres. */
	sizeMm: number | null;

	/**
	 * How many pieces the score divides the tablet into — `1` for unscored,
	 * `2` for a single bisecting line, `4` for a cross. Not a count of lines.
	 */
	score: number | null;

	/**
	 * The debossed or printed text, as the label states it.
	 *
	 * Semicolons are SPL's separator between the faces or lines of an imprint
	 * (`V;10` is `V` on one side and `10` on the other), and are kept as given
	 * so the renderer can split them rather than having to guess at a joiner.
	 */
	imprint: string | null;

	/**
	 * The imprint's layout in Imprint Layout Notation, saved by hand as a
	 * property override (`details.spl.appearances.<i>.iln`). SPL never states
	 * one; when absent the mockup uses the photo's measured layout or a guess.
	 */
	iln?: string | null;

	/**
	 * The tablet's side profile — `biconvex`, `flat-faced, bevel-edged` — which
	 * SPL never codes. Only ever set by hand as a property override.
	 */
	profile?: string | null;

	/**
	 * Fields a property override set (`colors`, `shape`, …). The label's prose
	 * refines everything else but leaves these as corrected.
	 */
	overridden?: string[];

	/**
	 * The label's photo of the product (`SPLIMAGE`), as a file name within the
	 * label: `AHP48801.jpg`. With the label's set ID it is a DailyMed URL, and
	 * `$lib/server/pill-image-store.ts` measures where the imprint sits in it.
	 *
	 * Optional because snapshots stored before it was parsed lack it.
	 */
	image?: string | null;

	/**
	 * The label's prose description this appearance was refined from, when
	 * How Supplied or Dosage Forms & Strengths described it; see
	 * `$lib/spl-appearance-text.ts`. Never stored — laid over at display time.
	 */
	labelText?: { section: string; text: string } | null;
}

/** Whether a decoded appearance says anything at all. */
export const hasAppearance = (appearance: PillAppearance): boolean =>
	appearance.colors.length > 0 ||
	appearance.shape !== null ||
	appearance.sizeMm !== null ||
	appearance.imprint !== null ||
	(appearance.score !== null && appearance.score > 1);

/**
 * SPL's shape vocabulary (FDA SPL "Shape" value set), NCI code → canonical term.
 *
 * The terms are the vocabulary's own with the side-count parentheticals
 * dropped — `HEXAGON (6 SIDED)` is HEXAGON — and are what `shapeGeometry`
 * draws and `appearanceText` prints.
 */
export const SHAPE_CODES: Record<string, string> = {
	C48335: 'BULLET',
	C48336: 'CAPSULE',
	C48337: 'CLOVER',
	C48338: 'DIAMOND',
	C48339: 'DOUBLE CIRCLE',
	C48340: 'FREEFORM',
	C48341: 'GEAR',
	C48342: 'HEPTAGON',
	C48343: 'HEXAGON',
	C48344: 'OCTAGON',
	C48345: 'OVAL',
	C48346: 'PENTAGON',
	C48347: 'RECTANGLE',
	C48348: 'ROUND',
	C48349: 'SEMI-CIRCLE',
	C48350: 'SQUARE',
	C48351: 'TEAR',
	C48352: 'TRAPEZOID',
	C48353: 'TRIANGLE'
};

/** A shape's display name without its parenthetical: `HEXAGON (6 SIDED)` → `HEXAGON`. */
const canonicalShapeName = (name: string): string =>
	name.replace(/\s*\([^)]*\)\s*/g, ' ').trim().toUpperCase();

/** The canonical shape for an observation: by code when known, else by its name. */
export function shapeTerm(code: string | null, name: string | null): string | null {
	const byCode = code ? SHAPE_CODES[code.toUpperCase()] : undefined;
	if (byCode) return byCode;
	return name ? canonicalShapeName(name) || null : null;
}

const textOf = (characteristic: SplCharacteristic): string | null => {
	const value = characteristic.value?.trim();
	return value ? value : null;
};

/**
 * The palette term for one `SPLCOLOR`. The coded value has no shades, so a
 * labeler's own `dark blue` keeps its shade when it names the same colour.
 */
const codedColor = (entry: SplCharacteristic): string | null => {
	const coded = colorTerm(textOf(entry));
	const own = colorTerm(entry.originalText);
	return own && coded && baseColor(own) === baseColor(coded) ? own : coded;
};

/**
 * Decode one product's characteristics into an appearance.
 *
 * `null` when the label stated none of the five — which is the normal answer
 * for an injection, a cream or a solution, and must stay distinguishable from
 * "nobody has looked" (that distinction lives in `ndc_ingredient_check`, whose
 * row covers this scrape too).
 */
export function appearanceOf(product: SplProduct): PillAppearance | null {
	const of = (code: string) => product.characteristics.filter((entry) => entry.code === code);

	const colors = of(COLOR);
	const shape = of(SHAPE)[0];
	const size = of(SIZE)[0];
	const score = of(SCORE)[0];
	const imprint = of(IMPRINT)[0];
	const image = of(IMAGE).find((entry) => entry.reference);

	const appearance: PillAppearance = {
		productCode: product.productCode,
		colors: colors
			.map(codedColor)
			.filter((color): color is string => !!color),
		// The first colour's own words. A two-tone capsule states one per
		// colour and joining them would invent a phrase no labeler wrote.
		colorText: colors.map((entry) => entry.originalText).find((text) => !!text) ?? null,
		shape: shape ? shapeTerm(shape.valueCode, textOf(shape)) : null,
		shapeCode: shape?.valueCode ?? null,
		shapeText: shape?.originalText ?? null,
		// `mm` is the only unit the vocabulary permits here; a value in
		// anything else is a label error and is dropped rather than drawn.
		sizeMm: size && (size.unit === null || size.unit === 'mm') ? size.number : null,
		score: score?.number ?? null,
		imprint: imprint ? textOf(imprint) : null,
		image: image?.reference ?? null
	};

	return hasAppearance(appearance) ? appearance : null;
}

/** Every appearance a parsed document states, by the packages it belongs to. */
export function appearancesByPackage(products: SplProduct[]): Map<string, PillAppearance[]> {
	const out = new Map<string, PillAppearance[]>();

	for (const product of products) {
		const appearance = appearanceOf(product);
		if (!appearance) continue;
		for (const code of product.packageCodes) {
			const held = out.get(code) ?? [];
			// A kit's parts inherit the kit's package codes and are genuinely
			// several appearances of one NDC; two products claiming the same
			// package *and* the same product code is a labeler's duplicate.
			if (held.some((other) => other.productCode === appearance.productCode)) continue;
			held.push(appearance);
			out.set(code, held);
		}
	}

	return out;
}

// ── Which dose forms have an appearance worth drawing ────────────────────────

/**
 * Dosage-form words that mean "a solid unit you can hold".
 *
 * Matched as whole words against the form string, so this covers both
 * vocabularies the app carries them in without a second table: openFDA's
 * `TABLET, FILM COATED, EXTENDED RELEASE` and RxNorm's `Delayed Release Oral
 * Tablet` both answer to `TABLET`. Powders, solutions, creams and every
 * injection form match none of them.
 */
const SOLID_WORDS = ['TABLET', 'CAPSULE', 'CAPLET', 'LOZENGE', 'TROCHE', 'PELLET', 'GUM', 'WAFER'];

/**
 * Whether a dosage form is a solid oral — the forms a pill mockup can describe.
 *
 * Deliberately a property of the *form* rather than of the route: SPL states an
 * appearance for a few solids that are not swallowed (an inhalation capsule,
 * a vaginal tablet), and for those the mockup is still an accurate picture of
 * the thing in the blister. What it must never do is draw a vial.
 */
export function isSolidDoseForm(form: string | null | undefined): boolean {
	if (!form) return false;
	const words = form.toUpperCase().split(/[^A-Z]+/);
	return SOLID_WORDS.some((word) => words.includes(word));
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Hex for each colour in the SPL colour vocabulary, plus a fallback. */
/** Side profiles a tablet may be corrected to; SPL has no vocabulary for them. */
export const PROFILE_CHOICES = [
	'flat',
	'flat-faced, bevel-edged',
	'biconvex',
	'shallow convex',
	'deep convex',
	'concave',
	'biconcave'
] as const;

const PALETTE: Record<string, string> = {
	white: '#f7f7f4',
	'off-white': '#f2efe6',
	black: '#3a3a3a',
	gray: '#b9bcc0',
	grey: '#b9bcc0',
	blue: '#7fa9de',
	green: '#8dc296',
	turquoise: '#7fcfc6',
	yellow: '#f0d97a',
	orange: '#efab6a',
	pink: '#f0aeba',
	red: '#d97a7a',
	purple: '#b49ad4',
	brown: '#dcbc9f'
};

/** The swatch a bare colour name renders as; unknown names read as neutral. */
/** Colour names the mockup knows how to paint. */
export const COLOR_CHOICES = Object.keys(PALETTE).filter((name) => name !== 'grey');

/** Colour words → the SPL colour vocabulary `swatchOf` draws. */
export const COLOR_WORDS: Record<string, string> = {
	white: 'white',
	'off-white': 'off-white',
	offwhite: 'off-white',
	ivory: 'off-white',
	cream: 'off-white',
	creamy: 'off-white',
	'cream-colored': 'off-white',
	beige: 'brown',
	tan: 'brown',
	buff: 'brown',
	brown: 'brown',
	brownish: 'brown',
	chocolate: 'brown',
	caramel: 'brown',
	black: 'black',
	gray: 'gray',
	grey: 'gray',
	grayish: 'gray',
	silver: 'gray',
	blue: 'blue',
	bluish: 'blue',
	navy: 'blue',
	aqua: 'turquoise',
	aquamarine: 'turquoise',
	teal: 'turquoise',
	turquoise: 'turquoise',
	cyan: 'turquoise',
	green: 'green',
	greenish: 'green',
	olive: 'green',
	mint: 'green',
	yellow: 'yellow',
	yellowish: 'yellow',
	lemon: 'yellow',
	gold: 'yellow',
	golden: 'yellow',
	mustard: 'yellow',
	orange: 'orange',
	orangish: 'orange',
	peach: 'orange',
	apricot: 'orange',
	coral: 'orange',
	amber: 'orange',
	rust: 'orange',
	pink: 'pink',
	pinkish: 'pink',
	rose: 'pink',
	salmon: 'pink',
	red: 'red',
	reddish: 'red',
	maroon: 'red',
	scarlet: 'red',
	crimson: 'red',
	burgundy: 'red',
	purple: 'purple',
	purplish: 'purple',
	violet: 'purple',
	lavender: 'purple',
	lilac: 'purple',
	mauve: 'purple',
	plum: 'purple'
};

/**
 * The palette term a free-text colour names, or null when it names none.
 *
 * Labels and hand edits say `LIGHT BLUE`, `white (black ink)` or `white,
 * imprinted in red ink`; only the body colour may reach the swatch, never the
 * ink, and an unrecognised word must not silently paint the pill neutral.
 */
export function colorTerm(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const text = raw
		.toLowerCase()
		// Ink phrases name the imprint, not the body: "printed in black ink", "(red ink)".
		.replace(/(?:\b(?:imprinted|printed|marked)\s+)?(?:\b(?:in|with|using)\s+)?(?:\b(?:light|dark|edible)\s+)*\b[a-z-]+\s+(?:edible\s+)?ink\b/g, ' ')
		.replace(/\b(?:imprinted|printed|marked)\b.*$/g, ' ')
		.trim();
	const base = baseTerm(text);
	return base && DARK_WORD.test(text) ? `dark ${base}` : base;
}

/** "dark"/"deep" in a colour phrase; kept so the swatch can show it. */
const DARK_WORD = /\b(?:dark|deep)\b/;

function baseTerm(text: string): string | null {
	if (PALETTE[text]) return text === 'grey' ? 'gray' : text;
	if (COLOR_WORDS[text]) return COLOR_WORDS[text];
	for (const word of text.split(/[^a-z-]+/)) {
		if (COLOR_WORDS[word]) return COLOR_WORDS[word];
		for (const part of word.split('-')) if (COLOR_WORDS[part]) return COLOR_WORDS[part];
	}
	return null;
}

/** A colour term without its shade: `dark blue` → `blue`. For comparing colours. */
export const baseColor = (term: string): string => term.replace(/^dark /, '');

/** How much of the base swatch a `dark` colour keeps, per channel. */
const DARKEN = 0.55;

const darken = (hex: string): string =>
	'#' +
	[1, 3, 5]
		.map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * DARKEN).toString(16).padStart(2, '0'))
		.join('');

/**
 * A distinct swatch for every colour word, so navy isn't blue and peach isn't
 * orange. `colorTerm` still buckets these into SPL's vocabulary for matching;
 * this table is only for drawing.
 */
export const NAMED_SWATCHES: Record<string, string> = {
	white: '#f7f7f4',
	'off-white': '#ebe5d3',
	ivory: '#f6edc4',
	cream: '#ebd29c',
	beige: '#d6c3a8',
	buff: '#e2b874',
	tan: '#c9a77c',
	caramel: '#b77a3c',
	brown: '#d2a982',
	chocolate: '#5e3a24',
	black: '#3a3a3a',
	silver: '#c9d2dc',
	gray: '#b0b3b8',
	lemon: '#f7ee86',
	yellow: '#f2d94e',
	gold: '#d9a62e',
	mustard: '#b3962c',
	amber: '#e8961c',
	orange: '#f07c2e',
	apricot: '#f4ad72',
	peach: '#f8cfb0',
	coral: '#ef7f6c',
	rust: '#b4542a',
	salmon: '#f39a85',
	pink: '#f2a9c0',
	rose: '#e07a97',
	red: '#d64545',
	scarlet: '#e8301f',
	crimson: '#b81c3a',
	maroon: '#7a2433',
	burgundy: '#6a1d3c',
	mauve: '#b88aa6',
	lilac: '#dc9fd8',
	lavender: '#b4b8f2',
	violet: '#7f5ad6',
	purple: '#9a6fcf',
	plum: '#7d3f72',
	navy: '#2c3e74',
	blue: '#5f93e0',
	cyan: '#4fcde8',
	aqua: '#8ee0e0',
	aquamarine: '#7fdcc4',
	turquoise: '#3fbfb0',
	teal: '#2a8a86',
	mint: '#b2e8c8',
	green: '#5fae6e',
	olive: '#86863a'
};
const SWATCH_ALIASES: Record<string, string> = { grey: 'gray', offwhite: 'off-white', 'cream-colored': 'off-white' };

/** How far `light` moves a swatch toward white. */
const LIGHTEN = 0.45;
const lighten = (hex: string): string =>
	'#' +
	[1, 3, 5]
		.map((i) => {
			const v = parseInt(hex.slice(i, i + 2), 16);
			return Math.round(v + (255 - v) * LIGHTEN).toString(16).padStart(2, '0');
		})
		.join('');

/** `light navy`, `dark peach`, `teal` → its own swatch; null when the phrase isn't one word with an optional shade. */
function namedSwatch(color: string): string | null {
	const m = /^(?:(light|pale|dark|deep)\s+)?([a-z-]+)$/.exec(color.toLowerCase().trim().replace(/\s+/g, ' '));
	if (!m) return null;
	const swatch = NAMED_SWATCHES[SWATCH_ALIASES[m[2]] ?? m[2]];
	if (!swatch) return null;
	if (m[1] === 'light' || m[1] === 'pale') return lighten(swatch);
	if (m[1] === 'dark' || m[1] === 'deep') return darken(swatch);
	return swatch;
}

export const swatchOf = (color: string): string => {
	const named = namedSwatch(color);
	if (named) return named;
	const term = colorTerm(color) ?? '';
	const swatch = PALETTE[baseColor(term)];
	if (!swatch) return '#dcdcd6';
	return term === baseColor(term) ? swatch : darken(swatch);
};

/**
 * Fill colours for a pill, always at least one.
 *
 * A pill whose label stated no colour is drawn in the neutral swatch rather
 * than not drawn: the shape and the imprint are still worth showing, and an
 * outline with nothing in it reads as a rendering failure.
 */
export const swatchesFor = (appearance: PillAppearance): string[] =>
	appearance.colors.length ? appearance.colors.map(swatchOf) : [swatchOf('')];

/** An SVG shape, in a 100×100 box the renderer scales. */
export interface ShapeGeometry {
	/** `d` for a `<path>`. Every shape is expressed as one, including circles. */
	path: string;
	/** Box-relative width and height, so an oblong is drawn wider than tall. */
	width: number;
	height: number;
	/** The through-hole a composite shape carries (a `HOLES` id), drawn centred. */
	hole?: string;
}

const roundedRect = (w: number, h: number, r: number): string => {
	const x = 50 - w / 2;
	const y = 50 - h / 2;
	const radius = Math.min(r, w / 2, h / 2);
	return (
		`M${x + radius},${y}h${w - 2 * radius}a${radius},${radius} 0 0 1 ${radius},${radius}` +
		`v${h - 2 * radius}a${radius},${radius} 0 0 1 ${-radius},${radius}h${-(w - 2 * radius)}` +
		`a${radius},${radius} 0 0 1 ${-radius},${-radius}v${-(h - 2 * radius)}a${radius},${radius} 0 0 1 ${radius},${-radius}z`
	);
};

/** A regular polygon, first vertex at the top. */
const polygon = (sides: number, rx = 42, ry = rx): string => {
	const points = Array.from({ length: sides }, (_, index) => {
		const angle = (Math.PI * 2 * index) / sides - Math.PI / 2;
		return `${(50 + rx * Math.cos(angle)).toFixed(2)},${(50 + ry * Math.sin(angle)).toFixed(2)}`;
	});
	return `M${points.join('L')}z`;
};

const ellipse = (w: number, h: number): string => {
	const rx = w / 2;
	const ry = h / 2;
	return `M${50 - rx},50a${rx},${ry} 0 1 0 ${w},0a${rx},${ry} 0 1 0 ${-w},0z`;
};

/**
 * The outline for a coded shape.
 *
 * These are the named outlines in SPL's dosage-form vocabulary.  In particular,
 * capsule, oblong and oval are not interchangeable: a capsule has circular
 * ends, an oblong has shorter rounded corners, and an oval has no straight
 * edges.  Unrecognised labeler extensions still get a conservative outline
 * rather than a misleading empty drawing.
 */
export function shapeGeometry(shape: string | null): ShapeGeometry {
	const geometry = rawShapeGeometry(shape);
	return { ...geometry, path: roundCorners(geometry.path) };
}

function rawShapeGeometry(shape: string | null): ShapeGeometry {
	const term = (shapeTerm(null, shape) ?? '').replace(/[^A-Z]/g, '');
	// A letter-shaped through-hole: VDONUT, KDONUT, ADONUT ...
	const letterHole = /^([A-Z])DONUT$/.exec(term);
	if (letterHole) return { path: ellipse(84, 84), width: 84, height: 84, hole: letterHole[1] };
	switch (term) {
		case 'ROUND':
			return { path: ellipse(84, 84), width: 84, height: 84 };
		case 'OVAL':
		case 'ELLIPTICAL':
			return { path: ellipse(94, 62), width: 94, height: 62 };
		case 'THINOVAL':
			return { path: ellipse(96, 42), width: 96, height: 42 };
		case 'PAREN':
			// Long sides bowed out, short ends bowed in: "( )".
			return { path: 'M8,30Q50,16 92,30Q84,50 92,70Q50,84 8,70Q16,50 8,30z', width: 84, height: 54 };
		case 'USHAPE':return { path: 'M12,14H88V52A38,38 0 0 1 12,52z', width: 76, height: 76 };
		case 'SHIELD':return { path: 'M14,12H86V46C86,70 68,84 50,92C32,84 14,70 14,46z', width: 72, height: 80 };
		case 'DONUT':return { path: ellipse(84, 84), width: 84, height: 84, hole: 'ROUND' };
		case 'EGG':return {path: 'M50,8C72,8 91,25 91,48C91,72 72,91 50,91C28,91 13,75 13,53C13,30 27,8 50,8z', width: 78, height: 83};
		case 'CAPSULE':
		case 'CAPSULESHAPED':
			return { path: roundedRect(96, 36, 18), width: 96, height: 44 };
		case 'OBLONG':
			return { path: roundedRect(94, 52, 14), width: 94, height: 52 };
		case 'SQUARE':
			return { path: roundedRect(74, 74, 3), width: 74, height: 74 };
		case 'RECTANGLE':
			return { path: roundedRect(94, 54, 3), width: 94, height: 54 };
		case 'TRIANGLE':
			return { path: polygon(3), width: 84, height: 84 };
		case 'DIAMOND':
			return { path: polygon(4), width: 84, height: 84 };
		case 'PENTAGON':
			return { path: polygon(5), width: 84, height: 84 };
		case 'HEXAGON':
			return { path: polygon(6), width: 84, height: 84 };
		case 'HEPTAGON':
			return { path: polygon(7), width: 84, height: 84 };
		case 'OCTAGON':
			return { path: polygon(8), width: 84, height: 84 };
		case 'SEMICIRCLE':
			return { path: 'M8,72A42,42 0 0 1 92,72z', width: 84, height: 42 };
		case 'TRAPEZOID':
			return { path: 'M25,15h50l16,70H9z', width: 82, height: 70 };
		case 'TEAR':
		case 'TEARDROP':
			return {
				path: 'M50,8C50,8 84,40 84,58A34,34 0 1 1 16,58C16,40 50,8 50,8z',
				width: 68,
				height: 84
			};
		case 'HEART':
			return {
				path: 'M50,88L14,52C-1,37 8,12 28,12c11,0 18,7 22,15c4-8 11-15 22-15c20,0 29,25 14,40z',
				width: 72,
				height: 76
			};
		case 'KIDNEY':
			return {
				path: 'M68,13c20,4 25,29 13,45C70,74 59,89 38,87C17,85 8,69 14,52c5-15 20-11 22-24c2-12 15-18 32-15z',
				width: 78,
				height: 74
			};
		case 'CLOVER':
			return {
				path: 'M50,50C42,37 18,40 18,25C18,5 45,8 50,27C55,8 82,5 82,25C82,40 58,37 50,50C63,42 60,18 75,18C95,18 92,45 73,50C92,55 95,82 75,82C60,82 63,58 50,50C58,63 82,60 82,75C82,95 55,92 50,73C45,92 18,95 18,75C18,60 42,63 50,50C37,58 40,82 25,82C5,82 8,55 27,50C8,45 5,18 25,18C40,18 37,42 50,50z',
				width: 90,
				height: 90
			};
		case 'GEAR':
			return {
				path: 'M42,8h16l3,10l10-4l8,8l-4,10l10,3v16l-10,3l4,10l-8,8l-10-4l-3,10H42l-3-10l-10,4l-8-8l4-10l-10-3V35l10-3l-4-10l8-8l10,4z M50,34a16,16 0 1 0 0,32a16,16 0 1 0 0-32z',
				width: 80,
				height: 80
			};
		case 'BOWTIE':
			return {
				path: 'M8,20C29,20 40,32 50,50C60,32 71,20 92,20V80C71,80 60,68 50,50C40,68 29,80 8,80z',
				width: 84,
				height: 60
			};
		case 'BARREL':
			return {
				path: 'M18,12C39,18 61,18 82,12C91,35 91,65 82,88C61,82 39,82 18,88C9,65 9,35 18,12z',
				width: 82,
				height: 76
			};
		case 'DOUBLECIRCLE':
			return {
				path: 'M50,8a24,24 0 1 1 0,48a24,24 0 1 1 0-48zM50,44a24,24 0 1 1 0,48a24,24 0 1 1 0-48z',
				width: 48,
				height: 84
			};
		case 'BULLET':
			return { path: 'M50,8C72,8 88,25 88,46v30H12V46C12,25 28,8 50,8z', width: 76, height: 68 };
		case 'FREEFORM':
		case 'CHARACTER':
			return {
				path: 'M17,29C23,10 49,8 66,16C84,24 90,45 80,63C72,78 52,91 33,84C14,77 8,49 17,29z',
				width: 82,
				height: 76
			};
		default:
			return { path: roundedRect(88, 60, 14), width: 88, height: 60 };
	}
}

/**
 * Where to draw the score lines, as box-relative x fractions of the shape.
 *
 * `SPLSCORE` counts the *pieces* the tablet breaks into, so a score of 2 is one
 * line and a score of 4 is a cross — which is why this returns positions rather
 * than a count. Anything below 2 is unscored and draws nothing.
 */
export function scoreLines(score: number | null): number[] {
	if (!score || score < 2) return [];
	// 3 is rare and is a two-line trisection; 4 is drawn as a cross by the
	// renderer, which adds the horizontal itself.
	if (score === 3) return [1 / 3, 2 / 3];
	return [0.5];
}

/** The faces of an imprint, split on SPL's separator. Empty when there is none. */
export const imprintFaces = (imprint: string | null): string[] =>
	(imprint ?? '')
		.split(';')
		.map((face) => face.trim())
		.filter((face) => face.length > 0);

/**
 * The imprint lines grouped by the two sides of a pill.
 *
 * SPL uses semicolons for both lines and faces. Two entries conventionally
 * identify opposite sides; once there are three or more, the most faithful
 * readable treatment is to split the ordered sequence into two face groups.
 * Thus `5;Valium;Roche;Roche` is drawn as `5`/`Valium` on one side and the two
 * `Roche` lines on the other, rather than silently losing half the imprint.
 */
export const imprintViews = (imprint: string | null): string[][] => {
	const sections = imprintFaces(imprint);
	if (sections.length < 3) return sections.length ? sections.map((section) => [section]) : [[]];
	const midpoint = Math.ceil(sections.length / 2);
	return [sections.slice(0, midpoint), sections.slice(midpoint)];
};

/**
 * The appearance as a line of prose — `Pale yellow, round, 6 mm, imprint “V;10”`.
 *
 * The mockup is an approximation by construction; this is not, and it is what
 * the popover shows beside the drawing so the stated facts are always readable
 * even where the shape had to be approximated. Labeler's own words win over the
 * coded term wherever the label gave both.
 */
export function appearanceText(appearance: PillAppearance): string {
	const parts: string[] = [];

	const color =
		appearance.colorText ?? (appearance.colors.length ? appearance.colors.join(' and ') : null);
	if (color) parts.push(color);
	const shape =
		appearance.shapeText ?? shapeTerm(appearance.shapeCode, appearance.shape)?.toLowerCase() ?? null;
	if (shape) parts.push(shape);
	if (appearance.profile) parts.push(appearance.profile);
	if (appearance.sizeMm !== null) parts.push(`${appearance.sizeMm} mm`);
	if (appearance.score !== null && appearance.score > 1) {
		parts.push(appearance.score === 2 ? 'scored' : `scored into ${appearance.score}`);
	}

	const faces = imprintFaces(appearance.imprint);
	if (faces.length) parts.push(`imprint “${faces.join(' / ')}”`);

	const text = parts.join(', ');
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}
