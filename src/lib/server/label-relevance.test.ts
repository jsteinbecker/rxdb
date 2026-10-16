import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSplIngredients } from '../spl-ingredients';
import type { LabelBlock } from '../spl-sections';
import { filterLabelBlocks, formFamilyOf, labelScope } from '../label-relevance';

// One `<manufacturedProduct>` with a single active ingredient, in the shape
// the SPL strength tests use.
const product = (
	code: string,
	form: string,
	strength: [string, string, string, string],
	packages: [string, string, string, string][]
) => `<manufacturedProduct><manufacturedProduct>
	<code code="${code}" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Drug</name>
	<formCode code="C" displayName="${form}"/>
	<ingredient classCode="ACTIB">
		<quantity><numerator value="${strength[0]}" unit="${strength[1]}"/><denominator value="${strength[2]}" unit="${strength[3]}"/></quantity>
		<ingredientSubstance><code code="UNII" codeSystem="2.16.840.1.113883.4.9"/><name>DRUG</name></ingredientSubstance>
	</ingredient>
	${packages
		.map(
			([pkg, amount, unit, container]) => `<asContent>
		<quantity><numerator value="${amount}" unit="${unit}"/><denominator value="1"/></quantity>
		<containerPackagedProduct>
			<code code="${pkg}" codeSystem="2.16.840.1.113883.6.69"/>
			<formCode code="C" displayName="${container}"/>
		</containerPackagedProduct>
	</asContent>`
		)
		.join('')}
</manufacturedProduct></manufacturedProduct>`;

const doc = (...products: string[]) => `<document>${products.join('')}</document>`;

// Amoxicillin-style: tablets and a powder for oral suspension on one label.
export const TABLET_AND_SUSPENSION = doc(
	product('11111-100', 'TABLET, FILM COATED', ['500', 'mg', '1', '1'], [
		['11111-100-30', '30', '1', 'BOTTLE']
	]),
	product('11111-200', 'POWDER, FOR SUSPENSION', ['250', 'mg', '5', 'mL'], [
		['11111-200-80', '80', 'mL', 'BOTTLE'],
		['11111-200-15', '150', 'mL', 'BOTTLE']
	])
);

// Ceftriaxone-style: three vial strengths of one injection.
export const THREE_VIALS = doc(
	product('22222-500', 'INJECTION, POWDER, FOR SOLUTION', ['500', 'mg', '1', '1'], [
		['22222-500-10', '1', '1', 'VIAL']
	]),
	product('22222-100', 'INJECTION, POWDER, FOR SOLUTION', ['1', 'g', '1', '1'], [
		['22222-100-10', '1', '1', 'VIAL']
	]),
	product('22222-200', 'INJECTION, POWDER, FOR SOLUTION', ['2', 'g', '1', '1'], [
		['22222-200-10', '1', '1', 'VIAL']
	])
);

const SINGLE = doc(
	product('33333-100', 'TABLET', ['10', 'mg', '1', '1'], [
		['33333-100-30', '30', '1', 'BOTTLE'],
		['33333-100-90', '90', '1', 'BOTTLE']
	])
);

// A powder kit with a drug-free diluent part, each part its own product.
const KIT = `<document><manufacturedProduct><manufacturedProduct>
	<code code="44444-206" codeSystem="2.16.840.1.113883.6.69"/>
	<name>Kit</name>
	<formCode code="C" displayName="KIT"/>
	<asContent><quantity><numerator value="1" unit="1"/><denominator value="1"/></quantity>
		<containerPackagedProduct><code code="44444-206-05" codeSystem="2.16.840.1.113883.6.69"/><formCode code="C" displayName="CARTON"/></containerPackagedProduct>
	</asContent>
	<part><quantity><numerator value="7.5" unit="g"/><denominator value="1"/></quantity>
		<partProduct><name>Powder</name><formCode code="C" displayName="POWDER, FOR SOLUTION"/>
			<ingredient classCode="ACTIB"><quantity><numerator value="1" unit="g"/><denominator value="1" unit="g"/></quantity>
				<ingredientSubstance><code code="UNII" codeSystem="2.16.840.1.113883.4.9"/><name>DRUG</name></ingredientSubstance></ingredient>
		</partProduct></part>
	<part><quantity><numerator value="145" unit="mL"/><denominator value="1"/></quantity>
		<partProduct><name>Diluent</name><formCode code="C" displayName="SOLUTION"/>
			<ingredient classCode="IACT"><ingredientSubstance><code code="W" codeSystem="2.16.840.1.113883.4.9"/><name>WATER</name></ingredientSubstance></ingredient>
		</partProduct></part>
</manufacturedProduct></manufacturedProduct></document>`;

test('formFamilyOf groups SPL dose forms into the families a label speaks of', () => {
	assert.equal(formFamilyOf('TABLET, FILM COATED'), 'tablet');
	assert.equal(formFamilyOf('CAPSULE'), 'capsule');
	assert.equal(formFamilyOf('POWDER, FOR SUSPENSION'), 'oral-suspension');
	assert.equal(formFamilyOf('SUSPENSION'), 'oral-suspension');
	assert.equal(formFamilyOf('SOLUTION'), 'oral-solution');
	assert.equal(formFamilyOf('INJECTION, POWDER, FOR SOLUTION'), 'injection');
	assert.equal(formFamilyOf('TABLET, FOR SUSPENSION'), 'tablet');
	assert.equal(formFamilyOf(null), 'other');
});

test('labelScope: tablet NDC on a tablet + oral suspension label', () => {
	const scope = labelScope(parseSplIngredients(TABLET_AND_SUSPENSION), '11111010030');
	assert.ok(scope);
	assert.equal(scope.own.family, 'tablet');
	assert.equal(scope.own.formLabel, 'tablet');
	assert.deepEqual(
		scope.siblings.map((s) => s.family),
		['oral-suspension']
	);
});

