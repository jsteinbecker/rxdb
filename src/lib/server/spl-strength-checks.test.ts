import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSplIngredients, strengthText } from '../spl-ingredients';
import { checkProductStrengths, rxNormStrengths } from '../spl-strength-checks';

const ingredient = (classCode: string, name: string, unii: string, qty: string, moiety = '') => `
	<ingredient classCode="${classCode}">
		${qty}
		<ingredientSubstance>
			<code code="${unii}" codeSystem="2.16.840.1.113883.4.9"/>
			<name>${name}</name>
			${moiety}
		</ingredientSubstance>
	</ingredient>`;

const perMg = (value: string) =>
	`<quantity><numerator value="${value}" unit="mg"/><denominator value="1" unit="mg"/></quantity>`;

// NDC 0143-9161: every strength coded "in 1 mg", and the active's 513 mg is
// the hydrochloride's mass tagged as vancomycin-base strength.
const VANCOMYCIN = `<document><manufacturedProduct><manufacturedProduct>
	<code code="0143-9161" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Vancomycin</name>
	<formCode code="C42957" displayName="INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION"/>
	${ingredient(
		'ACTIM',
		'VANCOMYCIN HYDROCHLORIDE',
		'71WO621TJD',
		perMg('513'),
		`<activeMoiety><activeMoiety><code code="6Q205EH1VU" codeSystem="2.16.840.1.113883.4.9"/><name>VANCOMYCIN</name></activeMoiety></activeMoiety>`
	)}
	${ingredient('IACT', 'TREHALOSE', 'B8WCK70T7I', perMg('125'))}
	${ingredient('IACT', 'POLYSORBATE 80', '6OZP39ZG8H', perMg('0.05'))}
	${ingredient('IACT', 'HYDROCHLORIC ACID', 'QTT17582CB', '')}
	<asContent>
		<quantity><numerator value="513" unit="mg"/><denominator value="1"/></quantity>
		<containerPackagedProduct>
			<code code="0143-9161-01" codeSystem="2.16.840.1.113883.6.69"/>
			<formCode code="C43226" displayName="VIAL"/>
		</containerPackagedProduct>
	</asContent>
</manufacturedProduct></manufacturedProduct></document>`;

test('miscoded mass denominators and salt-as-moiety strengths are corrected with notes', () => {
	const [product] = parseSplIngredients(VANCOMYCIN);
	assert.deepEqual(product.presentation, {
		amount: 513,
		amountUnit: 'mg',
		per: 1,
		form: 'VIAL'
	});

	const checked = checkProductStrengths(product, { rxNormName: 'vancomycin 500 MG Injection' });
	assert.deepEqual(checked.map(strengthText), [
		'500 mg/1 VIAL',
		'125 mg/1 VIAL',
		'0.05 mg/1 VIAL',
		null
	]);

	const presentation = 'Corrected unit of presentation to 1 VIAL from improper coding as 1 mg';
	assert.deepEqual(
		checked.map((row) => row.corrections.map((c) => c.note)),
		[
			[
				presentation,
				'Strength corrected from stated value of 513 mg, equivalent to 500 mg vancomycin as the hydrochloride salt'
			],
			[presentation],
			[presentation],
			[]
		]
	);
});

test('a plausible mass-in-mass strength and an unmatched RxNorm name are left alone', () => {
	const [product] = parseSplIngredients(
		VANCOMYCIN.replace(perMg('513'), perMg('0.5')).replace(perMg('125'), perMg('0.2'))
	);
	const checked = checkProductStrengths(product, { rxNormName: 'vancomycin 250 MG Oral Capsule' });
	assert.ok(checked.every((row) => row.corrections.length === 0));
	assert.equal(strengthText(checked[0]), '0.5 mg/1 mg');
});

test('RxNorm names split into per-component strengths', () => {
	assert.deepEqual(rxNormStrengths('amoxicillin 250 MG / clavulanate 62.5 MG Oral Tablet [Augmentin]'), [
		{ name: 'amoxicillin', value: 250, unit: 'MG', per: 1, perUnit: null },
		{ name: 'clavulanate', value: 62.5, unit: 'MG', per: 1, perUnit: null }
	]);
	assert.deepEqual(rxNormStrengths('lidocaine hydrochloride 10 MG/ML Injectable Solution'), [
		{ name: 'lidocaine hydrochloride', value: 10, unit: 'MG', per: 1, perUnit: 'ML' }
	]);
});

