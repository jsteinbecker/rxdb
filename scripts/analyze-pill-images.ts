// Measure every pill photo the cached package snapshots name, or that an NDC
// page view has found for them (`pill_photo`: a re-read label or NLM's C3PI
// archive), so pill mockups can place imprint text where the photo shows it.
// Skips photos
// already measured by the current analyzer; pass --force to redo them, and
// --limit N to stop after N photos.
//
//   node --env-file=.env --import tsx scripts/analyze-pill-images.ts [--force] [--limit N]

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/client.ts';
import { CACHE_SOURCE, readSnapshot } from '../src/lib/server/catalog-cache.ts';
import { storedPillPhotos } from '../src/lib/server/pill-photo.ts';
import { localPillPhotos } from '../src/lib/server/local-pill-photos.ts';
import {
	labelPhoto,
	measurePillImage,
	pillImageTarget,
	unmeasured,
	type PillImageTarget
} from '../src/lib/server/pill-image-store.ts';
import { tesseractAvailable } from '../src/lib/server/pill-image-ocr.ts';
import { pillImageKey } from '../src/lib/pill-image-layout.ts';

const force = process.argv.includes('--force');
const limitAt = process.argv.indexOf('--limit');
const limit = limitAt > 0 ? Number(process.argv[limitAt + 1]) : Infinity;
const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});

try {
	// Only snapshots that state an appearance; the text match keeps the rest undecoded.
	const records = await db.$queryRaw<{ payload: unknown }[]>`
		SELECT DISTINCT ON (r.source_native_id) r.payload
		FROM source_record r
		JOIN ingestion_run run ON run.id = r.ingestion_run_id
		WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
			AND r.payload::text LIKE '%"appearances": [{%'
		ORDER BY r.source_native_id, r.observed_at DESC`;

	const items = records.flatMap((record) => readSnapshot(record.payload)?.item ?? []);
	const stored = await storedPillPhotos(db, items.map((item) => item.ndc));
	// A development tool: photos saved by hand into dev-pill-photos/ count too.
	const saved = await localPillPhotos(items.map((item) => item.ndc));
	const targets = new Map<string, PillImageTarget>();
	for (const item of items) {
		(item.details?.spl?.appearances ?? []).forEach((appearance, index) => {
			const photo =
				saved.get(item.ndc)?.get(index + 1) ??
				labelPhoto(item.splSetId, appearance) ??
				stored.get(item.ndc)?.get(index + 1) ??
				null;
			const target = pillImageTarget(photo, appearance, item.doseForm ?? null);
			if (target) targets.set(pillImageKey(target.setId, target.image), target);
		});
	}
	const todo = (force ? [...targets.values()] : await unmeasured(db, [...targets.values()])).slice(0, limit);
	console.log(
		`${targets.size} photos known; measuring ${todo.length}` +
			((await tesseractAvailable()) ? '' : ' (no tesseract: matching on glyph counts only)')
	);

	const tally: Record<string, number> = {};
	for (const [index, target] of todo.entries()) {
		const layout = await measurePillImage(db, target);
		const outcome = !layout ? 'unmeasured' : layout.confidence >= 0.5 ? 'confident' : 'weak';
		tally[outcome] = (tally[outcome] ?? 0) + 1;
		console.log(
			`[${index + 1}/${todo.length}] ${target.image} "${target.imprint}": ${outcome}` +
				(layout ? ` (${layout.confidence})` : '')
		);
	}
	console.log(tally);
} finally {
	await db.$disconnect();
}
