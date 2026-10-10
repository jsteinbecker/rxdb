import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseAppearanceClause,
	parseAppearanceSection,
	refineAppearances,
	imprintOf,
	colorPhrase,
	sizeOf,
	scoreOf
} from '../spl-appearance-text';
import type { PillAppearance } from '../spl-characteristics';

const coded = (over: Partial<PillAppearance>): PillAppearance => ({
	productCode: null,
	colors: [],
	colorText: null,
	shape: null,
	shapeCode: null,
	shapeText: null,
	sizeMm: null,
	score: null,
	imprint: null,
	image: null,
	...over
});

test('a classic How Supplied sentence decodes every field', () => {
	const a = parseAppearanceClause(
		'Lisinopril Tablets USP, 10 mg are pink, round, biconvex tablets debossed with “L 10” on one side and plain on the other side.'
	)!;
	assert.deepEqual(a.colors, ['pink']);
	assert.equal(a.shape, 'ROUND');
	assert.equal(a.shapeText, 'round, biconvex');
	assert.equal(a.imprint, 'L 10');
	assert.deepEqual(a.strengths, ['10 mg']);
});

test('stacked lines share a face; the other side is a second face', () => {
	assert.equal(imprintOf('debossed with "M" over "25" on one side and "G" on the other side').imprint, 'M 25;G');
	assert.equal(imprintOf('debossed with "M" on one side and "A" above "12" on the other').imprint, 'M;A 12');
	assert.equal(imprintOf('engraved with 93 on one side and 7180 on the other').imprint, '93;7180');
	assert.equal(imprintOf('debossed with "TEVA" on one side and scored on the other').imprint, 'TEVA');
	assert.equal(imprintOf('debossed with "TEVA" on one side and scored on the other').scoreSide, true);
	assert.equal(imprintOf('plain on both sides').plain, true);
});

test('two-tone capsules read cap first whichever way they are written', () => {
	assert.deepEqual(colorPhrase('hard gelatin capsules with a light blue opaque cap and a white opaque body')?.colors, ['blue', 'white']);
	assert.deepEqual(colorPhrase('capsules with a white body and a green cap')?.colors, ['green', 'white']);
	assert.deepEqual(colorPhrase('white to off-white tablets')?.colors, ['white']);
	assert.deepEqual(colorPhrase('blue/white capsules')?.colors, ['blue', 'white']);
});

test('capsule imprints on cap and body, and ink is not the shell colour', () => {
	const a = parseAppearanceClause(
		'Size 2 capsules with a green opaque cap and a white opaque body, imprinted with "TEVA" on the cap and "1234" on the body in black ink.'
	)!;
	assert.deepEqual(a.colors, ['green', 'white']);
	assert.equal(a.imprint, 'TEVA;1234');
	assert.equal(a.ink, 'black');
	assert.equal(a.shape, 'CAPSULE');
	assert.equal(a.sizeMm, 18);
});

test('sizes, inches and scores', () => {
	assert.equal(sizeOf('measuring approximately 10.5 mm x 5.3 mm', 'tablet'), 10.5);
	assert.equal(sizeOf('7/16 inch round tablets', 'tablet'), 11.1);
	assert.equal(scoreOf('quadrisected tablets'), 4);
	assert.equal(scoreOf('functionally scored'), 2);
	assert.equal(scoreOf('unscored tablets'), 1);
	assert.equal(scoreOf('tablets debossed with "SCORED"'), null);
});

test('a section with several strengths attaches each NDC to its description', () => {
	const text = `16 HOW SUPPLIED/STORAGE AND HANDLING
Amlodipine Besylate Tablets USP, 5 mg are white, octagonal tablets debossed with "AB" on one side and "5" on the other. Bottles of 90 NDC 12345-678-90.
Amlodipine Besylate Tablets USP, 10 mg are white, round tablets debossed with "AB" on one side and "10" on the other. Bottles of 90 NDC 12345-679-90. Store at 20° to 25°C.`;
	const all = parseAppearanceSection(text, 'how_supplied');
	assert.equal(all.length, 2);
	assert.deepEqual(all[0].ndcProducts, ['12345-678']);
	assert.equal(all[1].shape, 'ROUND');
	const refined = refineAppearances([coded({ imprint: 'AB;10', colors: ['white'] })], [{ key: 'how_supplied', text }], {
		ndc: '12345-0679-90'
	});
	assert.equal(refined[0].shape, 'ROUND');
	assert.equal(refined[0].labelText?.section, 'how_supplied');
});

