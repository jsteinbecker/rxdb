import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildFace,
	describeLocation,
	type FaceGeometry,
	formatLocation,
	locateBaseline,
	LocationError,
	parseLocation,
	parseModifiers,
	type Pt
} from './iln-location.ts';
import { serializeNode } from './spl-to-iln.ts'; // ── Parsing & formatting ──────────────────────────────────────

// ── Parsing & formatting ──────────────────────────────────────

const CANONICAL = [
	'RIM:W>N>E',
	'RIM:W>S>E',
	'RIM:E>N>W',
	'RIM:NW>NE',
	'RIM:W>N>E>S',
	'RIM:N>N(cw)',
	'RIM:S>S(ccw)',
	'RIM:N(cw)',
	'RIM:300>60',
	'MID:W>N>E',
	'HOLE:N>N(cw)',
	'BEVEL:SW>SE',
	'ORBIT(<heart>):W>N>E',
	'BAND:N(cw, feet F)',
	'BAND:N>N(cw)',
	'BAND:ACROSS@N',
	'LINE@C',
	'LINE@N',
	'LINE>N@W',
	'LINE>SE@C',
	'STACK@E',
	'SCORE:ALONG.N',
	'SCORE:ACROSS',
	'SCORE:GAP',
	'SCORE:END.W',
	'HALF.W',
	'QUAD.NE',
	'THIRD.C',
	'CAP.MID:AX',
	'BODY.MID:AX<',
	'BODY.TIP:RAD>N@back',
	'BODY.SEAM:RING',
	'SPAN:AX'
];

for (const code of CANONICAL) {
	test(`round-trips ${code}`, () => {
		assert.equal(formatLocation(parseLocation(code)), code);
	});
}

test('top arc reads clockwise with feet toward center', () => {
	const info = describeLocation(parseLocation('RIM:W>N>E'));
	assert.deepEqual(info, {
		startDeg: 270,
		endDeg: 90,
		spanDeg: 180,
		centerDeg: 0,
		dir: 'cw',
		feet: 'in'
	});
});

test('bottom arc reads counterclockwise with feet toward edge', () => {
	const info = describeLocation(parseLocation('RIM:W>S>E'));
	assert.equal(info?.dir, 'ccw');
	assert.equal(info?.feet, 'out');
	assert.equal(info?.centerDeg, 180);
});

test('degree points that land on compass points format as compass names', () => {
	assert.equal(formatLocation(parseLocation('RIM:315>45')), 'RIM:NW>NE');
});

test('capsule @180 is formatted as @back', () => {
	assert.equal(formatLocation(parseLocation('BODY.MID:AX<@180')), 'BODY.MID:AX<@back');
});

test('LINE defaults to heading E in zone C', () => {
	assert.equal(formatLocation(parseLocation('LINE')), 'LINE@C');
});

test('band feet default to B and are omitted', () => {
	assert.equal(formatLocation(parseLocation('BAND:N(cw, feet B)')), 'BAND:N(cw)');
});

const INVALID: [string, RegExp][] = [
	['RIM:W>E', /180/],
	['RIM:N>N', /cw|ccw/],
	['RIM:N', /cw|ccw/],
	['RIM:W>N>W', /direction/i],
	['RIM:W>N>E(ccw)', /contradict/i],
	['ORBIT:W>N', /element/i],
	['RIM(<heart>):W>N', /ORBIT/],
	['RIM:N(cw, feet F)', /BAND/],
	['LINE>NNE@C', /heading/i],
	['QUAD.N', /QUAD/],
	['RIM:400>N', /point/i],
	['FOO:BAR', /Unknown/i]
];

for (const [code, msg] of INVALID) {
	test(`rejects ${code}`, () => {
		assert.throws(
			() => parseLocation(code),
			(e: unknown) => e instanceof LocationError && msg.test(e.message)
		);
	});
}

// ── Legacy modifier translation ───────────────────────────────

test('legacy [arc, top] becomes RIM:W>N>E', () => {
	const r = parseModifiers('[arc, top]');
	assert.equal(r.location && formatLocation(r.location), 'RIM:W>N>E');
	assert.deepEqual(r.mods, []);
});

test('legacy [arc, bottom, cw] becomes RIM:E>S>W', () => {
	assert.equal(formatLocation(parseModifiers('arc, bottom, cw').location!), 'RIM:E>S>W');
});

test('legacy rotation and anchor become a LINE code', () => {
	assert.equal(formatLocation(parseModifiers('r90').location!), 'LINE>S@C');
	assert.equal(formatLocation(parseModifiers('r180, top-left').location!), 'LINE>W@NW');
});

test('legacy vert and ring translate', () => {
	assert.equal(formatLocation(parseModifiers('vert, right').location!), 'STACK@E');
	assert.equal(formatLocation(parseModifiers('ring').location!), 'RIM:N>N(cw)');
});

test('non-location modifiers pass through, including codes with commas', () => {
	const r = parseModifiers('[BAND:N(cw, feet F), small, x2]');
	assert.equal(formatLocation(r.location!), 'BAND:N(cw, feet F)');
	assert.deepEqual(r.mods, ['small', 'x2']);
});

// ── Geometry (OCR baselines) ──────────────────────────────────

const FACE: FaceGeometry = { cx: 500, cy: 400, rx: 200, ry: 200 };

/** Points along a circle around (ox, oy) in face-radius units; angles are compass degrees, interpolated from→to. */
function arc(face: FaceGeometry, r: number, from: number, to: number, n = 9, ox = 0, oy = 0): Pt[] {
	return Array.from({ length: n }, (_, i) => {
		const t = ((from + ((to - from) * i) / (n - 1)) * Math.PI) / 180;
		return {
			x: face.cx + face.rx * (ox + r * Math.sin(t)),
			y: face.cy - face.ry * (oy + r * Math.cos(t))
		};
	});
}

