/**
 * What a label photo says about where the imprint sits.
 *
 * SPL states an imprint as a flat string — `APO;GLP;5` — and never says which
 * face a piece is on, where on the face, or that a score runs between two of
 * them. `spl-to-iln` guesses; the label's own `SPLIMAGE` photo usually shows.
 * `$lib/server/media/pill-image-analyze.ts` measures the photo and this is what it
 * measures: per photographed face, each imprint section's box, the score
 * lines, and the colour as photographed.
 *
 * Shared because the renderer reads it: `drawPill` places text where these
 * boxes say instead of where the notation's layout would have put it.
 *
 * @module
 */

/** One imprint section, located on a face. */
export interface MeasuredElement {
	/** Index into `imprintFaces(appearance.imprint)` — which section this is. */
	segment: number;
	/** That section's text, as the label states it. */
	text: string;
	/**
	 * Centre and extent as fractions of the face's bounding box, in the face's
	 * own frame: an elongated face is turned so its long axis runs left to
	 * right, which is how `shapeGeometry` draws it.
	 */
	x: number;
	y: number;
	w: number;
	h: number;
	/** What OCR read in that box, when it read anything. */
	read: string | null;
	/** 0 (certain) to 1: how poorly the box matched the section. */
	cost: number;
}

export interface MeasuredFace {
	/** Long side over short side of the face as photographed. */
	aspect: number;
	/** Median colour of the face as photographed, imprint excluded: `#e9ece6`. */
	fill: string;
	/** Left and right halves' colours — a two-tone capsule's cap and body. */
	halves: [string, string];
	elements: MeasuredElement[];
	/** Score lines across the face, at a fraction of its width (`v`) or height (`h`). */
	scores: { dir: 'h' | 'v'; at: number }[];
	/** Marks on the face that matched no section: a logo, a stray glint. */
	unmatched: number;
}

export interface PillImageLayout {
	/** Faces in drawing order: the one carrying the first section first. */
	faces: MeasuredFace[];
	/** Sections the photo could not place. */
	missing: number[];
	/** 0–1: the share of sections placed, discounted by how well they matched. */
	confidence: number;
}

/** Bumped whenever the analyzer would measure the same photo differently. */
export const PILL_IMAGE_ANALYZER_VERSION = 2;

/** The key a layout is stored and looked up under. */
export const pillImageKey = (setId: string, image: string): string => `${setId}/${image}`;

/** DailyMed serves a label's images by set ID and file name. */
export const splImageUrl = (setId: string, image: string): string =>
	`https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid=${encodeURIComponent(setId)}&name=${encodeURIComponent(image)}`;

/**
 * Where a pill's photo lives. Label photos are named by the label's set ID
 * and file name; a photo from NLM's C3PI archive — the retired Pillbox
 * collection, for products whose label carries none — by its archive path,
 * under the pseudo set ID `c3pi`. Either way the pair is the photo's identity:
 * it keys a stored layout as much as it builds a URL.
 */
export interface PillPhotoRef {
	setId: string;
	image: string;
}

export const C3PI_SET_ID = 'c3pi';
/** A photo saved by hand into `dev-pill-photos/`; its image is `file#mtime`. */
export const LOCAL_SET_ID = 'local';
const C3PI_BASE = 'https://data.lhncbc.nlm.nih.gov/public/Pills/';

export function pillPhotoUrl(ref: PillPhotoRef): string {
	if (ref.setId === C3PI_SET_ID)
		return C3PI_BASE + ref.image.split('/').map(encodeURIComponent).join('/');
	if (ref.setId === LOCAL_SET_ID) {
		const [file, version] = ref.image.split('#');
		return `/dev/pill-photos/${encodeURIComponent(file)}${version ? `?v=${version}` : ''}`;
	}
	return splImageUrl(ref.setId, ref.image);
}

/** Photos and measured layouts for a package's appearances, index for index. */
export interface PillMedia {
	photos: (PillPhotoRef | null)[];
	/** By `pillImageKey`. */
	layouts: Record<string, PillImageLayout>;
	/** Per appearance, the photo's measured layout as ILN — what saving it by hand would start from. */
	ilns: (string | null)[];
}

/** Below this a layout is not trusted over the notation's guess. */
export const MIN_LAYOUT_CONFIDENCE = 0.5;
