import { json } from '@sveltejs/kit';
import { toNdc11 } from '$lib/ndc';
import { stagedTree, syncExternalPackages } from '$lib/server/catalog-sync';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const ndc = toNdc11(params.ndc);
	if (!ndc)
		return json({ message: 'Use an 11-digit NDC or a labeled, hyphenated NDC.' }, { status: 400 });
	const [item] = await syncExternalPackages([ndc]);
	if (!item) return json({ message: 'No package data available.' }, { status: 404 });
	// Raw XML and upstream payloads remain in provenance storage.
	const { packages } = await stagedTree({ concepts: [], packages: [item] });
	return json(packages[0]);
};
