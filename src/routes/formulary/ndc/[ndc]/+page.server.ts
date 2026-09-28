import { error, fail } from '@sveltejs/kit';
import { toNdc11 } from '$lib/ndc';
import { stagedTree, syncExternalPackages } from '$lib/server/catalog-sync';
import { applyReinterpret, previewReinterpret } from '$lib/server/reinterpret';
import type { ReviewRequest } from '$lib/reinterpret';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const ndc = toNdc11(params.ndc);
	if (!ndc) error(400, 'Use an 11-digit NDC or a labeled, hyphenated NDC.');
	const [item] = await syncExternalPackages([ndc]);
	if (!item) error(404, 'No package data available.');
	const { packages } = await stagedTree({ concepts: [], packages: [item] });
	return { item: packages[0] };
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
