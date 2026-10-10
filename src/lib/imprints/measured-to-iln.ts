import {
	buildFace,
	type FaceGeometry,
	locateBaseline,
	type PlacedElement
} from './iln-location.ts';
import { type Node, type PillForm, serializeSurfaces, type Surface } from './spl-to-iln.ts';
import type { MeasuredElement, MeasuredFace, PillImageLayout } from '../pill-image-layout'; // ── From a measured photo to ILN ─────────────────────────────────────────────

// ── From a measured photo to ILN ─────────────────────────────────────────────
// `pill-image-analyze` finds each imprint section's box on the label photo.
// This hands those boxes to the ILN locator as straight baselines — the box's
// bottom edge, read left to right — so the photo's layout becomes notation
// that can be saved, reviewed and edited like any other ILN.

// Measured boxes are fractions of the face's bounding box, y down.
const UNIT_FACE: FaceGeometry = { cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 };

const placed = (element: MeasuredElement): PlacedElement => {
	const y = element.y + element.h / 2;
	const { location } = locateBaseline(UNIT_FACE, [
		{ x: element.x - element.w / 2, y },
		{ x: element.x + element.w / 2, y }
	]);
	return { node: { k: 'text', v: element.text }, loc: location };
};

/** Re-measure elements against the part of the face from `from` to `to` along x or y. */
const within = (elements: MeasuredElement[], axis: 'x' | 'y', from: number, to: number) =>
	elements
		.filter((e) => e[axis] >= from && e[axis] < to)
		.map((e) => {
			const size = axis === 'x' ? 'w' : 'h';
			return { ...e, [axis]: (e[axis] - from) / (to - from), [size]: e[size] / (to - from) };
		});

/** One face's elements, divided by its score lines when it has any. */
function faceNode(elements: MeasuredElement[], scores: MeasuredFace['scores']): Node | null {
	if (!elements.length) return null;
	const [score, ...rest] = scores;
	if (score) {
		const axis = score.dir === 'v' ? 'x' : 'y';
		const kept = rest.filter((other) => other.dir === score.dir);
		return {
			k: 'score',
			dir: score.dir === 'v' ? '|' : '-',
			items: [
				faceNode(within(elements, axis, 0, score.at), []) ?? { k: 'blank' },
				faceNode(within(elements, axis, score.at, 1.0001), kept) ?? { k: 'blank' }
			]
		};
	}
	const node = buildFace(elements.map(placed));
	return node.k === 'blank' ? null : node;
}

/** The measured layout as ILN, or null when the photo placed nothing. */
export function measuredToIln(layout: PillImageLayout, form: PillForm): string | null {
	if (!layout.faces.some((face) => face.elements.length)) return null;
	let surfaces: Surface[];
	if (form === 'capsule') {
		// One photographed side: cap on the left, body on the right.
		const face = [...layout.faces].sort((a, b) => b.elements.length - a.elements.length)[0];
		surfaces = [
			{ label: 'CAP', body: faceNode(within(face.elements, 'x', 0, 0.5), []) },
			{ label: 'BODY', body: faceNode(within(face.elements, 'x', 0.5, 1.0001), []) }
		];
	} else {
		const [front, back] = layout.faces;
		surfaces = [
			{ label: 'F', body: faceNode(front.elements, front.scores) },
			{ label: 'B', body: back ? faceNode(back.elements, back.scores) : null }
		];
	}
	return serializeSurfaces(surfaces);
}
