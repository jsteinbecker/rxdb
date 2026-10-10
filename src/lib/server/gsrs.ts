// ── FDA's Global Substance Registration System ───────────────────────────────
// The ingredient correction wizard converts a strength between two substances
// by molecular weight, and GSRS is where those weights (and the active moiety
// of a salt) come from. Public, unauthenticated, JSON.

const GSRS = 'https://gsrs.ncats.nih.gov/api/v1/substances';
export const GSRS_TIMEOUT_MS = 5000;

/** What GSRS says about a UNII, reduced to what the wizard uses. */
export type GsrsSubstance = {
	unii: string;
	name: string | null;
	formula: string | null;
	/** Null for a substance without a structure — protein, mixture, polymer. */
	mw: number | null;
	moiety: { unii: string; name: string } | null;
	/** Every distinct active moiety — both ions of SODIUM CHLORIDE, where `moiety` is null. */
	moieties: { unii: string; name: string }[];
	/** Units of the drug-bearing fragment per formula unit; null without a structure. */
	moietyCount: number | null;
};

/** The outcome of asking about one UNII. */
export type GsrsLookup =
	| { status: 'ok'; substance: GsrsSubstance; raw: unknown }
	| { status: 'not-found' }
	| { status: 'unavailable' };

type Record_ = Record<string, unknown>;
const isRecord = (value: unknown): value is Record_ =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Reads a GSRS `substances(<UNII>)?view=full` document; null when it is not one. */
export function parseGsrs(unii: string, document: unknown): GsrsSubstance | null {
	if (!isRecord(document)) return null;
	const names = Array.isArray(document.names) ? document.names.filter(isRecord) : [];
	const name =
		str(document._name) ??
		str(names.find((entry) => entry.displayName === true)?.name) ??
		str(names[0]?.name);

	const structure = isRecord(document.structure) ? document.structure : null;
	const fragments = (Array.isArray(document.moieties) ? document.moieties : [])
		.filter(isRecord)
		.flatMap((moiety) => {
			const mw = num(moiety.mwt);
			return mw ? [{ mw, count: num(moiety.count) ?? 1 }] : [];
		});
	// The drug-bearing fragment of a salt or hydrate is the heaviest: not Na, not H2O.
	const heaviest = fragments.reduce<{ mw: number; count: number } | null>(
		(best, fragment) => (!best || fragment.mw > best.mw ? fragment : best),
		null
	);

	// A salt of two active ions (SODIUM CHLORIDE: chloride ion and sodium cation)
	// has no single moiety to default to, so it gets none.
	const moieties = activeMoietiesOf(document);
	const moiety = moieties.length === 1 ? moieties[0] : null;

	return {
		unii,
		name,
		formula: str(structure?.formula),
		mw: num(structure?.mwt),
		moiety,
		moieties,
		moietyCount: heaviest ? Math.round(heaviest.count) : null
	};
}

/** The distinct ACTIVE MOIETY relationships of a GSRS document, full or trimmed. */
export function activeMoietiesOf(document: unknown): { unii: string; name: string }[] {
	if (!isRecord(document) || !Array.isArray(document.relationships)) return [];
	const found = new Map<string, { unii: string; name: string }>();
	for (const entry of document.relationships) {
		if (!isRecord(entry) || entry.type !== 'ACTIVE MOIETY' || !isRecord(entry.relatedSubstance)) continue;
		const unii = str(entry.relatedSubstance.approvalID);
		const name = str(entry.relatedSubstance.name);
		if (unii && name && !found.has(unii)) found.set(unii, { unii, name });
	}
	return [...found.values()];
}

/** Asks GSRS about `unii`. Network failure or a slow answer is `unavailable`, never an exception. */
export async function lookupUnii(
	unii: string,
	fetcher: typeof fetch = fetch
): Promise<GsrsLookup> {
	try {
		const response = await fetcher(`${GSRS}(${encodeURIComponent(unii)})?view=full`, {
			signal: AbortSignal.timeout(GSRS_TIMEOUT_MS),
			headers: { accept: 'application/json' }
		});
		if (response.status === 404) return { status: 'not-found' };
		if (!response.ok) return { status: 'unavailable' };
		const raw: unknown = await response.json();
		const substance = parseGsrs(unii, raw);
		return substance ? { status: 'ok', substance, raw: trimGsrs(raw) } : { status: 'not-found' };
	} catch {
		return { status: 'unavailable' };
	}
}

/** The parts of a full GSRS document the parser reads, so the cache stays small. */
export function trimGsrs(document: unknown): unknown {
	if (!isRecord(document)) return null;
	const structure = isRecord(document.structure) ? document.structure : null;
	return {
		approvalID: document.approvalID ?? null,
		_name: document._name ?? null,
		substanceClass: document.substanceClass ?? null,
		structure: structure && {
			formula: structure.formula ?? null,
			mwt: structure.mwt ?? null,
			count: structure.count ?? null
		},
		moieties: (Array.isArray(document.moieties) ? document.moieties : [])
			.filter(isRecord)
			.map((m) => ({ formula: m.formula ?? null, mwt: m.mwt ?? null, count: m.count ?? null })),
		relationships: (Array.isArray(document.relationships) ? document.relationships : [])
			.filter((r) => isRecord(r) && r.type === 'ACTIVE MOIETY')
	};
}
