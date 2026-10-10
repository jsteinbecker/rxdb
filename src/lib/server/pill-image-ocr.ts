import { spawn } from 'node:child_process';
import type { CropReader, GrayCrop } from './pill-image-analyze';

// Tesseract, when it is installed, as the analyzer's crop reader. Optional on
// purpose: without it the analyzer still places sections by glyph count, which
// settles every imprint whose sections differ in length, and the binary is a
// system package rather than something npm can provide.

const TESSERACT = process.env.TESSERACT_PATH ?? 'tesseract';

let available: Promise<boolean> | null = null;

/** Whether the tesseract binary runs here; probed once per process. */
export function tesseractAvailable(): Promise<boolean> {
	available ??= new Promise((resolve) => {
		const child = spawn(TESSERACT, ['--version'], { stdio: 'ignore' });
		child.on('error', () => resolve(false));
		child.on('close', (code) => resolve(code === 0));
	});
	return available;
}

/** A greyscale crop as binary PGM, which tesseract reads from stdin. */
const pgm = (crop: GrayCrop): Buffer =>
	Buffer.concat([Buffer.from(`P5\n${crop.width} ${crop.height}\n255\n`), Buffer.from(crop.data)]);

/** One word (`--psm 8`), restricted to the imprint's characters. */
export const tesseractReader: CropReader = (crop, whitelist) =>
	new Promise((resolve) => {
		const child = spawn(
			TESSERACT,
			['stdin', 'stdout', '--psm', '8', '-c', `tessedit_char_whitelist=${whitelist}`],
			{ stdio: ['pipe', 'pipe', 'ignore'] }
		);
		let out = '';
		child.stdout.on('data', (chunk) => (out += chunk));
		child.on('error', () => resolve(null));
		child.on('close', (code) => resolve(code === 0 ? out.trim() || null : null));
		child.stdin.on('error', () => resolve(null));
		child.stdin.end(pgm(crop));
	});
