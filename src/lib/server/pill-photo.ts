import { loggedFetch } from './log';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '../../generated/client';
import { C3PI_SET_ID, type PillPhotoRef } from '../pill-image-layout';
import { appearanceOf, type PillAppearance } from '../spl-characteristics';
import { parseSplIngredients } from '../spl-ingredients';
import { localPillPhoto } from './local-pill-photos';
import { labelPhoto } from './pill-image-store';

// ── Finding a photo for a pill whose snapshot names none ─────────────────────
// A package snapshot names its label's photo when the label has one and the
// snapshot was parsed after `SPLIMAGE` was. For the rest, in order:
//
//   1. The label, re-read. A snapshot from before the photo was parsed says
//      nothing either way (`image` is undefined, not null), and DailyMed has
//      the answer.
//   2. NLM's C3PI archive — the photography behind the retired Pillbox and
//      RxImage, by NDC: ~4,700 products, mostly older, many of them labels
//      that never carried a photo of their own.
//
// In development a photo saved by hand into `dev-pill-photos/` comes first of
// all, and is never stored: the folder is the record.
//
// Each answer, "none" included, is kept in `pill_photo`, so a package is
// looked up once; a "none" is looked up again after a month, in case the
// label has since gained a photo.

type Db = Pick<PrismaClient, 'pillPhoto'>;

const DAILYMED_SPL = 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls';
const C3PI_DIRECTORY = 'https://data.lhncbc.nlm.nih.gov/public/Pills/directory_of_images.txt';
const C3PI_CACHE = path.resolve('node_modules/.cache/rxdb/c3pi-directory.txt');
const RECHECK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The C3PI image classes worth showing, best first. Both are the archive's
 * standard studio shot — both faces, grey backdrop, mm ruler — which is what
 * a label photo looks like too. The archive's other classes are camera raws,
 * single-pill cut-outs under a banner, or 20-megapixel calibration frames.
 */
const C3PI_CLASSES = ['MC_SPL_SPLIMAGE_V3.0', 'MC_API_NLMIMAGE_V1.3'];

let c3piIndex: Promise<Map<string, Map<number, string>>> | null = null;

/**
 * NDC11 → part → archive path, from the archive's 16 MB directory, which is
 * fetched once and kept on disk. A failed download is not cached, so the next
 * lookup tries again.
 */
function loadC3piIndex(): Promise<Map<string, Map<number, string>>> {
	c3piIndex ??= (async () => {
		let text: string;
		try {
			text = await readFile(C3PI_CACHE, 'utf8');
		} catch {
			const response = await loggedFetch(C3PI_DIRECTORY);
			if (!response.ok) throw new Error(`C3PI directory answered ${response.status}`);
			text = await response.text();
			await mkdir(path.dirname(C3PI_CACHE), { recursive: true });
			await writeFile(C3PI_CACHE, text);
		}
		const index = new Map<string, Map<number, string>>();
		const rank = new Map<string, number>();
		for (const line of text.split('\n')) {
			const [ndc, part, file, kind] = line.split('|');
			const order = C3PI_CLASSES.indexOf(kind);
			if (order < 0 || !/^\d{11}$/.test(ndc)) continue;
			const key = `${ndc}|${part}`;
			if ((rank.get(key) ?? Infinity) <= order) continue;
			rank.set(key, order);
			const parts = index.get(ndc) ?? new Map<number, string>();
			parts.set(Number(part), file);
			index.set(ndc, parts);
		}
		return index;
	})().catch((error) => {
		c3piIndex = null;
		throw error;
	});
	return c3piIndex;
}

/** The C3PI photo of a package's part, if the archive has one. */
export async function c3piPhoto(ndc: string, part: number): Promise<PillPhotoRef | null> {
	const parts = (await loadC3piIndex()).get(ndc);
	// A single-product package is part 1 whatever position it was asked for.
	const file = parts?.get(part) ?? (parts?.size === 1 ? [...parts.values()][0] : undefined);
	return file ? { setId: C3PI_SET_ID, image: file } : null;
}

