import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { lookupUnii, parseGsrs } from './gsrs';
import {
	type CachedSubstance,
	NOT_FOUND_TTL_MS,
	SUBSTANCE_TTL_MS,
	substanceFor,
	type SubstanceTable
} from '../medication/substance-store';

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`../fixtures/gsrs/${name}.json`, import.meta.url), 'utf8'));

test('a salt reads its weight, active moiety and count', () => {
	const salt = parseGsrs('M98T69Q7HP', fixture('salt'));
	assert.equal(salt?.name, 'Piperacillin Sodium');
	assert.equal(salt?.formula, 'C23H26N5O7S.Na');
	assert.equal(salt?.mw, 539.5386);
	assert.deepEqual(salt?.moiety, { unii: '9I628532GX', name: 'Piperacillin anhydrous' });
	assert.equal(salt?.moietyCount, 1);
});

test('a hydrate counts the drug, not the water', () => {
	const hydrate = parseGsrs('XLJ4VSY381', fixture('hydrate'));
	assert.equal(hydrate?.mw, 566.5692);
	assert.equal(hydrate?.moietyCount, 1);
	assert.equal(hydrate?.moiety?.unii, 'IHS69L0Y4T');
});

test('a moiety-only substance is its own moiety', () => {
	const moiety = parseGsrs('9I628532GX', fixture('moiety-only'));
	assert.equal(moiety?.mw, 517.5568);
	assert.equal(moiety?.moiety?.unii, '9I628532GX');
});

test('a protein has no molecular weight', () => {
	const protein = parseGsrs('1Y17CTI5SR', fixture('protein'));
	assert.equal(protein?.name, 'INSULIN HUMAN');
	assert.equal(protein?.mw, null);
	assert.equal(protein?.moietyCount, null);
});

test('a non-document is not a substance', () => {
	assert.equal(parseGsrs('X', null), null);
	assert.equal(parseGsrs('X', []), null);
});

const respond = (status: number, body: unknown = {}) =>
	(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('lookup maps 404 to not-found and failures to unavailable', async () => {
	assert.equal((await lookupUnii('ZZZZZZZZZZ', respond(404))).status, 'not-found');
	assert.equal((await lookupUnii('ZZZZZZZZZZ', respond(500))).status, 'unavailable');
	const failing = (async () => {
		throw new Error('offline');
	}) as unknown as typeof fetch;
	assert.equal((await lookupUnii('ZZZZZZZZZZ', failing)).status, 'unavailable');
	const found = await lookupUnii('M98T69Q7HP', respond(200, fixture('salt')));
	assert.equal(found.status, 'ok');
});

function memoryTable() {
	const rows = new Map<string, CachedSubstance & { raw: unknown }>();
	const table: SubstanceTable = {
		find: async (unii) => rows.get(unii) ?? null,
		save: async (row) => void rows.set(row.unii, row)
	};
	return { rows, table };
}

test('a fresh cached row is served without asking GSRS', async () => {
	const { table } = memoryTable();
	let calls = 0;
	const lookup = async (unii: string) => {
		calls++;
		return { status: 'ok' as const, substance: parseGsrs(unii, fixture('salt'))!, raw: {} };
	};
	const t0 = Date.parse('2026-10-07T00:00:00Z');
	await substanceFor(table, 'M98T69Q7HP', { now: t0, lookup });
	await substanceFor(table, 'M98T69Q7HP', { now: t0 + SUBSTANCE_TTL_MS - 1000, lookup });
	assert.equal(calls, 1);
	await substanceFor(table, 'M98T69Q7HP', { now: t0 + SUBSTANCE_TTL_MS + 1000, lookup });
	assert.equal(calls, 2);
});

test('not-found is cached for a day only', async () => {
	const { table } = memoryTable();
	let calls = 0;
	const lookup = async () => {
		calls++;
		return { status: 'not-found' as const };
	};
	const t0 = Date.parse('2026-10-07T00:00:00Z');
	assert.equal((await substanceFor(table, 'ZZZZZZZZZZ', { now: t0, lookup })).status, 'not-found');
	await substanceFor(table, 'ZZZZZZZZZZ', { now: t0 + NOT_FOUND_TTL_MS - 1000, lookup });
	assert.equal(calls, 1);
	await substanceFor(table, 'ZZZZZZZZZZ', { now: t0 + NOT_FOUND_TTL_MS + 1000, lookup });
	assert.equal(calls, 2);
});

test('an outage serves a stale row, or reports unavailable', async () => {
	const { table } = memoryTable();
	const t0 = Date.parse('2026-10-07T00:00:00Z');
	const down = async () => ({ status: 'unavailable' as const });
	assert.equal(
		(await substanceFor(table, 'M98T69Q7HP', { now: t0, lookup: down })).status,
		'unavailable'
	);
	await substanceFor(table, 'M98T69Q7HP', {
		now: t0,
		lookup: async (unii) => ({
			status: 'ok',
			substance: parseGsrs(unii, fixture('salt'))!,
			raw: {}
		})
	});
	const stale = await substanceFor(table, 'M98T69Q7HP', {
		now: t0 + SUBSTANCE_TTL_MS * 2,
		lookup: down
	});
	assert.equal(stale.status, 'ok');
});

test('a salt of two active ions has no default moiety', () => {
	const nacl = parseGsrs('451W47IQ8X', {
		_name: 'SODIUM CHLORIDE',
		relationships: [
			{
				type: 'ACTIVE MOIETY',
				relatedSubstance: { name: 'CHLORIDE ION', approvalID: 'Q32ZN48698' }
			},
			{
				type: 'ACTIVE MOIETY',
				relatedSubstance: { name: 'SODIUM CATION', approvalID: 'LYR4M0NH37' }
			}
		]
	});
	assert.equal(nacl?.moiety, null);
	assert.deepEqual(
		nacl?.moieties.map((moiety) => moiety.name),
		['CHLORIDE ION', 'SODIUM CATION']
	);
});
