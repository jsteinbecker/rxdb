// Read-only report: which formulary package rows now read as gross contents
// instead of a bare concentration, and which stay flagged because no package
// volume could be trusted (`src/lib/medication/gross-strength.ts`). Strengths are
// derived at read time from cached snapshots, so nothing needs rewriting; this
// shows what the change does to the data, and lists the rows to fix by hand
// (or re-enrich so a dry-fill label's volume resolves). Writes nothing.
//
//   node --env-file=.env --import tsx scripts/report-gross-strengths.ts [--csv]

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/client.ts';
import { formularyRows } from '../src/lib/server/formulary/read.ts';
import { strengthOf } from '../src/lib/formulary/hierarchy.ts';
import { formatNdc } from '../src/lib/catalog/ndc.ts';

const csv = process.argv.includes('--csv');
const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});

try {
	const scopes = await db.scope.findMany({ where: { kind: 'formulary' }, select: { id: true, name: true } });
	const lines: string[][] = [['scope', 'ndc', 'item', 'before', 'after', 'status']];
	let changed = 0;
	let flagged = 0;
	for (const scope of scopes) {
		for (const row of await formularyRows(db, scope.id)) {
			const before = strengthOf({ ...row, contents: undefined });
			const after = strengthOf(row);
			if (row.concentrationOnly) flagged++;
			else if (before !== after) changed++;
			else continue;
			lines.push([
				scope.name,
				formatNdc(row.ndc),
				row.formularyItem,
				before,
				after,
				row.concentrationOnly ? 'FLAGGED: package volume unknown' : 'gross contents'
			]);
		}
	}
	if (csv) for (const line of lines) console.log(line.map((v) => JSON.stringify(v)).join(','));
	else {
		for (const line of lines.slice(1)) console.log(line.join('  |  '));
		console.log(`\n${changed} rows now read as gross contents; ${flagged} flagged (volume unknown).`);
	}
} finally {
	await db.$disconnect();
}
