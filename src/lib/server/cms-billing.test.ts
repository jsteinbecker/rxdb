import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { billingFormat, crosswalkFileOf, crosswalkQuarter, latestCrosswalkUrl, parseCrosswalkCsv, unitQualifierFor } from '../cms-billing';

const CSV = `October 2026 ASP NDC - HCPCS Crosswalk for Medicare Part B Drugs,,,,,,,,,
"     Effective October 1, 2026 through December 31, 2026",,,,,,,,,
,,,,,,,,,
_2026_CODE,Short Description,LABELER NAME,NDC,Drug Name,HCPCS dosage,PKG SIZE,PKG QTY,BILLUNITS,BILLUNITSPKG
90371,Hep b ig im,"Grifols USA, LLC",13533-0636-01,HyperHepB ,1 ML,1,1,1,1
J0739,"Hiv prep, cabotegravir, 1mg",VIIV HEALTHCARE,49702-0264-23,Apretude,1 MG,3,1,600,600
J9999,Alternate,Someone,ALT-ID-1,Thing,1 MG,1,1,1,1
`;

describe('CMS crosswalk', () => {
	it('parses rows below the title block and skips alternate IDs', () => {
		const rows = parseCrosswalkCsv(CSV, 'ASP');
		assert.deepEqual(rows.map((row) => [row.ndc11, row.hcpcs]), [
			['13533063601', '90371'],
			['49702026423', 'J0739']
		]);
		assert.equal(rows[0].labelerName, 'Grifols USA, LLC');
		assert.partialDeepStrictEqual(rows[1], { hcpcsDosage: '1 MG', pkgSize: 3, billUnitsPkg: 600 });
	});

	it('finds the newest crosswalk link and its quarter', () => {
		const html = `<a href="/files/zip/october-2026-ndc-hcpcs-crosswalk-final.zip"></a>
<a href="/files/zip/2026-2027-ndc-hcpcs-crosswalk-seasonal-vaccines.zip"></a>`;
		const url = latestCrosswalkUrl(html)!;
		assert.equal(url, 'https://www.cms.gov/files/zip/october-2026-ndc-hcpcs-crosswalk-final.zip');
		assert.equal(crosswalkQuarter(url), 'October 2026');
	});

	it('names files by their 508 CSV', () => {
		assert.equal(crosswalkFileOf('section 508 version of October 2026 ASP NDC-HCPCS Crosswalk 091126.csv'), 'ASP');
		assert.equal(crosswalkFileOf('section 508 version of October 2026 OPPS NDC-HCPCS Crosswalk 090426.csv'), 'OPPS');
		assert.equal(crosswalkFileOf('October 2026 ASP NDC-HCPCS Crosswalk 091126.xls'), null);
		assert.equal(crosswalkFileOf('section 508 version of NDC-HCPCS Crosswalk Introduction Text 090326.csv'), null);
	});
});

describe('billing format', () => {
	it('bills an injectable solution by the mL', () => {
		const [row] = parseCrosswalkCsv(CSV, 'ASP').filter((r) => r.hcpcs === 'J0739');
		const bill = billingFormat(row, 'INJECTION, SUSPENSION, EXTENDED RELEASE', 'October 2026');
		assert.partialDeepStrictEqual(bill, { hcpcs: 'J0739', unitQualifier: 'ML', ndcQuantity: 3, billUnitsPerPackage: 600 });
		assert.equal(bill.n4, 'N449702026423ML3');
		assert.equal(bill.ndc, '49702-0264-23');
	});

	it('bills a vial of powder and a tablet bottle by the unit', () => {
		assert.equal(unitQualifierFor('INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION'), 'UN');
		assert.equal(unitQualifierFor('TABLET, FILM COATED'), 'UN');
		assert.equal(unitQualifierFor('CREAM'), 'GR');
		const tablets = billingFormat(
			{ ndc11: '50090771901', hcpcs: 'J0750', file: 'PrEP', descriptor: null, labelerName: null, drugName: null, hcpcsDosage: '200 MG/300 MG', pkgSize: 30, pkgQty: 1, billUnits: 30, billUnitsPkg: 30 },
			'TABLET',
			'October 2026'
		);
		assert.equal(tablets.n4, 'N450090771901UN30');
		const vials = billingFormat(
			{ ndc11: '00000000001', hcpcs: 'J1234', file: 'ASP', descriptor: null, labelerName: null, drugName: null, hcpcsDosage: '10 MG', pkgSize: 500, pkgQty: 10, billUnits: 50, billUnitsPkg: 500 },
			'INJECTION, POWDER, FOR SOLUTION',
			'October 2026'
		);
		assert.partialDeepStrictEqual(vials, { unitQualifier: 'UN', ndcQuantity: 10 });
	});
});
