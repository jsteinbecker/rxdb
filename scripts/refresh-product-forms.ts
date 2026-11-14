// Rebuild product forms from the live formulary. Writes product_form* tables only
// (plus ingredient rows for base ingredients the catalog has not named yet).
//   node --env-file=.env --import tsx scripts/refresh-product-forms.ts [--dry-run]
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/client.ts';
import { buildProductForms } from '../src/lib/catalog/product-forms.ts';
import { loadProductFormInputs, refreshProductForms } from '../src/lib/server/catalog/product-form-store.ts';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
	if (process.argv.includes('--dry-run')) {
		const { forms, skipped } = buildProductForms(await loadProductFormInputs(db));
		for (const form of forms)
			console.log(
				`${form.ingredients.join(' + ')} | ${form.doseForm} — ${form.packageIds.length} pkg, ` +
					`${form.strengths.length} strengths, routes ${form.routes.map((r) => `${r.route}(${r.preps.length})`).join(' ') || '—'}`
			);
		console.log({ forms: forms.length, skipped });
	} else console.log(await refreshProductForms(db));
} finally {
	await db.$disconnect();
}
