import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inactivatedOnDailyMed } from './catalog-providers';
import {
	type ActivityInput,
	directoryListed,
	exclusionReason,
	parsePackageFacts
} from './catalog-facts';
import {
	CATALOG_VERSION,
	isFresh,
	mergePackage,
	readSnapshot,
	snapshotPackage
} from './catalog-cache';
import { parseStrength, uniqueRunEvidence } from './catalog-store';
import { packageFixture } from './catalog-test-fixtures';

const reconstitutionText =
	'Reconstitute the pharmacy bulk package bottle with exactly 152 mL of a compatible reconstitution diluent, listed below, to a concentration of 200 mg per mL of piperacillin and 25 mg per mL of tazobactam.';

test('package parsing preserves pack count and the physical container', () => {
	const facts = parsePackageFacts(
		'25021032104',
		'10 VIAL in 1 CARTON / 4 mL in 1 VIAL, SINGLE-DOSE',
		'INJECTION, SOLUTION',
		[],
		null
	);
	assert.equal(facts.size?.value, 4);
	assert.equal(facts.size?.packQty, 10);
	assert.equal(facts.size?.container, 'VIAL, SINGLE-DOSE');
	assert.equal(facts.isMultiDose, false);
	assert.equal(facts.resolvedVolume, null);
});

test('dry-fill parsing separates the added 152 mL from the final 180 mL', () => {
	const item = packageFixture();
	const facts = parsePackageFacts(item.ndc, item.description, item.doseForm, item.ingredients, {
		dosage_and_administration: [reconstitutionText]
	});
	assert.equal(facts.resolvedVolume?.meaning, 'diluent');
	assert.equal(facts.resolvedVolume?.finalVolumeMl, 180);
	assert.equal(facts.resolvedVolume?.diluentMl, 152);
});

test('unresolved/incomplete label data does not invent a final volume', () => {
	const item = packageFixture();
	assert.equal(
		parsePackageFacts(item.ndc, item.description, item.doseForm, item.ingredients, null)
			.resolvedVolume?.finalVolumeMl,
		null
	);
	assert.equal(
		parsePackageFacts(
			item.ndc,
			item.description,
			item.doseForm,
			[...item.ingredients, { name: 'Unknown', strength: null }],
			{ dosage_and_administration: [reconstitutionText] }
		).resolvedVolume,
		null
	);
});

test('reconstitution tables use the stated concentration, not mass divided by diluent', () => {
	const facts = parsePackageFacts(
		'12345678901',
		'1 INJECTION, POWDER, FOR SOLUTION in 1 VIAL',
		'POWDER, FOR SOLUTION',
		[{ name: 'CEFTRIAXONE', strength: '1 g/1' }],
		{
			dosage_and_administration_table: [
				'<table><tr><th>Vial size</th><th>100 mg/mL</th></tr><tr><td>1 g</td><td>9.6 mL</td></tr></table>'
			]
		}
	);
	assert.equal(facts.resolvedVolume?.finalVolumeMl, 10);
	assert.equal(facts.resolvedVolume?.diluentMl, 9.6);
});

// Eugia ampicillin/sulbactam (55150-178), Table 6 verbatim bar styling: a
// withdrawal-volume column beside the diluent one, a <tfoot> ahead of <tbody>,
// and a sibling 3 g vial on the same label.
const ampicillinSulbactamTable =
	'<table><caption>TABLE 6 </caption><thead><tr><th>Ampicillin and Sulbactam for Injection Vial Size</th><th>Volume of Diluent to be Added</th><th>Withdrawal Volume*</th></tr></thead>' +
	'<tfoot><tr><td colspan="3">* There is sufficient excess present to allow withdrawal and administration of the stated volumes. </td></tr></tfoot>' +
	'<tbody><tr><td>1.5 g </td><td>3.2 mL </td><td>4 mL </td></tr><tr><td>3 g </td><td>6.4 mL </td><td>8 mL </td></tr></tbody></table>';

test('withdrawal volume columns are yields, not diluent, and sibling vial sizes are dropped', () => {
	const facts = parsePackageFacts(
		'55150017899',
		'10 BOTTLE in 1 BOX (55150-178-99) / 1 INJECTION, POWDER, FOR SOLUTION in 1 BOTTLE',
		'INJECTION, POWDER, FOR SOLUTION',
		[
			{ name: 'AMPICILLIN SODIUM', strength: '1 g/1' },
			{ name: 'SULBACTAM SODIUM', strength: '0.5 g/1' }
		],
		{ dosage_and_administration_table: [ampicillinSulbactamTable] }
	);
	assert.deepEqual(
		facts.reconstitution.map(({ id: _id, ...row }) => row),
		[{ vialMassMg: 1500, diluentMl: 3.2, concentrations: [], finalVolumeMl: 4 }]
	);
	assert.equal(facts.resolvedVolume?.diluentMl, 3.2);
	assert.equal(facts.resolvedVolume?.finalVolumeMl, 4);
	// 1500 mg / 4 mL — the 375 mg/mL the label's prose states for this vial.
	assert.equal(facts.resolvedVolume?.concentrationMgPerMl, 375);
});