test('dosage forms and strengths lists split per strength', () => {
	const text =
		'Tablets: 25 mg: yellow, oval, film-coated, debossed with "25" on one side; 50 mg: pink, capsule-shaped, film-coated, debossed with "50" on one side.';
	const all = parseAppearanceSection(text, 'dosage_forms_and_strengths');
	assert.equal(all.length, 2);
	assert.deepEqual(all[1].colors, ['pink']);
	assert.equal(all[1].shape, 'CAPSULE');
	const refined = refineAppearances([coded({ colors: ['red'] })], [{ key: 'dosage_forms_and_strengths', text }], {
		strengths: ['50 mg/1']
	});
	assert.deepEqual(refined[0].colors, ['pink']);
	assert.equal(refined[0].imprint, '50');
});

test('prose wins over the coded observation, keeping the photo', () => {
	const refined = refineAppearances(
		[coded({ colors: ['orange'], shape: 'OVAL', imprint: 'M;25', image: 'x.jpg' })],
		[{ key: 'how_supplied', text: 'Light orange, oval, biconvex tablets debossed with "M" over "25" on one side and scored on the other.' }]
	);
	assert.equal(refined[0].imprint, 'M 25');
	assert.equal(refined[0].colorText, 'light orange');
	assert.equal(refined[0].score, 2);
	assert.equal(refined[0].image, 'x.jpg');
});

test('ambiguous descriptions are left alone', () => {
	const text =
		'The 5 mg tablets are white, round, debossed with "A". The 10 mg tablets are blue, round, debossed with "B".';
	const original = coded({ colors: ['green'] });
	assert.deepEqual(refineAppearances([original], [{ key: 'how_supplied', text }]), [original]);
});

test('flattened How Supplied without stops, and score-straddling imprints', () => {
	const text =
		'HOW SUPPLIED/STORAGE AND HANDLING Metoprolol Tartrate Tablets, USP are available containing 25 mg, 37.5 mg or 50 mg of metoprolol tartrate, USP. The 25 mg tablets are white, film-coated, round, scored tablets debossed with M over 18 on one side of the tablet and scored on the other side. They are available as follows: NDC 0378-0018-01 bottles of 100 tablets The 37.5 mg tablets are light blue, film-coated, round, scored tablets debossed with M above the score and MT below the score on one side of the tablet and 37.5 on the other side. They are available as follows: NDC 0378-4593-01 bottles of 100 tablets The 50 mg tablets are pink, film-coated, round, scored tablets debossed with M over 32 on one side of the tablet and scored on the other side. They are available as follows: NDC 0378-0032-01 bottles of 100 tablets';
	const all = parseAppearanceSection(text, 'how_supplied');
	assert.equal(all.length, 3);
	assert.equal(all[0].imprint, 'M 18');
	assert.equal(all[1].imprint, 'M MT;37.5');
	assert.deepEqual(all[2].ndcProducts, ['378-32']);
	assert.ok(all[0].source.startsWith('The 25 mg'));
	const [refined] = refineAppearances([coded({ imprint: 'M;32' })], [{ key: 'how_supplied', text }], { ndc: '00378-0032-01' });
	assert.equal(refined.imprint, 'M 32');
	assert.deepEqual(refined.colors, ['pink']);
});

test('a How Supplied table with one row per strength splits into one description per row', () => {
	const text =
		'16 HOW SUPPLIED/STORAGE AND HANDLING LIPITOR tablets are supplied as follows: Strength How Supplied NDC Tablet Description ' +
		'10 mg of atorvastatin bottles of 90 58151-155-77 white, elliptical, film-coated tablets debossed with "10" on one side and "VLE 155" on the other side ' +
		'20 mg of atorvastatin bottles of 90 58151-156-77 white, elliptical, film-coated tablets debossed with "20" on one side and "VLE 156" on the other side ' +
		'40 mg of atorvastatin bottles of 90 58151-157-77 white, elliptical, film-coated tablets debossed with "40" on one side and "VLE 157" on the other side ' +
		'80 mg of atorvastatin bottles of 90 58151-158-77 white, elliptical, film-coated tablets debossed with "80" on one side and "VLE 158" on the other side ' +
		'Storage Store at controlled room temperature 20-25°C (68-77°F).';
	const found = parseAppearanceSection(text, 'how_supplied');
	assert.equal(found.length, 4);
	assert.deepEqual(found.map((d) => d.ndcProducts), [['58151-155'], ['58151-156'], ['58151-157'], ['58151-158']]);
	assert.deepEqual(found.map((d) => d.strengths), [['10 mg'], ['20 mg'], ['40 mg'], ['80 mg']]);
	const [refined] = refineAppearances([], [{ key: 'how_supplied', text }], { ndc: '58151-157-77' });
	assert.ok(refined.imprint === '40;VLE 157' || refined.imprint === 'VLE 157;40', refined.imprint ?? '');
	assert.ok(!refined.labelText?.text.includes('VLE 155'));
});
