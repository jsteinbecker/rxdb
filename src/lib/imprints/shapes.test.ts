import { test } from 'node:test';
import assert from 'node:assert/strict';
// ── Drugs.com vocabulary, new shapes, holes ───────────────────
// ── V and K holes ─────────────────────────────────────────────
import {
	checkHoleOrient,
	checkShapeOrient,
	checkShapeProportion,
	describeShapeOrient,
	findHole,
	findShape,
	formatHoleOrient,
	formatShapeOrient,
	formatShapeProportion,
	HOLES,
	isDefaultHoleOrient,
	isDefaultOrient,
	isElongated,
	parseHoleOrient,
	parseShapeOrient,
	PROPORTIONS,
	shapeRatio,
	SHAPES,
	splitShapeProportion
} from './shapes.ts'; // ── Registry ──────────────────────────────────────────────────

// ── Registry ──────────────────────────────────────────────────

test('all 19 SPL shapes are present with consecutive NCI codes', () => {
	const spl = SHAPES.filter((s) => s.spl);
	assert.equal(spl.length, 19);
	const codes = spl.map((s) => Number(s.spl!.code.slice(1))).sort((a, b) => a - b);
	assert.deepEqual(
		codes,
		Array.from({ length: 19 }, (_, i) => 48335 + i)
	);
});

test('lookup by name, SPL term, code, and alias', () => {
	assert.equal(findShape('oval')?.id, 'OVAL');
	assert.equal(findShape('C48348')?.id, 'ROUND');
	assert.equal(findShape('HEXAGON (6 sided)')?.id, 'HEXAGON');
	assert.equal(findShape('semi circle')?.id, 'SEMI-CIRCLE');
	assert.equal(findShape('oblong')?.id, 'CAPSULE');
	assert.equal(findShape('banana'), undefined);
});

test('ILN extension shapes exist and map to an SPL fallback', () => {
	const thin = findShape('thin oval');
	assert.equal(thin?.id, 'THIN OVAL');
	assert.equal(thin?.spl, undefined);
	assert.equal(thin?.splFallback?.[0], 'OVAL');
	const paren = findShape('()');
	assert.equal(paren?.id, 'PAREN');
	assert.ok(paren?.splFallback?.includes('CAPSULE'));
	assert.equal(findShape('paren')?.id, 'PAREN');
});

test('elongated set includes DOUBLE CIRCLE and the extensions', () => {
	for (const s of [
		'DOUBLE CIRCLE',
		'THIN OVAL',
		'()',
		'OVAL',
		'CAPSULE',
		'TEAR',
		'BULLET',
		'oblong'
	]) {
		assert.equal(isElongated(s), true, s);
	}
	for (const s of ['ROUND', 'SQUARE', 'TRIANGLE', undefined])
		assert.equal(isElongated(s), false, String(s));
});

// ── Direction tags ────────────────────────────────────────────

test('parse and format direction tags', () => {
	assert.deepEqual(parseShapeOrient('TIP@E'), { feature: 'TIP', deg: 90 });
	assert.equal(formatShapeOrient(parseShapeOrient('FLAT@300')), 'FLAT@300');
	assert.equal(formatShapeOrient(parseShapeOrient('CORNER@315')), 'CORNER@NW');
	assert.throws(() => parseShapeOrient('POINT@E'), /TIP|FLAT/);
	assert.throws(() => parseShapeOrient('TIP@X'), /point/i);
});

test('elongated directional shapes point E or W only', () => {
	assert.match(checkShapeOrient(findShape('TEAR')!, parseShapeOrient('TIP@N')).join(), /E or W/);
	assert.deepEqual(checkShapeOrient(findShape('TEAR')!, parseShapeOrient('TIP@W')), []);
});

test('shapes without a direction reject tags', () => {
	assert.match(
		checkShapeOrient(findShape('ROUND')!, parseShapeOrient('TIP@E')).join(),
		/no direction/i
	);
});

test('wrong feature lists the right ones', () => {
	assert.match(
		checkShapeOrient(findShape('SEMI-CIRCLE')!, parseShapeOrient('TIP@N')).join(),
		/FLAT/
	);
	assert.deepEqual(checkShapeOrient(findShape('HEXAGON')!, parseShapeOrient('CORNER@N')), []);
});

