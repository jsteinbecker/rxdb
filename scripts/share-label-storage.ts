// Move existing rows to shared label storage (label-store.ts, migration
// 20261115074620_shared_label_storage):
//   1. package_curation baselines keep label sections by hash in spl_label;
//   2. catalog-enrichment snapshots do the same (payload_hash recomputed, so the
//      next refresh still sees an unchanged snapshot);
//   3. raw provider payloads move to source_payload, one row per content hash.
// Then VACUUM FULL returns the space. Dry run by default; pass --apply.
//
//   node --env-file=.env --import tsx scripts/share-label-storage.ts [--apply]

import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/client.ts';
import { detachLabel } from '../src/lib/server/catalog/label-store.ts';
import { payloadHash } from '../src/lib/server/catalog/snapshot-store.ts';
import { CACHE_SOURCE } from '../src/lib/server/catalog/cache.ts';
import type { ExternalPackage } from '../src/lib/catalog/types.ts';

const apply = process.argv.includes('--apply');
const BATCH = 200;
const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});
const hasSections = (item: Pick<ExternalPackage, 'details'> | undefined) =>
	Array.isArray(item?.details?.label?.sections);
const size = async () =>
	(
		await db.$queryRaw<{ size: string }[]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size`
	)[0].size;

try {
	console.log(`Database size before: ${await size()}`);

	// 1. Baselines.
	const ndcs = (
		await db.$queryRaw<{ ndc: string }[]>`
    SELECT ndc FROM package_curation
    WHERE jsonb_typeof(baseline #> '{details,label,sections}') = 'array' ORDER BY ndc`
	).map((row) => row.ndc);
	console.log(`Baselines with inline label sections: ${ndcs.length}`);
	if (apply)
		for (let at = 0; at < ndcs.length; at += BATCH) {
			const rows = await db.$queryRaw<{ ndc: string; baseline: ExternalPackage }[]>`
        SELECT ndc, baseline FROM package_curation WHERE ndc = ANY(${ndcs.slice(at, at + BATCH)}::text[])`;
			await db.$transaction(async (tx) => {
				for (const row of rows) {
					if (!hasSections(row.baseline)) continue;
					const stored = await detachLabel(tx, row.baseline);
					// Same facts, so neither revision nor updated_at moves.
					await tx.$executeRaw`
            UPDATE package_curation SET baseline = ${JSON.stringify(stored)}::jsonb WHERE ndc = ${row.ndc}`;
				}
			});
			process.stdout.write(`\r  baselines ${Math.min(at + BATCH, ndcs.length)}/${ndcs.length}`);
		}
	if (apply) console.log();

	// 2. Cache snapshots, every version.
	const snapshotIds = (
		await db.$queryRaw<{ id: string }[]>`
    SELECT r.id FROM source_record r JOIN ingestion_run run ON run.id = r.ingestion_run_id
    WHERE run.source = ${CACHE_SOURCE}
      AND jsonb_typeof(r.payload #> '{item,details,label,sections}') = 'array'`
	).map((row) => row.id);
	console.log(`Cache snapshots with inline label sections: ${snapshotIds.length}`);
	if (apply)
		for (let at = 0; at < snapshotIds.length; at += BATCH) {
			const rows = await db.$queryRaw<{ id: string; payload: { item: ExternalPackage } }[]>`
        SELECT id, payload FROM source_record WHERE id = ANY(${snapshotIds.slice(at, at + BATCH)}::uuid[])`;
			await db.$transaction(async (tx) => {
				for (const row of rows) {
					if (!hasSections(row.payload.item)) continue;
					const payload = { ...row.payload, item: await detachLabel(tx, row.payload.item) };
					const hash = new Uint8Array(payloadHash(CACHE_SOURCE, payload));
					await tx.$executeRaw`
            UPDATE source_record SET payload = ${JSON.stringify(payload)}::jsonb, payload_hash = ${hash}
            WHERE id = ${row.id}::uuid`;
				}
			});
			process.stdout.write(
				`\r  snapshots ${Math.min(at + BATCH, snapshotIds.length)}/${snapshotIds.length}`
			);
		}
	if (apply) console.log();

	// 3. Raw provider payloads. The hash is the key, so it must name one payload.
	const raw = Prisma.sql`
    FROM source_record r JOIN ingestion_run run ON run.id = r.ingestion_run_id
    WHERE run.source <> ${CACHE_SOURCE} AND run.source NOT LIKE 'user-%' AND r.payload IS NOT NULL`;
	const [counts] = await db.$queryRaw<{ records: number; distinct: number; collisions: number }[]>`
    SELECT count(*)::int AS records, count(DISTINCT r.payload_hash)::int AS distinct,
      (SELECT count(*)::int FROM (
        SELECT r.payload_hash ${raw} GROUP BY r.payload_hash HAVING count(DISTINCT r.payload) > 1
      ) c) AS collisions
    ${raw}`;
	console.log(
		`Raw payloads: ${counts.records} records, ${counts.distinct} distinct, ${counts.collisions} hash collisions`
	);
	if (counts.collisions) throw new Error('Payload hashes collide; not moving raw payloads.');
	if (apply) {
		await db.$transaction(
			async (tx) => {
				await tx.$executeRaw`
          INSERT INTO source_payload (hash, payload)
          SELECT DISTINCT ON (r.payload_hash) r.payload_hash, r.payload ${raw}
          ON CONFLICT DO NOTHING`;
				const moved = await tx.$executeRaw`
          UPDATE source_record r SET payload_ref = r.payload_hash, payload = NULL
          FROM ingestion_run run
          WHERE run.id = r.ingestion_run_id AND run.source <> ${CACHE_SOURCE}
            AND run.source NOT LIKE 'user-%' AND r.payload IS NOT NULL`;
				console.log(`  moved ${moved} raw payloads`);
			},
			{ timeout: 600_000 }
		);
		console.log('Vacuuming…');
		for (const table of ['source_record', 'package_curation', 'source_payload', 'spl_label_section'])
			await db.$executeRawUnsafe(`VACUUM (FULL, ANALYZE) "${table}"`);
		const [labels] = await db.$queryRaw<{ labels: number; sets: number }[]>`
      SELECT count(*)::int AS labels, count(DISTINCT set_id)::int AS sets FROM spl_label`;
		console.log(`spl_label: ${labels.labels} labels across ${labels.sets} sets`);
		console.log(`Database size after: ${await size()}`);
	} else console.log('Dry run; pass --apply to move the rows.');
} finally {
	await db.$disconnect();
}