// NDC 0264-1933 (TrophAmine 10%): lysine acetate's 1.2 g/100 mL coded ACTIM
// as though it were lysine. RxNorm copied the number; the directory names the
// salt at the same mass, and GSRS weights give lysine's share.
const LYSINE_MOIETY = `<activeMoiety><activeMoiety><code code="K3Z4F929H6" codeSystem="2.16.840.1.113883.4.9"/><name>LYSINE</name></activeMoiety></activeMoiety>`;
const perDl = (value: string) =>
	`<quantity><numerator value="${value}" unit="g"/><denominator value="100" unit="mL"/></quantity>`;
const TROPHAMINE = `<document><manufacturedProduct><manufacturedProduct>
	<code code="0264-1933" codeSystem="2.16.840.1.113883.6.69"/>
	<name>TrophAmine</name>
	<formCode code="C42945" displayName="INJECTION, SOLUTION"/>
	${ingredient('ACTIM', 'LYSINE ACETATE', 'TTL6G7LIWZ', perDl('1.2'), LYSINE_MOIETY)}
</manufacturedProduct></manufacturedProduct></document>`;
// 146.19 / 206.24
const LYSINE_FACTOR = new Map([['TTL6G7LIWZ', { moietyUnii: 'K3Z4F929H6', factor: '0.708834367727889837' }]]);

test('a heavy salt stated as moiety strength converts when the directory names the salt at that mass', () => {
	const [product] = parseSplIngredients(TROPHAMINE);
	const [row] = checkProductStrengths(product, {
		rxNormName: 'lysine 1.2 MG/ML Injectable Solution',
		moietyFactors: LYSINE_FACTOR,
		directory: [{ name: 'LYSINE ACETATE', strength: '1.2 g/100mL' }]
	});
	assert.equal(strengthText(row), '0.8506 g/100 mL');
	assert.equal(row.corrections[0].kind, 'moiety-equivalent');
	assert.match(row.corrections[0].note, /1\.2 g, the mass of the acetate salt.*0\.8506 g lysine/);
	// Kept exactly, so undoing the correction restores the label's number
	// instead of converting the rounded one back.
	assert.equal(row.corrections[0].stated, 1.2);
});

// NDC 59630-266 (Fetroja): ACTIM `CEFIDEROCOL SULFATE TOSYLATE 1 g`, which is
// ordinary "equivalent to" labeling. The SCD is `cefiderocol 1000 MG`, and the
// label text says "1 gram of cefiderocol". Rule 3 once cut it to 0.7371 g.
const FETROJA = `<document><manufacturedProduct><manufacturedProduct>
	<code code="59630-266" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Fetroja</name>
	<formCode code="C42974" displayName="INJECTION, POWDER, FOR SOLUTION"/>
	${ingredient(
		'ACTIM',
		'CEFIDEROCOL SULFATE TOSYLATE',
		'O2VQ1P3I6B',
		`<quantity><numerator value="1" unit="g"/><denominator value="10" unit="mL"/></quantity>`,
		`<activeMoiety><activeMoiety><code code="SZ34OMG6E8" codeSystem="2.16.840.1.113883.4.9"/><name>CEFIDEROCOL</name></activeMoiety></activeMoiety>`
	)}
</manufacturedProduct></manufacturedProduct></document>`;
const CEFIDEROCOL_FACTOR = new Map([['O2VQ1P3I6B', { moietyUnii: 'SZ34OMG6E8', factor: '0.7371' }]]);
const FETROJA_DIRECTORY = [{ name: 'CEFIDEROCOL SULFATE TOSYLATE', strength: '1 g/10mL' }];

