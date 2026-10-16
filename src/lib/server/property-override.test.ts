import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPropertyOverrides } from './apply-property-overrides';
import { mergePackage } from './catalog-cache';
import { packageFixture } from './catalog-test-fixtures';
import {
	type EquivalentPackage,
	equivalentValues,
	isProductLevelKey,
	overrideTargets,
	validOverrideValue
} from '../property-override-fields';
import { citeOverride, readCitationInput } from './override-citation';

const cited = (value: string) => ({
	value,
	excerpt: 'Add 152 mL of diluent.',
	sectionKey: 'dosage_and_administration',
	sectionTitle: 'Dosage and administration',
	subsectionTitle: 'Reconstitution',
	splSetId: '11111111-1111-1111-1111-111111111111',
	createdAt: '2026-09-28T00:00:00.000Z'
});

test('reconstitution and resolved-volume overrides are typed and survive provider refresh', () => {
	const original = packageFixture({
		reconstitution: [
			{
				vialMassMg: 40500,
				diluentMl: 150,
				finalVolumeMl: 180,
				concentrations: [{ name: null, mgPerMl: 225 }]
			}
		],
		resolvedVolume: {
			meaning: 'diluent',
			diluentMl: 150,
			finalVolumeMl: 180,
			concentrationMgPerMl: 225
		},
		propertyOverrides: {
			'reconstitution.0.diluentMl': cited('152'),
			'resolvedVolume.finalVolumeMl': cited('180'),
			'resolvedVolume.powderDisplacementMl': cited('28'),
			'resolvedVolume.concentrationMgPerMl': cited('225')
		}
	});
	assert.ok(
		overrideTargets(original).some(
			(target) => target.key === 'reconstitution.0.concentrations.0.mgPerMl'
		)
	);
	assert.equal(validOverrideValue('reconstitution.0.diluentMl', 'bad'), false);
	const applied = applyPropertyOverrides(original);
	assert.equal(applied.reconstitution[0].diluentMl, 152);
	assert.equal(applied.resolvedVolume?.powderDisplacementMl, 28);
	const refreshed = mergePackage(
		applied,
		packageFixture({ reconstitution: original.reconstitution })
	);
	assert.equal(refreshed.reconstitution[0].diluentMl, 152);
	assert.equal(refreshed.resolvedVolume?.concentrationMgPerMl, 225);
});

test('outside-source overrides need a web address and a quoted passage', () => {
	const item = packageFixture();
	const now = new Date('2026-09-28T00:00:00.000Z');
	const cite = (url: string, excerpt: string) =>
		citeOverride(
			item,
			'brandName',
			'Zosyn',
			{ source: 'url', url, title: '  PI  ', excerpt },
			[],
			now
		);
	assert.deepEqual(cite('https://example.com/pi.pdf', ' Brand:\n Zosyn '), {
		value: 'Zosyn',
		source: 'url',
		url: 'https://example.com/pi.pdf',
		title: 'PI',
		excerpt: 'Brand: Zosyn',
		createdAt: now.toISOString()
	});
	assert.throws(() => cite('example.com', 'Zosyn'), /full address/);
	assert.throws(() => cite('javascript:alert(1)', 'Zosyn'), /http or https/);
	assert.throws(() => cite('https://example.com', '  '), /Quote the passage/);
});

test('equivalent-NDC overrides copy exactly what the equivalent lists', () => {
	const item = packageFixture({
		reconstitution: [{ id: 'raaaaaaaa', vialMassMg: 40500, diluentMl: 150, concentrations: [] }]
	});
	// Worded differently, so the row's content id differs; matched by position.
	const sibling = packageFixture({
		ndc: '25021018102',
		description: '10 VIAL in 1 CARTON',
		brandName: null,
		reconstitution: [{ id: 'rbbbbbbbb', vialMassMg: 40500, diluentMl: 152, concentrations: [] }]
	});
	const values = equivalentValues(item, sibling);
	assert.equal(values['reconstitution.raaaaaaaa.diluentMl'], '152');
	assert.equal(values.brandName, undefined);
	const equivalents: EquivalentPackage[] = [
		{
			ndc: sibling.ndc,
			relation: 'sibling',
			description: sibling.description,
			labelerName: null,
			values
		}
	];
	const override = citeOverride(
		item,
		'reconstitution.raaaaaaaa.diluentMl',
		'152',
		{ source: 'ndc', ndc: sibling.ndc },
		equivalents
	);
	assert.equal(override.source, 'ndc');
	assert.equal(
		applyPropertyOverrides({
			...item,
			propertyOverrides: { 'reconstitution.raaaaaaaa.diluentMl': override }
		}).reconstitution[0].diluentMl,
		152
	);
	assert.throws(
		() =>
			citeOverride(
				item,
				'reconstitution.raaaaaaaa.diluentMl',
				'153',
				{ source: 'ndc', ndc: sibling.ndc },
				equivalents
			),
		/does not list this value/
	);
	assert.throws(
		() => citeOverride(item, 'brandName', 'X', { source: 'ndc', ndc: '99999999999' }, equivalents),
		/equivalent/
	);
});

