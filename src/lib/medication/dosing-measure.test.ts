import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	dosingConceptKey,
	dosingMeasureText,
	isCombo,
	parseDosingMeasure,
	type DosingMeasureSource
} from './dosing-measure';

const smxTmp = (rxcui = '198335'): DosingMeasureSource => ({
	ingredients: [
		{ name: 'SULFAMETHOXAZOLE', strength: '800 mg/1' },
		{ name: 'TRIMETHOPRIM', strength: '160 mg/1' }
	],
	details: {
		rxnav: { rxcui, conceptName: 'sulfamethoxazole 800 MG / trimethoprim 160 MG Oral Tablet' }
	}
});

test('packages under one RxCUI share a concept key', () => {
	assert.equal(dosingConceptKey(smxTmp()), dosingConceptKey({ ...smxTmp(), ingredients: [] }));
	assert.equal(dosingConceptKey({ ingredients: [] }), null);
});

test('only products with several ingredient groups are combos', () => {
	assert.equal(isCombo(smxTmp()), true);
	assert.equal(
		isCombo({
			ingredients: [
				{ name: 'CEFEPIME HYDROCHLORIDE', strength: '1 g/1' },
				{ name: 'cefepime', strength: '1 g/1' }
			]
		}),
		false
	);
});

test('sum and named ingredient are accepted; salts resolve to the moiety', () => {
	assert.deepEqual(parseDosingMeasure(smxTmp(), 'sum', null), { measure: { mode: 'sum' } });
	assert.deepEqual(parseDosingMeasure(smxTmp(), 'ingredient', 'Trimethoprim'), {
		measure: { mode: 'ingredient', ingredient: 'trimethoprim' }
	});
});

test('invalid selections are rejected', () => {
	assert.ok('error' in parseDosingMeasure(smxTmp(), 'ingredient', 'warfarin'));
	assert.ok('error' in parseDosingMeasure(smxTmp(), 'other', null));
	assert.ok(
		'error' in parseDosingMeasure({ ingredients: [{ name: 'X', strength: '1 mg' }] }, 'sum', null)
	);
	const unitless = smxTmp();
	unitless.ingredients![0].strength = '5 mL';
	assert.ok('error' in parseDosingMeasure(unitless, 'sum', null));
});

test('measure text reads the sum or the chosen ingredient', () => {
	assert.equal(dosingMeasureText(smxTmp(), { mode: 'sum' }), '960 mg (sum)');
	assert.equal(
		dosingMeasureText(smxTmp(), { mode: 'ingredient', ingredient: 'trimethoprim' }),
		'TRIMETHOPRIM 160 mg'
	);
});

test('sum puts every strength on a common denominator', () => {
	const amino: DosingMeasureSource = {
		ingredients: [
			{ name: 'LEUCINE', strength: '1.4 g/100 mL' },
			{ name: 'ACETYL L-TYROSINE', strength: '0.974 g/500 mL' },
			{ name: 'TAURINE', strength: '0.25 mg/mL' }
		]
	};
	// 1400 + 194.8 + 25 mg per 100 mL
	assert.equal(dosingMeasureText(amino, { mode: 'sum' }), '16.198 mg/mL (sum)');
	assert.ok(
		'error' in
			parseDosingMeasure(
				{
					ingredients: [
						{ name: 'A', strength: '1 g/100 mL' },
						{ name: 'B', strength: '5 mg/1' }
					]
				},
				'sum',
				null
			)
	);
});

test('sum may cover a subset of ingredient groups', () => {
	const amino: DosingMeasureSource = {
		ingredients: [
			{ name: 'LEUCINE', strength: '1.4 g/100 mL' },
			{ name: 'LYSINE ACETATE', strength: '1.2 g/100 mL' },
			{ name: 'SODIUM METABISULFITE', strength: '0.05 g/100 mL' }
		]
	};
	const parsed = parseDosingMeasure(amino, 'sum', null, ['Leucine', 'lysine acetate']);
	assert.ok('measure' in parsed);
	assert.equal(dosingMeasureText(amino, parsed.measure), '26 mg/mL (sum of 2)');
	assert.deepEqual(
		parseDosingMeasure(smxTmp(), 'sum', null, ['sulfamethoxazole', 'trimethoprim']),
		{
			measure: { mode: 'sum' }
		}
	);
	assert.ok('error' in parseDosingMeasure(amino, 'sum', null, ['leucine']));
	assert.ok('error' in parseDosingMeasure(amino, 'sum', null, ['leucine', 'warfarin']));
});