test('a heavy salt is not converted where RxNorm states its moiety at the label number', () => {
	const [product] = parseSplIngredients(FETROJA);
	for (const labelText of [undefined, 'Each vial contains 1 gram of cefiderocol (as the sulfate tosylate).']) {
		const [row] = checkProductStrengths(product, {
			rxNormName: 'cefiderocol 1000 MG Injection [Fetroja]',
			moietyFactors: CEFIDEROCOL_FACTOR,
			directory: FETROJA_DIRECTORY,
			labelText
		});
		assert.equal(row.strength, 1);
		assert.deepEqual(row.corrections, []);
	}
});

test('label text giving the number as the moiety blocks the heavy-salt rule', () => {
	const [product] = parseSplIngredients(FETROJA);
	const [row] = checkProductStrengths(product, {
		moietyFactors: CEFIDEROCOL_FACTOR,
		directory: FETROJA_DIRECTORY,
		labelText: 'FETROJA is formulated with 1 gram cefiderocol, sucrose and sodium chloride.'
	});
	assert.equal(row.strength, 1);
	assert.deepEqual(row.corrections, []);
});

test('label text giving the salt its mass outweighs an RxNorm copied from the label', () => {
	// RxNorm's real TrophAmine name copies the acetate's mass as lysine's.
	const [product] = parseSplIngredients(TROPHAMINE);
	const options = {
		rxNormName: 'lysine 12 MG/ML Injectable Solution [TrophAmine]',
		moietyFactors: LYSINE_FACTOR,
		directory: [{ name: 'LYSINE ACETATE', strength: '1.2 g/100mL' }]
	};
	const [unproved] = checkProductStrengths(product, options);
	assert.deepEqual(unproved.corrections, []);
	const [row] = checkProductStrengths(product, {
		...options,
		labelText: 'Each 100 mL contains: Isoleucine USP 0.82 g; L-Lysine Acetate USP 1.2 g; Valine USP 0.78 g'
	});
	assert.equal(strengthText(row), '0.8506 g/100 mL');
	assert.equal(row.corrections[0].kind, 'moiety-equivalent');
});

// NDC 0093-2275 (amoxicillin/clavulanate 875/125): ACTIM `CLAVULANATE
// POTASSIUM 125 mg`, moiety CLAVULANIC ACID; RxNorm writes the moiety as its
// anion, `clavulanate 125 MG`. Rule 3 cut it to 104.9 mg on 81 packages.
const AUGMENTIN = `<document><manufacturedProduct><manufacturedProduct>
	<code code="0093-2275" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Amoxicillin and Clavulanate Potassium</name>
	<formCode code="C42931" displayName="TABLET, FILM COATED"/>
	${ingredient(
		'ACTIM',
		'CLAVULANATE POTASSIUM',
		'Q42OMW3AT8',
		`<quantity><numerator value="125" unit="mg"/><denominator value="1" unit="1"/></quantity>`,
		`<activeMoiety><activeMoiety><code code="23521W1S24" codeSystem="2.16.840.1.113883.4.9"/><name>CLAVULANIC ACID</name></activeMoiety></activeMoiety>`
	)}
</manufacturedProduct></manufacturedProduct></document>`;

test('RxNorm naming an acid by its anion still arbitrates', () => {
	const [product] = parseSplIngredients(AUGMENTIN);
	const [row] = checkProductStrengths(product, {
		rxNormName: 'amoxicillin 875 MG / clavulanate 125 MG Oral Tablet',
		moietyFactors: new Map([['Q42OMW3AT8', { moietyUnii: '23521W1S24', factor: '0.8392' }]]),
		directory: [{ name: 'CLAVULANATE POTASSIUM', strength: '125 mg/1' }],
		// A strength pair names the salt but gives the moiety's numbers.
		labelText:
			'Amoxicillin and Clavulanate Potassium 125 mg/31.25 mg per 5 mL for Oral Suspension may be used in place of the 500 mg/125 mg tablet.'
	});
	assert.equal(row.strength, 125);
	assert.deepEqual(row.corrections, []);
});

test('a heavy salt is left alone without the directory agreeing on its mass', () => {
	const [product] = parseSplIngredients(TROPHAMINE);
	for (const directory of [[], [{ name: 'LYSINE ACETATE', strength: '1.7 g/100mL' }]]) {
		const [row] = checkProductStrengths(product, { moietyFactors: LYSINE_FACTOR, directory });
		assert.equal(row.strength, 1.2);
		assert.deepEqual(row.corrections, []);
	}
});

