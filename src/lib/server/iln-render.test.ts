import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessIln, serializeSurfaces } from '../imprints/spl-to-iln';
import { drawPill, parseIln, toSplAppearance } from '../imprints/iln-render';
import type { PillAppearance } from '../spl-characteristics';

const pill = (over: Partial<PillAppearance>): PillAppearance => ({
	productCode: null,
	colors: ['white'],
	colorText: null,
	shape: 'ROUND',
	shapeCode: null,
	shapeText: null,
	sizeMm: 8,
	score: 1,
	imprint: null,
	...over
});

test('parseIln round-trips every guess the converter makes', () => {
	const cases = [
		{ colors: ['WHITE'], shape: 'ROUND', score: 2, imprint: 'WATSON;349', dosageForm: 'TABLET' },
		{ colors: ['WHITE'], shape: 'ROUND', score: 4, imprint: '', dosageForm: 'TABLET' },
		{ colors: ['BLUE', 'WHITE'], shape: 'CAPSULE', imprint: 'LILLY 3105', dosageForm: 'CAPSULE' },
		{ colors: ['WHITE'], shape: 'OVAL', imprint: 'LOGO 5;Valium;Roche', dosageForm: 'TABLET' },
		{ colors: ['YELLOW'], shape: 'ROUND', symbol: true, imprint: 'A"B', dosageForm: 'TABLET' },
		{ colors: ['RED'], shape: 'OVAL', imprint: 'AB 12', dosageForm: 'CAPSULE, LIQUID FILLED' }
	];
	for (const app of cases) {
		const guess = guessIln(app);
		for (const iln of [guess.iln, ...guess.alternatives.map((a) => a.iln)]) {
			assert.equal(serializeSurfaces(parseIln(iln)), iln);
		}
	}
});

test('parseIln reads nested scores and blanks', () => {
	const [f, b] = parseIln('F: ("1" | "2") - (blank | blank) ; B(white): blank');
	assert.equal(f.body?.k, 'score');
	assert.equal(b.color, 'white');
	assert.equal(b.body, null);
});

test('a scored tablet draws its score line between the halves of the imprint', () => {
	const { views } = drawPill(pill({ imprint: '10 10', score: 2 }), 'TABLET');
	const front = views.find((v) => v.label === 'F')!;
	const score = front.marks.find((m) => m.kind === 'score');
	const texts = front.marks.filter((m) => m.kind === 'text');
	assert.ok(score && score.kind === 'score' && score.x1 === 50);
	assert.equal(texts.length, 2);
	assert.ok(texts.every((t) => t.kind === 'text' && t.text === '10'));
});

test('a cross-scored blank face draws two crossing lines', () => {
	const { views } = drawPill(pill({ imprint: 'M', score: 4 }), 'TABLET');
	const scored = views.find((v) => v.marks.some((m) => m.kind === 'score'))!;
	const lines = scored.marks.filter((m) => m.kind === 'score');
	assert.ok(lines.some((m) => m.kind === 'score' && m.x1 === m.x2));
	assert.ok(lines.some((m) => m.kind === 'score' && m.y1 === m.y2));
});

test('a two-tone capsule fills cap and body separately in one view', () => {
	const { views, guess } = drawPill(
		pill({ colors: ['blue', 'white'], shape: 'CAPSULE', imprint: 'LILLY;3105' }),
		'CAPSULE'
	);
	assert.equal(guess.form, 'capsule');
	assert.equal(views.length, 1);
	assert.notEqual(views[0].fills[0], views[0].fills[1]);
	assert.equal(views[0].finish, 'ink');
	const [cap, body] = views[0].marks.filter((m) => m.kind === 'text');
	assert.ok(cap.kind === 'text' && body.kind === 'text' && cap.x < 50 && body.x > 50);
});

test('an unmarked tablet shows a single plain face', () => {
	const { views } = drawPill(pill({}), 'TABLET');
	assert.equal(views.length, 1);
	assert.equal(views[0].marks.length, 0);
});

test('a measured photo layout places text and scores where the photo shows them', () => {
	const face = (over: object) => ({
		aspect: 1.9,
		fill: '#a2a3a2',
		halves: ['#a2a3a2', '#a2a3a2'] as [string, string],
		elements: [],
		scores: [],
		unmatched: 0,
		...over
	});
	const drawing = drawPill(pill({ shape: 'OVAL', imprint: '60;60;1105', score: 2 }), 'TABLET', {
		confidence: 0.9,
		missing: [],
		faces: [
			face({
				elements: [
					{ segment: 0, text: '60', x: 0.28, y: 0.5, w: 0.2, h: 0.36, read: '60', cost: 0 },
					{ segment: 1, text: '60', x: 0.72, y: 0.5, w: 0.2, h: 0.36, read: '60', cost: 0 }
				],
				scores: [{ dir: 'v', at: 0.5 }]
			}),
			face({ elements: [{ segment: 2, text: '1105', x: 0.5, y: 0.5, w: 0.4, h: 0.35, read: null, cost: 0.3 }] })
		]
	});
	assert.ok(drawing.measured);
	assert.deepEqual(drawing.views.map((v) => v.label), ['F', 'B']);
	// The label's colour, not the photo's grey.
	assert.equal(drawing.views[0].fills[0], '#f7f7f4');
	const [left, right] = drawing.views[0].marks.filter((m) => m.kind === 'text');
	assert.ok(left.kind === 'text' && right.kind === 'text' && left.x < 50 && right.x > 50);
	const score = drawing.views[0].marks.find((m) => m.kind === 'score');
	assert.ok(score && score.kind === 'score' && score.x1 === score.x2 && Math.abs(score.x1 - 50) < 0.01);
	assert.equal(drawing.views[1].marks.length, 1);
});

