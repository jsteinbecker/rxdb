import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nestTallies } from '../item-summary';

test('nestTallies nests values under the longest contained value', () => {
	const tree = nestTallies([
		{ value: 'White, round', ndcs: ['1'] },
		{ value: 'White, round, 8 mm', ndcs: ['2'] },
		{ value: 'White, round, 8 mm, imprint “A”', ndcs: ['3'] },
		{ value: 'Blue, oval', ndcs: ['4'] },
		{ value: 'Light white, round', ndcs: ['5'] }
	]);
	assert.deepEqual(
		tree.map((n) => n.value),
		['White, round', 'Blue, oval']
	);
	const [white] = tree;
	assert.deepEqual(white.children.map((n) => n.label), ['… 8 mm', 'Light white, round']);
	assert.deepEqual(white.ndcs, ['1', '2', '3', '5']);
	assert.deepEqual(white.children[0].ndcs, ['2', '3']);
	assert.equal(white.children[0].children[0].label, '… imprint “A”');
});
