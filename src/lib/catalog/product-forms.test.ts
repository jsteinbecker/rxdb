import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseIngredient, buildProductForms, type ProductFormInput } from './product-forms';

const pkg = (ndc: string, over: Partial<ProductFormInput> = {}): ProductFormInput => ({
	packageId: `p${ndc}`,
	ndc,
	doseForm: 'INJECTION, POWDER, FOR SOLUTION',
	scd: null,
	actives: [{ name: 'CEFTRIAXONE SODIUM', moieties: [{ name: 'CEFTRIAXONE' }] }],
	listed: [],
	routes: ['INTRAMUSCULAR', 'INTRAVENOUS'],
	isDryFill: true,
	reconstitution: [],
	...over
});

test('a salt keys on its moiety; a hydrate drops its water; an electrolyte keeps its name', () => {
	assert.equal(baseIngredient({ name: 'CEFEPIME HYDROCHLORIDE', moieties: [{ name: 'CEFEPIME' }] }), 'CEFEPIME');
	assert.equal(baseIngredient({ name: 'AMOXICILLIN', moieties: [{ name: 'AMOXICILLIN ANHYDROUS' }] }), 'AMOXICILLIN');
	assert.equal(
		baseIngredient({ name: 'SODIUM CHLORIDE', moieties: [{ name: 'SODIUM CATION' }, { name: 'CHLORIDE ION' }] }),
		'SODIUM CHLORIDE'
	);
});

test('salt and base spellings of one drug share a form; powder and solution do not', () => {
	const { forms } = buildProductForms([
		pkg('1', { actives: [{ name: 'MICAFUNGIN SODIUM', moieties: [{ name: 'MICAFUNGIN' }] }] }),
		pkg('2', { actives: [{ name: 'MICAFUNGIN', moieties: [] }] }),
		pkg('3', { actives: [{ name: 'MICAFUNGIN', moieties: [] }], doseForm: 'INJECTION, SOLUTION' })
	]);
	assert.deepEqual(
		forms.map((f) => [f.ingredients, f.doseForm, f.packageIds]),
		[
			[['MICAFUNGIN'], 'injection, powder, for solution', ['p1', 'p2']],
			[['MICAFUNGIN'], 'injection, solution', ['p3']]
		]
	);
});

test('packages without ingredients or a dose form are skipped, with the reason', () => {
	const { forms, skipped } = buildProductForms([
		pkg('1', { actives: [], listed: [] }),
		pkg('2', { doseForm: null })
	]);
	assert.equal(forms.length, 0);
	assert.deepEqual(skipped, [
		{ ndc: '1', reason: 'no ingredients' },
		{ ndc: '2', reason: 'no dose form' }
	]);
});

test('strengths come from the SCD, attributed to the base, salt named as the basis', () => {
	const { forms } = buildProductForms([
		pkg('1', {
			doseForm: 'TABLET',
			actives: [
				{ name: 'OXYCODONE HYDROCHLORIDE', moieties: [{ name: 'OXYCODONE' }] },
				{ name: 'ACETAMINOPHEN', moieties: [] }
			],
			scd: { id: 's1', name: 'acetaminophen 325 MG / oxycodone hydrochloride 5 MG Oral Tablet' }
		})
	]);
	assert.deepEqual(
		forms[0].strengths.map((s) => [s.ingredient, s.basisIngredient, s.value, s.unit]),
		[
			['ACETAMINOPHEN', null, 325, 'MG'],
			['OXYCODONE', 'OXYCODONE HYDROCHLORIDE', 5, 'MG']
		]
	);
});

test('routes come from the listing and the labels; prep is kept per route', () => {
	const im = { vialMassMg: 1000, diluentMl: 2.1, diluents: [], routes: ['IM' as const], concentrations: [{ name: null, mgPerMl: 350 }] };
	const iv = { vialMassMg: 1000, diluentMl: 9.6, diluents: [], routes: ['IV' as const], concentrations: [{ name: null, mgPerMl: 100 }] };
	const { forms } = buildProductForms([
		pkg('1', { routes: ['INTRAVENOUS'], reconstitution: [im, iv] }),
		pkg('2', { routes: ['INTRAVENOUS'], reconstitution: [iv] })
	]);
	assert.deepEqual(
		forms[0].routes.map((r) => [r.route, r.preps.map((p) => [p.step.diluentMl, p.agreeing, p.stating])]),
		[
			['IM', [[2.1, 1, 1]]],
			['IV', [[9.6, 2, 2]]]
		]
	);
});

test('a salt name with no moiety coded folds into the base other labels give', () => {
	const { forms } = buildProductForms([
		pkg('1', { actives: [{ name: 'HYDROCODONE BITARTRATE', moieties: [{ name: 'HYDROCODONE' }] }] }),
		pkg('2', { actives: [{ name: 'HYDROCODONE BITARTRATE', moieties: [] }] })
	]);
	assert.deepEqual(forms.map((f) => [f.ingredients, f.packageIds]), [[['HYDROCODONE'], ['p1', 'p2']]]);
});
