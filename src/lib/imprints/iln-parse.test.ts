import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainIln, formatIln, IlnSyntaxError, parseIln, validateIln } from './iln-parse.ts';
import { serializeSurfaces } from './spl-to-iln.ts';

// ── Parse / round-trip ────────────────────────────────────────

const ROUND_TRIP = [
	'F: "5" | "10" ; B: "WATSON" / "349"',
	'F: "AN" - "627" ; B: blank',
	'F: "10" | "10"[RIM:W>N>E] ; B: <logo:Teva>',
	'F: ("A" | "B") - ("C" | "D") ; B: "XYZ"',
	'F: "50" + "ACME"[RIM:W>N>E] + "MG"[RIM:W>S>E] ; B: blank',
	'F: <heart: "5"> ; B: "AB" / "12"',
	'F: ("5" + <star>[LINE@NW, small]) | "10" ; B: blank',
	'F: "A\\"B" ; B: "AB\\?3"',
	'F: ("5" / "MG")[LINE>S@C] ; B: blank',
	'F(pink): "P" ; B(white): "20"',
	'CAP(white): "LILLY" ; BODY(blue): "3105"[BODY.MID:RAD>N, x2]',
	'CAP(white): blank ; BODY(blue): blank ; CAP+BODY: "ACME 250"',
	'F: "ABC" ; B: blank | blank ; E: "12"[BAND:N(cw)]',
	'F: "A" <hole> "B" ; B: blank',
	'F: "LOGO" <logo> "93" ; B: blank',
	'F[TIP@W]: "ABC" ; B: blank',
	'F(pink)[FLAT@S]: "P" ; B(white): blank'
];

for (const src of ROUND_TRIP) {
	test(`round-trips ${src}`, () => {
		assert.equal(serializeSurfaces(parseIln(src)), src);
	});
}

test('whitespace is flexible around operators', () => {
	assert.equal(serializeSurfaces(parseIln('F:"5"|"10";B:blank')), 'F: "5" | "10" ; B: blank');
});

test('illegible characters are stored as U+FFFD', () => {
	const [f] = parseIln('F: "A\\?C" ; B: blank');
	assert.deepEqual(f.body, { k: 'text', v: 'A\uFFFDC' });
});

