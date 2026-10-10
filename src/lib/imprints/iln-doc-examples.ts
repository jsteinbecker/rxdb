// Every worked example from the ILN skill's documentation (SKILL.md and
// references/*.md), with the shape and dose form each is meant for, so the
// `/dev/iln-examples` gallery can draw them and `scripts/iln-screenshots.sh`
// can capture them into `static/iln-examples/`.

export interface IlnDocExample {
	id: string;
	iln: string;
	shape: string;
	doseForm: string;
	colors: string[];
	note: string;
}

const tab = (id: string, iln: string, shape: string, note: string, colors = ['white']): IlnDocExample => ({
	id,
	iln,
	shape,
	doseForm: 'TABLET',
	colors,
	note
});
const cap = (id: string, iln: string, colors: string[], note: string): IlnDocExample => ({
	id,
	iln,
	shape: 'CAPSULE',
	doseForm: 'CAPSULE',
	colors,
	note
});

export const ILN_DOC_EXAMPLES: IlnDocExample[] = [
	tab('intro-arcs-scored-back', 'F: "50" + "ACME"[RIM:W>N>E] + "MG"[RIM:W>S>E] ; B: "5" | "10"', 'ROUND', 'Center text, top and bottom rim arcs; back split by a vertical score'),
	tab('lines-and-score', 'F: "WATSON" / "349" ; B: "5" | "10"', 'CAPSULE', 'Two stacked lines; vertical score on the back'),
	tab('horizontal-score', 'F: "AN" - "627" ; B: blank', 'ROUND', 'Horizontal score between two runs'),
	tab('score-on-blank-face', 'F: "TEVA 3109" ; B: blank | blank', 'CAPSULE', 'Score on the unmarked face'),
	tab('rotated-half', 'F: "10" | "10"[LINE>W@C] ; B: <logo:Teva>', 'ROUND', 'Right half upside down; logo on the back'),
	tab('cross-score', 'F: ("A" | "B") - ("C" | "D") ; B: "XYZ"', 'ROUND', 'Cross score, four quadrants'),
	tab('rim-arcs', 'F: "50" + "ACME"[RIM:W>N>E] + "MG"[RIM:W>S>E] ; B: blank', 'ROUND', 'Top and bottom edge arcs'),
	tab('symbol-with-markings', 'F: "AB" / "12" ; B: <heart: "5">', 'ROUND', 'Symbol enclosing a marking'),
	tab('hole-ring', 'F: <hole> + "RX 10"[HOLE:N>N(cw)] ; B: blank', 'DONUT', 'Text ringing a through-hole'),
	tab('stacked-letters', 'F: "ABC 10" ; B: "X"[STACK@C]', 'ROUND', 'Stacked letters on the back'),
	tab('bilayer', 'F(white): "20" ; B(pink): "P"', 'ROUND', 'Bilayer: per-face colors', ['white', 'pink']),
	tab('tear-tip-west', 'F[TIP@W]: "ABC" ; B: "12"', 'TEAR', 'Tear shape, tip on the left of the front'),
	tab('k-donut', 'F: "K5" + <hole>[UP@E] ; B: "2" + <hole>[UP@W, MIRROR]', 'K-DONUT', 'K-shaped hole, mirrored on the back'),
	tab('p-donut', 'F: "20" + <hole> ; B: <hole>[MIRROR]', 'P-DONUT', 'P-shaped hole; its counter is cut through too'),
	tab('a-donut', 'F: <hole> ; B: blank', 'A-DONUT', 'A-shaped hole'),
	tab('b-donut', 'F: <hole> ; B: blank', 'B-DONUT', 'B-shaped hole'),
	tab('v-donut', 'F: "10" + <hole>[TIP@N] ; B: blank', 'V-DONUT', 'V-shaped hole pointing up'),
	tab('fill-priority', 'F: "725"[LINE@S, fill] + "MSD"[RIM:N(cw), fill] ; B: blank', 'ROUND', 'Two fill elements grow equally'),
	tab('illegible-and-edge', 'F: "AB\\?3" ; B: blank ; E: "12"[BAND:N(cw)]', 'ROUND', 'Illegible character; edge band print'),
	tab('vertical-text', 'F: "10" + "ACME"[LINE>S@C] ; B: blank', 'ROUND', 'Vertical text reading down (location table)'),
	tab('corner-mark', 'F: "100" + "M"[LINE@NW] ; B: blank', 'SQUARE', 'Small mark in a corner (location table)'),
	tab('short-top-arc', 'F: "5" + "ACME"[RIM:NW>NE] ; B: blank', 'ROUND', 'Short top arc (location table)'),
	tab('full-ring', 'F: "7" + "ACME PHARMA"[RIM:N>N(cw)] ; B: blank', 'ROUND', 'Full ring (location table)'),
	cap('capsule-two-color', 'CAP(white): "LILLY" ; BODY(blue): "3105"', ['white', 'blue'], 'Cap and body, each printed'),
	cap('capsule-radial', 'CAP(ivory): blank ; BODY(ivory): "250 mg"[BODY.MID:RAD>N, x2]', ['ivory', 'ivory'], 'Print around the girth, twice'),
	cap('capsule-axial-back', 'CAP(red): "XY" ; BODY(red): "77"[BODY.MID:AX@back]', ['red', 'red'], 'Axial print on the back of the body'),
	cap('capsule-clear-body', 'CAP(blue): "AB" ; BODY(clear, pellets white): "12"', ['blue', 'clear'], 'Clear body showing white pellets'),
	cap('capsule-translucent', 'CAP(translucent green, powder white): blank ; BODY(translucent green, powder white): "G 10"', ['green', 'green'], 'Tinted see-through shell over powder'),
	cap('capsule-clear-liquid', 'CAP(clear, liquid yellow): blank ; BODY(clear, liquid yellow): "LQ"', ['clear', 'clear'], 'Clear shell, yellow liquid fill')
];
