import { error } from '@sveltejs/kit';
import type { PrismaClient } from '../../generated/client';
import { packageClassKey, type PackageClassKey } from '../pharm-class-key';
import { isUuid, moietyUniis, normalizeRuleClasses } from '../pharm-class-rule-input';
import { ruleMatches, type PharmClassRule } from '../pharm-class-rules';
import { CACHE_SOURCE } from './catalog-cache';
import type { ExternalPackage } from './catalog-providers';

export { RuleInputError } from '../pharm-class-rule-input';

type Db = PrismaClient;

export type PharmClassRuleRow = PharmClassRule & {
	scopeId: string;
	moietyNames: string;
	note: string | null;
	createdAt: Date;
	updatedAt: Date;
};

export type RuleInput = {
	moietyKey: string;
	moietyNames: string;
	doseFormGroup: string | null;
	route: string | null;
	strengthKey: string | null;
	mode: PharmClassRule['mode'];
	classes: string[];
	note?: string | null;
};

const asRow = (row: {
	mode: string;
	[key: string]: unknown;
}): PharmClassRuleRow => row as unknown as PharmClassRuleRow;

export async function rulesForKeys(
	db: Db,
	scopeId: string,
	moietyKeys: string[]
): Promise<PharmClassRuleRow[]> {
	const keys = [...new Set(moietyKeys.filter(Boolean))];
	if (!keys.length) return [];
	const rows = await db.pharmClassRule.findMany({
		where: { scopeId, moietyKey: { in: keys } },
		orderBy: { createdAt: 'asc' }
	});
	return rows.map(asRow);
}

export async function listRules(db: Db, scopeId: string): Promise<PharmClassRuleRow[]> {
	const rows = await db.pharmClassRule.findMany({
		where: { scopeId },
		orderBy: [{ moietyNames: 'asc' }, { createdAt: 'asc' }]
	});
	return rows.map(asRow);
}

/** Throws `RuleInputError` for invalid input; route actions turn that into fail(400). */
export async function upsertRule(
	db: Db,
	scopeId: string,
	input: RuleInput
): Promise<PharmClassRuleRow> {
	const classes = normalizeRuleClasses(input.classes, input.mode);
	const key = {
		scopeId,
		moietyKey: input.moietyKey,
		doseFormGroup: input.doseFormGroup,
		route: input.route,
		strengthKey: input.strengthKey
	};
	const data = {
		moietyNames: input.moietyNames,
		mode: input.mode,
		classes,
		note: input.note ?? null
	};
	const find = () =>
		db.pharmClassRule.findFirst({
			where: {
				scopeId,
				moietyKey: input.moietyKey,
				doseFormGroup: input.doseFormGroup === null ? { equals: null } : input.doseFormGroup,
				route: input.route === null ? { equals: null } : input.route,
				strengthKey: input.strengthKey === null ? { equals: null } : input.strengthKey
			}
		});
	const existing = await find();
	if (existing)
		return asRow(await db.pharmClassRule.update({ where: { id: existing.id }, data }));
	try {
		return asRow(await db.pharmClassRule.create({ data: { ...key, ...data } }));
	} catch (cause) {
		// A concurrent save created the same key between our find and create: update that row instead.
		if ((cause as { code?: string }).code !== 'P2002') throw cause;
		const winner = await find();
		if (!winner) throw cause;
		return asRow(await db.pharmClassRule.update({ where: { id: winner.id }, data }));
	}
}

export async function deleteRule(db: Db, scopeId: string, id: string): Promise<void> {
	if (!isUuid(id)) error(404, 'Rule not found');
	const { count } = await db.pharmClassRule.deleteMany({ where: { id, scopeId } });
	if (!count) error(404, 'Rule not found');
}

const MATCH_LIMIT = 2000;
const SCAN_CONCURRENCY = 2;

