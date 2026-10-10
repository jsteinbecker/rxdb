import { error } from '@sveltejs/kit';
import type { PrismaClient } from '../../generated/client';
import { packageClassKey } from '../pharm-class-key';
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

/**
 * The latest cached packages carrying every UNII, pre-filtered in SQL (a superset of the rule matches).
 * Rows come back in NDC order so the first MATCH_LIMIT are the same every time; `capped` is true whenever
 * the raw SQL limit was hit, in which case the packages are a prefix and any count over them is a lower bound.
 */
async function scanCandidates(
	db: Db,
	uniis: string[]
): Promise<{ packages: ExternalPackage[]; capped: boolean }> {
	const rows = await db.$queryRaw<{ payload: { item?: ExternalPackage } | null }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (r.source_native_id) r.id
      FROM source_record r
      JOIN ingestion_run run ON run.id = r.ingestion_run_id
      WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
        AND r.source_native_id ~ '^[0-9]{11}$'
      ORDER BY r.source_native_id, r.observed_at DESC
    )
    SELECT r.payload #- '{item,details,label}' AS payload
    FROM source_record r JOIN latest ON latest.id = r.id
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(${uniis}::text[]) AS u(unii)
      WHERE NOT COALESCE(
        jsonb_exists(r.payload #> '{item,details,product,uniis}', u.unii)
        OR jsonb_path_exists(
          r.payload,
          '$.item.details.spl.ingredients[*] ? (@.unii == $u || @.moieties[*].unii == $u)',
          jsonb_build_object('u', u.unii)
        ),
        false
      )
    )
    ORDER BY r.source_native_id
    LIMIT ${MATCH_LIMIT}`;
	return {
		packages: rows.flatMap(({ payload }) => (payload?.item ? [payload.item] : [])),
		capped: rows.length >= MATCH_LIMIT
	};
}

function countIn(rule: RuleFacets, packages: ExternalPackage[], capped: boolean): Count {
	const full = { id: '', mode: 'replace' as const, classes: [], ...rule };
	return { count: packages.filter((item) => ruleMatches(full, packageClassKey(item))).length, capped };
}

/**
 * How many cached packages a rule would apply to. `capped` is true whenever the scan hit its row limit,
 * so the count is then a lower bound.
 */
export async function countMatches(db: Db, rule: RuleFacets): Promise<Count> {
	const uniis = moietyUniis(rule.moietyKey);
	if (!uniis.length) return { count: 0, capped: false };
	const { packages, capped } = await scanCandidates(db, uniis);
	return countIn(rule, packages, capped);
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
			const scan = uniis.length ? await scanCandidates(db, uniis) : { packages: [], capped: false };
			for (const rule of group) counts.set(rule.id, countIn(rule, scan.packages, scan.capped));
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