test('overrides add and remove reconstitution rows and correct ingredient strengths', () => {
	const base = packageFixture({
		reconstitution: [
			{ id: 'raaaaaaaa', vialMassMg: 1000, diluentMl: 10, concentrations: [] },
			{ id: 'rbbbbbbbb', vialMassMg: 1000, diluentMl: 3.5, concentrations: [] }
		]
	});
	const item = {
		...base,
		details: {
			...base.details!,
			spl: {
				...base.details?.spl,
				ingredients: [
					{
						name: 'Cefazolin sodium',
						unii: null,
						kind: 'active' as const,
						basis: null,
						strength: '1 g',
						moieties: [],
						productCode: null
					}
				]
			}
		}
	} as typeof base;
	const keys = overrideTargets(item).map((target) => target.key);
	assert.ok(keys.includes('reconstitution.a0.diluentMl'));
	assert.ok(keys.includes('reconstitution.rbbbbbbbb.removed'));
	assert.ok(keys.includes('reconstitution.raaaaaaaa.concentrations.0.mgPerMl'));
	assert.ok(keys.includes('details.spl.ingredients.0.strength'));
	assert.equal(validOverrideValue('reconstitution.rbbbbbbbb.removed', 'yes'), false);

	const applied = applyPropertyOverrides({
		...item,
		propertyOverrides: {
			'reconstitution.a0.diluentMl': cited('5'),
			'reconstitution.a0.vialMassMg': cited('500'),
			'reconstitution.raaaaaaaa.concentrations.0.mgPerMl': cited('95'),
			'reconstitution.rbbbbbbbb.removed': cited('true'),
			'details.spl.ingredients.0.strength': cited('2 g')
		}
	});
	assert.deepEqual(
		applied.reconstitution.map((row) => [row.id, row.diluentMl, row.vialMassMg]),
		[
			['raaaaaaaa', 10, 1000],
			['a0', 5, 500]
		]
	);
	assert.equal(applied.reconstitution[0].concentrations[0].mgPerMl, 95);
	assert.equal(applied.details?.spl?.ingredients[0].strength, '2 g');
	// Reapplying to the stored result is stable, and the next new row takes a1.
	assert.equal(applyPropertyOverrides(applied).reconstitution.length, 2);
	assert.ok(
		overrideTargets(applied).some((target) => target.key === 'reconstitution.a1.diluentMl')
	);
});

test('dropping an override restores the provider value and keeps the others', () => {
	const original = packageFixture({
		propertyOverrides: { description: cited('Edited'), doseForm: cited('SOLUTION') }
	});
	const applied = applyPropertyOverrides(original);
	const remaining = { doseForm: original.propertyOverrides!.doseForm };
	const restored = mergePackage(
		{ ...applied, propertyOverrides: remaining },
		packageFixture({ propertyOverrides: undefined })
	);
	assert.equal(restored.description, packageFixture().description);
	assert.equal(restored.doseForm, 'SOLUTION');
});

test('product-level fields are told apart from package-specific ones', () => {
	assert.ok(isProductLevelKey('details.spl.appearances.0.iln'));
	assert.ok(isProductLevelKey('details.spl.appearances.1.colors'));
	assert.ok(isProductLevelKey('details.spl.ingredients.0.strength'));
	assert.ok(isProductLevelKey('brandName'));
	assert.ok(!isProductLevelKey('description'));
	assert.ok(!isProductLevelKey('size.packQty'));
	assert.ok(!isProductLevelKey('reconstitution.0.diluentMl'));
	assert.ok(!isProductLevelKey('marketingEndDate'));
});

