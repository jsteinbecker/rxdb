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
