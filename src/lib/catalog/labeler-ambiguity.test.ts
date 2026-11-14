import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectivePackage } from './effective-package';
import { packageFixture } from '../server/testing/package-fixture';
import { buildAmbiguityOverrides } from '../server/curation/override-citation';
import { ambiguityKindsFor } from './labeler-ambiguity';

const item = packageFixture({
	splSetId: '11111111-1111-1111-1111-111111111111',
	details: {
		label: {
			sections: [
				{
					key: 'dosage_and_administration',
					title: 'Dosage and administration',
					text: 'Add 152 mL of diluent. Final volume 180 mL.',
					blocks: []
				}
			]
		},
		spl: {
			ingredients: [{ name: 'PIPERACILLIN SODIUM', kind: 'active', strength: '36 g' }]
		}
	} as never
});
const spl = {
	source: 'spl' as const,
	passages: [
		{
			sectionKey: 'dosage_and_administration',
			excerpt: 'Final volume 180 mL',
			subsectionTitle: '',
			startOffset: 24,
			endOffset: 43
		}
	]
};
const now = new Date('2026-09-30T00:00:00.000Z');

test('each ambiguity is offered only at the fields it can explain', () => {
	assert.deepEqual(ambiguityKindsFor('details.spl.ingredients.0.strength'), ['salt-basis']);
	assert.deepEqual(ambiguityKindsFor('resolvedVolume.finalVolumeMl'), [
		'diluent-as-final',
		'capacity-as-final'
	]);
	assert.deepEqual(ambiguityKindsFor('brandName'), []);
});

test('a volume ambiguity also fixes how the labeled volume is read', () => {
	const overrides = buildAmbiguityOverrides(
		item,
		'resolvedVolume.finalVolumeMl',
		'180',
		'capacity-as-final',
		' vial is a 250 mL bag ',
		spl,
		now
	);
	assert.deepEqual(Object.keys(overrides).sort(), [
		'resolvedVolume.finalVolumeMl',
		'resolvedVolume.meaning'
	]);
	for (const override of Object.values(overrides))
		assert.deepEqual(override.ambiguity, {
			kind: 'capacity-as-final',
			note: 'vial is a 250 mL bag'
		});
	const applied = resolveEffectivePackage({ ...item, propertyOverrides: overrides });
	assert.equal(applied.resolvedVolume?.meaning, 'capacity');
	assert.equal(applied.resolvedVolume?.finalVolumeMl, 180);
});

test('a salt-basis correction overrides only the strength it names', () => {
	const key = 'details.spl.ingredients.0.strength';
	const overrides = buildAmbiguityOverrides(item, key, '34 g', 'salt-basis', '', spl, now);
	assert.deepEqual(Object.keys(overrides), [key]);
	assert.equal(overrides[key].ambiguity?.note, null);
});

test('an ambiguity is refused at a field it does not explain, or with an NDC citation', () => {
	assert.throws(
		() => buildAmbiguityOverrides(item, 'brandName', 'X', 'salt-basis', '', spl, now),
		/does not apply/
	);
	assert.throws(
		() =>
			buildAmbiguityOverrides(
				item,
				'resolvedVolume.finalVolumeMl',
				'180',
				'capacity-as-final',
				'',
				{ source: 'ndc', ndc: '1' },
				now
			),
		/SPL or an outside source/
	);
	assert.throws(
		() =>
			buildAmbiguityOverrides(
				item,
				'resolvedVolume.finalVolumeMl',
				'x',
				'capacity-as-final',
				'',
				spl,
				now
			),
		/valid value/
	);
});