// NDC 14537-817 (ACD-A, 750 mL): citric acid monohydrate's 6 g coded ACTIM as
// anhydrous citric acid. Its name does not contain the moiety's, so rule 2
// never sees it; left as is, it summed hydrate mass with the trisodium
// citrate row's anhydrous equivalent.
const CITRIC_MOIETY = `<activeMoiety><activeMoiety><code code="XF417D3PSL" codeSystem="2.16.840.1.113883.4.9"/><name>ANHYDROUS CITRIC ACID</name></activeMoiety></activeMoiety>`;
const ACD_A = `<document><manufacturedProduct><manufacturedProduct>
	<code code="14537-817" codeSystem="2.16.840.1.113883.6.69"/>
	<name>ACD-A</name>
	<formCode code="C42945" displayName="INJECTION, SOLUTION"/>
	${ingredient(
		'ACTIM',
		'CITRIC ACID MONOHYDRATE',
		'2968PHW8QP',
		`<quantity><numerator value="6" unit="g"/><denominator value="750" unit="mL"/></quantity>`,
		CITRIC_MOIETY
	)}
</manufacturedProduct></manufacturedProduct></document>`;
// 192.12 / 210.14
const CITRIC_FACTOR = new Map([['2968PHW8QP', { moietyUnii: 'XF417D3PSL', factor: '0.914247644427519748' }]]);

test('a light hydrate stated as moiety strength converts when RxNorm cannot arbitrate', () => {
	const [product] = parseSplIngredients(ACD_A);
	const directory = [{ name: 'CITRIC ACID MONOHYDRATE', strength: '.8 g/100mL' }];
	const [row] = checkProductStrengths(product, { moietyFactors: CITRIC_FACTOR, directory });
	assert.equal(row.strength, 5.485);
	assert.equal(row.corrections[0].kind, 'moiety-equivalent');
	assert.equal(row.corrections[0].stated, 6);

	// Where RxNorm states the moiety, rule 2 owns light salts.
	const [kept] = checkProductStrengths(product, {
		rxNormName: 'anhydrous citric acid 8 MG/ML Injectable Solution',
		moietyFactors: CITRIC_FACTOR,
		directory
	});
	assert.equal(kept.strength, 6);
});

// Amoxicillin capsules: the label names AMOXICILLIN, whose UNII (804826J2HU) is
// the trihydrate in GSRS, with ACTIM basis on AMOXICILLIN ANHYDROUS. The bare
// name means the drug, so 500 mg stays 500 mg.
const AMOXICILLIN_MOIETY = `<activeMoiety><activeMoiety><code code="9EM05410Q9" codeSystem="2.16.840.1.113883.4.9"/><name>AMOXICILLIN ANHYDROUS</name></activeMoiety></activeMoiety>`;
const AMOXICILLIN = `<document><manufacturedProduct><manufacturedProduct>
	<code code="00000-0000" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Amoxicillin</name>
	<formCode code="C25158" displayName="CAPSULE"/>
	${ingredient(
		'ACTIM',
		'AMOXICILLIN',
		'804826J2HU',
		`<quantity><numerator value="500" unit="mg"/><denominator value="1" unit="1"/></quantity>`,
		AMOXICILLIN_MOIETY
	)}
</manufacturedProduct></manufacturedProduct></document>`;
// 365.40 / 419.45
const AMOXICILLIN_FACTOR = new Map([['804826J2HU', { moietyUnii: '9EM05410Q9', factor: '0.871140779592323' }]]);

test('a listing name in RxNav is no SCD to arbitrate with', () => {
	// RxNav names ACD-A in the listing's own words; its `Citric Acid
	// Monohydrate 0.80 g` names the hydrate, so it says nothing about the moiety.
	const [product] = parseSplIngredients(ACD_A);
	const [row] = checkProductStrengths(product, {
		rxNormName:
			'Dextrose Monohydrate 2.45 g in 100 mL / Citric Acid Monohydrate 0.80 g in 100 mL INTRAVENOUS INJECTION, SOLUTION [ACD A]',
		moietyFactors: CITRIC_FACTOR,
		directory: [{ name: 'CITRIC ACID MONOHYDRATE', strength: '.8 g/100mL' }]
	});
	assert.equal(row.strength, 5.485);
	assert.equal(row.corrections[0].kind, 'moiety-equivalent');
});

