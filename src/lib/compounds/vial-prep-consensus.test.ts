import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseAdoptedVialPrep,
	sameConsensusStep,
	vialPrepConsensus,
	type VialPrepPackage
} from './vial-prep-consensus';
import type { ProseReconstitution } from '../labels/dry-fill-volume';

const row = (diluentMl: number, mgPerMl: number | null, over: Partial<ProseReconstitution> = {}) => ({
	vialMassMg: 1000,
	diluentMl,
	concentrations: mgPerMl === null ? [] : [{ name: null, mgPerMl }],
	...over
});
const pkg = (id: string, rows: ProseReconstitution[], isDryFill: boolean | null = true): VialPrepPackage => ({
	packageId: id,
	ndc: id,
	title: id,
	isDryFill,
	reconstitution: rows
});

test('ready-to-use packages need no preparation', () => {
	assert.equal(vialPrepConsensus([pkg('a', [], false)]).status, 'not-needed');
});

test('every vial agreeing on a step is consensus', () => {
	const result = vialPrepConsensus([
		pkg('a', [row(9.6, 100, { diluents: ['SWFI', 'NS'], routes: ['IV'] }), row(2.1, 350, { routes: ['IM'] })]),
		pkg('b', [row(9.6, 100, { diluents: ['SWFI'] })])
	]);
	assert.equal(result.status, 'consensus');
	assert.deepEqual('steps' in result && result.steps, [
		{ vialMassMg: 1000, diluentMl: 9.6, concentrationMgPerMl: 100, diluents: ['SWFI'], routes: ['IV'] }
	]);
});

test('different volumes or concentrations conflict', () => {
	assert.equal(vialPrepConsensus([pkg('a', [row(9.6, 100)]), pkg('b', [row(10, 95)])]).status, 'conflict');
	assert.equal(vialPrepConsensus([pkg('a', [row(10, 100)]), pkg('b', [row(10, 95)])]).status, 'conflict');
});

test('disjoint diluents conflict', () => {
	const result = vialPrepConsensus([
		pkg('a', [row(2.1, 350, { diluents: ['lidocaine 1%'] })]),
		pkg('b', [row(2.1, 350, { diluents: ['SWFI'] })])
	]);
	assert.equal(result.status, 'conflict');
});

test('a dry fill without an instruction makes the consensus partial', () => {
	const result = vialPrepConsensus([pkg('a', [row(9.6, 100)]), pkg('b', [])]);
	assert.equal(result.status, 'partial');
	assert.deepEqual('missing' in result && result.missing.map((p) => p.packageId), ['b']);
});

test('ready-to-use packages do not vote', () => {
	const result = vialPrepConsensus([pkg('a', [row(9.6, 100)]), pkg('rtu', [], false)]);
	assert.equal(result.status, 'consensus');
});

test('bottle rows are not vial preparation', () => {
	assert.equal(vialPrepConsensus([pkg('a', [row(90, 40, { bottle: true })], null)]).status, 'not-needed');
});

const step = { vialMassMg: 1000, diluentMl: 9.6, concentrationMgPerMl: 100, diluents: ['SWFI'], routes: [] };

test('an adopted step reads back, and junk does not', () => {
	const stored = { step, ndcs: ['1'], adoptedAt: '2026-11-02T00:00:00.000Z' };
	assert.deepEqual(parseAdoptedVialPrep(JSON.parse(JSON.stringify(stored))), stored);
	assert.equal(parseAdoptedVialPrep(null), null);
	assert.equal(parseAdoptedVialPrep({ step: {}, ndcs: [], adoptedAt: 'x' }), null);
});

test('steps compare on volume, concentration, diluents and routes', () => {
	assert.ok(sameConsensusStep(step, { ...step, diluentMl: 9.61 }));
	assert.ok(!sameConsensusStep(step, { ...step, concentrationMgPerMl: 95 }));
	assert.ok(!sameConsensusStep(step, { ...step, diluents: ['NS'] }));
});

test("the compound's route sets aside label steps for other routes", () => {
	const ceftriaxone = [
		pkg('a', [row(9.6, 100, { routes: ['IV'] }), row(2.1, 350, { routes: ['IM'] }), row(5, 200)]),
		pkg('b', [row(9.6, 100, { routes: ['IV'] }), row(2.1, 350, { routes: ['IM'] }), row(5, 200)])
	];
	const steps = (route: 'IV' | 'IM' | null) => {
		const result = vialPrepConsensus(ceftriaxone, route);
		return 'steps' in result ? result.steps.map((step) => step.diluentMl) : [];
	};
	assert.deepEqual(steps(null), [9.6, 2.1, 5]);
	assert.deepEqual(steps('IV'), [9.6, 5]);
	assert.deepEqual(steps('IM'), [2.1, 5]);
});

