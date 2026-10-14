import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPropertyOverrides } from './apply-property-overrides';
import { citeOverride } from './override-citation';
import { packageFixture } from './catalog-test-fixtures';
import { isProductLevelKey, type PropertyOverride } from '../property-override-fields';
import {
	applyIngredientCorrection,
	formatStrength,
	ingredientAsCorrection,
	ingredientCorrectionKey,
	parseIngredientCorrection,
	parseStrengthText,
	serializeIngredientCorrection,
	type IngredientCorrection
} from '../ingredient-correction';

const KEY = ingredientCorrectionKey(0);
const correction: IngredientCorrection = {
	substance: { name: 'PIPERACILLIN SODIUM', unii: 'M98T69Q7HP' },
	basis: 'moiety',
	moiety: { name: 'PIPERACILLIN', unii: 'X00B0D5O0E' },
	strength: { value: '577.9', unit: 'mg', per: '1', perUnit: '' },
	conversion: {
		from: { unii: 'M98T69Q7HP', mw: 539.5 },
		to: { unii: 'X00B0D5O0E', mw: 517.6 },
		n: 1,
		factor: '0.959',
		original: '600 mg',
		gsrsFetchedAt: null,
		mwEdited: true
	}
};
const stamp = (value: string): PropertyOverride => ({
	value,
	createdAt: '2026-10-07T00:00:00.000Z',
	source: 'none'
});
const withIngredient = (overrides: Record<string, PropertyOverride> = {}) =>
	packageFixture({
		ingredients: [{ name: 'PIPERACILLIN SODIUM', strength: '600 mg' }],
		details: {
			spl: {
				ingredients: [
					{
						name: 'PIPERACILLIN SODIUM',
						unii: 'AAAAAAAAAA',
						kind: 'active',
						basis: 'ingredient',
						strength: '600 mg',
						moieties: [{ name: 'OLD', unii: 'BBBBBBBBBB' }],
						productCode: null
					}
				]
			}
		} as never,
		propertyOverrides: overrides
	});

test('parse accepts a well-formed correction and round-trips it', () => {
	const parsed = parseIngredientCorrection(serializeIngredientCorrection(correction));
	assert.deepEqual(parsed, correction);
});

test('parse rejects malformed corrections', () => {
	const bad = (patch: object) => JSON.stringify({ ...correction, ...patch });
	assert.equal(parseIngredientCorrection('not json'), null);
	assert.equal(parseIngredientCorrection('[]'), null);
	assert.equal(parseIngredientCorrection(bad({ basis: 'salt' })), null);
	// A moiety basis needs its moiety.
	assert.equal(parseIngredientCorrection(bad({ moiety: undefined })), null);
	assert.equal(parseIngredientCorrection(bad({ moiety: { name: 'X', unii: 'short' } })), null);
	assert.equal(
		parseIngredientCorrection(bad({ strength: { value: '-1', unit: 'mg', per: '1', perUnit: '' } })),
		null
	);
	assert.equal(
		parseIngredientCorrection(bad({ strength: { value: '5', unit: '', per: '1', perUnit: '' } })),
		null
	);
	assert.equal(
		parseIngredientCorrection(bad({ conversion: { ...correction.conversion, n: 0 } })),
		null
	);
});

test('formats and parses strengths', () => {
	assert.equal(formatStrength({ value: '500', unit: 'mg', per: '1', perUnit: '' }), '500 mg');
	assert.equal(formatStrength({ value: '25', unit: 'mg', per: '1', perUnit: 'g' }), '25 mg/1 g');
	assert.deepEqual(parseStrengthText('25 mg/1 g'), { value: '25', unit: 'mg', per: '1', perUnit: 'g' });
	assert.deepEqual(parseStrengthText('25 mg/mL'), { value: '25', unit: 'mg', per: '1', perUnit: 'mL' });
	assert.deepEqual(parseStrengthText('500 mg'), { value: '500', unit: 'mg', per: '1', perUnit: '' });
	assert.equal(parseStrengthText('some'), null);
});