test('a bare drug name is not treated as its hydrate UNII', () => {
	const [product] = parseSplIngredients(AMOXICILLIN);
	const [row] = checkProductStrengths(product, {
		rxNormName: 'amoxicillin 500 MG Oral Capsule',
		moietyFactors: AMOXICILLIN_FACTOR,
		directory: [{ name: 'AMOXICILLIN', strength: '500 mg/1' }]
	});
	assert.equal(row.strength, 500);
	assert.deepEqual(row.corrections, []);
});

// Piperacillin and tazobactam (Hospira vials, Baxter and B. Braun bags): ACTIM
// on PIPERACILLIN SODIUM, moiety PIPERACILLIN ANHYDROUS, at 2 g — the usual
// "equivalent to 2 g piperacillin", and what the SCD says (2000 MG). The
// directory repeats that number under the salt's name. An exact name match
// missed RxNorm's `piperacillin`, and every one of these read 1.919 g.
const PIPERACILLIN_MOIETY = `<activeMoiety><activeMoiety><code code="9I628532GX" codeSystem="2.16.840.1.113883.4.9"/><name>PIPERACILLIN ANHYDROUS</name></activeMoiety></activeMoiety>`;
const pipTazo = (quantity: string) => `<document><manufacturedProduct><manufacturedProduct>
	<code code="00000-0001" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Piperacillin and Tazobactam</name>
	<formCode code="C42974" displayName="INJECTION, POWDER, FOR SOLUTION"/>
	${ingredient('ACTIM', 'PIPERACILLIN SODIUM', 'M98T69Q7HP', quantity, PIPERACILLIN_MOIETY)}
</manufacturedProduct></manufacturedProduct></document>`;
const PIP_VIAL = pipTazo(`<quantity><numerator value="2" unit="g"/><denominator value="1" unit="1"/></quantity>`);
const PIP_BAG = pipTazo(`<quantity><numerator value="2" unit="g"/><denominator value="50" unit="mL"/></quantity>`);
// 517.56 / 539.54
const PIPERACILLIN_FACTOR = new Map([['M98T69Q7HP', { moietyUnii: '9I628532GX', factor: '0.959261592' }]]);

test('piperacillin sodium stated as piperacillin keeps the SCD\'s 2 g', () => {
	for (const [xml, listed] of [
		[PIP_VIAL, '2 g/1'],
		[PIP_BAG, '2 g/50mL']
	]) {
		for (const rxNormName of ['piperacillin 2000 MG / tazobactam 250 MG Injection', null]) {
			const [product] = parseSplIngredients(xml);
			const [row] = checkProductStrengths(product, {
				rxNormName,
				moietyFactors: PIPERACILLIN_FACTOR,
				directory: [{ name: 'PIPERACILLIN SODIUM', strength: listed }]
			});
			assert.equal(row.strength, 2, `${listed}, ${rxNormName ?? 'no RxNorm'}`);
			assert.deepEqual(row.corrections, []);
		}
	}
});

test('RxNorm matches a moiety whatever its hydrate word', () => {
	// Rule 2 still corrects toward RxNorm when the label printed the salt's mass.
	const [product] = parseSplIngredients(
		pipTazo(`<quantity><numerator value="2.085" unit="g"/><denominator value="1" unit="1"/></quantity>`)
	);
	const [row] = checkProductStrengths(product, {
		rxNormName: 'piperacillin 2000 MG / tazobactam 250 MG Injection'
	});
	assert.equal(row.strength, 2);
	assert.equal(row.corrections[0].kind, 'salt-equivalent');
});

