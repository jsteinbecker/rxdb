import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUuid, moietyUniis, normalizeRuleClasses, RuleInputError } from '../pharm-class-rule-input';
import {
	countMatchesForRules,
	deleteRule,
	knownClasses,
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

test('countMatchesForRules scans once per distinct moiety key and counts per rule', async () => {
	const pkg = (uniis: string[], doseForm: string) =>
		({ ndc: '1', doseForm, details: { product: { routes: [], uniis }, spl: null } }) as never;
	let scans = 0;
	const db = {
		$queryRaw: async () => {
			scans++;
			return [
				{ payload: { item: pkg(['A'], 'INJECTION') } },
				{ payload: { item: pkg(['A'], 'TABLET') } }
			];
		}
	};
	const facets = { route: null, strengthKey: null };
	const counts = await countMatchesForRules(db as never, [
		{ id: 'r1', moietyKey: 'A', doseFormGroup: null, ...facets },
		{ id: 'r2', moietyKey: 'A', doseFormGroup: 'injectable', ...facets },
		{ id: 'r3', moietyKey: 'B', doseFormGroup: null, ...facets }
	]);
	assert.equal(scans, 2);
	assert.deepEqual(counts.get('r1'), { count: 2, capped: false });
	assert.deepEqual(counts.get('r2'), { count: 1, capped: false });
});
