// Pass every package's saved corrections along to its siblings: product-level
// fields to every package of the product, unit-of-use fields (fill, container,
// reconstitution) to packages holding the same unit. Dry run by default; pass
// --apply to stage the copies.
//
//   node --env-file=.env --import tsx scripts/pass-along-overrides.ts [--apply]

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/client.ts';
import { passAlongSavedOverrides } from '../src/lib/server/override-propagation.ts';

const apply = process.argv.includes('--apply');
const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});

try {
	const changes = await passAlongSavedOverrides(db, { dryRun: !apply });
	for (const { ndc, keys } of changes) console.log(`${ndc}: ${keys.join(', ')}`);
	console.log(
		`${changes.length} sibling package(s) ${apply ? 'updated' : 'would be updated; pass --apply'}.`
	);
} finally {
	await db.$disconnect();
}
