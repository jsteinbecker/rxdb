import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUuid, moietyUniis, normalizeRuleClasses, RuleInputError } from '../pharm-class-rule-input';
import {
	countMatches,
	countMatchesForRules,
	deleteRule,
	knownClasses,
	resetScanIndex,
	resetKnownClassesCache,
	upsertRule,
	type PharmClassRuleRow
} from './pharm-class-rule-store';

test('trims, drops blanks and de-duplicates', () => {
	assert.deepEqual(normalizeRuleClasses([' A ', '', 'A', 'B'], 'replace'), ['A', 'B']);
});
test('rejects an empty list unless suppress', () => {
	assert.throws(() => normalizeRuleClasses([' '], 'add'), RuleInputError);
	assert.deepEqual(normalizeRuleClasses([], 'suppress'), []);
});
test('rejects a class over 160 characters', () => {
	assert.throws(() => normalizeRuleClasses(['x'.repeat(161)], 'replace'), RuleInputError);
	assert.equal(normalizeRuleClasses(['x'.repeat(160)], 'replace').length, 1);
});
test('moietyUniis splits a key, dropping blanks and duplicates', () => {
	assert.deepEqual(moietyUniis('A|B|A'), ['A', 'B']);
	assert.deepEqual(moietyUniis(''), []);
});

test('isUuid accepts uuids only', () => {
	assert.equal(isUuid('3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34'), true);
	assert.equal(isUuid('abc'), false);
	assert.equal(isUuid(''), false);
	assert.equal(isUuid("3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34'; --"), false);
});

test('deleteRule answers 404 for a non-uuid id without touching the database', async () => {
	const db = {
		pharmClassRule: {
			deleteMany: () => {
				throw new Error('should not be called');
			}
		}
	};
	await assert.rejects(
		() => deleteRule(db as never, 'scope', 'not-a-uuid'),
		(cause: { status?: number }) => cause.status === 404
	);
});

const input = {
	moietyKey: 'U',
	moietyNames: 'U',
	doseFormGroup: null,
	route: null,
	strengthKey: null,
	mode: 'add' as const,
	classes: ['A']
};

test('upsertRule retries as an update when a concurrent create wins (P2002)', async () => {
	const calls: string[] = [];
	const existing = { id: 'row-1' } as PharmClassRuleRow;
	let finds = 0;
	const db = {
		pharmClassRule: {
			findFirst: async () => (finds++ === 0 ? null : existing),
			create: async () => {
				calls.push('create');
				throw Object.assign(new Error('unique'), { code: 'P2002' });
			},
			update: async ({ where }: { where: { id: string } }) => {
				calls.push(`update:${where.id}`);
				return { ...existing, mode: 'add' };
			}
		}
	};
	await upsertRule(db as never, 'scope', input);
	assert.deepEqual(calls, ['create', 'update:row-1']);
});

test('upsertRule rethrows other create errors and a second P2002', async () => {
	const failing = (code: string) => ({
		pharmClassRule: {
			findFirst: async () => null,
			create: async () => {
				throw Object.assign(new Error('boom'), { code });
			},
			update: async () => ({})
		}
	});
	await assert.rejects(() => upsertRule(failing('P1000') as never, 'scope', input), /boom/);
	await assert.rejects(() => upsertRule(failing('P2002') as never, 'scope', input), /boom/);
});

test('knownClasses shares one in-flight query and does not cache an empty result', async () => {
	resetKnownClassesCache();
	let queries = 0;
	let rows: { name: string }[] = [];
	const db = {
		$queryRaw: async () => {
			queries++;
			await new Promise((resolve) => setTimeout(resolve, 5));
			return rows;
		}
	};
	const [a, b] = await Promise.all([knownClasses(db as never), knownClasses(db as never)]);
	assert.equal(queries, 1);
	assert.deepEqual([a, b], [[], []]);
	rows = [{ name: 'X [EPC]' }];
	assert.deepEqual(await knownClasses(db as never), ['X [EPC]']);
	assert.equal(queries, 2);
	assert.deepEqual(await knownClasses(db as never), ['X [EPC]']);
	assert.equal(queries, 2);
	resetKnownClassesCache();
});

