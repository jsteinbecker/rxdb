export type BrandRow = {
	name: string;
	/** Lower-cased, whitespace-collapsed name; the identity within one formulary item. */
	nameKey: string;
	source: 'rxnorm' | 'manual';
	suppressed: boolean;
};

export const MAX_BRAND_LENGTH = 120;

export const brandKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function parseBrandName(raw: unknown): { name: string } | { error: string } {
	const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
	if (!name) return { error: 'Enter a brand name.' };
	if (name.length > MAX_BRAND_LENGTH)
		return { error: `Brand names are limited to ${MAX_BRAND_LENGTH} characters.` };
	return { name };
}

/**
 * The RxNorm brands to insert for a load. Any name already on the item, in any
 * state, is left alone, so a dismissed brand stays dismissed and a brand RxNorm
 * later drops is kept.
 */
export function mergeBrands(existing: BrandRow[], incoming: string[]): string[] {
	const seen = new Set(existing.map((row) => row.nameKey));
	const fresh: string[] = [];
	for (const raw of incoming) {
		const name = raw.trim().replace(/\s+/g, ' ');
		const key = brandKey(name);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		fresh.push(name);
	}
	return fresh;
}

export type BrandChange =
	| { action: 'insert' }
	| { action: 'unsuppress'; key: string }
	| { action: 'delete' }
	| { action: 'suppress' }
	| { action: 'none' };

/** Adding a name restores a dismissed tag rather than duplicating it. */
export function addBrand(existing: BrandRow[], name: string): BrandChange {
	const key = brandKey(name);
	const match = existing.find((row) => row.nameKey === key);
	if (!match) return { action: 'insert' };
	return match.suppressed ? { action: 'unsuppress', key } : { action: 'none' };
}

/** A manual tag is deleted; an RxNorm tag is kept as a dismissal so reloads respect it. */
export function removeBrand(existing: BrandRow[], key: string): BrandChange {
	const match = existing.find((row) => row.nameKey === key);
	if (!match || match.suppressed) return { action: 'none' };
	return { action: match.source === 'manual' ? 'delete' : 'suppress' };
}
