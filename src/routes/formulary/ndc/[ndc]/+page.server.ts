import { error, fail } from '@sveltejs/kit';
import { toNdc11 } from '$lib/ndc';
import { prisma } from '$lib/server/prisma';
import { quantifiedScdName } from '$lib/quantified-scd';
import { stagedTree, syncExternalPackages } from '$lib/server/catalog-sync';
import { applyReinterpret, previewReinterpret } from '$lib/server/reinterpret';
import {
  findEquivalentPackages,
  removePropertyOverrides,
  savePropertyOverride
} from '$lib/server/property-override';
import {
  clearDosingMeasure,
  loadDosingMeasure,
  saveDosingMeasure
} from '$lib/server/dosing-measure-store';
import { isAmbiguityKind } from '$lib/labeler-ambiguity';
import { readCitationInput } from '$lib/server/override-citation';
import type { ReviewRequest } from '$lib/reinterpret';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const ndc = toNdc11(params.ndc);
  if (!ndc) error(400, 'Use an 11-digit NDC or a labeled, hyphenated NDC.');
  const [item] = await syncExternalPackages([ndc]);
  if (!item) error(404, 'No package data available.');
  const [{ packages }, equivalents, dosingMeasure] = await Promise.all([
    stagedTree({ concepts: [], packages: [item] }),
    findEquivalentPackages(item),
    loadDosingMeasure(item)
  ]);
  const links = await prisma.formularyItemPackage.findMany({
    where: {
      validTo: null,
      formularyItem: { entity: { retiredAt: null } },
      package: {
        entity: {
          externalIdentifiers: { some: { namespace: 'ndc11', normalizedValue: ndc, validTo: null } }
        }
      }
    },
    select: { formularyItem: { select: { id: true, displayName: true } } }
  });
  const formularyItems = links.map(({ formularyItem }) => ({
    id: formularyItem.id,
    displayName: quantifiedScdName(formularyItem.displayName)
  }));
  return { item: packages[0], equivalents, dosingMeasure, formularyItems };
};

function parseReview(raw: FormDataEntryValue | null): ReviewRequest | null {
  try {
    const value = JSON.parse(String(raw ?? '')) as Partial<ReviewRequest>;
    return {
      marks: value.marks ?? {},
      notes: value.notes ?? {},
      overrides: value.overrides ?? {},
      keepRows: value.keepRows ?? {},
      preferredSetId: String(value.preferredSetId ?? ''),
      note: String(value.note ?? '')
    };
  } catch {
    return null;
  }
}

export const actions: Actions = {
  override: async ({ params, request }) => {
    const ndc = toNdc11(params.ndc);
    if (!ndc) return fail(400, { message: 'Invalid NDC.' });
    const form = await request.formData();
    const citation = readCitationInput(form);
    if (!citation) return fail(400, { message: 'Choose what the override cites.' });
    const named = form.get('ambiguity');
    if (named && !isAmbiguityKind(named))
      return fail(400, { message: 'Unknown labeler ambiguity.' });
    const kind = isAmbiguityKind(named) ? named : null;
    try {
      await savePropertyOverride(
        ndc,
        String(form.get('key') ?? ''),
        String(form.get('value') ?? ''),
        citation,
        kind ? { kind, note: String(form.get('note') ?? '') } : undefined
      );
      return { overridden: true };
    } catch (cause) {
      return fail(400, {
        message: cause instanceof Error ? cause.message : 'Could not save override.'
      });
    }
  },
  /** Saved per SCD concept, so it reaches every NDC sharing this one's concept. */
  setDosingMeasure: async ({ params, request }) => {
    const ndc = toNdc11(params.ndc);
    if (!ndc) return fail(400, { message: 'Invalid NDC.' });
    const form = await request.formData();
    const [item] = await syncExternalPackages([ndc]);
    if (!item) return fail(404, { message: 'No package data available.' });
    try {
      await saveDosingMeasure(
        item,
        String(form.get('mode') ?? ''),
        form.get('ingredient') ? String(form.get('ingredient')) : null
      );
      return { dosingMeasureSaved: true };
    } catch (cause) {
      return fail(400, {
        message: cause instanceof Error ? cause.message : 'Could not save dosing measure.'
      });
    }
  },
  clearDosingMeasure: async ({ params }) => {
    const ndc = toNdc11(params.ndc);
    if (!ndc) return fail(400, { message: 'Invalid NDC.' });
    const [item] = await syncExternalPackages([ndc]);
    if (!item) return fail(404, { message: 'No package data available.' });
    await clearDosingMeasure(item);
    return { dosingMeasureSaved: true };
  },
  removeOverride: async ({ params, request }) => {
    const ndc = toNdc11(params.ndc);
    if (!ndc) return fail(400, { message: 'Invalid NDC.' });
    const keys = (await request.formData()).getAll('key').map(String);
    try {
      await removePropertyOverrides(ndc, keys);
      return { overridden: true };
    } catch (cause) {
      return fail(400, {
        message: cause instanceof Error ? cause.message : 'Could not remove override.'
      });
    }
  },
  /** Re-scrape and reinterpret without saving; the user confirms the result. */
  preview: async ({ params, request }) => {
    const ndc = toNdc11(params.ndc);
    const review = parseReview((await request.formData()).get('review'));
    if (!ndc || !review) return fail(400, { message: 'Malformed review request.' });
    if (review.preferredSetId && !/^[0-9a-f-]{36}$/i.test(review.preferredSetId.trim()))
      return fail(400, { message: 'A DailyMed set ID looks like 8-4-4-4-12 hex digits.' });
    try {
      return { preview: await previewReinterpret(ndc, review) };
    } catch (cause) {
      return fail(502, { message: cause instanceof Error ? cause.message : 'Scrape failed.' });
    }
  },
  apply: async ({ params, request }) => {
    const ndc = toNdc11(params.ndc);
    const token = String((await request.formData()).get('token') ?? '');
    if (!ndc || !(await applyReinterpret(ndc, token)))
      return fail(410, { message: 'This preview expired. Run the reload again.' });
    return { applied: true };
  }
};
