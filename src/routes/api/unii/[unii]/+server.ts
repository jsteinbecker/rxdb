import { error, json } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { normalizeUnii } from '$lib/server/unii-usage';
import { prismaSubstanceTable, substanceFor } from '$lib/server/unii-substance-store';
import type { RequestHandler } from './$types';

/** What GSRS says about a UNII (molecular weight, active moiety), cached. */
export const GET: RequestHandler = async ({ params }) => {
	const unii = normalizeUnii(params.unii);
	if (!unii) error(400, 'A UNII is 10 letters and digits.');
	return json(await substanceFor(prismaSubstanceTable(prisma), unii));
};
