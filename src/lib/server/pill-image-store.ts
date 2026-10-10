import { loggedFetch } from './log';
import sharp from 'sharp';
import { Prisma, type PrismaClient } from '../../generated/client';
import { guessIln } from '../imprints/spl-to-iln';
import { toSplAppearance } from '../imprints/iln-render';
import {
	MIN_LAYOUT_CONFIDENCE,
	PILL_IMAGE_ANALYZER_VERSION,
	pillImageKey,
	pillPhotoUrl,
	LOCAL_SET_ID,
	type PillImageLayout,
	type PillPhotoRef
} from '../pill-image-layout';
import type { PillAppearance } from '../spl-characteristics';
import { analyzePillImage } from './pill-image-analyze';
import { readLocalPhoto } from './local-pill-photos';
import { tesseractAvailable, tesseractReader } from './pill-image-ocr';

// ── Measured imprint layouts, stored ─────────────────────────────────────────
// Measuring a label photo means a DailyMed fetch, a decode and a few dozen OCR
// calls — a second or two — so it is done once per photo and kept in
// `pill_image_layout`. Page loads only read; a photo nobody has measured yet is
// queued in the background and appears on a later load. `scripts/
// analyze-pill-images.ts` measures everything up front.

type Db = Pick<PrismaClient, 'pillImageLayout'>;

/** A photo to measure, and what the label says should be in it. */
export interface PillImageTarget {
	setId: string;
	image: string;
	imprint: string;
	shape: string | null;
	capsule: boolean;
}

/** Photos are measured at this size: plenty for imprint boxes, quick to scan. */
const MEASURE_PX = 640;

/** The label's own photo of an appearance, when the snapshot names one. */
export const labelPhoto = (
	setId: string | null | undefined,
	appearance: PillAppearance
): PillPhotoRef | null => (setId && appearance.image ? { setId, image: appearance.image } : null);

/** The target for an appearance's photo, when there is a photo and an imprint to find in it. */
export function pillImageTarget(
	photo: PillPhotoRef | null,
	appearance: PillAppearance,
	doseForm: string | null
): PillImageTarget | null {
	if (!photo || !appearance.imprint) return null;
	return {
		setId: photo.setId,
		image: photo.image,
		imprint: appearance.imprint,
		shape: appearance.shape,
		capsule: guessIln(toSplAppearance(appearance, doseForm)).form === 'capsule'
	};
}

/**
 * Stored layouts worth drawing, by `pillImageKey`: measured by the current
 * analyzer, against the imprint the label states now, and confident enough to
 * beat the notation's guess.
 */
export async function loadPillImageLayouts(
	db: Db,
	targets: PillImageTarget[]
): Promise<Map<string, PillImageLayout>> {
	if (!targets.length) return new Map();
	const rows = await db.pillImageLayout.findMany({
		where: {
			OR: targets.map((t) => ({ setId: t.setId, image: t.image })),
			analyzerVersion: PILL_IMAGE_ANALYZER_VERSION,
			status: 'measured'
		}
	});
	const imprintOf = new Map(targets.map((t) => [pillImageKey(t.setId, t.image), t.imprint]));
	const out = new Map<string, PillImageLayout>();
	for (const row of rows) {
		const key = pillImageKey(row.setId, row.image);
		const layout = row.layout as PillImageLayout | null;
		if (!layout || imprintOf.get(key) !== row.imprint) continue;
		if (layout.confidence >= MIN_LAYOUT_CONFIDENCE) out.set(key, layout);
	}
	return out;
}

/** Targets with no current row: never measured, an older analyzer, or a changed imprint. */
export async function unmeasured(db: Db, targets: PillImageTarget[]): Promise<PillImageTarget[]> {
	if (!targets.length) return [];
	const rows = await db.pillImageLayout.findMany({
		where: { OR: targets.map((t) => ({ setId: t.setId, image: t.image })) },
		select: { setId: true, image: true, imprint: true, analyzerVersion: true }
	});
	const current = new Set(
		rows
			.filter((row) => row.analyzerVersion === PILL_IMAGE_ANALYZER_VERSION)
			.map((row) => `${pillImageKey(row.setId, row.image)}\n${row.imprint}`)
	);
	return targets.filter((t) => !current.has(`${pillImageKey(t.setId, t.image)}\n${t.imprint}`));
}

/** Fetch, decode and measure one photo, and store the outcome whatever it is. */
export async function measurePillImage(db: Db, target: PillImageTarget): Promise<PillImageLayout | null> {
	let status = 'failed';
	let layout: PillImageLayout | null = null;
	let error: string | null = null;
	try {
		const bytes = target.setId === LOCAL_SET_ID ? await readLocalPhoto(target.image) : await download(target);
		const { data, info } = await sharp(bytes)
			.removeAlpha()
			.resize({ width: MEASURE_PX, height: MEASURE_PX, fit: 'inside', withoutEnlargement: true })
			.raw()
			.toBuffer({ resolveWithObject: true });
		layout = await analyzePillImage(
			{ width: info.width, height: info.height, data: new Uint8Array(data) },
			target.imprint,
			{
				shape: target.shape,
				capsule: target.capsule,
				read: (await tesseractAvailable()) ? tesseractReader : undefined
			}
		);
		status = layout ? 'measured' : 'no-pill';
	} catch (caught) {
		error = caught instanceof Error ? caught.message : String(caught);
	}
	const row = {
		imprint: target.imprint,
		analyzerVersion: PILL_IMAGE_ANALYZER_VERSION,
		status,
		layout: layout ? (layout as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
		error,
		analyzedAt: new Date()
	};
	await db.pillImageLayout.upsert({
		where: { setId_image: { setId: target.setId, image: target.image } },
		create: { setId: target.setId, image: target.image, ...row },
		update: row
	});
	return layout;
}

async function download(photo: PillPhotoRef): Promise<Buffer> {
	const response = await loggedFetch(pillPhotoUrl(photo));
	if (!response.ok) throw new Error(`${new URL(pillPhotoUrl(photo)).host} answered ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

// ── Background queue ─────────────────────────────────────────────────────────

const queued = new Set<string>();
const pending: { db: Db; target: PillImageTarget }[] = [];
let running = false;

/**
 * Measure photos after the response has gone, one at a time: a page load must
 * never wait on DailyMed or tesseract, and a formulary page can name dozens
 * of photos at once.
 */
export function queuePillImages(db: Db, targets: PillImageTarget[]): void {
	for (const target of targets) {
		const key = pillImageKey(target.setId, target.image);
		if (queued.has(key)) continue;
		queued.add(key);
		pending.push({ db, target });
	}
	if (running) return;
	running = true;
	void (async () => {
		while (pending.length) {
			const { db, target } = pending.shift()!;
			try {
				await measurePillImage(db, target);
			} catch (caught) {
				console.warn('pill image measurement failed', target.setId, target.image, caught);
			}
			queued.delete(pillImageKey(target.setId, target.image));
		}
		running = false;
	})();
}
