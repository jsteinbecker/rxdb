import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PackageClassKey } from './pharm-class-key';
import { scopeOptions } from './pharm-class-scope-options';

const key = (over: Partial<PackageClassKey> = {}): PackageClassKey => ({
	moietyKey: 'ABC',
	moietyNames: 'Drug',
	doseFormGroup: 'injectable',
	routes: [],
	strengthKey: '10 mg',
	...over
});

const ids = (k: PackageClassKey) => scopeOptions(k).map((o) => o.id);

test('empty moiety key offers nothing', () => {
	assert.deepEqual(scopeOptions(key({ moietyKey: '' })), []);
});

test('no route: all, form, strength without a route', () => {
	const options = scopeOptions(key());
	assert.deepEqual(ids(key()), ['all', 'form', 'strength']);
	assert.equal(options[2].route, null);
	assert.equal(options[2].strengthKey, '10 mg');
});

test('one route: route option, and strength keeps that route', () => {
	const options = scopeOptions(key({ routes: ['INTRAVENOUS'] }));
	assert.deepEqual(
		options.map((o) => o.id),
		['all', 'form', 'route:INTRAVENOUS', 'strength']
	);
	assert.equal(options[2].route, 'INTRAVENOUS');
	assert.equal(options[3].route, 'INTRAVENOUS');
});

test('several routes: one labelled route option each, strength is route-less, ids unique', () => {
	const k = key({ routes: ['INTRAVENOUS', 'INTRAMUSCULAR', 'INTRAVENOUS'] });
	const options = scopeOptions(k);
	assert.deepEqual(ids(k), ['all', 'form', 'route:INTRAVENOUS', 'route:INTRAMUSCULAR', 'strength']);
	assert.equal(new Set(ids(k)).size, options.length);
	assert.match(options[2].label, /intravenous/);
	assert.match(options[3].label, /intramuscular/);
	assert.equal(options[4].route, null);
	assert.match(options[4].label, /any route/);
});

test('null strength key omits the strength option', () => {
	assert.deepEqual(ids(key({ strengthKey: null, routes: ['ORAL', 'SUBLINGUAL'] })), [
		'all',
		'form',
		'route:ORAL',
		'route:SUBLINGUAL'
	]);
});
