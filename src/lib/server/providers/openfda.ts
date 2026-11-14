/**
 * openFDA endpoints: the NDC directory and drug labels, paged searches, and
 * labeler names.
 *
 * @module
 */
import { getJson } from './transport';
import { labelerCandidates } from '../../catalog/ndc';
export const OPENFDA_NDC = 'https://api.fda.gov/drug/ndc.json';
export const OPENFDA_LABEL = 'https://api.fda.gov/drug/label.json';

export function fdaUrl(base: string, search: string, apiKey?: string): string {
	const params = new URLSearchParams({ search, limit: '100' });
	if (apiKey) params.set('api_key', apiKey);
	return `${base}?${params}`;
}

/** Every openFDA NDC-directory product matching a search, paged past the 100-row limit. */
export async function searchFdaProducts(search: string, apiKey?: string): Promise<FdaProduct[]> {
	const products: FdaProduct[] = [];
	for (let skip = 0; skip < 5_000; skip += 100) {
		const params = new URLSearchParams({ search, limit: '100', skip: String(skip) });
		if (apiKey) params.set('api_key', apiKey);
		const page = (await getJson(`${OPENFDA_NDC}?${params}`, true)) as {
			results?: FdaProduct[];
			meta?: { results?: { total?: number } };
		};
		products.push(...(page.results ?? []));
		if (!page.results?.length || products.length >= (page.meta?.results?.total ?? 0)) break;
	}
	return products;
}

/** A labeler's name outlives any one product; keep it for the process. */
const LABELER_TTL_MS = 24 * 60 * 60 * 1000;
const labelerNames = new Map<string, { at: number; name: Promise<string | null> }>();

export function labelerNameOf(labelerCode: string, apiKey?: string): Promise<string | null> {
	const hit = labelerNames.get(labelerCode);
	if (hit && Date.now() - hit.at < LABELER_TTL_MS) return hit.name;
	const url = fdaUrl(
		OPENFDA_NDC,
		labelerCandidates(labelerCode)
			.map((code) => `product_ndc:${code}-*`)
			.join(' OR '),
		apiKey
	);
	const name = (getJson(url, true) as Promise<{ results?: FdaProduct[] }>).then(
		(payload) => payload.results?.find((row) => row.labeler_name)?.labeler_name ?? null
	);
	labelerNames.set(labelerCode, { at: Date.now(), name });
	name.then(
		(value) => {
			// An empty answer may be an indexing gap; let the next package ask again.
			if (value === null) labelerNames.delete(labelerCode);
		},
		() => labelerNames.delete(labelerCode)
	);
	return name;
}

export type FdaProduct = {
	product_ndc?: string;
	route?: string[];
	marketing_category?: string;
	application_number?: string;
	dea_schedule?: string;
	marketing_start_date?: string;
	listing_expiration_date?: string;
	finished?: boolean;
	pharm_class?: string[];
	spl_id?: string;
	openfda?: Record<string, unknown>;
	labeler_name?: string;
	brand_name?: string;
	generic_name?: string;
	dosage_form?: string;
	product_type?: string;
	marketing_end_date?: string;
	packaging?: {
		package_ndc?: string;
		description?: string;
		marketing_start_date?: string;
		marketing_end_date?: string;
		sample?: boolean;
	}[];
	active_ingredients?: { name?: string; strength?: string }[];
};
