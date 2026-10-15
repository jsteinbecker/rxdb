import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSplIngredients } from '../spl-ingredients';
import { SHAPE_CODES, appearanceOf, appearanceText, shapeGeometry, shapeTerm } from '../spl-characteristics';

const CHAR = '2.16.840.1.113883.1.11.19255';
const tablet = (shape: string) => `
<manufacturedProduct><manufacturedProduct>
  <code code="0093-0001" codeSystem="2.16.840.1.113883.6.69"/>
  <name>Example</name>
  <formCode code="C42998" codeSystem="2.16.840.1.113883.3.26.1.1" displayName="TABLET"/>
  <ingredient classCode="ACTIM"><ingredientSubstance><name>EXAMPLE</name></ingredientSubstance></ingredient>
  <asContent><containerPackagedProduct><code code="0093-0001-01" codeSystem="2.16.840.1.113883.6.69"/>
    <formCode code="C" codeSystem="2.16.840.1.113883.3.26.1.1" displayName="BOTTLE"/></containerPackagedProduct></asContent>
</manufacturedProduct>
<subjectOf><characteristic><code code="SPLCOLOR" codeSystem="${CHAR}"/><value xsi:type="CE" code="C48325" displayName="WHITE"/></characteristic></subjectOf>
<subjectOf><characteristic><code code="SPLSHAPE" codeSystem="${CHAR}"/>${shape}</characteristic></subjectOf>
</manufacturedProduct>`;

const appearance = (shape: string) => {
	const [product] = parseSplIngredients(tablet(shape));
	return appearanceOf(product)!;
};

test('the shape is read from its NCI code, whatever the display name says', () => {
	const a = appearance('<value xsi:type="CE" code="C48343" displayName="HEXAGON (6 SIDED)"/>');
	assert.equal(a.shape, 'HEXAGON');
	assert.equal(a.shapeCode, 'C48343');
	assert.match(appearanceText(a), /, hexagon/);
});

test('the code wins over a displayName that disagrees with it', () => {
	assert.equal(appearance('<value xsi:type="CE" code="C48348" displayName="CIRCLE"/>').shape, 'ROUND');
});

test('without a code the display name is still canonicalized', () => {
	const a = appearance('<value xsi:type="CE" displayName="Heptagon (7 sided)"/>');
	assert.equal(a.shape, 'HEPTAGON');
	assert.equal(a.shapeCode, null);
	assert.equal(shapeTerm('C99999', 'Tear'), 'TEAR');
});

test('every coded shape draws its own outline, not the fallback', () => {
	const fallback = shapeGeometry('NOT A SHAPE').path;
	for (const name of [...Object.values(SHAPE_CODES), 'HEXAGON (6 SIDED)', 'SEMI-CIRCLE']) {
		assert.notEqual(shapeGeometry(name).path, fallback, name);
	}
});

test('the label photo is read from SPLIMAGE as a file name', () => {
	const [product] = parseSplIngredients(
		tablet('<value xsi:type="CE" code="C48348" displayName="ROUND"/>').replace(
			'</manufacturedProduct>\n',
			`</manufacturedProduct>
<subjectOf><characteristic><code code="SPLIMAGE" codeSystem="${CHAR}"/><value mediaType="image/jpeg" xsi:type="ED"><reference value="AHP48801.jpg"/></value></characteristic></subjectOf>
`
		)
	);
	assert.equal(appearanceOf(product)!.image, 'AHP48801.jpg');
	assert.equal(appearance('<value xsi:type="CE" code="C48348" displayName="ROUND"/>').image, null);
});

test('a capsule outline is drawn at its stated proportion', () => {
	const plain = shapeGeometry('CAPSULE');
	const ratio = (g: { width: number; height: number }) => g.width / (g.height - 8);
	assert.ok(Math.abs(ratio(plain) - 96 / 36) < 1e-9);
	assert.ok(Math.abs(ratio(shapeGeometry('CAPSULE 2:1')) - 2) < 1e-9);
	assert.ok(ratio(shapeGeometry('LONG CAPSULE')) > ratio(plain));
	assert.ok(ratio(shapeGeometry('STOUT CAPSULE')) < ratio(plain));
	// Very stout outlines stay inside the 100-unit box.
	assert.ok(shapeGeometry('CAPSULE 1.1:1').height <= 100);
	// A bad proportion draws the plain outline.
	assert.equal(shapeGeometry('CAPSULE 1:2').path, plain.path);
	assert.notEqual(shapeGeometry('LONG CAPSULE').path, plain.path);
});
