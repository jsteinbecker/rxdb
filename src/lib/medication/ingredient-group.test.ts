import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingredientGroup, racemicDisplayName } from './ingredient-group';
import { buildTree, comboKey, type FormularyRow } from '../formulary/hierarchy';
import { parseSettings } from '../formulary/settings';

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
		// A cation count is stoichiometry, unless the anion makes it a different salt
		['TRISODIUM CITRATE DIHYDRATE', 'SODIUM CITRATE'],
		['Trisodium Citrate', 'Sodium Citrate'],
		['SODIUM CITRATE', 'SODIUM CITRATE'],
		['DIPOTASSIUM CITRATE', 'POTASSIUM CITRATE'],
		['DISODIUM PHOSPHATE DIHYDRATE', 'DISODIUM PHOSPHATE'],
		['TRISODIUM PHOSPHATE', 'TRISODIUM PHOSPHATE'],
		['DIPOTASSIUM PHOSPHATE', 'DIPOTASSIUM PHOSPHATE'],
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

test('an explicit racemic marker groups with the plain name and displays as (D,L)-', () => {
	for (const name of [
		'AMPHETAMINE DL-ASPARTATE',
		'AMPHETAMINE D,L-ASPARTATE',
		'Amphetamine (D,L)-Aspartate',
		'AMPHETAMINE (±)-ASPARTATE MONOHYDRATE',
		'AMPHETAMINE ASPARTATE'
	])
		assert.equal(ingredientGroup(name).toUpperCase(), 'AMPHETAMINE ASPARTATE', name);
	assert.equal(racemicDisplayName('AMPHETAMINE DL-ASPARTATE'), 'AMPHETAMINE (D,L)-ASPARTATE');
	assert.equal(racemicDisplayName('amphetamine rac-aspartate'), 'amphetamine (D,L)-aspartate');
	assert.equal(racemicDisplayName('AMPHETAMINE ASPARTATE'), 'AMPHETAMINE ASPARTATE');
	// A single enantiomer is its own substance.
	assert.equal(ingredientGroup('DEXTROAMPHETAMINE SULFATE'), 'DEXTROAMPHETAMINE');
	assert.equal(ingredientGroup('L-GLUTAMINE'), 'L-GLUTAMINE');
});

test('a blank or whitespace name groups as nothing instead of throwing', () => {
	// Directory rows with a blank ingredient name do arrive; one used to take
	// down every title built from that package.
	for (const name of ['', '   ', '\t'] as const)
		assert.equal(ingredientGroup(name), '', JSON.stringify(name));
});

test('a lone cation or hydrate word is left as written', () => {
	for (const name of ['SODIUM', 'DISODIUM', 'HYDRATE', 'ANHYDROUS', 'Potassium'])
		assert.equal(ingredientGroup(name), name, name);
});

test('stray whitespace and HCl abbreviations do not change the group', () => {
	for (const name of ['  CEFEPIME   HYDROCHLORIDE ', 'Cefepime HCl', 'CEFEPIME HCL MONOHYDRATE'])
		assert.equal(ingredientGroup(name).toUpperCase(), 'CEFEPIME', name);
});

test('look-alike salts with different clinical uses never share a group', () => {
	// Each pair has been confused in practice; merging them in the hierarchy
	// would put both under one node.
	for (const [a, b] of [
		['EDETATE DISODIUM', 'EDETATE CALCIUM DISODIUM'],
		['Edetate Disodium', 'Edetate Calcium Disodium'],
		['DISODIUM EDETATE', 'CALCIUM DISODIUM EDETATE'],
		['POTASSIUM PHOSPHATE, MONOBASIC', 'POTASSIUM PHOSPHATE, DIBASIC'],
		['SODIUM PHOSPHATE, MONOBASIC, MONOHYDRATE', 'SODIUM PHOSPHATE, DIBASIC, HEPTAHYDRATE'],
		['POTASSIUM CHLORIDE', 'POTASSIUM ACETATE'],
		['CALCIUM CHLORIDE', 'CALCIUM GLUCONATE'],
		['LITHIUM CARBONATE', 'LITHIUM CITRATE'],
		['ZINC SULFATE', 'ZINC CHLORIDE'],
		['HYDROXYZINE HYDROCHLORIDE', 'HYDROXYZINE PAMOATE'],
		['FLUPHENAZINE HYDROCHLORIDE', 'FLUPHENAZINE DECANOATE'],
		['TESTOSTERONE CYPIONATE', 'TESTOSTERONE ENANTHATE'],
		['ESTRADIOL', 'ESTRADIOL VALERATE'],
		['PENICILLIN G POTASSIUM', 'PENICILLIN G PROCAINE'],
		['PENICILLIN G POTASSIUM', 'PENICILLIN G BENZATHINE'],
		['BUPROPION HYDROCHLORIDE', 'BUPROPION HYDROBROMIDE'],
		['DICLOFENAC SODIUM', 'DICLOFENAC POTASSIUM'],
		['DEXAMETHASONE', 'DEXAMETHASONE SODIUM PHOSPHATE'],
		['AMPHOTERICIN B', 'AMPHOTERICIN B LIPOSOME'],
		['CEFUROXIME SODIUM', 'CEFUROXIME AXETIL'],
		['DEXTROAMPHETAMINE SULFATE', 'AMPHETAMINE SULFATE']
	])
		assert.notEqual(
			ingredientGroup(a).toLowerCase(),
			ingredientGroup(b).toLowerCase(),
			`${a} vs ${b}`
		);
});

