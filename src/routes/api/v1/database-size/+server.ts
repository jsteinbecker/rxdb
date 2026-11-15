import { json } from '@sveltejs/kit';
import { prisma } from '#lib/server/infrastructure/database.ts';
import type { RequestHandler } from './$types';

/** Current on-disk size of the database, with its largest tables. */
export const GET: RequestHandler = async () => {
	const [{ bytes }] = await prisma.$queryRaw<{ bytes: bigint }[]>`
		SELECT pg_database_size(current_database()) AS bytes`;
	const tables = await prisma.$queryRaw<{ name: string; bytes: bigint }[]>`
		SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind = 'r' AND n.nspname = current_schema()
		ORDER BY bytes DESC LIMIT 5`;
	return json(
		{
			bytes: Number(bytes),
			tables: tables.map((table) => ({ name: table.name, bytes: Number(table.bytes) })),
			at: new Date().toISOString()
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