test('top arc baseline lands on RIM:W>N>E', () => {
	assert.equal(locateBaseline(FACE, arc(FACE, 0.85, -90, 90)).code, 'RIM:W>N>E');
});

test('bottom arc baseline read left to right lands on RIM:W>S>E', () => {
	assert.equal(locateBaseline(FACE, arc(FACE, 0.9, 270, 90)).code, 'RIM:W>S>E');
});

test('upside-down top arc lands on RIM:E>N>W', () => {
	assert.equal(locateBaseline(FACE, arc(FACE, 0.9, 90, -90)).code, 'RIM:E>N>W');
});

test('mid-radius arc lands on MID', () => {
	assert.equal(locateBaseline(FACE, arc(FACE, 0.45, -90, 90)).code, 'MID:W>N>E');
});

test('nearly complete circle becomes a ring', () => {
	assert.equal(locateBaseline(FACE, arc(FACE, 0.85, 0, 350, 24)).code, 'RIM:N>N(cw)');
});

test('off-compass endpoints fall back to degrees', () => {
	assert.equal(locateBaseline(FACE, arc(FACE, 0.85, 300, 420)).code, 'RIM:300>60');
});

test('ring around a hole lands on HOLE', () => {
	const face = { ...FACE, hole: { cx: 500, cy: 400, r: 40 } };
	assert.equal(locateBaseline(face, arc(face, 0.3, 0, 355, 24)).code, 'HOLE:N>N(cw)');
});

test('arc around an off-center element lands on ORBIT', () => {
	const pts = arc(FACE, 0.2, -90, 90, 9, 0.5, 0);
	assert.equal(locateBaseline(FACE, pts, { orbitOf: '<heart>' }).code, 'ORBIT(<heart>):W>N>E');
});

test('oval face normalizes to the rim', () => {
	const oval = { cx: 500, cy: 400, rx: 300, ry: 150 };
	assert.equal(locateBaseline(oval, arc(oval, 0.85, -90, 90)).code, 'RIM:W>N>E');
});

test('image rotation is removed using upDeg', () => {
	const rotated = { ...FACE, upDeg: 90 };
	// canonical W→N→E appears in the image as compass 0→180
	assert.equal(locateBaseline(rotated, arc(FACE, 0.85, 0, 180)).code, 'RIM:W>N>E');
});

test('jittered arc still lands on the same code', () => {
	const pts = arc(FACE, 0.85, -90, 90, 15).map((p, i) => ({
		x: p.x + ((i % 3) - 1) * 2,
		y: p.y + ((i % 2) * 2 - 1) * 2
	}));
	assert.equal(locateBaseline(FACE, pts).code, 'RIM:W>N>E');
});

test('horizontal baseline through the center is LINE@C', () => {
	assert.equal(
		locateBaseline(FACE, [
			{ x: 420, y: 410 },
			{ x: 500, y: 410 },
			{ x: 580, y: 410 }
		]).code,
		'LINE@C'
	);
});

test('horizontal baseline in the upper zone is LINE@N', () => {
	assert.equal(
		locateBaseline(FACE, [
			{ x: 440, y: 290 },
			{ x: 560, y: 290 }
		]).code,
		'LINE@N'
	);
});

test('vertical baseline reading down on the left is LINE>S@W', () => {
	assert.equal(
		locateBaseline(FACE, [
			{ x: 380, y: 330 },
			{ x: 380, y: 400 },
			{ x: 380, y: 470 }
		]).code,
		'LINE>S@W'
	);
});

// ── Face building ─────────────────────────────────────────────

const t = (v: string) => ({ k: 'text' as const, v });

test('flow text plus rim arcs, ordered clockwise from the top', () => {
	const face = buildFace([
		{ node: t('MG'), loc: parseLocation('RIM:W>S>E') },
		{ node: t('50') },
		{ node: t('ACME'), loc: parseLocation('RIM:W>N>E') }
	]);
	assert.equal(serializeNode(face), '"50" + "ACME"[RIM:W>N>E] + "MG"[RIM:W>S>E]');
});

test('horizontal lines in different rows stack top to bottom', () => {
	const face = buildFace([
		{ node: t('MG'), loc: parseLocation('LINE@S') },
		{ node: t('5'), loc: parseLocation('LINE@N') }
	]);
	assert.equal(serializeNode(face), '"5" / "MG"');
});

test('horizontal lines in one row are juxtaposed west to east', () => {
	const face = buildFace([
		{ node: t('B'), loc: parseLocation('LINE@E') },
		{ node: t('A'), loc: parseLocation('LINE@W') }
	]);
	assert.equal(serializeNode(face), '"A" "B"');
});

test('a lone off-center line keeps its zone', () => {
	assert.equal(
		serializeNode(buildFace([{ node: t('X'), loc: parseLocation('LINE@N') }])),
		'"X"[LINE@N]'
	);
});

test('a face with only placed elements has no leading flow', () => {
	assert.equal(
		serializeNode(buildFace([{ node: t('ACME'), loc: parseLocation('RIM:W>N>E') }])),
		'"ACME"[RIM:W>N>E]'
	);
});

test('existing modifiers are kept after the location code', () => {
	const face = buildFace([
		{ node: { k: 'text', v: '250', mods: ['x2'] }, loc: parseLocation('BODY.MID:RAD>N') }
	]);
	assert.equal(serializeNode(face), '"250"[BODY.MID:RAD>N, x2]');
});