type RuleFacets = Pick<PharmClassRule, 'moietyKey' | 'doseFormGroup' | 'route' | 'strengthKey'>;
type Count = { count: number; capped: boolean };

/** What a rule count needs from one latest cached package: its UNIIs and its class key. */
type ScanEntry = { observedAt: number; ndc: string; uniis: Set<string>; key: PackageClassKey };

/**
 * The latest package snapshots, reduced to `ScanEntry`s and kept by record id. Matching every snapshot's
 * JSON in SQL decompresses all of them per count, so a refresh fetches only records new or rewritten since
 * the last one (a rewrite always moves `observed_at`); concurrent counts share one refresh.
 */
const scanIndex = new Map<string, ScanEntry>();
let scanRefresh: Promise<ScanEntry[]> | null = null;
const SCAN_FETCH_BATCH = 500;

/** For tests. */
export function resetScanIndex(): void {
	scanIndex.clear();
	scanRefresh = null;
}

function latestScanEntries(db: Db): Promise<ScanEntry[]> {
	scanRefresh ??= refreshScanIndex(db).finally(() => {
		scanRefresh = null;
	});
	return scanRefresh;
}

async function refreshScanIndex(db: Db): Promise<ScanEntry[]> {
	const latest = await db.$queryRaw<{ id: string; observedAt: Date }[]>`
    SELECT DISTINCT ON (r.source_native_id) r.id, r.observed_at AS "observedAt"
    FROM source_record r
    JOIN ingestion_run run ON run.id = r.ingestion_run_id
    WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
      AND r.source_native_id ~ '^[0-9]{11}$'
    ORDER BY r.source_native_id, r.observed_at DESC`;
	const missing = latest.filter((row) => scanIndex.get(row.id)?.observedAt !== row.observedAt.getTime());
	for (let start = 0; start < missing.length; start += SCAN_FETCH_BATCH) {
		const batch = missing.slice(start, start + SCAN_FETCH_BATCH);
		const rows = await db.$queryRaw<{ id: string; ndc: string; item: ExternalPackage | null }[]>`
      SELECT r.id, r.source_native_id AS ndc, (r.payload #- '{item,details,label}') -> 'item' AS item
      FROM source_record r WHERE r.id = ANY(${batch.map((row) => row.id)}::uuid[])`;
		const observedAt = new Map(batch.map((row) => [row.id, row.observedAt.getTime()]));
		for (const { id, ndc, item } of rows)
			if (item) scanIndex.set(id, { observedAt: observedAt.get(id)!, ndc, uniis: packageUniis(item), key: packageClassKey(item) });
	}
	const current = new Set(latest.map((row) => row.id));
	for (const id of scanIndex.keys()) if (!current.has(id)) scanIndex.delete(id);
	// In NDC order, so the first MATCH_LIMIT matches are the same every time.
	return latest.flatMap((row) => scanIndex.get(row.id) ?? []);
}

/** The product's UNIIs and every SPL ingredient's and moiety's: the ones a rule's moieties are matched against. */
function packageUniis(item: ExternalPackage): Set<string> {
	const product = item.details?.product?.uniis as unknown;
	const uniis = new Set<string>(
		Array.isArray(product)
			? product.filter((unii): unii is string => typeof unii === 'string')
			: product && typeof product === 'object'
				? Object.keys(product)
				: []
	);
	for (const ingredient of item.details?.spl?.ingredients ?? []) {
		if (ingredient.unii) uniis.add(ingredient.unii);
		for (const moiety of ingredient.moieties ?? []) if (moiety.unii) uniis.add(moiety.unii);
	}
	return uniis;
}

/**
 * The latest cached packages carrying every UNII (a superset of the rule matches), as class keys. `capped`
 * is true whenever MATCH_LIMIT was hit, in which case the keys are a prefix and any count over them is a
 * lower bound.
 */
