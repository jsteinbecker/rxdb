import { error } from '@sveltejs/kit';
import type { PrismaClient } from '../../generated/client';
import { packageClassKey } from '../pharm-class-key';
import { normalizeRuleClasses } from '../pharm-class-rule-input';
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
	const existing = await db.pharmClassRule.findFirst({
		where: {
			scopeId,
			moietyKey: input.moietyKey,
			doseFormGroup: input.doseFormGroup === null ? { equals: null } : input.doseFormGroup,
			route: input.route === null ? { equals: null } : input.route,
			strengthKey: input.strengthKey === null ? { equals: null } : input.strengthKey
		}
	});
	const data = {
		moietyNames: input.moietyNames,
		mode: input.mode,
		classes,
		note: input.note ?? null
	};
	const row = existing
		? await db.pharmClassRule.update({ where: { id: existing.id }, data })
		: await db.pharmClassRule.create({ data: { ...key, ...data } });
	return asRow(row);
}

export async function deleteRule(db: Db, scopeId: string, id: string): Promise<void> {
	const { count } = await db.pharmClassRule.deleteMany({ where: { id, scopeId } });
	if (!count) error(404, 'Rule not found');
}

const MATCH_LIMIT = 2000;

/** How many cached packages a rule would apply to; `capped` when the scan hit the limit. */
export async function countMatches(
	db: Db,
	rule: Pick<PharmClassRule, 'moietyKey' | 'doseFormGroup' | 'route' | 'strengthKey'>
): Promise<{ count: number; capped: boolean }> {
	const uniis = rule.moietyKey.split('|').filter(Boolean);
	if (!uniis.length) return { count: 0, capped: false };
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
    WHERE r.payload #> '{item,details,product,uniis}' @> ${JSON.stringify(uniis)}::jsonb
    LIMIT ${MATCH_LIMIT}`;
	const full = { id: '', mode: 'replace' as const, classes: [], ...rule };
	const count = rows.filter(
		({ payload }) => payload?.item && ruleMatches(full, packageClassKey(payload.item))
	).length;
	return { count, capped: rows.length >= MATCH_LIMIT };
}

const KNOWN_TTL_MS = 10 * 60 * 1000;
let knownCache: { at: number; classes: string[] } | null = null;

/** Distinct source pharmacologic classes across the latest snapshots, for the type-ahead. */
export async function knownClasses(db: Db, now = Date.now()): Promise<string[]> {
	if (knownCache && now - knownCache.at < KNOWN_TTL_MS) return knownCache.classes;
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
	const classes = rows.map((row) => row.name);
	knownCache = { at: now, classes };
	return classes;
}