test('a vial whose label covers only other routes is missing for this one', () => {
	const result = vialPrepConsensus(
		[pkg('a', [row(9.6, 100, { routes: ['IV'] })]), pkg('b', [row(2.1, 350, { routes: ['IM'] })])],
		'IV'
	);
	assert.equal(result.status, 'partial');
	assert.deepEqual('missing' in result && result.missing.map((p) => p.ndc), ['b']);
});

import { vialPrepVariants } from './vial-prep-consensus';

const stated = (packages: VialPrepPackage[]) => {
	const result = vialPrepVariants(packages);
	assert.equal(result.status, 'stated');
	return result as Extract<typeof result, { status: 'stated' }>;
};

test('variants: all ready-to-use needs no preparation', () => {
	assert.deepEqual(vialPrepVariants([pkg('a', [], false)]), { status: 'not-needed', readyToUse: ['a'] });
});

test('variants: agreeing labels are one unanimous variant', () => {
	const result = stated([pkg('a', [row(9.6, 100)]), pkg('b', [row(9.6, 100)]), pkg('c', [], false)]);
	assert.equal(result.groups.length, 1);
	assert.equal(result.groups[0].route, null);
	assert.equal(result.groups[0].status, 'unanimous');
	assert.deepEqual(result.groups[0].variants[0].ndcs, ['a', 'b']);
	assert.deepEqual(result.readyToUse, ['c']);
});

test('variants: a different volume splits, most-stated first, and flags the field', () => {
	const group = stated([pkg('a', [row(10, 95)]), pkg('b', [row(9.6, 100)]), pkg('c', [row(9.6, 100)])]).groups[0];
	assert.equal(group.status, 'split');
	assert.deepEqual(group.variants.map((v) => v.ndcs), [['b', 'c'], ['a']]);
	assert.deepEqual(group.differs[1], { diluentMl: true, concentration: true, diluents: false });
});

test('variants: concentration-only difference flags only concentration', () => {
	const group = stated([pkg('a', [row(9.6, 100)]), pkg('b', [row(9.6, 90)])]).groups[0];
	assert.equal(group.variants.length, 2);
	assert.deepEqual(group.differs[1], { diluentMl: false, concentration: true, diluents: false });
});

test('variants: routes group separately; route-less steps get their own group', () => {
	const result = stated([
		pkg('a', [row(9.6, 100, { routes: ['IV'] }), row(2.1, 350, { routes: ['IM'] })]),
		pkg('b', [row(9.6, 100)])
	]);
	assert.deepEqual(result.groups.map((g) => g.route), ['IV', 'IM', null]);
	// b states a route-less step, so it is not missing from the routed groups.
	assert.deepEqual(result.groups.map((g) => g.missing), [[], [], []]);
	assert.deepEqual(result.groups[2].variants[0].ndcs, ['b']);
});

test('variants: an IM-only label leaves the IV group incomplete', () => {
	const result = stated([pkg('a', [row(9.6, 100, { routes: ['IV'] })]), pkg('b', [row(2.1, 350, { routes: ['IM'] })])]);
	const iv = result.groups.find((g) => g.route === 'IV')!;
	assert.equal(iv.status, 'incomplete');
	assert.deepEqual(iv.missing, ['b']);
});

test('variants: a dry fill with no instruction is reported missing', () => {
	const result = stated([pkg('a', [row(9.6, 100)]), pkg('b', [])]);
	assert.deepEqual(result.missing, ['b']);
	assert.equal(result.groups[0].status, 'incomplete');
});

test('variants: two steps every label states are alternatives, not a split', () => {
	const group = stated([
		pkg('a', [row(2.1, 350, { routes: ['IM'] }), row(3.6, 250, { routes: ['IM'] })]),
		pkg('b', [row(2.1, 350, { routes: ['IM'] }), row(3.6, 250, { routes: ['IM'] })])
	]).groups[0];
	assert.equal(group.status, 'unanimous');
	assert.deepEqual(group.differs[1], { diluentMl: false, concentration: false, diluents: false });
});

test('variants: a route-less step beside routed ones is unassigned', () => {
	const result = stated([pkg('a', [row(9.6, 100, { routes: ['IV'] })]), pkg('b', [row(50, 20)])]);
	assert.equal(result.groups.find((g) => g.route === null)!.status, 'unassigned');
});