test('a high-confidence guess is drawn over a measured photo layout', () => {
	const appearance = pill({ imprint: 'M30' });
	assert.equal(guessIln(toSplAppearance(appearance, 'TABLET')).confidence, 'high');
	const drawing = drawPill(appearance, 'TABLET', {
		confidence: 0.9,
		missing: [],
		faces: [{ aspect: 1, fill: '#fff', halves: ['#fff', '#fff'], elements: [], scores: [], unmatched: 0 }]
	});
	assert.equal(drawing.measured, null);
});

test('without a layout the guess is drawn and nothing claims to be measured', () => {
	assert.equal(drawPill(pill({ imprint: 'M;30' }), 'TABLET').measured, null);
});

test('a hole in the middle of a score breaks the score instead of displacing it', () => {
	const { views } = drawPill(pill({ shape: 'DONUT', iln: 'F: "5" | "5"; B: blank' }), 'TABLET');
	const scores = views[0].marks.filter((m) => m.kind === 'score');
	assert.equal(scores.length, 2);
	for (const s of scores) if (s.kind === 'score') assert.equal(s.x1, 50);
});

test('<hole:…> names the hole shape in the notation', () => {
	const { views } = drawPill(pill({ iln: 'F: "A" + <hole:hexagon>; B: blank' }), 'TABLET');
	assert.ok(views[0].marks.some((m) => m.kind === 'symbol' && m.name === 'hole:hexagon'));
});

test('marking method and ink reach the marks; the innermost wins', () => {
	const drawing = drawPill(
		pill({ iln: 'F: ("5"[emboss] / "MG")[ink:#123456] | "10" ; B: "X"[RIM:W>N>E, deboss]' }),
		'TABLET'
	);
	const [front, back] = drawing.views;
	const text = (t: string) => front.marks.find((m) => m.kind === 'text' && m.text === t) as { finish?: string; ink?: string };
	assert.equal(text('5').finish, 'emboss');
	assert.equal(text('MG').finish, 'ink');
	assert.equal(text('MG').ink, '#123456');
	assert.equal(text('10').finish, undefined);
	assert.ok(front.marks.filter((m) => m.kind === 'score').every((m) => !('finish' in m)));
	const arc = back.marks.find((m) => m.kind === 'arc') as { finish?: string };
	assert.equal(arc.finish, 'deboss');
});

test('uniformText gives unmodified strings on a face one size, leaving sized ones alone', () => {
	const appearance = pill({ shape: 'OVAL', iln: 'F: "A" / "LONGWORDLONGWORD" / "B"[small]; B: blank' });
	const sizes = (uniformText: boolean) =>
		drawPill(appearance, 'TABLET', null, { uniformText }).views[0].marks.flatMap((m) =>
			m.kind === 'text' ? [[m.text, m.size] as const] : []
		);
	const off = new Map(sizes(false));
	const on = new Map(sizes(true));
	assert.notEqual(off.get('A'), off.get('LONGWORDLONGWORD'));
	assert.equal(on.get('A'), on.get('LONGWORDLONGWORD'));
	assert.equal(on.get('A'), Math.min(off.get('A')!, off.get('LONGWORDLONGWORD')!));
	assert.equal(on.get('B'), off.get('B'));
	for (const m of drawPill(appearance, 'TABLET', null, { uniformText: true }).views[0].marks)
		assert.ok(!('auto' in m));
});

test('a proportioned capsule outline draws tablets and two-piece capsules at that proportion', () => {
	const base = { productCode: null, colors: ['white'], colorText: null, shapeCode: null, shapeText: null, sizeMm: null, score: null, imprint: 'ABC' };
	const plain = drawPill({ ...base, shape: 'CAPSULE' }, 'TABLET').views[0];
	const long = drawPill({ ...base, shape: 'LONG CAPSULE' }, 'TABLET').views[0];
	assert.ok(long.width / long.height > plain.width / plain.height);
	const shell = drawPill({ ...base, colors: ['white', 'blue'], shape: 'STOUT CAPSULE' }, 'CAPSULE').views[0];
	const plainShell = drawPill({ ...base, colors: ['white', 'blue'], shape: 'CAPSULE' }, 'CAPSULE').views[0];
	assert.equal(shell.label, 'CAPSULE');
	assert.ok(shell.width / shell.height < plainShell.width / plainShell.height);
});