test('several unlabeled volume columns are ambiguous and yield nothing', () => {
	const facts = parsePackageFacts('12345678901', null, 'POWDER, FOR SOLUTION', [], {
		dosage_and_administration_table: [
			'<table><tr><th>Vial</th><th>A</th><th>B</th></tr><tr><td>1 g</td><td>3 mL</td><td>4 mL</td></tr></table>'
		]
	});
	assert.deepEqual(facts.reconstitution, []);
});

test('reconstitution captures concentrations beside volumes and removes less informative duplicates', () => {
	const facts = parsePackageFacts('12345678901', null, 'POWDER, FOR SOLUTION', [], {
		dosage_and_administration: ['Reconstitute each vial with 20 mL. Add 20 mL.'],
		dosage_and_administration_table: [
			'<table><tr><th>Vial</th><th>Volume of diluent to be added</th><th>Approximate concentration</th></tr><tr><td>100 mg</td><td>20 mL</td><td>5 mg/mL paclitaxel</td></tr></table>'
		]
	});
	assert.deepEqual(
		facts.reconstitution.map(({ id: _id, ...row }) => row),
		[
			{
				vialMassMg: 100,
				diluentMl: 20,
				concentrations: [{ name: null, mgPerMl: 5 }],
				finalVolumeMl: null
			}
		]
	);
});

test('reconstitution retains every explicitly allowed solution volume', () => {
	const facts = parsePackageFacts('12345678901', null, 'POWDER, FOR SOLUTION', [], {
		dosage_and_administration_table: [
			'<table><tr><th>Vial</th><th>Volume of diluent to be added</th><th>Concentration</th></tr><tr><td>100 mg</td><td>20 mL</td><td>5 mg/mL</td></tr><tr><td>100 mg</td><td>40 mL</td><td>2.5 mg/mL</td></tr></table>'
		]
	});
	assert.deepEqual(
		facts.reconstitution.map((row) => [row.diluentMl, row.concentrations[0]?.mgPerMl]),
		[
			[20, 5],
			[40, 2.5]
		]
	);
});

const unknown: ActivityInput = {
	listed: null,
	marketingEndDate: null,
	rxcuiStatus: null,
	splPresent: null,
	isVeterinary: null
};
test('activity ladder distinguishes absence from outage and prefers FDA marketing evidence', () => {
	const now = new Date('2026-09-22T12:00:00Z');
	assert.equal(exclusionReason(unknown, now), null);
	assert.equal(exclusionReason({ ...unknown, listed: true, rxcuiStatus: 'RETIRED' }, now), null);
	assert.equal(
		exclusionReason({ ...unknown, listed: true, marketingEndDate: '20260921' }, now),
		'marketing-ended'
	);
	assert.equal(
		exclusionReason({ ...unknown, listed: true, marketingEndDate: '20260922' }, now),
		null
	);
	assert.equal(exclusionReason({ ...unknown, rxcuiStatus: 'OBSOLETE' }, now), 'rxnav-inactive');
	assert.equal(
		exclusionReason({ ...unknown, listed: false, splPresent: false, rxcuiStatus: 'OBSOLETE' }, now),
		'no-spl'
	);
	assert.equal(
		exclusionReason({ ...unknown, listed: false, splPresent: true, rxcuiStatus: 'OBSOLETE' }, now),
		'unlisted'
	);
	assert.equal(
		exclusionReason({ ...unknown, listed: false, splPresent: null, rxcuiStatus: 'OBSOLETE' }, now),
		'rxnav-inactive'
	);
	assert.equal(exclusionReason({ ...unknown, listed: false, splPresent: false }, now), 'no-spl');
	assert.equal(exclusionReason({ ...unknown, listed: true, splPresent: false }, now), null);
	// 61919-0428-30: unlisted, no siblings, SPL and RxNav still active.
	assert.equal(
		exclusionReason({ ...unknown, listed: false, splPresent: true, rxcuiStatus: 'ACTIVE' }, now),
		'unlisted'
	);
	// An inner package matched through a listed sibling stays on.
	assert.equal(
		exclusionReason(
			{ ...unknown, listed: false, splPresent: true, details: { packaging: { siblings: [{}] } } },
			now
		),
		null
	);
	assert.equal(exclusionReason({ ...unknown, listed: null, splPresent: false }, now), null);
	// 33358-0028-60 as stored: the directory found product 33358-0028 without this
	// package, DailyMed has no SPL, and RxNav still said ACTIVE. That is unlisted.
	assert.equal(
		exclusionReason(
			{ ...unknown, listed: null, productCode: '33358-0028', splPresent: false, rxcuiStatus: 'ACTIVE' },
			now
		),
		'no-spl'
	);
	assert.equal(directoryListed({ listed: null, productCode: '33358-0028' }), false);
	assert.equal(directoryListed({ listed: true, productCode: '33358-0028' }), true);
	assert.equal(directoryListed({ listed: null, productCode: null }), null);
	assert.equal(exclusionReason({ ...unknown, isVeterinary: true }, now), 'veterinary');
	// The end date applies without a directory answer, against RxNav's lagging ACTIVE.
	assert.equal(
		exclusionReason(
			{
				...unknown,
				listed: null,
				splPresent: false,
				rxcuiStatus: 'ACTIVE',
				marketingEndDate: '20260921'
			},
			now
		),
		'marketing-ended'
	);
	assert.equal(
		exclusionReason({ ...unknown, splPresent: true, marketingEndDate: '20260921' }, now),
		'marketing-ended'
	);
	assert.equal(
		exclusionReason({ ...unknown, rxcuiStatus: 'ACTIVE', marketingEndDate: '20260922' }, now),
		null
	);
	assert.equal(
		exclusionReason({ ...unknown, listed: false, splPresent: true, splInactivated: true }, now),
		'spl-inactivated'
	);
	assert.equal(
		inactivatedOnDailyMed('<td>72572-805-01</td> <td>(inactivated)</td>', ['72572-805-01']),
		true
	);
	assert.equal(
		inactivatedOnDailyMed('<td>172572-805-01 (inactivated)</td><td>72572-805-01</td>', [
			'72572-805-01'
		]),
		false
	);
});

