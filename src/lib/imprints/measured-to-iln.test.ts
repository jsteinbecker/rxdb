import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measuredToIln } from './measured-to-iln.ts';
import { validateIln } from './iln-parse.ts';
import type { MeasuredElement, MeasuredFace, PillImageLayout } from './pill-image-layout.ts';

const el = (text: string, x: number, y: number, w = 0.3, h = 0.15): MeasuredElement => ({
	segment: 0,
	text,
	x,
	y,
	w,
	h,
	read: text,
	cost: 0
});
const face = (elements: MeasuredElement[], scores: MeasuredFace['scores'] = []): MeasuredFace => ({
	aspect: 1,
	fill: '#ffffff',
	halves: ['#ffffff', '#ffffff'],
	elements,
	scores,
	unmatched: 0
});
const layout = (...faces: MeasuredFace[]): PillImageLayout => ({
	faces,
	missing: [],
	confidence: 1
});

test('stacked text on the front, blank back', () => {
	const iln = measuredToIln(layout(face([el('M', 0.5, 0.3), el('30', 0.5, 0.7)])), 'tablet');
	assert.equal(iln, 'F: "M" / "30" ; B: blank');
	assert.ok(validateIln(iln!).ok);
});

test('a vertical score divides the face', () => {
	const iln = measuredToIln(
		layout(
			face([el('5', 0.5, 0.5, 0.15)]),
			face([el('A', 0.25, 0.5, 0.15), el('B', 0.75, 0.5, 0.15)], [{ dir: 'v', at: 0.5 }])
		),
		'tablet'
	);
	assert.equal(iln, 'F: "5" ; B: "A" | "B"');
	assert.ok(validateIln(iln!).ok);
});

test('capsule text splits at the seam', () => {
	const iln = measuredToIln(
		layout(face([el('LILLY', 0.25, 0.5), el('3105', 0.75, 0.5)])),
		'capsule'
	);
	assert.equal(iln, 'CAP: "LILLY" ; BODY: "3105"');
	assert.ok(validateIln(iln!).ok);
});

test('nothing placed gives null', () => {
	assert.equal(measuredToIln(layout(face([])), 'tablet'), null);
});