/** Each product's photo in a label, read from the label itself, by product code. */
async function labelPhotos(setId: string): Promise<{ productCode: string | null; image: string }[]> {
	const response = await loggedFetch(`${DAILYMED_SPL}/${encodeURIComponent(setId)}.xml`);
	if (!response.ok) throw new Error(`DailyMed answered ${response.status}`);
	return parseSplIngredients(await response.text()).flatMap((product) => {
		const image = appearanceOf(product)?.image;
		return image ? [{ productCode: product.productCode, image }] : [];
	});
}

const inFlight = new Map<string, Promise<(PillPhotoRef | null)[]>>();

/**
 * The photo for each of a package's appearances, index for index, looking up
 * whatever the snapshot does not name. Lookups that fail (DailyMed or NLM
 * down) answer null and are not stored, so the next view tries again.
 */
export async function resolvePillPhotos(
	db: Db,
	ndc: string,
	setId: string | null,
	appearances: PillAppearance[],
	{ local = false }: { local?: boolean } = {}
): Promise<(PillPhotoRef | null)[]> {
	const saved = local ? await Promise.all(appearances.map((_, index) => localPillPhoto(ndc, index + 1))) : [];
	// Skip the network entirely when every appearance has a saved photo.
	if (saved.length && saved.every(Boolean)) return saved;
	const key = `${ndc}|${setId}|${appearances.length}`;
	let work = inFlight.get(key);
	if (!work) {
		work = resolve(db, ndc, setId, appearances).finally(() => inFlight.delete(key));
		inFlight.set(key, work);
	}
	const found = await work;
	return found.map((photo, index) => saved[index] ?? photo);
}

async function resolve(
	db: Db,
	ndc: string,
	setId: string | null,
	appearances: PillAppearance[]
): Promise<(PillPhotoRef | null)[]> {
	const named = appearances.map((appearance) => labelPhoto(setId, appearance));
	if (named.every(Boolean)) return named;

	const stored = new Map(
		(await db.pillPhoto.findMany({ where: { ndc } })).map((row) => [row.part, row])
	);
	let reread: Promise<{ productCode: string | null; image: string }[]> | null = null;

	return Promise.all(
		appearances.map(async (appearance, index) => {
			if (named[index]) return named[index];
			const part = index + 1;
			const row = stored.get(part);
			if (row?.setId && row.image) return { setId: row.setId, image: row.image };
			if (row && Date.now() - row.checkedAt.getTime() < RECHECK_MS) return null;

			try {
				let found: PillPhotoRef | null = null;
				// Only a snapshot that predates the photo field can be wrong about
				// the label; `null` means the label was read and has none.
				if (setId && appearance.image === undefined) {
					reread ??= labelPhotos(setId);
					const photos = await reread;
					const match =
						photos.find((photo) => photo.productCode === appearance.productCode) ??
						(photos.length === 1 && appearances.length === 1 ? photos[0] : undefined);
					if (match) found = { setId, image: match.image };
				}
				found ??= await c3piPhoto(ndc, part);
				await db.pillPhoto.upsert({
					where: { ndc_part: { ndc, part } },
					create: { ndc, part, setId: found?.setId ?? null, image: found?.image ?? null },
					update: { setId: found?.setId ?? null, image: found?.image ?? null, checkedAt: new Date() }
				});
				return found;
			} catch (caught) {
				console.warn('pill photo lookup failed', ndc, part, caught);
				return null;
			}
		})
	);
}

/** Photos already found for packages, by NDC then part — no network. */
export async function storedPillPhotos(db: Db, ndcs: string[]): Promise<Map<string, Map<number, PillPhotoRef>>> {
	const out = new Map<string, Map<number, PillPhotoRef>>();
	if (!ndcs.length) return out;
	for (const row of await db.pillPhoto.findMany({ where: { ndc: { in: ndcs }, image: { not: null } } })) {
		if (!row.setId || !row.image) continue;
		const parts = out.get(row.ndc) ?? new Map<number, PillPhotoRef>();
		parts.set(row.part, { setId: row.setId, image: row.image });
		out.set(row.ndc, parts);
	}
	return out;
}