test('labelScope: 1 g vial NDC among three vial strengths', () => {
	const scope = labelScope(parseSplIngredients(THREE_VIALS), '22222010010');
	assert.ok(scope);
	assert.equal(scope.own.family, 'injection');
	assert.deepEqual(scope.own.strengths.map((s) => s.mg), [1000]);
	assert.equal(scope.own.strengths[0].text, '1 g vial');
	assert.deepEqual(
		scope.siblings.flatMap((s) => s.strengths.map((x) => x.mg)),
		[500, 2000]
	);
	assert.ok(scope.siblings.every((s) => s.family === 'injection'));
});

test('labelScope: bottle sizes of one oral powder are told apart by package', () => {
	const scope = labelScope(parseSplIngredients(TABLET_AND_SUSPENSION), '11111020015', [
		{ ndc: '11111020080', description: '80 mL in 1 BOTTLE' },
		{ ndc: '11111020015', description: '150 mL in 1 BOTTLE' }
	]);
	assert.ok(scope);
	assert.equal(scope.own.family, 'oral-suspension');
	assert.deepEqual(scope.own.strengths.map((s) => s.containerMl), [150]);
	assert.equal(scope.own.strengths[0].text, '150 mL bottle');
	const sameFamily = scope.siblings.find((s) => s.family === 'oral-suspension');
	assert.deepEqual(sameFamily?.strengths.map((s) => s.containerMl), [80]);
});

test('labelScope: a single-product label has nothing to filter', () => {
	assert.equal(labelScope(parseSplIngredients(SINGLE), '33333010030'), null);
});

test('labelScope: a kit diluent part is not a sibling dose form', () => {
	assert.equal(labelScope(parseSplIngredients(KIT), '44444020605'), null);
});

// ── Dose form ────────────────────────────────────────────────────────────────

const h = (level: number, text: string): LabelBlock => ({ type: 'heading', level, text });
const p = (text: string): LabelBlock => ({ type: 'paragraph', runs: [{ text }] });
const list = (...items: string[]): LabelBlock => ({ type: 'list', ordered: false, items: items.map((t) => [p(t)]) });
const textOf = (blocks: LabelBlock[]): string[] =>
	blocks.flatMap((b) =>
		b.type === 'heading' ? [b.text] : b.type === 'paragraph' ? [b.runs.map((r) => r.text).join('')] : b.type === 'list' ? b.items.flatMap(textOf) : []
	);

const tabletScope = () => labelScope(parseSplIngredients(TABLET_AND_SUSPENSION), '11111010030')!;
const suspensionScope = () => labelScope(parseSplIngredients(TABLET_AND_SUSPENSION), '11111020080')!;

test('filterLabelBlocks drops a subsection headed for another form, as one passage', () => {
	const blocks = [
		h(1, '2.1 Dosing'),
		p('Take one tablet twice daily.'),
		h(1, '2.3 Preparation of Oral Suspension'),
		p('Tap the bottle until the powder flows freely.'),
		p('Add water in two portions.')
	];
	const result = filterLabelBlocks(blocks, tabletScope());
	assert.deepEqual(textOf(result.blocks), ['2.1 Dosing', 'Take one tablet twice daily.']);
	assert.deepEqual(result.omissions, [
		{ reason: 'form', count: 1, unit: 'passage', others: ['oral suspension'], own: 'a tablet' }
	]);
});

test('filterLabelBlocks drops reconstitution prose on an oral solid NDC', () => {
	const blocks = [p('Constitute the powder with 63 mL of water; shake well.')];
	assert.deepEqual(filterLabelBlocks(blocks, tabletScope()).blocks, []);
});

test('filterLabelBlocks keeps reconstitution prose on the suspension NDC', () => {
	const blocks = [p('Constitute the powder with 63 mL of water; shake well.')];
	const result = filterLabelBlocks(blocks, suspensionScope());
	assert.deepEqual(result.blocks, blocks);
	assert.deepEqual(result.omissions, []);
});

test('filterLabelBlocks keeps a passage naming both forms', () => {
	const blocks = [p('Tablets and oral suspension may be taken with or without food.')];
	assert.deepEqual(filterLabelBlocks(blocks, tabletScope()).blocks, blocks);
	assert.deepEqual(filterLabelBlocks(blocks, suspensionScope()).blocks, blocks);
});

test("filterLabelBlocks drops only the other form's list item", () => {
	const blocks = [list('Tablets: swallow whole.', 'Oral suspension: shake well before use.')];
	const result = filterLabelBlocks(blocks, tabletScope());
	assert.deepEqual(textOf(result.blocks), ['Tablets: swallow whole.']);
	assert.equal(result.omissions[0].count, 1);
});

test('filterLabelBlocks drops a heading left with nothing under it, keeps one with something', () => {
	const blocks = [
		h(1, 'Administration'),
		p('Shake the oral suspension well before each use.'),
		h(1, 'Missed dose'),
		p('Shake the oral suspension well.'),
		p('Take the missed dose as soon as remembered.')
	];
	const result = filterLabelBlocks(blocks, tabletScope());
	assert.deepEqual(textOf(result.blocks), ['Missed dose', 'Take the missed dose as soon as remembered.']);
});

test('filterLabelBlocks drops a table captioned for another form', () => {
	const table: LabelBlock = {
		type: 'table',
		caption: 'Table 2: Amount of water for constitution of the oral suspension',
		head: [],
		body: [[{ runs: [{ text: '80 mL' }], header: false }]],
		foot: []
	};
	const result = filterLabelBlocks([table], tabletScope());
	assert.deepEqual(result.blocks, []);
	assert.equal(result.omissions[0].reason, 'form');
});
