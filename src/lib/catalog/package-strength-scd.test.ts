import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { correctedIngredients, liquidConcentration, packageStrengthText, scdShownStrength } from './package-title';
import { routeCode } from '../labels/route-code';

const spl = (name: string, strength: string, basis = 'ingredient') => ({
	kind: 'active',
	name,
	strength,
	basis,
	moieties: [{ name }]
});

// 00641-6285-01: the label codes 2.5 mg per 10 mL vial; the SCD says 0.25 MG/ML.
const bumetanide = {
	ndc: '00641628501',
	doseForm: 'INJECTION, SOLUTION',
	isDryFill: false,
	size: { kind: 'volume' as const, value: 10, unit: 'mL', container: 'VIAL', packQty: 1 },
	ingredients: [{ name: 'BUMETANIDE', strength: '.25 mg/mL' }],
	details: {
		rxnav: { conceptName: 'bumetanide 0.25 MG/ML Injectable Solution' },
		spl: { ingredients: [spl('BUMETANIDE', '2.5 mg')] }
	}
};

describe('a per-mL liquid shows the SCD strength', () => {
	it('restates the container total per mL', () => {
		const [active] = correctedIngredients(bumetanide);
		assert.equal(active.strength, '0.25 MG/ML');
		assert.equal(packageStrengthText(bumetanide), 'bumetanide 0.25 mg/mL');
	});
	it('shows the SCD figure over the label total in the ingredient table', () => {
		assert.equal(scdShownStrength(bumetanide, spl('BUMETANIDE', '2.5 mg')), '0.25 MG/ML');
	});
	it('summarizes concentration and fill for the reconstitution section', () => {
		assert.deepEqual(liquidConcentration(bumetanide), {
			volumeMl: 10,
			actives: [{ name: 'bumetanide', concentration: '0.25 mg/mL', total: '2.5 mg' }]
		});
	});
});

describe('a dry-fill powder keeps its vial content', () => {
	// Ampicillin 1 g vial: the SCD states the vial amount; no fill volume to divide by.
	const ampicillin = {
		ndc: '00000000001',
		doseForm: 'INJECTION, POWDER, FOR SOLUTION',
		isDryFill: true,
		size: { kind: 'volume' as const, value: 10, unit: 'mL', container: 'VIAL', packQty: 1 },
		details: {
			rxnav: { conceptName: 'ampicillin 1000 MG Injection' },
			spl: { ingredients: [spl('AMPICILLIN SODIUM', '1 g', 'moiety')] }
		}
	};
	it('is not divided by a vial volume or summarized as ready to use', () => {
		assert.doesNotMatch(correctedIngredients(ampicillin)[0].strength ?? '', /\/\s*mL/i);
		assert.equal(liquidConcentration(ampicillin), null);
	});
});

describe('a solid keeps its per-unit strength', () => {
	const tablet = {
		ndc: '00000000002',
		doseForm: 'TABLET',
		isDryFill: false,
		size: { kind: 'count' as const, value: 100, unit: 'TABLET', container: 'BOTTLE', packQty: 1 },
		details: {
			rxnav: { conceptName: 'bumetanide 1 MG Oral Tablet' },
			spl: { ingredients: [spl('BUMETANIDE', '1 mg/1')] }
		}
	};
	it('shows no denominator and no liquid summary', () => {
		assert.equal(packageStrengthText(tablet), 'bumetanide 1 mg');
		assert.equal(scdShownStrength(tablet, spl('BUMETANIDE', '1 mg/1')), null);
		assert.equal(liquidConcentration(tablet), null);
	});
});

describe('route codes', () => {
	it('are joined with a separator', () => {
		assert.equal(['INTRAMUSCULAR', 'INTRAVENOUS'].map(routeCode).join(' · '), 'IM · IV');
	});
});
