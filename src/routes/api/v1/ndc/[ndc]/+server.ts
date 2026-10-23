import { json } from '@sveltejs/kit';
import { toNdc11 } from '$lib/catalog/ndc';
import { prisma } from '$lib/server/infrastructure/database';
import { stagedTree, syncExternalPackages } from '$lib/server/catalog/sync';
import { defaultScope } from '$lib/server/formulary/membership';
import { withPharmClassRules } from '$lib/server/curation/pharm-class-view';
import { withLocalConcepts } from '$lib/server/curation/local-concept-view';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const ndc = toNdc11(params.ndc);
	if (!ndc)
		return json({ message: 'Use an 11-digit NDC or a labeled, hyphenated NDC.' }, { status: 400 });
	// `?refresh=1` asks the providers again even when the stored snapshot is fresh.
	const [item] = await syncExternalPackages([ndc], {
		force: url.searchParams.get('refresh') === '1'
	});
	if (!item) return json({ message: 'No package data available.' }, { status: 404 });
	// Raw XML and upstream payloads remain in provenance storage.
	const { packages } = await stagedTree({ concepts: [], packages: [item] });
	// Display classes with the scope's rules applied; the staged data itself is untouched.
	const scopeId = (await defaultScope(prisma)).id;
	const [shown] = await withLocalConcepts(
		prisma,
		scopeId,
		await withPharmClassRules(prisma, scopeId, packages.slice(0, 1))
	);
	return json(shown);
};
