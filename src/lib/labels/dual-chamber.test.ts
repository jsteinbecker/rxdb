import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dualChamber } from './dual-chamber';

type Sections = Record<string, string>;
const pkg = (
	ndc: string,
	description: string,
	container: string,
	sections: Sections,
	vialMassMg: number | null = null
) => ({
	ndc,
	description,
	size: { kind: 'volume' as const, unit: 'mL', value: 50, packQty: 24, container },
	reconstitution: vialMassMg === null ? [] : [{ vialMassMg }],
	details: {
		label: {
			effectiveTime: null,
			version: null,
			setId: null,
			sections: Object.entries(sections).map(([key, text]) => ({ key, title: key, text }))
		}
	}
});

// B. Braun's ceftriaxone DUPLEX label, abridged: two strengths on one label,
// each with its own dextrose concentration.
const duplex: Sections = {
	dosage_forms_and_strengths:
		'3 DOSAGE FORMS AND STRENGTHS Dual-chamber, single-dose container: 1 g ceftriaxone for injection and 50 mL of 3.74% dextrose injection 2 g ceftriaxone for injection and 50 mL of 2.22% dextrose injection',
	description:
		'The DUPLEX® Container is a flexible dual chamber container. The diluent chamber contains Dextrose Injection.',
	how_supplied: 'NDC REF Dose Volume 0264-3153-11 3153-11 1 g 50 mL 0264-3155-11 3155-11 2 g 50 mL',
	clinical_pharmacology: 'Ceftriaxone follows a two-compartment model.'
};

test('a DUPLEX bag is a dual-chamber container holding its strength’s diluent', () => {
	const one = dualChamber(pkg('00264315311', '50 mL in 1 CONTAINER', 'CONTAINER', duplex, 1000));
	assert.equal(one?.system, 'DUPLEX');
	assert.equal(one?.container, 'bag');
	assert.equal(one?.diluent, '3.74% dextrose injection');
	assert.equal(one?.diluentMl, 50);
	const two = dualChamber(pkg('00264315511', '50 mL in 1 CONTAINER', 'CONTAINER', duplex, 2000));
	assert.equal(two?.diluent, '2.22% dextrose injection');
});

test('a How Supplied row names the diluent of its own NDC', () => {
	const sections = {
		description:
			'The DUPLEX ® Container is a flexible dual chamber container. The diluent chamber contains 225 mg of sodium chloride and 50 mL of water for injection.',
		how_supplied:
			'Strength Volume of Diluent NDC 2.25 g 2 g 0.25 g 50 mL of 0.45% Sodium Chloride 0264- 3446-11 9.6 mEq 3.375 g 3 g 0.375 g 50 mL of 0.3% Sodium Chloride 0264- 3448-11 11.1 mEq'
	};
	assert.equal(
		dualChamber(pkg('00264344811', '50 mL in 1 CONTAINER', 'CONTAINER', sections))?.diluent,
		'0.3% sodium chloride'
	);
});

test('the diluent chamber sentence supplies a concentration the pairing leaves out', () => {
	const sections = {
		dosage_forms_and_strengths:
			'Single-dose DUPLEX ® (Dual-chamber) container: 500 mg meropenem for injection USP (as a blend of sterile meropenem trihydrate USP and sterile sodium carbonate USP/NF) and 50 mL of sodium chloride injection USP',
		how_supplied:
			'The diluent chamber contains approximately 50 mL of 0.9% Sodium Chloride Injection USP. After reconstitution'
	};
	assert.equal(
		dualChamber(pkg('00264318311', '50 mL in 1 CONTAINER', 'CONTAINER', sections, 500))?.diluent,
		'0.9% sodium chloride injection'
	);
});

test('a vial on a label that also covers a dual-chamber vial is matched only by its own NDC', () => {
	const sections = {
		how_supplied:
			'Single-dose vials: 40 mg NDC 0009-0039-28. Act-O-Vial System (single-dose vial with diluent chamber): 125 mg NDC 0009-0047-22.'
	};
	assert.equal(dualChamber(pkg('00009003928', '1 VIAL in 1 CARTON', 'VIAL', sections)), null);
	const actOVial = dualChamber(pkg('00009004722', '1 VIAL in 1 CARTON', 'VIAL', sections));
	assert.equal(actOVial?.system, 'Act-O-Vial');
	assert.equal(actOVial?.container, 'vial');
});

test('separate vial-and-bag systems and pharmacokinetic compartments are not dual-chamber', () => {
	const addVantage = {
		how_supplied:
			'ADD-Vantage vials are to be used with ADD-Vantage flexible diluent containers. NDC 0409-2689-01'
	};
	assert.equal(dualChamber(pkg('00409268901', '1 VIAL in 1 CARTON', 'VIAL', addVantage)), null);
	const model = {
		description: 'Elimination fits a two-compartment model with a terminal half-life of 8 hours.'
	};
	assert.equal(dualChamber(pkg('00409268901', '50 mL in 1 BAG', 'BAG', model)), null);
});