test('defaults', () => {
	assert.equal(isDefaultOrient(findShape('TEAR')!, parseShapeOrient('TIP@E')), true);
	assert.equal(isDefaultOrient(findShape('TEAR')!, parseShapeOrient('TIP@W')), false);
	assert.equal(isDefaultOrient(findShape('TRIANGLE')!, parseShapeOrient('TIP@N')), true);
	assert.equal(isDefaultOrient(findShape('SEMI-CIRCLE')!, parseShapeOrient('FLAT@S')), true);
});

test('plain-English direction', () => {
	assert.equal(describeShapeOrient(parseShapeOrient('TIP@W')), 'tip at the left');
	assert.equal(describeShapeOrient(parseShapeOrient('FLAT@300')), 'flat side at 300°');
});

// ── Drugs.com vocabulary, new shapes, holes ───────────────────

test('every Drugs.com shape term resolves, except the ambiguous Four-sided', () => {
	const terms = [
		'Barrel',
		'Capsule/Oblong',
		'Character-shape',
		'Egg-shape',
		'Eight-sided',
		'Oval',
		'Figure eight-shape',
		'Five-sided',
		'Gear-shape',
		'Heart-shape',
		'Kidney-shape',
		'Rectangle',
		'Round',
		'Seven-sided',
		'Six-sided',
		'Three-sided',
		'U-shape'
	];
	for (const t of terms) assert.ok(findShape(t), t);
	assert.equal(findShape('Capsule/Oblong')?.id, 'CAPSULE');
	assert.equal(findShape('Figure eight-shape')?.id, 'DOUBLE CIRCLE');
	assert.equal(findShape('Three-sided')?.id, 'TRIANGLE');
	assert.equal(findShape('Four-sided'), undefined);
});

test('U-shape and shield are directional, not elongated', () => {
	const u = findShape('U-shape')!;
	assert.equal(u.id, 'U-SHAPE');
	assert.equal(u.elongated, false);
	assert.equal(isDefaultOrient(u, parseShapeOrient('FLAT@N')), true);
	assert.deepEqual(checkShapeOrient(u, parseShapeOrient('FLAT@S')), []);
	const shield = findShape('shield')!;
	assert.equal(shield.id, 'SHIELD');
	assert.equal(isDefaultOrient(shield, parseShapeOrient('TIP@S')), true);
});

test('kidney notch sits on a long side; egg tip on an end', () => {
	const kidney = findShape('kidney')!;
	assert.equal(kidney.elongated, true);
	assert.deepEqual(checkShapeOrient(kidney, parseShapeOrient('NOTCH@S')), []);
	assert.match(checkShapeOrient(kidney, parseShapeOrient('NOTCH@E')).join(), /N or S/);
	assert.match(checkShapeOrient(findShape('egg')!, parseShapeOrient('TIP@N')).join(), /E or W/);
});

test('donut is a round outline with a round through-hole', () => {
	const d = findShape('donut')!;
	assert.equal(d.hole, 'ROUND');
	assert.deepEqual(d.splFallback, ['ROUND']);
	assert.equal(findShape('ring')?.id, 'DONUT');
});

test('hole registry', () => {
	assert.equal(findHole('round')?.through, true);
	assert.equal(findHole('orifice')?.through, false);
	assert.equal(findHole('laser drilled')?.id, 'ORIFICE');
	assert.ok(HOLES.length >= 2);
});

// ── V and K holes ─────────────────────────────────────────────

test('V and K hole definitions', () => {
	const v = findHole('V')!;
	assert.equal(v.through, true);
	assert.deepEqual(v.features, ['TIP']);
	assert.equal(v.chiral, false);
	const k = findHole('k-shaped')!;
	assert.equal(k.id, 'K');
	assert.equal(k.chiral, true);
	assert.equal(findShape('V-Donut')?.hole, 'V');
	assert.equal(findShape('k donut')?.id, 'K-DONUT');
});

test('parse and format hole tags', () => {
	assert.deepEqual(parseHoleOrient('TIP@S'), { feature: 'TIP', deg: 180, mirrored: false });
	assert.deepEqual(parseHoleOrient('UP@E, MIRROR'), { feature: 'UP', deg: 90, mirrored: true });
	assert.equal(formatHoleOrient(parseHoleOrient('mirror, UP@270')), 'UP@W, MIRROR');
	assert.equal(formatHoleOrient(parseHoleOrient('MIRROR')), 'MIRROR');
	assert.throws(() => parseHoleOrient('LEFT@E'), /TIP|UP/);
});

