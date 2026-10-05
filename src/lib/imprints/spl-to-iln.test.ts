import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	fromRecord,
	guessIln,
	parseSplCharacteristics,
	parseSplXml,
	serializeSurfaces
} from './spl-to-iln.ts';

const SPL_FRAGMENT = `
<subject>
  <manufacturedProduct>
    <manufacturedProduct>
      <name>Example Tablet</name>
      <formCode code="C42998" codeSystem="2.16.840.1.113883.3.26.1.1" displayName="TABLET"/>
    </manufacturedProduct>
    <subjectOf><characteristic>
      <code code="SPLCOLOR" codeSystem="2.16.840.1.113883.1.11.19255"/>
      <value xsi:type="CE" code="C48325" displayName="WHITE"/>
    </characteristic></subjectOf>
    <subjectOf><characteristic>
      <code code="SPLSHAPE" codeSystem="2.16.840.1.113883.1.11.19255"/>
      <value xsi:type="CE" code="C48348" displayName="ROUND"/>
    </characteristic></subjectOf>
    <subjectOf><characteristic>
      <code code="SPLSIZE" codeSystem="2.16.840.1.113883.1.11.19255"/>
      <value xsi:type="PQ" value="8" unit="mm"/>
    </characteristic></subjectOf>
    <subjectOf><characteristic>
      <code code="SPLSCORE" codeSystem="2.16.840.1.113883.1.11.19255"/>
      <value xsi:type="INT" value="2"/>
    </characteristic></subjectOf>
    <subjectOf><characteristic>
      <code code="SPLIMPRINT" codeSystem="2.16.840.1.113883.1.11.19255"/>
      <value xsi:type="ST">WATSON;349</value>
    </characteristic></subjectOf>
    <subjectOf><characteristic>
      <code code="SPLSYMBOL" codeSystem="2.16.840.1.113883.1.11.19255"/>
      <value xsi:type="BL" value="false"/>
    </characteristic></subjectOf>
  </manufacturedProduct>
</subject>`;

// ── Input parsing ─────────────────────────────────────────────
test('parses SPL characteristic elements', () => {
	const chars = parseSplCharacteristics(SPL_FRAGMENT);
	assert.equal(chars.length, 6);
	assert.deepEqual(chars.find((c) => c.code === 'SPLIMPRINT')?.text, 'WATSON;349');
	assert.equal(chars.find((c) => c.code === 'SPLCOLOR')?.displayName, 'WHITE');
});

test('parses a product into an appearance record', () => {
	const [app] = parseSplXml(SPL_FRAGMENT);
	assert.equal(app.name, 'Example Tablet');
	assert.equal(app.dosageForm, 'TABLET');
	assert.deepEqual(app.colors, ['WHITE']);
	assert.equal(app.shape, 'ROUND');
	assert.equal(app.sizeMm, 8);
	assert.equal(app.score, 2);
	assert.equal(app.imprint, 'WATSON;349');
	assert.equal(app.symbol, false);
});

test('decodes XML entities in imprint text', () => {
	const chars = parseSplCharacteristics(
		`<characteristic><code code="SPLIMPRINT"/><value xsi:type="ST">A&amp;B;1</value></characteristic>`
	);
	assert.equal(chars[0].text, 'A&B;1');
});

test('reads Pillbox-style flat records', () => {
	const app = fromRecord({
		splcolor_text: 'WHITE;BLUE',
		splshape_text: 'CAPSULE',
		splimprint: 'LILLY;3105',
		splscore: '1',
		splsymbol: 'false',
		dosage_form: 'CAPSULE'
	});
	assert.deepEqual(app.colors, ['WHITE', 'BLUE']);
	assert.equal(app.score, 1);
	assert.equal(app.symbol, false);
	assert.equal(app.dosageForm, 'CAPSULE');
});

// ── Tablets ───────────────────────────────────────────────────
test('single segment goes on F, back blank', () => {
	const g = guessIln({ colors: ['WHITE'], shape: 'ROUND', imprint: 'M 30', dosageForm: 'TABLET' });
	assert.equal(g.iln, 'F: "M 30" ; B: blank');
	assert.equal(g.confidence, 'high');
});

test('two segments become two faces, more characters first', () => {
	const g = guessIln({ colors: ['WHITE'], shape: 'ROUND', imprint: 'M;30', dosageForm: 'TABLET' });
	assert.equal(g.iln, 'F: "30" ; B: "M"');
	assert.ok(g.alternatives.some((a) => a.iln === 'F: "M" / "30" ; B: blank'));
});

test('bisect score goes on the unmarked face', () => {
	const g = guessIln({
		colors: ['WHITE'],
		shape: 'ROUND',
		imprint: 'TEVA 3109',
		score: 2,
		dosageForm: 'TABLET'
	});
	assert.equal(g.iln, 'F: "TEVA 3109" ; B: blank | blank');
});

test('numeric halves are split by the score', () => {
	const g = guessIln({
		colors: ['WHITE'],
		shape: 'ROUND',
		imprint: 'WATSON;5 10',
		score: 2,
		dosageForm: 'TABLET'
	});
	assert.equal(g.iln, 'F: "WATSON" ; B: "5" | "10"');
});

test('stacked lines on a round tablet split by a horizontal score', () => {
	const g = guessIln({
		colors: ['WHITE'],
		shape: 'ROUND',
		imprint: '10;10',
		score: 2,
		dosageForm: 'TABLET'
	});
	const all = [g.iln, ...g.alternatives.map((a) => a.iln)];
	assert.ok(all.includes('F: "10" - "10" ; B: blank'));
});

