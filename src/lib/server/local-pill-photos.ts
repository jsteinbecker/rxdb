import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { toNdc11 } from '../ndc';
import { LOCAL_SET_ID, type PillPhotoRef } from '../pill-image-layout';

// ── Pill photos saved by hand, for development ───────────────────────────────
// `dev-pill-photos/` holds photos a developer saved themselves, named by NDC
// (see its README). Only consulted where the caller says development is on;
// `/dev/pill-photos/[file]` serves them under the same rule.
//
// A photo's identity includes its modification time — `00378027101.jpg#…` —
// so replacing a file reads as a new photo and its layout is re-measured.

export const LOCAL_PHOTO_DIR = path.resolve(process.env.DEV_PILL_PHOTOS ?? 'dev-pill-photos');

const NAME = /^(.+?)(?:_(\d+))?\.(jpe?g|png|webp)$/i;

export const LOCAL_PHOTO_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

/** A file name this folder serves, or null: no paths, only the patterns the README names. */
export function localPhotoFile(name: string): string | null {
	return name === path.basename(name) && NAME.test(name) && toNdc11(NAME.exec(name)![1]) ? name : null;
}

/** NDC11 → part → file name, read fresh each call (a directory listing is cheap). */
async function localIndex(): Promise<Map<string, Map<number, string>>> {
	const index = new Map<string, Map<number, string>>();
	let names: string[];
	try {
		names = await readdir(LOCAL_PHOTO_DIR);
	} catch {
		return index;
	}
	for (const name of names.sort()) {
		const match = NAME.exec(name);
		const ndc = match && toNdc11(match[1]);
		if (!ndc) continue;
		const parts = index.get(ndc) ?? new Map<number, string>();
		parts.set(Number(match[2] ?? 1), name);
		index.set(ndc, parts);
	}
	return index;
}

/** The hand-saved photo of a package's part, if there is one. */
export async function localPillPhoto(ndc: string, part: number): Promise<PillPhotoRef | null> {
	const file = (await localIndex()).get(ndc)?.get(part);
	if (!file) return null;
	const { mtimeMs } = await stat(path.join(LOCAL_PHOTO_DIR, file));
	return { setId: LOCAL_SET_ID, image: `${file}#${Math.round(mtimeMs)}` };
}

/** Hand-saved photos for several packages, by NDC then part. */
export async function localPillPhotos(ndcs: string[]): Promise<Map<string, Map<number, PillPhotoRef>>> {
	const index = await localIndex();
	const out = new Map<string, Map<number, PillPhotoRef>>();
	for (const ndc of ndcs) {
		for (const part of index.get(ndc)?.keys() ?? []) {
			const photo = await localPillPhoto(ndc, part);
			if (!photo) continue;
			out.set(ndc, (out.get(ndc) ?? new Map()).set(part, photo));
		}
	}
	return out;
}

/** The bytes of a hand-saved photo, by its ref's image (the `#version` is ignored). */
export function readLocalPhoto(image: string): Promise<Buffer> {
	const file = localPhotoFile(image.split('#')[0]);
	if (!file) throw new Error(`Not a local pill photo: ${image}`);
	return readFile(path.join(LOCAL_PHOTO_DIR, file));
}