test('edetate salts keep their full names', () => {
	assert.equal(ingredientGroup('EDETATE DISODIUM ANHYDROUS'), 'EDETATE DISODIUM');
	assert.equal(ingredientGroup('EDETATE CALCIUM DISODIUM'), 'EDETATE CALCIUM DISODIUM');
});

test('interchangeable salts and hydrates of everyday drugs share one group', () => {
	for (const [a, b] of [
		['ESOMEPRAZOLE MAGNESIUM TRIHYDRATE', 'ESOMEPRAZOLE SODIUM'],
		['PANTOPRAZOLE SODIUM SESQUIHYDRATE', 'Pantoprazole'],
		['LEVOTHYROXINE SODIUM ANHYDROUS', 'LEVOTHYROXINE SODIUM'],
		['NAPROXEN SODIUM', 'NAPROXEN'],
		['DIATRIZOATE MEGLUMINE', 'DIATRIZOATE SODIUM'],
		['HEPARIN SODIUM', 'Heparin'],
		['MAGNESIUM SULFATE HEPTAHYDRATE', 'MAGNESIUM SULFATE'],
		['SODIUM ACETATE TRIHYDRATE', 'SODIUM ACETATE'],
		['TRIPOTASSIUM CITRATE MONOHYDRATE', 'POTASSIUM CITRATE'],
		['Monosodium Citrate', 'Sodium Citrate']
	])
		assert.equal(
			ingredientGroup(a).toLowerCase(),
			ingredientGroup(b).toLowerCase(),
			`${a} vs ${b}`
		);
});

test('a counted cation before a non-element word is not rewritten', () => {
	// `DI`/`TRI` prefixes that do not lead an element stay as written.
	for (const name of ['TRIAMCINOLONE ACETONIDE', 'DIMETHICONE', 'TRIHEXYPHENIDYL HYDROCHLORIDE'])
		assert.equal(ingredientGroup(name).split(' ')[0], name.split(' ')[0], name);
});

test('one cation count with phosphate is the same salt, however the directory words it', () => {
	for (const [a, b] of [
		['DISODIUM PHOSPHATE', 'SODIUM PHOSPHATE, DIBASIC'],
		['DISODIUM PHOSPHATE DIHYDRATE', 'SODIUM PHOSPHATE, DIBASIC, HEPTAHYDRATE'],
		['Disodium Phosphate', 'Dibasic Sodium Phosphate'],
		['MONOSODIUM PHOSPHATE', 'SODIUM PHOSPHATE, MONOBASIC, MONOHYDRATE'],
		['DIPOTASSIUM PHOSPHATE', 'POTASSIUM PHOSPHATE, DIBASIC'],
		['TRISODIUM PHOSPHATE', 'SODIUM PHOSPHATE, TRIBASIC'],
		['DICALCIUM PHOSPHATE', 'DIBASIC CALCIUM PHOSPHATE DIHYDRATE']
	])
		assert.equal(
			ingredientGroup(a).toUpperCase(),
			ingredientGroup(b).toUpperCase(),
			`${a} vs ${b}`
		);
	assert.equal(ingredientGroup('SODIUM PHOSPHATE, DIBASIC'), 'DISODIUM PHOSPHATE');
	// Unstated basicity stays its own name.
	assert.equal(ingredientGroup('SODIUM PHOSPHATE'), 'SODIUM PHOSPHATE');
});

test('a hydrogen salt keeps its anion', () => {
	assert.equal(ingredientGroup('DISODIUM HYDROGEN CITRATE'), 'DISODIUM HYDROGEN CITRATE');
	assert.equal(ingredientGroup('SODIUM DIHYDROGEN CITRATE'), 'SODIUM DIHYDROGEN CITRATE');
});