test('elongated tablets use a vertical score', () => {
	const g = guessIln({
		colors: ['WHITE'],
		shape: 'OVAL',
		imprint: '5 5',
		score: 2,
		dosageForm: 'TABLET'
	});
	assert.equal(g.iln, 'F: "5" | "5" ; B: blank');
});

test('score 4 on a blank face assumes a cross score and says so', () => {
	const g = guessIln({
		colors: ['WHITE'],
		shape: 'ROUND',
		imprint: 'ABC',
		score: 4,
		dosageForm: 'TABLET'
	});
	assert.equal(g.iln, 'F: "ABC" ; B: (blank | blank) - (blank | blank)');
	assert.ok(g.notes.some((n) => /cross/i.test(n)));
});

test('unplaceable score is reported, not invented', () => {
	const g = guessIln({
		colors: ['WHITE'],
		shape: 'ROUND',
		imprint: 'AB;CD',
		score: 2,
		dosageForm: 'TABLET'
	});
	assert.ok(g.notes.some((n) => /score/i.test(n)));
});

test('LOGO token becomes a logo symbol', () => {
	const g = guessIln({
		colors: ['WHITE'],
		shape: 'ROUND',
		imprint: 'LOGO;93',
		dosageForm: 'TABLET'
	});
	assert.equal(g.iln, 'F: "93" ; B: <logo>');
});

test('symbol flag with no logo token fills the blank face', () => {
	const g = guessIln({
		colors: ['WHITE'],
		shape: 'ROUND',
		imprint: '93',
		symbol: true,
		dosageForm: 'TABLET'
	});
	assert.equal(g.iln, 'F: "93" ; B: <symbol>');
});

test('quotes and backslashes in imprint text are escaped', () => {
	const g = guessIln({ colors: ['WHITE'], shape: 'ROUND', imprint: 'A"B', dosageForm: 'TABLET' });
	assert.equal(g.iln, 'F: "A\\"B" ; B: blank');
});

test('no imprint gives two blank faces', () => {
	const g = guessIln({ colors: ['WHITE'], shape: 'ROUND', dosageForm: 'TABLET' });
	assert.equal(g.iln, 'F: blank ; B: blank');
});

// ── Capsules ──────────────────────────────────────────────────
test('two-color capsule labels halves with colors in SPL order', () => {
	const g = guessIln({
		colors: ['WHITE', 'BLUE'],
		shape: 'CAPSULE',
		imprint: 'LILLY;3105',
		dosageForm: 'CAPSULE'
	});
	assert.equal(g.form, 'capsule');
	assert.equal(g.iln, 'CAP(white): "LILLY" ; BODY(blue): "3105"');
	assert.ok(g.notes.some((n) => /color/i.test(n)));
});

test('single capsule segment of word + number splits across halves', () => {
	const g = guessIln({
		colors: ['GREEN'],
		shape: 'CAPSULE',
		imprint: 'ACME 250',
		dosageForm: 'CAPSULE'
	});
	assert.equal(g.iln, 'CAP(green): "ACME" ; BODY(green): "250"');
});

test('liquid-filled capsule is treated as a one-piece softgel', () => {
	const g = guessIln({
		colors: ['YELLOW'],
		shape: 'OVAL',
		imprint: 'P10',
		dosageForm: 'CAPSULE, LIQUID FILLED'
	});
	assert.equal(g.form, 'softgel');
	assert.equal(g.iln, 'F: "P10" ; B: blank');
});

test('capsule shape without dosage form and two colors is guessed as a capsule', () => {
	const g = guessIln({ colors: ['RED', 'WHITE'], shape: 'CAPSULE', imprint: 'X;1' });
	assert.equal(g.form, 'capsule');
	assert.notEqual(g.confidence, 'high');
});

// ── Serializer ────────────────────────────────────────────────
test('serializer parenthesizes a stack inside a score', () => {
	const s = serializeSurfaces([
		{
			label: 'F',
			body: {
				k: 'score',
				dir: '|',
				items: [
					{
						k: 'stack',
						items: [
							{ k: 'text', v: '5' },
							{ k: 'text', v: 'MG' }
						]
					},
					{ k: 'text', v: '10' }
				]
			}
		}
	]);
	// stack binds tighter than score, so no parens are needed
	assert.equal(s, 'F: "5" / "MG" | "10"');
});

test('serializer parenthesizes a score inside a stack', () => {
	const s = serializeSurfaces([
		{
			label: 'F',
			body: {
				k: 'stack',
				items: [
					{ k: 'text', v: 'TOP' },
					{
						k: 'score',
						dir: '|',
						items: [
							{ k: 'text', v: 'A' },
							{ k: 'text', v: 'B' }
						]
					}
				]
			}
		}
	]);
	assert.equal(s, 'F: "TOP" / ("A" | "B")');
});

test('double circle counts as elongated for score direction', () => {
	const g = guessIln({
		colors: ['WHITE'],
		shape: 'DOUBLE CIRCLE',
		imprint: '10;10',
		score: 2,
		dosageForm: 'TABLET'
	});
	const all = [g.iln, ...g.alternatives.map((a) => a.iln)];
	assert.ok(all.includes('F: "10" | "10" ; B: blank'));
	assert.ok(!all.includes('F: "10" - "10" ; B: blank'));
});