test('persistent snapshots expire and parser changes invalidate cached results', () => {
	const now = new Date('2026-09-22T00:00:00Z');
	const snapshot = snapshotPackage(packageFixture(), now);
	assert.equal(isFresh(snapshot, now), true);
	assert.equal(isFresh(snapshot, new Date('2026-09-23T00:00:01Z')), false);
	assert.equal(readSnapshot({ ...snapshot, version: 'old-parser' }), null);
	assert.equal(readSnapshot(snapshot)?.version, CATALOG_VERSION);
	const partial = snapshotPackage(packageFixture({ complete: false }), now);
	assert.equal(isFresh(partial, new Date(now.getTime() + 6 * 60 * 1000)), false);
});

test('partial refresh preserves known data and later successful refresh corrects it', () => {
	const previous = packageFixture({ marketingEndDate: '20200101', isMultiDose: true });
	const partial = packageFixture({
		listed: null,
		description: null,
		ingredients: [],
		marketingEndDate: null,
		complete: false
	});
	const merged = mergePackage(previous, partial);
	assert.equal(merged.description, previous.description);
	assert.equal(merged.marketingEndDate, '20200101');
	assert.deepEqual(merged.ingredients, previous.ingredients);
	assert.equal(merged.complete, false);
	const updated = mergePackage(
		merged,
		packageFixture({ description: 'New description', marketingEndDate: null, isMultiDose: false })
	);
	assert.equal(updated.description, 'New description');
	assert.equal(updated.marketingEndDate, null);
	assert.equal(updated.isMultiDose, false);
});

test('strength parsing rejects partial matches and zero denominators', () => {
	assert.deepEqual(parseStrength('500 mg/5 mL'), {
		strengthNumMag: 500,
		strengthNumUom: 'mg',
		strengthDenMag: 5,
		strengthDenUom: 'mL'
	});
	assert.equal(parseStrength('500 mg/0 mL'), null);
	assert.equal(parseStrength('about 500 mg plus 3 mg'), null);
});

test('one ingestion run keeps the latest payload for each source native ID', () => {
	const evidence = [
		{ source: 'RxNav', nativeId: '123', url: 'https://example.test/old', payload: { v: 1 } },
		{
			source: 'DailyMed',
			nativeId: '123',
			url: 'https://example.test/dailymed',
			payload: { v: 1 }
		},
		{ source: 'RxNav', nativeId: '123', url: 'https://example.test/new', payload: { v: 2 } }
	];
	assert.deepEqual(uniqueRunEvidence(evidence), [evidence[2], evidence[1]]);
});

