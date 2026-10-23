import assert from 'node:assert/strict';
import test from 'node:test';
import { packageView } from './package-view';
import { correctedIngredients, packageDisplayTitle } from './package-title';
import { packageFixture } from '../server/testing/package-fixture';

const product = { doseForm: 'TABLET', brandName: 'Example', labelerName: 'Known labeler' };

test('oral dry-fill grouping keeps concentration when the missing form comes from catalog fallback', () => {
	const item = packageFixture({
		doseForm: null,
		ingredients: [{ name: 'AMOXICILLIN', strength: '250 mg/5mL' }],
		details: null
	});
	const view = packageView(item, {
		linkedProduct: { ...product, doseForm: 'POWDER, FOR SUSPENSION' }
	});
	assert.equal(view.facts.doseForm, 'POWDER, FOR SUSPENSION');
	assert.equal(view.ingredients[0].strength, '250 mg/5mL');
	// The old grouping path lacked that form and incorrectly stripped the denominator.
	assert.equal(correctedIngredients(item)[0].strength, '250 mg');
	assert.equal(view.displayTitle, packageDisplayTitle(view.facts));
	assert.equal(item.doseForm, null);
});

test('read precedence prefers snapshot facts, then SPL, linked product, and directory', () => {
	const item = packageFixture({
		doseForm: null,
		brandName: null,
		labelerName: null,
		details: { spl: { doseForm: 'CAPSULE', ingredients: [] } } as never
	});
	const fallback = {
		linkedProduct: { ...product, labelerName: 'Unknown labeler' },
		directoryProduct: { ...product, labelerName: 'Directory labeler' },
		doseType: 'single-dose'
	};
	const view = packageView(item, fallback);
	assert.equal(view.facts.doseForm, 'CAPSULE');
	assert.equal(view.facts.labelerName, 'Directory labeler');
	assert.equal(view.facts.brandName, 'Example');
	assert.equal(view.facts.isMultiDose, false);
	assert.equal(packageView({ ...item, doseForm: 'POWDER' }, fallback).facts.doseForm, 'POWDER');
	assert.equal(packageView(undefined, fallback).facts.doseForm, 'TABLET');
});