// One active with a single moiety, per one unit of presentation.
const single = (name: string, unii: string, moiety: string, moietyUnii: string, value: string, unit = 'mg', per = '1', perUnit = '1') => `<document><manufacturedProduct><manufacturedProduct>
	<code code="00000-0002" codeSystem="2.16.840.1.113883.6.69"/>
	<name>${name}</name>
	<formCode code="C25158" displayName="CAPSULE"/>
	${ingredient(
		'ACTIM',
		name,
		unii,
		`<quantity><numerator value="${value}" unit="${unit}"/><denominator value="${per}" unit="${perUnit}"/></quantity>`,
		`<activeMoiety><activeMoiety><code code="${moietyUnii}" codeSystem="2.16.840.1.113883.4.9"/><name>${moiety}</name></activeMoiety></activeMoiety>`
	)}
</manufacturedProduct></manufacturedProduct></document>`;

const vancomycinCapsule = (value: string, unit = 'mg') =>
	single('VANCOMYCIN HYDROCHLORIDE', '71WO621TJD', 'VANCOMYCIN', '6Q205EH1VU', value, unit);

test('a salt correction is only made inside the salt-ratio window', () => {
	const rxNormName = 'vancomycin 500 MG Oral Capsule';
	for (const [value, expected] of [
		['502', 502], // within rounding of RxNorm: left alone
		['490', 490], // below RxNorm: never raised to it
		['513', 500], // vancomycin HCl's own mass
		['650', 500], // 1.3×, the widest salt allowed
		['655', 655] // past 1.3×: more likely a different strength
	] as const) {
		const [product] = parseSplIngredients(vancomycinCapsule(value));
		const [row] = checkProductStrengths(product, { rxNormName });
		assert.equal(row.strength, expected, `${value} mg`);
		assert.equal(row.corrections.length, expected === Number(value) ? 0 : 1, `${value} mg`);
	}
});

test('a salt correction keeps the label unit', () => {
	const [product] = parseSplIngredients(vancomycinCapsule('0.513', 'g'));
	const [row] = checkProductStrengths(product, { rxNormName: 'vancomycin 500 MG Oral Capsule' });
	assert.equal(strengthText(row), '0.5 g');
	assert.match(row.corrections[0].note, /stated value of 0\.513 g, equivalent to 0\.5 g vancomycin as the hydrochloride salt/);
	assert.equal(row.corrections[0].stated, 0.513);
});

test('a salt is never corrected against RxNorm for a different moiety or kind of strength', () => {
	const [product] = parseSplIngredients(vancomycinCapsule('513'));
	for (const rxNormName of [
		null,
		'',
		'teicoplanin 500 MG Injection',
		// RxNorm per mL, label per capsule: not like with like.
		'vancomycin 50 MG/ML Oral Solution'
	]) {
		const [row] = checkProductStrengths(product, { rxNormName });
		assert.equal(row.strength, 513, String(rxNormName));
		assert.deepEqual(row.corrections, [], String(rxNormName));
	}
});

test('a pure substance, 100% by weight, is a possible mass-in-mass strength', () => {
	// Bulk powders: 1 g in 1 g is the whole product, not a miscoding.
	const [product] = parseSplIngredients(
		single('SODIUM CHLORIDE', '451W47IQ8X', 'SODIUM CATION', 'LYR4M0NH37', '1', 'g', '1', 'g')
	);
	const [row] = checkProductStrengths(product);
	assert.deepEqual(row.corrections, []);
	assert.equal(strengthText(row), '1 g/1 g');
});

test('the heavy-salt rule never stacks on a salt correction', () => {
	const [product] = parseSplIngredients(
		pipTazo(`<quantity><numerator value="2.085" unit="g"/><denominator value="1" unit="1"/></quantity>`)
	);
	const [row] = checkProductStrengths(product, {
		rxNormName: 'piperacillin 2000 MG / tazobactam 250 MG Injection',
		moietyFactors: PIPERACILLIN_FACTOR,
		directory: [{ name: 'PIPERACILLIN SODIUM', strength: '2.085 g/1' }]
	});
	assert.equal(row.strength, 2);
	assert.deepEqual(row.corrections.map((correction) => correction.kind), ['salt-equivalent']);
});

