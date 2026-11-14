import { error, json } from '@sveltejs/kit';
import { prisma } from '#lib/server/infrastructure/database.ts';
import { normalizeUnii } from '#lib/server/catalog/unii-usage.ts';
import { prismaSubstanceTable, substanceFor } from '#lib/server/medication/substance-store.ts';
import type { RequestHandler } from './$types';

/** What GSRS says about a UNII (molecular weight, active moiety), cached. */
export const GET: RequestHandler = async ({ params }) => {
	const unii = normalizeUnii(params.unii);
	if (!unii) error(400, 'A UNII is 10 letters and digits.');
	return json(await substanceFor(prismaSubstanceTable(prisma), unii));
};
