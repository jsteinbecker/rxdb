import { loggedFetch } from '$lib/server/log';
import { prisma } from '$lib/server/prisma';
import { loadConceptSnapshots } from '$lib/server/catalog-store';
import { defaultScope } from '$lib/server/catalog-formulary';
import { localConceptsByRxcui } from '$lib/server/local-concept-view';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const RXNAV = 'https://rxnav.nlm.nih.gov/REST';
// RxCUI names are stable; keep them for the life of the server process.
const cache = new Map<string, Promise<{ name: string | null; tty: string | null }>>();

function lookup(rxcui: string) {
	let pending = cache.get(rxcui);
	if (!pending) {
		pending = loggedFetch(`${RXNAV}/rxcui/${encodeURIComponent(rxcui)}/properties.json`)
			.then((r) => (r.ok ? r.json() : null))
			.then((p: { properties?: { name?: string; tty?: string } } | null) => ({
				name: p?.properties?.name ?? null,
				tty: p?.properties?.tty ?? null
			}))
			.catch(() => {
				cache.delete(rxcui);
				return { name: null, tty: null };
			});
		cache.set(rxcui, pending);
	}
	return pending;
}

type Name = { name: string | null; tty: string | null };

/** Names the catalog already holds: loaded clinical drugs and ingredients, then
 * concepts a search staged. */
async function knownNames(ids: string[]): Promise<Map<string, Name>> {
	const known = new Map<string, Name>();
	const identifiers = await prisma.externalIdentifier.findMany({
		where: { namespace: 'rxnorm_rxcui', normalizedValue: { in: ids }, validTo: null },
		select: {
			normalizedValue: true,
			entity: {
				select: {
					clinicalDrug: { select: { name: true, tty: true } },
					ingredient: { select: { name: true } }
				}
			}
		}
	});
	for (const { normalizedValue, entity } of identifiers) {
		const name = entity.clinicalDrug ?? (entity.ingredient && { ...entity.ingredient, tty: null });
		if (name && !known.has(normalizedValue)) known.set(normalizedValue, name);
	}
	const wanted = new Set(ids.filter((id) => !known.has(id)));
	if (!wanted.size) return known;
	for (const concept of (await loadConceptSnapshots(prisma, [...wanted])).values())
		if (!known.has(concept.rxcui))
			known.set(concept.rxcui, { name: concept.name, tty: concept.tty });
	return known;
}

/** GET ?ids=123,456 → { "123": { name, tty, local: { code, name } | null }, ... } */
export const GET: RequestHandler = async ({ url }) => {
	const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()))]
		.filter((id) => /^\d{1,10}$/.test(id))
		.slice(0, 200);
	const known = await knownNames(ids).catch(() => new Map<string, Name>());
	const entries = await Promise.all(
		ids.map(async (id) => [id, known.get(id) ?? (await lookup(id))] as const)
	);
	// Local superseding concepts are display-only; a failed lookup just means no `local`.
	const locals = await defaultScope(prisma)
		.then((scope) => localConceptsByRxcui(prisma, scope.id, ids))
		.catch(() => new Map());
	return json(
		Object.fromEntries(
			entries.map(([id, value]) => {
				const local = locals.get(id);
				return [id, { ...value, local: local ? { code: local.code, name: local.name } : null }];
			})
		)
	);
};