/** A database holding the given latest snapshots; counts how many payloads each refresh fetched. */
function snapshotDb(records: { id: string; ndc: string; observedAt: Date; item: unknown }[]) {
	const fetched: number[] = [];
	const db = {
		$queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
			if (strings.join('?').includes('DISTINCT ON'))
				return records.map(({ id, observedAt }) => ({ id, observedAt }));
			const ids = values.find(Array.isArray) as string[];
			fetched.push(ids.length);
			return records
				.filter((record) => ids.includes(record.id))
				.map(({ id, ndc, item }) => ({ id, ndc, item }));
		}
	};
	return { db, fetched };
}

test('rule counts match packages carrying every UNII, and agree between countMatches and countMatchesForRules', async () => {
	resetScanIndex();
	const pkg = (uniis: string[], doseForm: string, spl: unknown = null) => ({
		doseForm,
		details: { product: { routes: [], uniis }, spl }
	});
	const at = new Date(0);
	const { db } = snapshotDb([
		{ id: 'p1', ndc: '00000000001', observedAt: at, item: pkg(['A'], 'INJECTION') },
		{ id: 'p2', ndc: '00000000002', observedAt: at, item: pkg(['A'], 'TABLET') },
		// A moiety named only in the SPL still counts.
		{
			id: 'p3',
			ndc: '00000000003',
			observedAt: at,
			item: pkg([], 'TABLET', { ingredients: [{ unii: 'X', moieties: [{ unii: 'C' }] }] })
		},
		{ id: 'p4', ndc: '00000000004', observedAt: at, item: pkg(['C', 'D'], 'TABLET') }
	]);
	const facets = { route: null, strengthKey: null };
	const rules = [
		{ id: 'r1', moietyKey: 'A', doseFormGroup: null, ...facets },
		{ id: 'r2', moietyKey: 'A', doseFormGroup: 'injectable', ...facets },
		{ id: 'r3', moietyKey: 'B', doseFormGroup: null, ...facets },
		{ id: 'r4', moietyKey: 'C|D', doseFormGroup: null, ...facets }
	];
	const counts = await countMatchesForRules(db as never, rules);
	assert.deepEqual(counts.get('r1'), { count: 2, capped: false });
	assert.deepEqual(counts.get('r2'), { count: 1, capped: false });
	assert.deepEqual(counts.get('r3'), { count: 0, capped: false });
	for (const rule of rules)
		assert.deepEqual(counts.get(rule.id), await countMatches(db as never, rule), rule.id);
	resetScanIndex();
});

test('the scan index refetches only snapshots that are new or rewritten', async () => {
	resetScanIndex();
	const item = { doseForm: 'TABLET', details: { product: { routes: [], uniis: ['A'] }, spl: null } };
	const records = [
		{ id: 'p1', ndc: '00000000001', observedAt: new Date(0), item },
		{ id: 'p2', ndc: '00000000002', observedAt: new Date(0), item }
	];
	const { db, fetched } = snapshotDb(records);
	const rule = { moietyKey: 'A', doseFormGroup: null, route: null, strengthKey: null };
	assert.deepEqual(await countMatches(db as never, rule), { count: 2, capped: false });
	assert.deepEqual(await countMatches(db as never, rule), { count: 2, capped: false });
	assert.deepEqual(fetched, [2]);
	records[1].observedAt = new Date(1);
	records.push({ id: 'p3', ndc: '00000000003', observedAt: new Date(0), item });
	assert.deepEqual(await countMatches(db as never, rule), { count: 3, capped: false });
	assert.deepEqual(fetched, [2, 2]);
	// A record superseded by a newer one drops out of the counts.
	records.splice(0, 1);
	assert.deepEqual(await countMatches(db as never, rule), { count: 2, capped: false });
	resetScanIndex();
});
