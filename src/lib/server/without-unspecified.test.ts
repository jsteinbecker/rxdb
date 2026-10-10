import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ingredientKeyOf, parseSplIngredients, withoutUnspecified } from '../spl-ingredients';

test('drops a trailing ", unspecified" in any case', () => {
	assert.equal(withoutUnspecified('GELATIN, UNSPECIFIED'), 'GELATIN');
	assert.equal(withoutUnspecified('Starch, corn , unspecified '), 'Starch, corn');
	assert.equal(withoutUnspecified('UNSPECIFIED GRADE TALC'), 'UNSPECIFIED GRADE TALC');
});

test('drops the form and type variants too', () => {
	assert.equal(withoutUnspecified('MENTHOL, UNSPECIFIED FORM'), 'MENTHOL');
	assert.equal(withoutUnspecified('Carbomer, Unspecified Type'), 'Carbomer');
	assert.equal(withoutUnspecified('LIGHT MINERAL OIL, UNSPECIFIED GRADE'), 'LIGHT MINERAL OIL');
});

test('drops the qualifier inside a combined name, but not words that follow it', () => {
	assert.equal(
		withoutUnspecified('MENTHOL, UNSPECIFIED FORM AND METHYL SALICYLATE'),
		'MENTHOL AND METHYL SALICYLATE'
	);
	assert.equal(withoutUnspecified('VASOPRESSIN, UNSPECIFIED, WATER'), 'VASOPRESSIN, WATER');
	assert.equal(withoutUnspecified('FOO, UNSPECIFIED VASOPRESSIN'), 'FOO, UNSPECIFIED VASOPRESSIN');
});

test('the qualified and bare names share one key', () => {
	assert.equal(ingredientKeyOf('Gelatin, Unspecified'), ingredientKeyOf('GELATIN'));
});

test('SPL active and inactive ingredients are parsed without the qualifier', () => {
	const xml = `<manufacturedProduct><manufacturedProduct><name>X</name>
		<ingredient classCode="ACTIM"><quantity><numerator value="5" unit="mg"/><denominator value="1"/></quantity>
			<ingredientSubstance><code code="AAAAAAAAAA" codeSystem="2.16.840.1.113883.4.9"/><name>FOO, UNSPECIFIED</name></ingredientSubstance></ingredient>
		<ingredient classCode="IACT"><ingredientSubstance><code code="BBBBBBBBBB" codeSystem="2.16.840.1.113883.4.9"/><name>GELATIN, UNSPECIFIED</name></ingredientSubstance></ingredient>
	</manufacturedProduct></manufacturedProduct>`;
	const names = parseSplIngredients(xml).flatMap((p) => p.ingredients.map((i) => i.name));
	assert.deepEqual(names, ['FOO', 'GELATIN']);
});