test('partial refresh resolves label evidence using retained ingredient masses', () => {
	const previous = packageFixture();
	const parsed = parsePackageFacts(
		previous.ndc,
		previous.description,
		previous.doseForm,
		previous.ingredients,
		{ dosage_and_administration: [reconstitutionText] }
	);
	const incoming = packageFixture({
		ingredients: [],
		reconstitution: parsed.reconstitution,
		resolvedVolume: null,
		complete: false
	});
	const merged = mergePackage(previous, incoming);
	assert.equal(merged.resolvedVolume?.finalVolumeMl, 180);
	const solution = mergePackage(
		{ ...previous, ...parsed },
		packageFixture({ isDryFill: false, doseForm: 'INJECTION, SOLUTION', complete: false })
	);
	assert.equal(solution.resolvedVolume, null);
});

test('a kit narrows the shared table by its powder mass and pre-measured diluent', () => {
	// Wilshire's vancomycin oral solution kit 52536-108-10: no listed
	// ingredients, one label tabulating all four kit sizes.
	const table =
		'<table ID="_Ref38297091" cellpadding="3.6pt" width="75%"><caption>Table 1: Vancomycin Concentration and Volume after Reconstitution</caption><col width="21%"/><col width="21%"/><col width="21%"/><col width="21%"/><thead><tr><th align="left" styleCode="Botrule " valign="middle"><content styleCode="bold">Vancomycin Concentration after Reconstitution</content></th><th align="left" styleCode="Botrule " valign="middle"><content styleCode="bold">Final Volume of Vancomycin Hydrochloride after Reconstitution</content></th><th align="left" styleCode="Botrule " valign="middle"><content styleCode="bold">Vancomycin Strength per Bottle</content></th><th align="left" styleCode="Botrule " valign="middle"><content styleCode="bold">Diluent for Vancomycin Hydrochloride</content></th></tr></thead><tbody><tr><td styleCode="Toprule " valign="top"><paragraph>25 mg/mL</paragraph></td><td styleCode="Toprule " valign="top"><paragraph>150 mL</paragraph></td><td styleCode="Toprule " valign="top"><paragraph>3.75 g</paragraph></td><td styleCode="Toprule " valign="top"><paragraph>147 mL</paragraph></td></tr><tr><td styleCode="Botrule " valign="top"/><td styleCode="Botrule " valign="top"><paragraph>300 mL</paragraph></td><td styleCode="Botrule " valign="top"><paragraph>7.5 g</paragraph></td><td styleCode="Botrule " valign="top"><paragraph>295 mL</paragraph></td></tr><tr><td styleCode="Toprule " valign="top"><paragraph>50 mg/mL</paragraph></td><td styleCode="Toprule " valign="top"><paragraph>150 mL</paragraph></td><td styleCode="Toprule " valign="top"><paragraph>7.5 g</paragraph></td><td styleCode="Toprule " valign="top"><paragraph>145 mL</paragraph></td></tr><tr><td valign="top"/><td valign="top"><paragraph>300 mL</paragraph></td><td valign="top"><paragraph>15.0 g</paragraph></td><td valign="top"><paragraph>289 mL</paragraph></td></tr></tbody></table>';
	const facts = parsePackageFacts(
		'52536-108-10',
		'1 KIT in 1 CARTON (52536-108-10)  *  15 g in 1 BOTTLE (52536-098-10)  *  289 mL in 1 BOTTLE (52536-088-10)',
		'KIT',
		[],
		{ dosage_and_administration_table: [table] }
	);
	assert.deepEqual(
		facts.reconstitution.map((row) => [row.vialMassMg, row.diluentMl, row.finalVolumeMl]),
		[[15000, 289, 300]]
	);
	assert.deepEqual(
		facts.reconstitution[0].concentrations.map((c) => c.mgPerMl),
		[50]
	);
});

test('a row that names no vial mass takes the package ingredient strength as its vial content', () => {
	const facts = parsePackageFacts(
		'66621079002',
		'1 VIAL in 1 CARTON (66621-0790-2) / 10 mL in 1 VIAL (66621-0790-1)',
		'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION',
		[{ name: 'PIT VIPER (CROTALINAE) IMMUNE GLOBULIN ANTIVENIN (EQUINE)', strength: '120 mg' }],
		{
			dosage_and_administration: [
				'Reconstitute the contents of each vial with 10 mL of sterile normal saline.'
			]
		}
	);
	assert.equal(facts.reconstitution.length, 1);
	assert.equal(facts.reconstitution[0].vialMassMg, 120);
});

test('a w/v percent is worked into a mass over the container volume', async () => {
	const { ingredientMassMg } = await import('../ingredient-content');
	assert.equal(ingredientMassMg('1 %', 20), 200);
	assert.equal(ingredientMassMg('0.5% w/v', 10), 50);
	assert.equal(ingredientMassMg('12 g/60mL', null), 12000);
	assert.equal(ingredientMassMg('1 %', null), null);
	assert.equal(ingredientMassMg('100 [iU]', 10), null);
});