test('the heavy-salt rule needs GSRS to name this exact salt and moiety', () => {
	const [product] = parseSplIngredients(TROPHAMINE);
	const directory = [{ name: 'LYSINE ACETATE', strength: '1.2 g/100mL' }];
	for (const moietyFactors of [
		new Map(),
		// The factor is for another moiety.
		new Map([['TTL6G7LIWZ', { moietyUnii: 'XXXXXXXXXX', factor: '0.708834367727889837' }]]),
		// An unreadable or zero factor.
		new Map([['TTL6G7LIWZ', { moietyUnii: 'K3Z4F929H6', factor: 'abc' }]]),
		new Map([['TTL6G7LIWZ', { moietyUnii: 'K3Z4F929H6', factor: '0' }]])
	]) {
		const [row] = checkProductStrengths(product, { moietyFactors, directory });
		assert.equal(row.strength, 1.2);
		assert.deepEqual(row.corrections, []);
	}
});

test('the heavy-salt rule compares like with like against the directory', () => {
	const [product] = parseSplIngredients(TROPHAMINE);
	// The directory per vial, the label per mL: no agreement to lean on.
	const [row] = checkProductStrengths(product, {
		moietyFactors: LYSINE_FACTOR,
		directory: [{ name: 'LYSINE ACETATE', strength: '1.2 g/1' }]
	});
	assert.equal(row.strength, 1.2);
	// The directory names the salt in another case: still the same row.
	const [cased] = checkProductStrengths(product, {
		moietyFactors: LYSINE_FACTOR,
		directory: [{ name: 'Lysine Acetate', strength: '1.2 g/100mL' }]
	});
	assert.equal(cased.corrections[0]?.kind, 'moiety-equivalent');
});

test('RxNorm names with commas, metered doses and equivalents parse', () => {
	assert.deepEqual(rxNormStrengths('heparin sodium, porcine 5000 UNT/ML Injectable Solution'), [
		{ name: 'heparin sodium, porcine', value: 5000, unit: 'UNT', per: 1, perUnit: 'ML' }
	]);
	assert.deepEqual(rxNormStrengths('albuterol 0.09 MG/ACTUAT Metered Dose Inhaler, 200 ACTUAT'), [
		{ name: 'albuterol', value: 0.09, unit: 'MG', per: 1, perUnit: 'ACTUAT' }
	]);
	assert.deepEqual(rxNormStrengths('potassium chloride 2 MEQ/ML Injectable Solution'), [
		{ name: 'potassium chloride', value: 2, unit: 'MEQ', per: 1, perUnit: 'ML' }
	]);
	for (const empty of [null, undefined, '', 'Sterile Water Injection']) assert.deepEqual(rxNormStrengths(empty), []);
});

test('quantity and release prefixes are not part of the ingredient name', () => {
	assert.equal(rxNormStrengths('150 ML vancomycin 5 MG/ML Injection')[0]?.name, 'vancomycin');
	assert.equal(rxNormStrengths('0.4 ML enoxaparin sodium 100 MG/ML Prefilled Syringe')[0]?.name, 'enoxaparin sodium');
	assert.equal(rxNormStrengths('24 HR venlafaxine 75 MG Extended Release Oral Capsule')[0]?.name, 'venlafaxine');
	assert.deepEqual(rxNormStrengths('72 HR fentanyl 0.025 MG/HR Transdermal System'), [
		{ name: 'fentanyl', value: 0.025, unit: 'MG', per: 1, perUnit: 'HR' }
	]);
});

test('an extended-release salt is corrected against its SCD like any other', () => {
	// Venlafaxine HCl 84.86 mg is venlafaxine 75 mg.
	const [product] = parseSplIngredients(
		single('VENLAFAXINE HYDROCHLORIDE', '7D7RX5A8MO', 'VENLAFAXINE', 'GRZ5RCB1QG', '84.86')
	);
	const [row] = checkProductStrengths(product, {
		rxNormName: '24 HR venlafaxine 75 MG Extended Release Oral Capsule'
	});
	assert.equal(row.strength, 75);
});

test('a pack name yields its components, not its braces', () => {
	const names = rxNormStrengths(
		'{21 (norgestimate 0.25 MG / ethinyl estradiol 0.035 MG Oral Tablet) / 7 (inert ingredients 1 MG Oral Tablet) } Pack [Sprintec 28]'
	).map((entry) => entry.name);
	assert.deepEqual(names, ['norgestimate', 'ethinyl estradiol', 'inert ingredients']);
});