const SYNTAX_ERRORS: [string, RegExp][] = [
	['F: "A" | "B" - "C" ; B: blank', /parenthes/i],
	['F: "ABC ; B: blank', /unterminated/i],
	['X: "A"', /label/i],
	['F "A"', /":"/],
	['F: "A"[RIM:W>N>E ; B: blank', /\[/],
	['F: <heart: "5" ; B: blank', />/],
	['F: "A" | ; B: blank', /expected/i],
	['F[POINT@E]: "A" ; B: blank', /TIP/]
];

for (const [src, msg] of SYNTAX_ERRORS) {
	test(`syntax error: ${src}`, () => {
		assert.throws(
			() => parseIln(src),
			(e: unknown) => e instanceof IlnSyntaxError && msg.test(e.message)
		);
	});
}

test('syntax errors report a column with a caret', () => {
	try {
		parseIln('F: "A" | "B" - "C"');
		assert.fail('should throw');
	} catch (e) {
		assert.ok(e instanceof IlnSyntaxError);
		assert.equal(e.column, 14);
		assert.match(e.message, /\n.*\^/);
	}
});

// ── Validation ────────────────────────────────────────────────

const issues = (src: string) => validateIln(src).issues;
const has = (src: string, level: 'error' | 'warning', re: RegExp) =>
	issues(src).some((i) => i.level === level && re.test(i.message));

test('a clean string has no issues', () => {
	assert.deepEqual(issues('F: "50" + "ACME"[RIM:W>N>E] ; B: "93"'), []);
	assert.equal(validateIln('F: "5" | "10" ; B: blank').ok, true);
});

test('syntax errors surface as a single error issue', () => {
	const r = validateIln('F: "A" | "B" - "C"');
	assert.equal(r.ok, false);
	assert.equal(r.issues[0].level, 'error');
});

test('bad location code is an error', () => {
	assert.ok(has('F: "A"[RIM:W>E] ; B: blank', 'error', /180/));
});

test('legacy modifier is a warning with the replacement', () => {
	assert.ok(has('F: "A"[arc, top] ; B: blank', 'warning', /RIM:W>N>E/));
});

test('unknown modifier is a warning', () => {
	assert.ok(has('F: "A"[sparkly] ; B: blank', 'warning', /unknown modifier/i));
});

test('placed element juxtaposed in flow is a warning', () => {
	assert.ok(has('F: "A" "B"[RIM:W>N>E] ; B: blank', 'warning', /\+/));
});

test('a rotated element that is a whole score section is fine', () => {
	assert.ok(!has('F: "10" | "10"[LINE>W@C] ; B: blank', 'warning', /\+/));
});

test('an arc inside a score section is still a warning', () => {
	assert.ok(has('F: "ACME"[RIM:W>N] | "10" ; B: blank', 'warning', /\+/));
});

test('missing back face is a warning', () => {
	assert.ok(has('F: "A"', 'warning', /B/));
});

test('mixing tablet and capsule surfaces is an error', () => {
	assert.ok(has('F: "A" ; BODY(blue): "1"', 'error', /mix/i));
});

test('duplicate surface is an error', () => {
	assert.ok(has('F: "A" ; F: "B"', 'error', /duplicate/i));
});

test('capsule half without color is a warning', () => {
	assert.ok(has('CAP: "A" ; BODY(blue): "1"', 'warning', /color/i));
});

test('F/B rule violation is a warning', () => {
	assert.ok(has('F: "M" ; B: "WATSON"', 'warning', /swap/i));
});

test('capsule code on a tablet face is an error', () => {
	assert.ok(has('F: "A"[CAP.MID:AX] ; B: blank', 'error', /capsule/i));
});

test('ORBIT around an element not on the face is a warning', () => {
	assert.ok(has('F: "A"[ORBIT(<heart>):W>N>E] ; B: blank', 'warning', /heart/));
	assert.ok(!has('F: <heart> + "A"[ORBIT(<heart>):W>N>E] ; B: blank', 'warning', /heart/));
});

// ── Formatting ────────────────────────────────────────────────

test('format translates legacy modifiers and orders surfaces', () => {
	assert.equal(
		formatIln('B: blank ; F: "ACME"[x2, arc, top] + "50"'),
		'F: "ACME"[RIM:W>N>E, x2] + "50" ; B: blank'
	);
});

test('format drops the default LINE@C', () => {
	assert.equal(formatIln('F: "50"[LINE@C] ; B: blank'), 'F: "50" ; B: blank');
});

test('format normalizes compass-equivalent degrees', () => {
	assert.equal(formatIln('F: "A"[RIM:315>45] ; B: blank'), 'F: "A"[RIM:NW>NE] ; B: blank');
});

// ── Explanation ───────────────────────────────────────────────

test('explains a scored tablet', () => {
	const e = explainIln('F: "5" | "10" ; B: "WATSON" / "349"');
	assert.match(e, /Front: "5" left of a vertical score, "10" right of it/);
	assert.match(e, /Back: "WATSON" above "349"/);
});

test('explains arcs with direction and letter orientation', () => {
	const e = explainIln('F: "50" + "ACME"[RIM:W>N>E] + "MG"[RIM:W>S>E] ; B: blank');
	assert.match(
		e,
		/"ACME" along the face edge from W through N to E, reading clockwise, letter bottoms toward the center/
	);
	assert.match(
		e,
		/"MG" along the face edge from W through S to E, reading counterclockwise, letter bottoms toward the edge/
	);
	assert.match(e, /Back: blank/);
});

test('explains capsules with colors', () => {
	const e = explainIln('CAP(white): "LILLY" ; BODY(blue): "3105"[BODY.MID:RAD>N, x2]');
	assert.match(e, /Cap \(white\): "LILLY"/);
	assert.match(e, /printed twice around/);
});

test('explains illegible characters and symbols', () => {
	const e = explainIln('F: <heart: "5"> ; B: "AB\\?3" + <logo:Teva>[LINE@S]');
	assert.match(e, /heart symbol containing "5"/);
	assert.match(e, /1 illegible character/);
	assert.match(e, /Teva logo/);
});

// ── Shape direction tags ──────────────────────────────────────

const issuesWith = (src: string, shape: string) => validateIln(src, { shape }).issues;

test('direction tag inconsistent with shape is an error', () => {
	assert.ok(
		issuesWith('F[TIP@N]: "A" ; B: blank', 'TEAR').some(
			(i) => i.level === 'error' && /E or W/.test(i.message)
		)
	);
	assert.ok(
		issuesWith('F[TIP@E]: "A" ; B: blank', 'ROUND').some(
			(i) => i.level === 'error' && /no direction/i.test(i.message)
		)
	);
});

test('valid direction tag passes', () => {
	assert.deepEqual(issuesWith('F[TIP@W]: "A" ; B: blank', 'TEAR'), []);
});

test('unknown shape is a warning', () => {
	assert.ok(
		issuesWith('F: "A" ; B: blank', 'banana').some(
			(i) => i.level === 'warning' && /shape/i.test(i.message)
		)
	);
});

test('direction tag on a capsule half is an error', () => {
	assert.ok(has('CAP(white)[TIP@E]: "A" ; BODY(blue): blank', 'error', /faces/i));
});

test('format drops a default direction when the shape is known', () => {
	assert.equal(
		formatIln('F[TIP@E]: "A" ; B[TIP@W]: blank', { shape: 'TEAR' }),
		'F: "A" ; B[TIP@W]: blank'
	);
	assert.equal(formatIln('F[TIP@E]: "A" ; B: blank'), 'F[TIP@E]: "A" ; B: blank');
});

test('explain includes the direction', () => {
	assert.match(explainIln('F[TIP@W]: "ABC" ; B: blank'), /Front \(tip at the left\): "ABC"/);
	assert.match(
		explainIln('F(pink)[FLAT@S]: "P" ; B: blank'),
		/Front \(pink; flat side at the bottom\)/
	);
});

test('a direction tag on a face with no text is a warning', () => {
	assert.ok(
		issuesWith('F: "A" ; B[TIP@W]: blank', 'TEAR').some(
			(i) => i.level === 'warning' && /default/i.test(i.message)
		)
	);
	assert.ok(
		issuesWith('F: "A" ; B[TIP@W]: <heart>', 'TEAR').some((i) => /default/i.test(i.message))
	);
});

test('explains a drilled orifice', () => {
	assert.match(explainIln('F: "ALZA 18" + <orifice>[LINE@NE] ; B: blank'), /drilled orifice/);
});

// ── Hole direction tags ───────────────────────────────────────

test('hole tags round-trip', () => {
	for (const src of [
		'F: "10" + <hole>[TIP@S] ; B: blank',
		'F: "K5" + <hole>[UP@E] ; B: "2" + <hole>[UP@W, MIRROR]'
	])
		assert.equal(serializeSurfaces(parseIln(src)), src);
});

test('hole tags are not mistaken for location codes', () => {
	assert.deepEqual(issues('F: "10" + <hole>[TIP@S] ; B: blank'), []);
});

test('hole tag must fit the hole type', () => {
	assert.ok(
		issuesWith('F: "10" + <hole>[UP@N] ; B: blank', 'V-DONUT').some(
			(i) => i.level === 'error' && /TIP/.test(i.message)
		)
	);
});

test('a chiral hole reads mirrored on exactly one face', () => {
	const both = issuesWith('F: "K5" + <hole>[UP@E] ; B: "22" + <hole>[UP@W]', 'K-DONUT');
	assert.ok(both.some((i) => i.level === 'error' && /mirror/i.test(i.message)));
	assert.deepEqual(
		issuesWith('F: "K5" + <hole>[UP@E] ; B: "2" + <hole>[UP@W, MIRROR]', 'K-DONUT'),
		[]
	);
});

test('<hole> on a shape without a hole is a warning', () => {
	assert.ok(
		issuesWith('F: "A" <hole> "B" ; B: blank', 'ROUND').some(
			(i) => i.level === 'warning' && /hole/i.test(i.message)
		)
	);
});

test('format drops a default hole tag when the shape is known', () => {
	assert.equal(
		formatIln('F: "10" + <hole>[TIP@S] ; B: blank', { shape: 'V-DONUT' }),
		'F: "10" + <hole> ; B: blank'
	);
});

test('explain names the hole type and mirroring', () => {
	const e = explainIln('F: "K5" + <hole>[UP@E] ; B: "2" + <hole>[UP@W, MIRROR]', {
		shape: 'K-DONUT'
	});
	assert.match(e, /K-shaped hole, top of the letter at the right/);
	assert.match(e, /mirror-reversed/);
});

// ── fill ──────────────────────────────────────────────────────

test('fill round-trips after the location code', () => {
	const src = 'F: "ACME"[RIM:W>N>E, fill] + "MG"[RIM:W>S>E, fill] ; B: blank';
	assert.equal(serializeSurfaces(parseIln(src)), src);
	assert.deepEqual(issues(src), []);
});

test('fill conflicts with small/large', () => {
	assert.ok(has('F: "A"[fill, large] ; B: blank', 'error', /fill/));
});

test('fill on blank is a warning', () => {
	assert.ok(has('F: "A" | blank[fill] ; B: blank', 'warning', /fill/));
});

test('format puts fill in the size slot', () => {
	assert.equal(
		formatIln('F: "A"[x2, fill, RIM:W>N>E] ; B: blank'),
		'F: "A"[RIM:W>N>E, fill, x2] ; B: blank'
	);
});

test('explain: fill items in one region grow equally', () => {
	const e = explainIln('F: "725"[LINE@S, fill] + "MSD"[RIM:NW>NE, fill] ; B: blank');
	assert.match(e, /"725" in the lower area, sized to fill its space, growing equally with "MSD"/);
	assert.match(e, /"MSD" .*sized to fill its space, growing equally with "725"/);
});

test('explain: a lone fill item has no peers', () => {
	const e = explainIln('F: "ABC"[fill] ; B: blank');
	assert.match(e, /"ABC" sized to fill its space/);
	assert.doesNotMatch(e, /equally/);
});

test('explain: score sections are separate regions', () => {
	const e = explainIln('F: "5"[fill] | "10"[fill] ; B: blank');
	assert.doesNotMatch(e, /equally/);
});

test('<hole:shape> validates the named shape', () => {
	assert.ok(validateIln('F: <hole:K>[UP@E]; B: <hole:K>[UP@E, MIRROR]', { shape: 'ROUND' }).ok);
	assert.ok(!validateIln('F: <hole:blob>; B: blank').ok);
	assert.ok(!validateIln('F: <hole:hexagon>[TIP@N]; B: blank').ok);
});

// ── Marking method and ink ────────────────────────────────────

test('method and ink modifiers parse, validate and round-trip', () => {
	for (const src of [
		'F: "ACME"[emboss] ; B: "50"[deboss]',
		'F: ("5" / "MG")[ink:black] ; B: "10"[ink:#1a3c8f]',
		'CAP(white): "LILLY"[ink:dark blue] ; BODY(blue): "3105"[print]'
	]) {
		const r = validateIln(src);
		assert.ok(r.ok, `${src}: ${JSON.stringify(r.issues)}`);
		assert.equal(r.issues.length, 0, src);
		assert.equal(formatIln(formatIln(src)), formatIln(src));
	}
});

test('method and ink: conflicts are errors', () => {
	assert.ok(!validateIln('F: "5"[emboss, deboss] ; B: blank').ok);
	assert.ok(!validateIln('F: "5"[deboss, ink:black] ; B: blank').ok);
	assert.ok(!validateIln('F: "5"[ink:black, ink:red] ; B: blank').ok);
	assert.ok(!validateIln('F: "5"[ink:] ; B: blank').ok);
	assert.ok(validateIln('F: blank[emboss] ; B: blank').issues.some((i) => i.level === 'warning'));
});

test('format: ink implies print, modifiers ordered after size', () => {
	assert.equal(
		formatIln('F: "ACME"[INK:Black, print, small, RIM:W>N>E] ; B: blank'),
		'F: "ACME"[RIM:W>N>E, small, ink:black] ; B: blank'
	);
	assert.equal(formatIln('F: "5"[DEBOSS] ; B: blank'), 'F: "5"[deboss] ; B: blank');
});

test('explain: method and ink', () => {
	const e = explainIln('F: "50"[emboss] + "MG"[RIM:W>S>E, ink:red] ; B: "A"[print]');
	assert.match(e, /"50" embossed/);
	assert.match(e, /printed in red ink/);
	assert.match(e, /"A" printed/);
});

// ── See-through capsule shells ────────────────────────────────

test('clear and translucent capsule halves round-trip and validate', () => {
	const src = 'CAP(translucent blue, granules white): "AB" ; BODY(clear, liquid yellow): "12"';
	assert.equal(serializeSurfaces(parseIln(src)), src);
	assert.equal(validateIln(src).ok, true);
});

test('see-through shells must state their contents', () => {
	for (const src of [
		'CAP(clear): blank ; BODY(white): blank',
		'CAP(translucent blue): blank ; BODY(white): blank',
		'CAP(clear, white): blank ; BODY(white): blank',
		'CAP(clear, dust white): blank ; BODY(white): blank',
		'CAP(white, powder white): blank ; BODY(white): blank'
	])
		assert.equal(validateIln(src).ok, false, src);
});

test('formats and explains see-through shells', () => {
	assert.equal(
		formatIln('CAP(Clear, Pellet Orange): blank ; BODY(white): blank'),
		'CAP(clear, pellets orange): blank ; BODY(white): blank'
	);
	assert.match(
		explainIln('CAP(translucent green, powder white): blank ; BODY(white): blank'),
		/Cap \(translucent green shell, white powder\)/
	);
});