async function scanCandidates(
	db: Db,
	uniis: string[]
): Promise<{ keys: PackageClassKey[]; capped: boolean }> {
	const matches = (await latestScanEntries(db))
		.filter((entry) => uniis.every((unii) => entry.uniis.has(unii)))
		.slice(0, MATCH_LIMIT);
	return { keys: matches.map((entry) => entry.key), capped: matches.length >= MATCH_LIMIT };
}

function countIn(rule: RuleFacets, keys: PackageClassKey[], capped: boolean): Count {
	const full = { id: '', mode: 'replace' as const, classes: [], ...rule };
	return { count: keys.filter((key) => ruleMatches(full, key)).length, capped };
}

/**
 * How many cached packages a rule would apply to. `capped` is true whenever the scan hit its row limit,
 * so the count is then a lower bound.
 */
export async function countMatches(db: Db, rule: RuleFacets): Promise<Count> {
	const uniis = moietyUniis(rule.moietyKey);
	if (!uniis.length) return { count: 0, capped: false };
	const { keys, capped } = await scanCandidates(db, uniis);
	return countIn(rule, keys, capped);
}

/**
 * Counts for many rules, keyed by rule id. One scan per distinct moiety key (rules sharing a key share
 * the scan), run `SCAN_CONCURRENCY` at a time instead of once per rule all at once.
 */
export async function countMatchesForRules(
	db: Db,
	rules: (RuleFacets & { id: string })[]
): Promise<Map<string, Count>> {
	const byMoiety = new Map<string, (RuleFacets & { id: string })[]>();
	for (const rule of rules) byMoiety.set(rule.moietyKey, [...(byMoiety.get(rule.moietyKey) ?? []), rule]);
	const groups = [...byMoiety.entries()];
	const counts = new Map<string, Count>();
	let next = 0;
	const worker = async () => {
		while (next < groups.length) {
			const [moietyKey, group] = groups[next++];
			const uniis = moietyUniis(moietyKey);
			const scan = uniis.length ? await scanCandidates(db, uniis) : { keys: [], capped: false };
			for (const rule of group) counts.set(rule.id, countIn(rule, scan.keys, scan.capped));
		}
	};
	await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, groups.length) }, worker));
	return counts;
}

const KNOWN_TTL_MS = 10 * 60 * 1000;
let knownCache: { at: number; classes: string[] } | null = null;
let knownInFlight: Promise<string[]> | null = null;

/** For tests. */
export function resetKnownClassesCache(): void {
	knownCache = null;
	knownInFlight = null;
}

/**
 * Distinct source pharmacologic classes across the latest snapshots, for the type-ahead. Cached for ten
 * minutes except when empty (an empty cache just means nothing is synced yet); concurrent cold calls share one query.
 */
export function knownClasses(db: Db, now = Date.now()): Promise<string[]> {
	if (knownCache && now - knownCache.at < KNOWN_TTL_MS) return Promise.resolve(knownCache.classes);
	knownInFlight ??= loadKnownClasses(db)
		.then((classes) => {
			if (classes.length) knownCache = { at: now, classes };
			return classes;
		})
		.finally(() => {
			knownInFlight = null;
		});
	return knownInFlight;
}

async function loadKnownClasses(db: Db): Promise<string[]> {
	const rows = await db.$queryRaw<{ name: string }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (r.source_native_id) r.id
      FROM source_record r
      JOIN ingestion_run run ON run.id = r.ingestion_run_id
      WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
        AND r.source_native_id ~ '^[0-9]{11}$'
      ORDER BY r.source_native_id, r.observed_at DESC
    )
    SELECT DISTINCT c.name
    FROM source_record r JOIN latest ON latest.id = r.id,
      jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(r.payload #> '{item,details,product,pharmClasses}') = 'array'
          THEN r.payload #> '{item,details,product,pharmClasses}' ELSE '[]'::jsonb END
      ) AS c(name)
    ORDER BY c.name`;
	return rows.map((row) => row.name);
}
