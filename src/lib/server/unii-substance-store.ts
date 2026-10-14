import type { PrismaClient } from '../../generated/client';
import type { MoietyFactor } from '../spl-strength-checks';
import { conversionFactor } from '../strength-conversion';
import { activeMoietiesOf, type GsrsLookup, type GsrsSubstance, lookupUnii } from './gsrs';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A found substance is trusted this long; GSRS values change rarely. */
export const SUBSTANCE_TTL_MS = 90 * DAY_MS;
/** A UNII GSRS did not know is asked about again after this long. */
export const NOT_FOUND_TTL_MS = DAY_MS;

export type CachedSubstance = {
	unii: string;
	name: string | null;
	formula: string | null;
	mw: number | null;
	moietyUnii: string | null;
	moietyName: string | null;
	moietyCount: number | null;
	notFound: boolean;
	fetchedAt: Date;
	/** The trimmed GSRS document; its relationships hold every active moiety. */
	raw?: unknown;
};

/** The two table operations the cache needs, so tests need no database. */
export type SubstanceTable = {
	find: (unii: string) => Promise<CachedSubstance | null>;
	save: (row: CachedSubstance & { raw: unknown }) => Promise<void>;
};

export const prismaSubstanceTable = (db: PrismaClient): SubstanceTable => ({
	find: (unii) => db.uniiSubstance.findUnique({ where: { unii } }),
	save: async ({ raw, ...row }) => {
		const data = { ...row, raw: (raw ?? null) as never };
		await db.uniiSubstance.upsert({ where: { unii: row.unii }, create: data, update: data });
	}
});

export const isFresh = (row: CachedSubstance, now: number) =>
	now - row.fetchedAt.getTime() < (row.notFound ? NOT_FOUND_TTL_MS : SUBSTANCE_TTL_MS);

/** What the API route answers with. */
export type SubstanceAnswer =
	| { status: 'ok'; substance: GsrsSubstance; fetchedAt: string }
	| { status: 'not-found' }
	| { status: 'unavailable' };

const fromRow = (row: CachedSubstance): SubstanceAnswer =>
	row.notFound
		? { status: 'not-found' }
		: {
				status: 'ok',
				fetchedAt: row.fetchedAt.toISOString(),
				substance: {
					unii: row.unii,
					name: row.name,
					formula: row.formula,
					mw: row.mw,
					moiety:
						row.moietyUnii && row.moietyName
							? { unii: row.moietyUnii, name: row.moietyName }
							: null,
					moieties: activeMoietiesOf(row.raw),
					moietyCount: row.moietyCount
				}
			};

/**
 * The substance for a UNII: the cached row while fresh, else GSRS's answer
 * (cached). When GSRS cannot be reached a stale row is better than nothing.
 */
export async function substanceFor(
	table: SubstanceTable,
	unii: string,
	{ now = Date.now(), lookup = lookupUnii }: { now?: number; lookup?: (unii: string) => Promise<GsrsLookup> } = {}
): Promise<SubstanceAnswer> {
	const cached = await table.find(unii);
	if (cached && isFresh(cached, now)) return fromRow(cached);
	const answer = await lookup(unii);
	if (answer.status === 'unavailable') return cached ? fromRow(cached) : { status: 'unavailable' };
	const fetchedAt = new Date(now);
	if (answer.status === 'not-found') {
		await table.save({
			unii,
			name: null,
			formula: null,
			mw: null,
			moietyUnii: null,
			moietyName: null,
			moietyCount: null,
			notFound: true,
			raw: null,
			fetchedAt
		});
		return { status: 'not-found' };
	}
	const { substance, raw } = answer;
	await table.save({
		unii,
		name: substance.name,
		formula: substance.formula,
		mw: substance.mw,
		moietyUnii: substance.moiety?.unii ?? null,
		moietyName: substance.moiety?.name ?? null,
		moietyCount: substance.moietyCount,
		notFound: false,
		raw,
		fetchedAt
	});
	return { status: 'ok', substance, fetchedAt: fetchedAt.toISOString() };
}

/**
 * Every active moiety GSRS knows for a UNII, or null when it cannot say. Used
 * to complete a label that lists only some of a salt's ions.
 */
export const gsrsMoieties =
	(table: SubstanceTable) =>
	async (unii: string): Promise<{ unii: string; name: string }[] | null> => {
		const answer = await substanceFor(table, unii);
		return answer.status === 'ok' ? answer.substance.moieties : null;
	};

/**
 * How a salt's mass becomes its drug moiety's, from GSRS molecular weights:
 * `moietyCount · MW(moiety) / MW(salt)`. Null when GSRS names no single drug
 * moiety or lacks either weight.
 */
export const gsrsMoietyFactor =
	(table: SubstanceTable) =>
	async (unii: string): Promise<MoietyFactor | null> => {
		const salt = await substanceFor(table, unii);
		if (salt.status !== 'ok') return null;
		const { mw, moiety, moietyCount } = salt.substance;
		if (!mw || !moiety || !moietyCount || moiety.unii === unii) return null;
		const base = await substanceFor(table, moiety.unii);
		if (base.status !== 'ok' || !base.substance.mw) return null;
		const factor = conversionFactor(mw, base.substance.mw, 1 / moietyCount);
		return factor ? { moietyUnii: moiety.unii, factor } : null;
	};
