import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { localConceptDraft } from './local-concept-draft.ts';
import { ingredientDisplayName, type LocalIngredient } from './local-concept.ts';
import { parseLocalConceptInput } from './local-concept-input.ts';
import type { ExternalPackage } from '../catalog/types';

// The latest cache snapshot for NDC 00264193310 (TrophAmine 10%, 500 mL),
// trimmed to the fields the draft reads.
const fixture = (): ExternalPackage =>
	JSON.parse(
		readFileSync(new URL('../server/fixtures/trophamine-0264193310.json', import.meta.url), 'utf8')
	) as ExternalPackage;

const bySubstance = (rows: LocalIngredient[], name: string) => {
	const row = rows.find((r) => r.substanceName === name);
	assert.ok(row, `no row for ${name}`);
	return row;
};

const mgPerMl = (row: LocalIngredient) => {
	assert.equal(row.strengthNumUom, 'MG');
	assert.equal(row.strengthDenMag, '1');
	assert.equal(row.strengthDenUom, 'ML');
	return row.strengthNumMag;
};

describe('localConceptDraft (TrophAmine 10%)', () => {
	const { input, warnings } = localConceptDraft(fixture());
	const rows = input.ingredients;

	it('has one row per active SPL ingredient, and no salts or acetic acid', () => {
		assert.equal(rows.length, 20);
		for (const row of rows) {
			assert.doesNotMatch(row.substanceName, /SODIUM|SULFITE|ACETIC ACID/i);
		}
	});

	it('takes leucine as labeled, divided by the package volume', () => {
		const leucine = bySubstance(rows, 'LEUCINE');
		assert.equal(leucine.basis, 'as_labeled');
		assert.equal(leucine.substanceUnii, 'GMW67QNF9C');
		assert.equal(mgPerMl(leucine), '14');
	});

	it('puts lysine acetate on a lysine basis from the directory strength', () => {
		const lysine = bySubstance(rows, 'LYSINE ACETATE');
		assert.equal(lysine.basis, 'active_moiety');
		assert.equal(lysine.substanceUnii, 'TTL6G7LIWZ');
		assert.equal(lysine.moietyName, 'LYSINE');
		assert.equal(lysine.moietyUnii, 'K3Z4F929H6');
		assert.equal(mgPerMl(lysine), '8.51');
		assert.equal(ingredientDisplayName(lysine), 'lysine');
	});

	it('puts cysteine hydrochloride on a cysteine basis', () => {
		const cysteine = bySubstance(rows, 'CYSTEINE HYDROCHLORIDE');
		assert.equal(cysteine.basis, 'active_moiety');
		assert.equal(cysteine.moietyName, 'CYSTEINE');
		assert.equal(cysteine.moietyUnii, 'K848JZ4886');
		assert.equal(mgPerMl(cysteine), '0.166');
	});

	it('keeps tyrosine and N-acetyl-L-tyrosine as two rows', () => {
		const tyrosine = bySubstance(rows, 'TYROSINE');
		assert.equal(tyrosine.basis, 'as_labeled');
		assert.equal(mgPerMl(tyrosine), '0.44');
		const nat = bySubstance(rows, 'ACETYL L-TYROSINE');
		assert.equal(nat.basis, 'as_labeled');
		assert.equal(nat.substanceUnii, 'DA8G610ZO5');
		assert.equal(nat.moietyUnii, null);
		assert.equal(mgPerMl(nat), '2.4');
	});

	it('takes taurine as labeled', () => {
		assert.equal(mgPerMl(bySubstance(rows, 'TAURINE')), '0.25');
	});

	it('keeps SPL names for the amino acids RxNorm spells as anions', () => {
		const aspartic = bySubstance(rows, 'ASPARTIC ACID');
		assert.equal(ingredientDisplayName(aspartic), 'aspartate');
		assert.equal(mgPerMl(aspartic), '3.2');
	});

	it('fills evidence from the label and the dose form from the RxNorm name', () => {
		assert.equal(input.evidenceSetId, 'cb6d23ff-3ec5-445a-acbe-f88fd57949bf');
		assert.equal(input.evidenceVersion, '20260819');
		assert.equal(input.evidenceNdc, '00264193310');
		assert.equal(input.doseForm, 'Injectable Solution');
		assert.equal(input.note, null);
	});

	it('leaves ionic content for the user, with a warning', () => {
		assert.equal(input.ionicContent, null);
		assert.ok(warnings.includes('Ionic content not filled; enter it from the label'));
	});

	it('is valid input', () => {
		assert.doesNotThrow(() => parseLocalConceptInput(input));
	});
});

describe('localConceptDraft edge cases', () => {
	it('omits a row it cannot compute and names it in a warning', () => {
		const item = fixture();
		item.size = null;
		item.ingredients = [];
		const { input, warnings } = localConceptDraft(item);
		assert.equal(input.ingredients.length, 0);
		assert.ok(warnings.some((w) => w.includes('LEUCINE')));
	});

	it('falls back to the SPL version and dose form when the label and RxNorm name are missing', () => {
		const item = fixture();
		item.details!.label = null;
		item.details!.rxnav = null;
		const { input, warnings } = localConceptDraft(item);
		assert.equal(input.evidenceVersion, '10');
		assert.equal(input.evidenceSetId, 'cb6d23ff-3ec5-445a-acbe-f88fd57949bf');
		assert.equal(input.doseForm, '');
		assert.ok(warnings.some((w) => /dose form/i.test(w)));
	});

	it("keeps the SPL amount for a moiety row with no directory match when the SPL row's basis is moiety", () => {
		const item = fixture();
		item.ingredients = item.ingredients.filter((i) => i.name !== 'LYSINE ACETATE');
		const { input } = localConceptDraft(item);
		const lysine = bySubstance(input.ingredients, 'LYSINE ACETATE');
		assert.equal(lysine.basis, 'active_moiety');
		assert.equal(lysine.strengthNumMag, '8.51'); // 4.253 g / 500 mL
	});

	it('omits a strength-notes-only moiety row with no directory match, with a warning', () => {
		const item = fixture();
		item.ingredients = item.ingredients.filter((i) => i.name !== 'LYSINE ACETATE');
		item.details!.spl!.ingredients.find((i) => i.name === 'LYSINE ACETATE')!.basis = 'ingredient';
		const { input, warnings } = localConceptDraft(item);
		assert.ok(!input.ingredients.some((r) => r.substanceName === 'LYSINE ACETATE'));
		assert.ok(warnings.some((w) => w.startsWith('LYSINE ACETATE:')));
		assert.equal(input.ingredients.length, 19);
	});

	it("says what is missing when a row on another row's substance has no stored label amount", () => {
		const item = fixture();
		item.propertyOverrides = {};
		const { input, warnings } = localConceptDraft(item);
		assert.ok(!input.ingredients.some((r) => r.substanceName === 'ACETYL L-TYROSINE'));
		assert.ok(warnings.includes('ACETYL L-TYROSINE: stated as TYROSINE; enter the label amount'));
	});

	it('reads an SPL strength that already has a volume denominator', () => {
		const item = fixture();
		const leucine = item.details!.spl!.ingredients.find((i) => i.name === 'LEUCINE')!;
		leucine.strength = '1.4 g/100 mL';
		const { input } = localConceptDraft(item);
		assert.equal(bySubstance(input.ingredients, 'LEUCINE').strengthNumMag, '14');
	});
});
