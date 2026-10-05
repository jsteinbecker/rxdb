import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingredientGroup } from '../ingredient-group';
import { buildTree, comboKey, type FormularyRow } from '../formulary-hierarchy';
import { parseSettings } from '../settings';

test('incidental salts and hydrates group under the moiety', () => {
	for (const [name, group] of [
		['CEFEPIME HYDROCHLORIDE', 'CEFEPIME'],
		['Cefepime', 'Cefepime'],
		['VANCOMYCIN HCL', 'VANCOMYCIN'],
		['MORPHINE SULFATE PENTAHYDRATE', 'MORPHINE'],
		['ATORVASTATIN CALCIUM TRIHYDRATE', 'ATORVASTATIN'],
		['ATORVASTATIN CALCIUM PROPYLENE GLYCOL SOLVATE', 'ATORVASTATIN'],
		['Atorvastatin Calcium Propylene Glycol Solvate', 'Atorvastatin'],
		['PIPERACILLIN SODIUM', 'PIPERACILLIN'],
		['PENICILLIN G POTASSIUM', 'PENICILLIN G'],
		['DOXYCYCLINE HYCLATE', 'DOXYCYCLINE'],
		['NOREPINEPHRINE BITARTRATE', 'NOREPINEPHRINE'],
		['DEXTROSE MONOHYDRATE', 'DEXTROSE']
	])
		assert.equal(ingredientGroup(name), group, name);
});

test('salts that are the clinical identity stay apart', () => {
	for (const [name, group] of [
		// Named non-interchangeable salts
		['METOPROLOL TARTRATE', 'METOPROLOL TARTRATE'],
		['METOPROLOL SUCCINATE', 'METOPROLOL SUCCINATE'],
		['PHENYTOIN SODIUM', 'PHENYTOIN SODIUM'],
		['METHYLPREDNISOLONE SODIUM SUCCINATE', 'METHYLPREDNISOLONE SODIUM SUCCINATE'],
		['BUPROPION HCL', 'BUPROPION hydrochloride'],
		// Electrolytes and minerals
		['POTASSIUM CHLORIDE', 'POTASSIUM CHLORIDE'],
		['CALCIUM GLUCONATE', 'CALCIUM GLUCONATE'],
		['FERROUS SULFATE HEPTAHYDRATE', 'FERROUS SULFATE'],
		['SODIUM BICARBONATE', 'SODIUM BICARBONATE'],
		// Depot and release-changing esters
		['HALOPERIDOL DECANOATE', 'HALOPERIDOL DECANOATE'],
		['PENICILLIN G BENZATHINE', 'PENICILLIN G BENZATHINE'],
		// Prodrug esters that are part of the name
		['TENOFOVIR DISOPROXIL FUMARATE', 'TENOFOVIR DISOPROXIL'],
		['MYCOPHENOLATE MOFETIL', 'MYCOPHENOLATE MOFETIL']
	])
		assert.equal(ingredientGroup(name), group, name);
});

test('conjugate acid and base spellings of one moiety group together', () => {
	for (const [name, group] of [
		// The anion's name is the clinical one
		['CLAVULANATE POTASSIUM', 'CLAVULANATE'],
		['CLAVULANIC ACID', 'CLAVULANATE'],
		['clavulanate', 'clavulanate'],
		['Alendronic Acid', 'Alendronate'],
		['ALENDRONATE SODIUM TRIHYDRATE', 'ALENDRONATE'],
		['IBANDRONATE SODIUM', 'IBANDRONATE'],
		['RISEDRONIC ACID', 'RISEDRONATE'],
		// The acid's name is the clinical one
		['ZOLEDRONIC ACID MONOHYDRATE', 'ZOLEDRONIC ACID'],
		['zoledronate', 'zoledronic acid'],
		['VALPROATE SODIUM', 'VALPROIC ACID'],
		['ETHACRYNATE SODIUM', 'ETHACRYNIC ACID'],
		['Aspartate', 'Aspartic Acid']
	])
		assert.equal(ingredientGroup(name), group, name);
});

test('only listed conjugates are rewritten, so unrelated -ate names are untouched', () => {
	for (const name of [
		'METHOTREXATE',
		'GLYCOPYRROLATE',
		'DIVALPROEX SODIUM',
		'MYCOPHENOLIC ACID',
		'CALCIUM PANTOTHENATE'
	])
		assert.equal(ingredientGroup(name), name.replace(/ SODIUM$/, ''), name);
});

test('INN and BAN spellings group under the US adopted name', () => {
	for (const [name, group] of [
		['ARGIPRESSIN', 'VASOPRESSIN'],
		['GLYCOPYRRONIUM BROMIDE', 'GLYCOPYRROLATE'],
		['Paracetamol', 'Acetaminophen'],
		['SALBUTAMOL SULFATE', 'ALBUTEROL'],
		['Ethinylestradiol', 'Ethinyl Estradiol'],
		['ursodeoxycholic acid', 'ursodiol']
	])
		assert.equal(ingredientGroup(name), group, name);
});

const row = (ndc: string, ...names: string[]): FormularyRow => ({
	packageId: ndc,
	ndc,
	formularyItemId: 'f',
	formularyItem: 'Item',
	description: null,
	routes: [],
	doseForm: null,
	ingredients: names.map((name) => ({ name, strength: null })),
	brandName: null,
	genericName: null,
	labeler: null,
	size: null,
	isMultiDose: null,
	preferenceRank: 1,
	status: 'active'
});

test('the ingredient levels merge salt spellings but keep metoprolol salts apart', () => {
	const rows = [
		row('1', 'CEFEPIME'),
		row('2', 'CEFEPIME HYDROCHLORIDE'),
		row('3', 'METOPROLOL TARTRATE'),
		row('4', 'METOPROLOL SUCCINATE'),
		row('5', 'PIPERACILLIN SODIUM', 'TAZOBACTAM SODIUM'),
		row('6', 'PIPERACILLIN', 'TAZOBACTAM')
	];
	assert.deepEqual(
		buildTree(rows, ['ingredientCombo']).map((node) => [node.label, node.count]),
		[
			['Cefepime', 2],
			['Metoprolol Succinate', 1],
			['Metoprolol Tartrate', 1],
			['Piperacillin / Tazobactam', 2]
		]
	);
	assert.equal(comboKey(rows[4]), 'Piperacillin / Tazobactam');
});

test('the ingredient levels merge conjugate spellings of a combination', () => {
	const rows = [
		row('1', 'AMOXICILLIN', 'CLAVULANATE POTASSIUM'),
		row('2', 'amoxicillin', 'clavulanic acid'),
		row('3', 'AMOXICILLIN TRIHYDRATE', 'CLAVULANATE')
	];
	assert.deepEqual(
		buildTree(rows, ['ingredientCombo']).map((node) => [node.label, node.count]),
		[['Amoxicillin / Clavulanate', 3]]
	);
});

test('combo dose settings saved under salt names still apply', () => {
	const settings = parseSettings({
		comboDoseDisplay: {
			'Tazobactam Sodium / Piperacillin Sodium': {
				mode: 'single',
				ingredient: 'Piperacillin Sodium'
			}
		}
	});
	assert.deepEqual(settings.comboDoseDisplay, {
		'Piperacillin / Tazobactam': { mode: 'single', ingredient: 'Piperacillin' }
	});
});
