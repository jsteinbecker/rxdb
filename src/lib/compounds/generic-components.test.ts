import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	genericName,
	injectionRoutes,
	readable,
	vialCombinations,
	vialContent,
	type Vial
} from './generic-components';
import { rational, type Rational } from '../medication/rational';

const r = (n: number, d = 1): Rational => rational(n, d)!;
const vial = (id: string, mg: number): Vial => ({ packageId: id, amount: r(mg), unit: 'mg' });
const amp = [vial('2g', 2000), vial('1g', 1000), vial('500', 500)];
const show = (combos: ReturnType<typeof vialCombinations>) =>
	combos.map((c) => c.picks.map((p) => `${p.count}x${p.packageId}`).join('+'));

test('2 g of ampicillin: exact fills, fewest vials first', () => {
	assert.deepEqual(show(vialCombinations(r(2000), 'mg', amp)), ['1x2g', '2x1g', '1x1g+2x500', '4x500']);
});

test('an odd dose overfills with the least waste', () => {
	const [best] = vialCombinations(r(1200), 'mg', amp);
	assert.deepEqual(show([best]), ['1x1g+1x500']);
	assert.deepEqual(best.waste, r(300));
});

test('no proposal stacks a vial onto one that already covers the dose', () => {
	for (const combo of vialCombinations(r(400), 'mg', amp))
		assert.ok(!combo.picks.some((p) => p.packageId === '2g' && combo.vials > 1));
});

test('vials in another unit, or a dose beyond the vial limit, give nothing', () => {
	assert.deepEqual(vialCombinations(r(2000), 'unit', amp), []);
	assert.deepEqual(vialCombinations(r(100000), 'mg', amp, { maxVials: 3 }), []);
});

test('duplicate strengths count once, the first listed wins', () => {
	const combos = vialCombinations(r(1000), 'mg', [vial('a', 1000), vial('b', 1000)]);
	assert.deepEqual(show(combos), ['1xa']);
});

test('vial content reads single dry fills in mg', () => {
	assert.deepEqual(vialContent([{ name: 'AMPICILLIN SODIUM', strength: '1 g' }])?.amount, r(1000));
	assert.equal(vialContent([{ name: 'X', strength: '100 mg/mL' }]), null);
	assert.equal(vialContent([{ name: 'A', strength: '1 g' }, { name: 'B', strength: '1 g' }]), null);
});

test('generic names and routes', () => {
	assert.equal(genericName([{ name: 'TAZOBACTAM' }, { name: 'PIPERACILLIN' }]), 'Piperacillin / Tazobactam');
	assert.deepEqual(injectionRoutes(['INTRAMUSCULAR', 'INTRAVENOUS', 'ORAL']), ['IM', 'IV']);
});

test('amounts read in grams from a gram up', () => {
	assert.deepEqual(readable(r(2000), 'mg'), { value: r(2), unit: 'g' });
	assert.deepEqual(readable(r(1500), 'mg'), { value: r(3, 2), unit: 'g' });
	assert.deepEqual(readable(r(500), 'mg'), { value: r(500), unit: 'mg' });
});
