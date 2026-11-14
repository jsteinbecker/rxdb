import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppearanceClause } from './spl-appearance-text';
import { colorTerm, swatchOf } from './spl-characteristics';

const c = (t: string) => {
	const r = parseAppearanceClause(t);
	return { colors: r?.colors, ink: r?.ink };
};

test('body vs marks', () => {
	for (const [t, colors, ink] of [
		[
			'Opaque buff cap and opaque buff body, hard gelatin capsules. Printed black “TEVA” on cap',
			['brown', 'brown'],
			'black'
		],
		['Printed black “TEVA” on cap and “3109” on body portions of the capsules', [], 'black'],
		['White, round tablets imprinted with “M” in black ink', ['white'], 'black'],
		['White, round tablets with “M” imprinted in black', ['white'], 'black'],
		[
			'Hard gelatin capsules with a blue cap and a white body, imprinted with green “ABC”',
			['blue', 'white'],
			'green'
		],
		[
			'Size 0 capsules with an opaque blue cap and body containing white to off-white powder',
			['blue'],
			null
		],
		['Yellow capsules filled with a clear red liquid', ['yellow'], null],
		['White oval tablets with black imprint “A1”', ['white'], 'black'],
		['Orange capsules with two red bands', ['orange'], null],
		['Pink tablets debossed with “93” on one side', ['pink'], null],
		['Capsules with a black print “X” and a green cap and green body', ['green', 'green'], 'black']
	] as const)
		assert.deepEqual(c(t), { colors: [...colors], ink }, t);
});

test('colorTerm maps free text onto the palette, never the ink', () => {
	assert.equal(colorTerm('WHITE'), 'white');
	assert.equal(colorTerm('white with black ink'), 'white');
	assert.equal(colorTerm('white (printed in red ink)'), 'white');
	assert.equal(colorTerm('LIGHT BLUE'), 'blue');
	assert.equal(colorTerm('beige'), 'brown');
	assert.equal(colorTerm('grey'), 'gray');
	assert.equal(colorTerm('black ink'), null);
	assert.equal(colorTerm('zzz'), null);
});

test('dark colours keep their shade and draw noticeably darker', () => {
	assert.equal(colorTerm('DARK BLUE'), 'dark blue');
	assert.equal(colorTerm('deep red'), 'dark red');
	assert.equal(colorTerm('white with dark blue ink'), 'white');
	const lum = (hex: string) =>
		[1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
	assert.ok(lum(swatchOf('dark blue')) < lum(swatchOf('blue')) * 0.6);
	assert.deepEqual(c('Dark green capsules with a white body and dark blue cap'), {
		colors: ['dark blue', 'white'],
		ink: null
	});
	assert.deepEqual(c('Dark green, round tablets'), { colors: ['dark green'], ink: null });
});
