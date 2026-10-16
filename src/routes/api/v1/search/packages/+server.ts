import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { stagedConceptPackages } from '$lib/server/catalog-sync';
import { defaultScope } from '$lib/server/catalog-formulary';
import { withPharmClassRules } from '$lib/server/pharm-class-view';
import { withLocalConcepts } from '$lib/server/local-concept-view';
import type { RequestHandler } from './$types';

/**
 * GET /api/v1/search/packages?rxcui=<staged-rxcui>
 *
 * The enriched packages of one concept a search has staged, annotated with
 * eligibility and formulary state. A search warms these in rank order, so this
 * usually reads the snapshot cache or joins a collection already in flight.
 */
export const GET: RequestHandler = async ({ url }) => {
  const rxcui = url.searchParams.get('rxcui')?.trim() ?? '';
  if (!/^\d{1,10}$/.test(rxcui))
    return json({ message: 'rxcui must be a numeric RxCUI.' }, { status: 400 });
  try {
    const result = await stagedConceptPackages(rxcui);
    if (!result)
      return json({ message: `RxCUI ${rxcui} has not been staged by a search.` }, { status: 404 });
    // Display classes with the scope's rules applied (one rules query for the whole concept).
    const scopeId = (await defaultScope(prisma)).id;
    const packages = await withLocalConcepts(
      prisma,
      scopeId,
      await withPharmClassRules(prisma, scopeId, result.packages)
    );
    return json({
      rxcui,
      ...result,
      packages,
      warning: result.partial ? 'Some providers were unavailable; known values were preserved.' : null
    });
  } catch (error) {
    return json(
      { message: error instanceof Error ? error.message : 'Packages could not be fetched.' },
      { status: 502 }
    );
  }
};