test('an SPL citation may quote several passages, each checked against its section', () => {
	const item = packageFixture({
		splSetId: '11111111-1111-1111-1111-111111111111',
		details: {
			label: {
				sections: [
					{ key: 'description', title: 'Description', text: 'Brand: Zosyn vials.', blocks: [] },
					{ key: 'how_supplied', title: 'How supplied', text: 'Zosyn is supplied in cartons.', blocks: [] }
				]
			}
		} as never
	});
	const now = new Date('2026-10-15T00:00:00.000Z');
	const passage = (sectionKey: string, excerpt: string, startOffset: number) => ({
		sectionKey,
		excerpt,
		subsectionTitle: '',
		startOffset,
		endOffset: startOffset + excerpt.length
	});
	const override = citeOverride(
		item,
		'brandName',
		'Zosyn',
		{
			source: 'spl',
			passages: [passage('description', 'Brand: Zosyn', 11), passage('how_supplied', 'Zosyn is supplied', 12)]
		},
		[],
		now
	);
	assert.equal(override.source, 'spl');
	if (override.source === 'spl' || override.source === undefined) {
		assert.equal(override.excerpt, 'Brand: Zosyn');
		assert.equal(override.sectionTitle, 'Description');
		assert.deepEqual(
			override.passages?.map((cited) => [cited.sectionTitle, cited.excerpt]),
			[
				['Description', 'Brand: Zosyn'],
				['How supplied', 'Zosyn is supplied']
			]
		);
	}
	assert.throws(
		() =>
			citeOverride(
				item,
				'brandName',
				'Zosyn',
				{ source: 'spl', passages: [passage('description', 'Brand: Zosyn', 11), passage('how_supplied', 'Not there', 12)] },
				[],
				now
			),
		/exact excerpt/
	);
	assert.throws(
		() => citeOverride(item, 'brandName', 'Zosyn', { source: 'spl', passages: [] }, [], now),
		/Highlight/
	);
});

test('the override form sends SPL passages as JSON, or one passage as the older fields', () => {
	const form = new FormData();
	form.set('source', 'spl');
	form.set(
		'passages',
		JSON.stringify([
			{ sectionKey: 'a', excerpt: 'x', subsectionTitle: '', startOffset: 1, endOffset: 2 },
			{ sectionKey: 'b', excerpt: 'y', subsectionTitle: 'Sub', startOffset: 3, endOffset: 4 }
		])
	);
	const read = readCitationInput(form);
	assert.equal(read?.source, 'spl');
	assert.deepEqual(read?.source === 'spl' && read.passages.map((passage) => passage.sectionKey), ['a', 'b']);
	form.set('passages', 'not json');
	assert.equal(readCitationInput(form), null);
	const legacy = new FormData();
	for (const [name, value] of Object.entries({ sectionKey: 'a', excerpt: 'x', startOffset: '1', endOffset: '2' }))
		legacy.set(name, value);
	assert.deepEqual(readCitationInput(legacy), {
		source: 'spl',
		passages: [{ sectionKey: 'a', excerpt: 'x', subsectionTitle: '', startOffset: 1, endOffset: 2 }]
	});
});

test('a whole table row can be cited as its cells’ text', () => {
	const cell = (text: string) => ({ runs: [{ text }], header: false });
	const item = packageFixture({
		splSetId: '11111111-1111-1111-1111-111111111111',
		details: {
			label: {
				sections: [
					{
						key: 'dosage_and_administration',
						title: 'Dosage and administration',
						text: '',
						blocks: [
							{
								type: 'table',
								caption: 'Table 1',
								head: [[cell('Infection'), cell('Dose')]],
								body: [
									[cell('Severe'), cell('875 mg every 12 hours')],
									[cell('Less severe'), cell('500 mg every 12 hours')]
								],
								foot: []
							}
						]
					}
				]
			}
		} as never
	});
	const override = citeOverride(
		item,
		'brandName',
		'Zosyn',
		{
			source: 'spl',
			passages: [
				{
					sectionKey: 'dosage_and_administration',
					excerpt: 'Less severe 500 mg every 12 hours',
					subsectionTitle: '',
					startOffset: 60,
					endOffset: 92
				}
			]
		},
		[]
	);
	assert.equal(override.source, 'spl');
});