test('hole tags are checked against the hole type', () => {
	assert.deepEqual(checkHoleOrient(findHole('V')!, parseHoleOrient('TIP@N')), []);
	assert.match(checkHoleOrient(findHole('V')!, parseHoleOrient('UP@N')).join(), /TIP/);
	assert.match(checkHoleOrient(findHole('V')!, parseHoleOrient('TIP@S, MIRROR')).join(), /mirror/i);
	assert.match(checkHoleOrient(findHole('K')!, parseHoleOrient('TIP@S')).join(), /UP/);
	assert.match(
		checkHoleOrient(findHole('ROUND')!, parseHoleOrient('TIP@S')).join(),
		/no direction/i
	);
});

test('hole defaults', () => {
	assert.equal(isDefaultHoleOrient(findHole('V')!, parseHoleOrient('TIP@S')), true);
	assert.equal(isDefaultHoleOrient(findHole('K')!, parseHoleOrient('UP@N')), true);
	assert.equal(isDefaultHoleOrient(findHole('K')!, parseHoleOrient('MIRROR')), false);
});

// ── Any letter as a hole ──────────────────────────────────────

test('every letter is a hole and a donut shape', () => {
	for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
		assert.equal(findHole(letter)?.through, true, letter);
		assert.equal(findShape(`${letter}-donut`)?.hole, letter, letter);
	}
	assert.equal(findShape('X DONUT')?.id, 'X-DONUT');
	assert.equal(findHole('r shaped')?.id, 'R');
});

test('letter holes are chiral unless mirror-symmetric', () => {
	assert.equal(findHole('A')!.chiral, false);
	assert.equal(findHole('R')!.chiral, true);
	assert.deepEqual(checkHoleOrient(findHole('R')!, parseHoleOrient('UP@E, MIRROR')), []);
	assert.match(checkHoleOrient(findHole('T')!, parseHoleOrient('UP@N, MIRROR')).join(), /mirror/i);
	assert.match(checkHoleOrient(findHole('A')!, parseHoleOrient('TIP@S')).join(), /UP/);
});

// ── Proportion ────────────────────────────────────────────────

test('a capsule outline states its proportion as a word or length:width', () => {
	assert.equal(shapeRatio('CAPSULE'), null);
	assert.equal(shapeRatio('LONG CAPSULE'), PROPORTIONS.CAPSULE.LONG);
	assert.equal(shapeRatio('stout caplet'), PROPORTIONS.CAPSULE.STOUT);
	assert.equal(shapeRatio('CAPSULE 2.6:1'), 2.6);
	assert.equal(shapeRatio('Oblong 19:8'), 19 / 8);
	assert.deepEqual(splitShapeProportion('LONG CAPSULE'), {
		base: 'CAPSULE',
		ratio: 3.4,
		word: 'LONG'
	});
});

test('a proportioned shape is still found as its outline', () => {
	for (const v of ['LONG CAPSULE', 'STOUT CAPSULE', 'CAPSULE 2.6:1', 'stadium 3:1']) {
		assert.equal(findShape(v)?.id, 'CAPSULE', v);
		assert.ok(isElongated(v), v);
	}
});

test('bad proportions are reported', () => {
	assert.match(checkShapeProportion('LONG ROUND')[0], /ROUND takes no proportion/);
	assert.match(checkShapeProportion('CAPSULE 1:2')[0], /longer than wide/);
	assert.match(checkShapeProportion('CAPSULE 9:1')[0], /at most 6:1/);
	assert.match(checkShapeProportion('LONG CAPSULE 3:1')[0], /not both/);
	assert.deepEqual(checkShapeProportion('CAPSULE 2.2:1'), []);
	assert.deepEqual(checkShapeProportion('HEXAGON (6 sided)'), []);
	assert.equal(shapeRatio('CAPSULE 1:2'), null);
});

test('proportions format canonically', () => {
	assert.equal(formatShapeProportion('CAPSULE', null), 'CAPSULE');
	assert.equal(formatShapeProportion('CAPSULE', PROPORTIONS.CAPSULE.default), 'CAPSULE');
	assert.equal(formatShapeProportion('CAPSULE', 3.4), 'LONG CAPSULE');
	assert.equal(formatShapeProportion('CAPSULE', 1.8), 'STOUT CAPSULE');
	assert.equal(formatShapeProportion('CAPSULE', 19 / 8), 'CAPSULE 2.38:1');
	assert.equal(formatShapeProportion('ROUND', 2), 'ROUND');
});
