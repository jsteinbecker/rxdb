import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pseudoScdFor, type PseudoScdSource } from './pseudo-scd';

const vanco = (
	strength: string,
	size: PseudoScdSource['size'],
	conceptName = 'vancomycin 100 MG/ML Injectable Solution',
	extra: Partial<PseudoScdSource> = {}
): PseudoScdSource => ({
	isDryFill: true,
	ingredients: [{ name: 'VANCOMYCIN HYDROCHLORIDE', strength }],
	size,
	details: { rxnav: { rxcui: '239209', conceptName } },
	...extra
});

const bottle = (value: number) =>
	({ kind: 'volume', value, unit: 'mL', container: 'BOTTLE', packQty: 1 }) as const;

test('a per-vial bulk strength becomes a content pseudo-SCD', () => {
	const pseudo = pseudoScdFor(
		vanco('10 g/1', { kind: 'count', value: 1, unit: null, container: 'VIAL', packQty: 1 })
	);
	assert.equal(pseudo?.name, 'vancomycin 10000 MG Injection (Bulk)');
	assert.equal(pseudo?.key, 'vancomycin 10000 mg|injection|bulk');
	assert.equal(pseudo?.fromRxcui, '239209');
});

test('a concentration scales by the labeled volume, whatever diluent the labeler chose', () => {
	// 500 mg/10 mL in a 100 mL vial and 5 g/100 mL are both the 5 g vial.
	const a = pseudoScdFor(
		vanco('500 mg/10mL', bottle(100), 'vancomycin 50 MG/ML Injectable Solution')
	);
	const b = pseudoScdFor(
		vanco('5 g/100mL', bottle(100), 'vancomycin 50 MG/ML Injectable Solution')
	);
	assert.equal(a?.name, 'vancomycin 5000 MG Injection (Bulk)');
	assert.equal(a?.key, b?.key);
	// A 10 g vial reconstituted to 95 mL is still the 10 g vial.
	assert.equal(
		pseudoScdFor(vanco('10 g/95mL', bottle(95)))?.name,
		'vancomycin 10000 MG Injection (Bulk)'
	);
});

test('a salt mass snaps to the moiety vial the label names', () => {
	const pseudo = pseudoScdFor(
		vanco(
			'5.13 g/g',
			{ kind: 'mass', value: 5, unit: 'g', container: 'VIAL, PHARMACY BULK PACKAGE', packQty: 1 },
			undefined,
			{ reconstitution: [{ vialMassMg: 5000 }] }
		)
	);
	assert.equal(pseudo?.name, 'vancomycin 5000 MG Injection (Bulk)');
});

test('combinations keep each ingredient content', () => {
	const pseudo = pseudoScdFor({
		isDryFill: true,
		ingredients: [
			{ name: 'AMPICILLIN SODIUM', strength: '10 g/1' },
			{ name: 'SULBACTAM SODIUM', strength: '5 g/1' }
		],
		size: { kind: 'count', value: 1, unit: null, container: 'VIAL', packQty: 1 },
		details: {
			rxnav: {
				rxcui: '1',
				conceptName: 'ampicillin 100 MG/ML / sulbactam 50 MG/ML Injectable Solution'
			}
		}
	});
	assert.equal(pseudo?.name, 'ampicillin 10000 MG / sulbactam 5000 MG Injection (Bulk)');
});

test('packages RxNorm already quantifies, or whose content is ambiguous, stay put', () => {
	// Unit-dose content concept.
	assert.equal(pseudoScdFor(vanco('1 g/1', null, 'vancomycin 1000 MG Injection')), null);
	// Not a dry fill.
	assert.equal(
		pseudoScdFor(vanco('5 g/100mL', bottle(100), undefined, { isDryFill: false })),
		null
	);
	// A bare mass beside a labeled volume could be per vial or per dose.
	assert.equal(pseudoScdFor(vanco('500 mg', bottle(100))), null);
	// A concentration with no volume to scale by.
	assert.equal(pseudoScdFor(vanco('500 mg/10mL', null)), null);
	// No directory strength.
	assert.equal(pseudoScdFor({ ...vanco('', bottle(100)), ingredients: [] }), null);
	// Oral solutions are not vials.
	assert.equal(
		pseudoScdFor(vanco('5 g/100mL', bottle(100), 'vancomycin 50 MG/ML Oral Solution')),
		null
	);
});

test('a quantified RxNorm concept is already stated by content, so it stays put', () => {
	// Merck Keytruda 0006-3026-02: `4 ML pembrolizumab 25 MG/ML Injection [Keytruda]`.
	assert.equal(
		pseudoScdFor({
			isDryFill: true,
			ingredients: [{ name: 'PEMBROLIZUMAB', strength: '25 mg/mL' }],
			size: { kind: 'volume', value: 4, unit: 'mL', container: 'VIAL', packQty: 1 },
			details: {
				rxnav: { rxcui: '1657751', conceptName: '4 ML pembrolizumab 25 MG/ML Injection [Keytruda]' }
			}
		}),
		null
	);
});

test('an unlisted NDC reads its content from the label ingredients', () => {
	// Hospira 0409-5017: not in the FDA directory, so `ingredients` is empty and
	// the label's `500 mg/5 mL` in a 100 mL bulk vial is the 10 g vial.
	const pseudo = pseudoScdFor({
		...vanco('', bottle(100)),
		ingredients: [],
		details: {
			rxnav: { rxcui: '239209', conceptName: 'vancomycin 100 MG/ML Injectable Solution' },
			spl: {
				ingredients: [
					{ name: 'VANCOMYCIN HYDROCHLORIDE', kind: 'active', strength: '500 mg/5 mL' },
					{ name: 'HYDROCHLORIC ACID', kind: 'inactive', strength: null }
				]
			}
		},
		reconstitution: [{ vialMassMg: 10000 }]
	});
	assert.equal(pseudo?.name, 'vancomycin 10000 MG Injection (Bulk)');
});
