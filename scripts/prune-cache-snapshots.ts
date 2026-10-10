// Delete superseded catalog-enrichment snapshots: every cache record except
// the newest per native ID, keeping any record a catalog row still cites as
// its source. Dry run by default; pass --apply to delete.
//
//   node --env-file=.env --import tsx scripts/prune-cache-snapshots.ts [--apply]

import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/client.ts';

const CACHE_SOURCE = 'catalog-enrichment';
const apply = process.argv.includes('--apply');
const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});

try {
	// Every column that references source_record, so no provenance link is nulled.
	const references = await db.$queryRaw<{ table: string; column: string }[]>`
		SELECT cl.relname AS "table", att.attname AS "column"
		FROM pg_constraint con
		JOIN pg_class cl ON cl.oid = con.conrelid
		JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
		WHERE con.contype = 'f' AND con.confrelid = 'source_record'::regclass`;
	const unreferenced = Prisma.join(
		references.map(
			({ table, column }) =>
				Prisma.sql`NOT EXISTS (SELECT 1 FROM ${Prisma.raw(`"${table}"`)} ref WHERE ref.${Prisma.raw(`"${column}"`)} = r.id)`
		),
		' AND '
	);
	const superseded = Prisma.sql`
		SELECT r.id FROM source_record r
		JOIN ingestion_run run ON run.id = r.ingestion_run_id
		WHERE run.source = ${CACHE_SOURCE}
			AND r.id NOT IN (
				SELECT DISTINCT ON (latest.source_native_id) latest.id
				FROM source_record latest
				JOIN ingestion_run lrun ON lrun.id = latest.ingestion_run_id
				WHERE lrun.source = ${CACHE_SOURCE} AND lrun.status = 'completed'
				ORDER BY latest.source_native_id, latest.observed_at DESC)
			AND ${unreferenced}`;
	const [plan] = await db.$queryRaw<{ records: number; size: string; total: number }[]>`
		SELECT count(*)::int AS records,
			pg_size_pretty(coalesce(sum(pg_column_size(payload)), 0)::bigint) AS size,
			(SELECT count(*)::int FROM source_record s JOIN ingestion_run sr ON sr.id = s.ingestion_run_id
				WHERE sr.source = ${CACHE_SOURCE}) AS total
		FROM source_record WHERE id IN (${superseded})`;
	console.log(
		`${plan.records} of ${plan.total} cache snapshots are superseded (${plan.size} of payload).`
	);
	if (!apply) console.log('Dry run; pass --apply to delete them.');
	else {
		const deleted = await db.$executeRaw`DELETE FROM source_record WHERE id IN (${superseded})`;
		console.log(`Deleted ${deleted} snapshots.`);
		console.log('Run VACUUM (or VACUUM FULL source_record) to return the space to the OS.');
	}
} finally {
	await db.$disconnect();
}
