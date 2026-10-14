// Turns the surface photos in static/textures/ into the tiles PillMockup paints with:
//
//   static/textures/detail/<name>.jpg  grey relief only: the photo minus its own blur, centred
//                                      on mid-grey, so it carries grain and specks but no colour
//                                      and no lighting. Blended over any pill colour.
//   static/textures/white/<name>.jpg   the same surface keeping the photo's own tint and specks,
//                                      its baked-in light evened out and its exposure lifted to the
//                                      white swatch's brightness. Only white pills wear this.
//
// Each source's glare (upper left) is cropped away, and the crop is mirrored 2×2 so the tile
// repeats without seams. Prints the white tiles' mean colour for `TEXTURE_WHITE` in PillMockup.
//
//   node scripts/build-pill-textures.ts

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SOURCES = ['tablet', 'coated-tablet', 'capsule'];
// Clear of the glare the glossy photos carry in their upper left.
const CROP = { left: 640, top: 420, width: 896, height: 604 };
/** One mirrored quarter of the tile, in pixels. */
const QUARTER = { width: 480, height: 324 };
/** Blur radius whose output counts as lighting rather than surface. */
const SIGMA = 10;
/** How strongly the detail map swings either side of mid-grey. */
const GAIN = 2.2;
/** The white swatch's luminance (`#f7f7f4`): the photos are underexposed, so their white is lifted to it. */
const WHITE_LUM = 246;

mkdirSync('static/textures/detail', { recursive: true });
mkdirSync('static/textures/white', { recursive: true });

async function raw(image: sharp.Sharp) {
	const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
	return { data, info };
}

/** The crop mirrored into a 2×2 tile: each edge meets its own reflection. */
async function mirrored(name: string): Promise<sharp.Sharp> {
	const quarter = await sharp(`static/textures/${name}.png`)
		.extract(CROP)
		.resize(QUARTER.width, QUARTER.height)
		.png()
		.toBuffer();
	const flop = await sharp(quarter).flop().toBuffer();
	const flip = await sharp(quarter).flip().toBuffer();
	const both = await sharp(quarter).flip().flop().toBuffer();
	const tile = await sharp({
		create: {
			width: QUARTER.width * 2,
			height: QUARTER.height * 2,
			channels: 3,
			background: '#808080'
		}
	})
		.composite([
			{ input: quarter, left: 0, top: 0 },
			{ input: flop, left: QUARTER.width, top: 0 },
			{ input: flip, left: 0, top: QUARTER.height },
			{ input: both, left: QUARTER.width, top: QUARTER.height }
		])
		.png()
		.toBuffer();
	return sharp(tile);
}

for (const name of SOURCES) {
	const tile = await (await mirrored(name)).png().toBuffer();
	const source = await raw(sharp(tile));
	const blurred = await raw(sharp(tile).blur(SIGMA));
	const { width, height, channels } = source.info;
	const pixels = width * height;

	const mean = [0, 0, 0];
	for (let i = 0; i < pixels; i++) for (let c = 0; c < 3; c++) mean[c] += source.data[i * channels + c];
	for (let c = 0; c < 3; c++) mean[c] /= pixels;
	const lift = WHITE_LUM / (0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2]);

	const detail = Buffer.alloc(pixels);
	const white = Buffer.alloc(pixels * 3);
	for (let i = 0; i < pixels; i++) {
		let lum = 0;
		for (let c = 0; c < 3; c++) {
			const high = source.data[i * channels + c] - blurred.data[i * channels + c];
			white[i * 3 + c] = clamp((mean[c] + high) * lift);
			lum += high * [0.299, 0.587, 0.114][c];
		}
		detail[i] = clamp(128 + lum * GAIN);
	}

	await sharp(detail, { raw: { width, height, channels: 1 } })
		.jpeg({ quality: 82 })
		.toFile(`static/textures/detail/${name}.jpg`);
	await sharp(white, { raw: { width, height, channels: 3 } })
		.jpeg({ quality: 82 })
		.toFile(`static/textures/white/${name}.jpg`);
	const hex = `#${mean.map((v) => clamp(v * lift).toString(16).padStart(2, '0')).join('')}`;
	console.log(`${name}: ${width}×${height}, white ${hex}`);
}

function clamp(v: number): number {
	return Math.max(0, Math.min(255, Math.round(v)));
}
