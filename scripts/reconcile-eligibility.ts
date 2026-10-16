// Reapply the catalog exclusion rules to every formulary package from stored
// evidence (no provider calls), ending the formulary links of any it excludes.
// The dev server also runs this once at startup.
//
//   node --env-file=.env --import tsx scripts/reconcile-eligibility.ts

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/client.ts';
import { reconcileFormularyEligibility } from '../src/lib/server/catalog-store.ts';

const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});

try {
	const { checked, excluded } = await reconcileFormularyEligibility(db);
	for (const ndc of excluded) console.log(ndc);
	console.log(`${checked} formulary package(s) checked; ${excluded.length} excluded.`);
} finally {
	await db.$disconnect();
}