test('applying writes both ingredient lists and the moiety', () => {
	const applied = applyPropertyOverrides(
		withIngredient({ [KEY]: stamp(serializeIngredientCorrection(correction)) })
	);
	const row = applied.details!.spl!.ingredients[0];
	assert.equal(row.unii, 'M98T69Q7HP');
	assert.equal(row.basis, 'moiety');
	assert.equal(row.strength, '577.9 mg');
	assert.deepEqual(row.moieties, [{ name: 'PIPERACILLIN', unii: 'X00B0D5O0E' }]);
	assert.equal(applied.ingredients[0].strength, '577.9 mg');
});

test('an invalid stored correction is skipped', () => {
	const applied = applyPropertyOverrides(withIngredient({ [KEY]: stamp('{"basis":"x"}') }));
	assert.equal(applied.details!.spl!.ingredients[0].strength, '600 mg');
});

test('a correction wins over a strength override on the same row, whatever the order', () => {
	const strength = { ...stamp('1 g'), source: 'none' as const };
	for (const overrides of [
		{ 'details.spl.ingredients.0.strength': strength, [KEY]: stamp(serializeIngredientCorrection(correction)) },
		{ [KEY]: stamp(serializeIngredientCorrection(correction)), 'details.spl.ingredients.0.strength': strength }
	]) {
		const applied = applyPropertyOverrides(withIngredient(overrides));
		assert.equal(applied.details!.spl!.ingredients[0].strength, '577.9 mg');
	}
});

test('removing the correction restores the strength override', () => {
	const strength = stamp('1 g');
	const applied = applyPropertyOverrides(
		withIngredient({ 'details.spl.ingredients.0.strength': strength })
	);
	assert.equal(applied.details!.spl!.ingredients[0].strength, '1 g');
});

test('the correction key is product-level so it reaches sibling NDCs', () => {
	assert.equal(isProductLevelKey(KEY), true);
});

test('a correction can cite an equivalent NDC whose row matches', () => {
	const current = withIngredient();
	const sibling = applyPropertyOverrides(
		withIngredient({ [KEY]: stamp(serializeIngredientCorrection(correction)) })
	);
	const theirs = ingredientAsCorrection(sibling.details!.spl!.ingredients[0])!;
	const value = serializeIngredientCorrection(correction);
	const equivalent = {
		ndc: '25021018102',
		relation: 'sibling' as const,
		description: null,
		labelerName: null,
		values: { [KEY]: serializeIngredientCorrection(theirs) }
	};
	const cited = citeOverride(current, KEY, value, { source: 'ndc', ndc: equivalent.ndc }, [equivalent]);
	assert.equal(cited.source, 'ndc');
	const other = { ...equivalent, values: { [KEY]: serializeIngredientCorrection({ ...theirs, basis: 'ingredient', moiety: undefined }) } };
	assert.throws(() =>
		citeOverride(current, KEY, value, { source: 'ndc', ndc: other.ndc }, [other])
	);
});

test('a correction keeps the catalog row per its own volume when the label row has none', () => {
	const target = { name: 'ACETYL L-TYROSINE', unii: null, basis: null, strength: '1.2 g', moieties: [] };
	const listed = [{ name: 'ACETYL L-TYROSINE', strength: '.24 g/100mL' }];
	applyIngredientCorrection(target, listed, {
		basis: 'moiety',
		moiety: { name: 'TYROSINE', unii: '42HK56048U' },
		strength: { value: '0.974', unit: 'g', per: '1', perUnit: '' },
		conversion: {
			from: { unii: 'DA8G610ZO5', mw: 223.2256 },
			to: { unii: '42HK56048U', mw: 181.1889 },
			n: 1,
			factor: '0.81168512930416583',
			original: '1.2 g',
			gsrsFetchedAt: null,
			mwEdited: false
		}
	});
	assert.equal(target.strength, '0.974 g');
	assert.equal(listed[0].strength, '0.194804 g/100mL');
});
