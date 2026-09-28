import { json } from '@sveltejs/kit';
import { toNdc11 } from '$lib/ndc';
import { loadStagedNode } from '$lib/server/catalog-sync';
import type { LoadTarget } from '$lib/server/catalog-formulary';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/v1/formulary/load  { rxcui } | { ndc }  [, scopeId]
 *
 * Promotes one staged search node into the catalog and the formulary. A
 * concept node brings every eligible package it pools; a package node only
 * itself. Repeating a load is idempotent and links newly eligible packages.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		rxcui?: unknown;
		ndc?: unknown;
		scopeId?: unknown;
	} | null;
	let target: LoadTarget | null = null;
	if (typeof body?.rxcui === 'string' && /^\d{1,8}$/.test(body.rxcui))
		target = { kind: 'concept', rxcui: body.rxcui };
	else if (typeof body?.ndc === 'string') {
		const ndc = toNdc11(body.ndc);
		if (ndc) target = { kind: 'package', ndc };
	}
	if (!target) return json({ message: 'Provide an rxcui or an NDC to load.' }, { status: 400 });
	const scopeId = body?.scopeId;
	if (scopeId !== undefined && (typeof scopeId !== 'string' || !UUID.test(scopeId)))
		return json({ message: 'scopeId must be a UUID.' }, { status: 400 });
	try {
		return json(await loadStagedNode(target, scopeId as string | undefined));
	} catch (error) {
		return json(
			{ message: error instanceof Error ? error.message : 'The node could not be loaded.' },
			{ status: 422 }
		);
	}
};
