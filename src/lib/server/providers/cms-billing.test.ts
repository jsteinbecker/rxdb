import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	billingFormat,
	crosswalkFileOf,
	crosswalkQuarter,
	latestCrosswalkUrl,
	parseCrosswalkCsv,
	unitQualifierFor
} from '../../catalog/cms-billing';

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
		assert.deepEqual(
			rows.map((row) => [row.ndc11, row.hcpcs]),
			[
				['13533063601', '90371'],
				['49702026423', 'J0739']
			]
		);
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
		assert.equal(
			crosswalkFileOf('section 508 version of October 2026 ASP NDC-HCPCS Crosswalk 091126.csv'),
			'ASP'
		);
		assert.equal(
			crosswalkFileOf('section 508 version of October 2026 OPPS NDC-HCPCS Crosswalk 090426.csv'),
			'OPPS'
		);
		assert.equal(crosswalkFileOf('October 2026 ASP NDC-HCPCS Crosswalk 091126.xls'), null);
		assert.equal(
			crosswalkFileOf('section 508 version of NDC-HCPCS Crosswalk Introduction Text 090326.csv'),
			null
		);
	});
});

describe('billing format', () => {
	it('bills an injectable solution by the mL', () => {
		const [row] = parseCrosswalkCsv(CSV, 'ASP').filter((r) => r.hcpcs === 'J0739');
		const bill = billingFormat(row, 'INJECTION, SUSPENSION, EXTENDED RELEASE', 'October 2026');
		assert.partialDeepStrictEqual(bill, {
			hcpcs: 'J0739',
			unitQualifier: 'ML',
			ndcQuantity: 3,
			billUnitsPerPackage: 600
		});
		assert.equal(bill.n4, 'N449702026423ML3');
		assert.equal(bill.ndc, '49702-0264-23');
	});

	it('bills a vial of powder and a tablet bottle by the unit', () => {
		assert.equal(unitQualifierFor('INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION'), 'UN');
		assert.equal(unitQualifierFor('TABLET, FILM COATED'), 'UN');
		assert.equal(unitQualifierFor('CREAM'), 'GR');
		const tablets = billingFormat(
			{
				ndc11: '50090771901',
				hcpcs: 'J0750',
				file: 'PrEP',
				descriptor: null,
				labelerName: null,
				drugName: null,
				hcpcsDosage: '200 MG/300 MG',
				pkgSize: 30,
				pkgQty: 1,
				billUnits: 30,
				billUnitsPkg: 30
			},
			'TABLET',
			'October 2026'
		);
		assert.equal(tablets.n4, 'N450090771901UN30');
		const vials = billingFormat(
			{
				ndc11: '00000000001',
				hcpcs: 'J1234',
				file: 'ASP',
				descriptor: null,
				labelerName: null,
				drugName: null,
				hcpcsDosage: '10 MG',
				pkgSize: 500,
				pkgQty: 10,
				billUnits: 50,
				billUnitsPkg: 500
			},
			'INJECTION, POWDER, FOR SOLUTION',
			'October 2026'
		);
		assert.partialDeepStrictEqual(vials, { unitQualifier: 'UN', ndcQuantity: 10 });
	});
});

const crosswalkRow = (
	over: Partial<Parameters<typeof billingFormat>[0]> = {}
): Parameters<typeof billingFormat>[0] => ({
	ndc11: '00409488820',
	hcpcs: 'J1234',
	file: 'ASP',
	descriptor: null,
	labelerName: null,
	drugName: null,
	hcpcsDosage: '1 MG',
	pkgSize: 20,
	pkgQty: 1,
	billUnits: 20,
	billUnitsPkg: 20,
	...over
});

describe('CMS crosswalk files as they actually arrive', () => {
	it('reads CRLF line endings, quoted commas and escaped quotes', () => {
		const csv = [
			'Title row,,,,',
			'HCPCS Code,Short Description,LABELER NAME,NDC,Drug Name,HCPCS dosage,PKG SIZE,PKG QTY,BILLUNITS,BILLUNITSPKG',
			'J1234,"Inj, ""special"" drug",ACME,00409-4888-20,"Thing, 1 mg/mL",1 MG,"1,000",1,"1,000","1,000"',
			''
		].join('\r\n');
		const [row] = parseCrosswalkCsv(csv, 'ASP');
		assert.equal(row.ndc11, '00409488820');
		assert.equal(row.descriptor, 'Inj, "special" drug');
		assert.equal(row.drugName, 'Thing, 1 mg/mL');
		assert.equal(row.pkgSize, 1000);
		assert.equal(row.billUnitsPkg, 1000);
	});

	it('keeps one row per NDC and HCPCS code, but both codes for one NDC', () => {
		const csv = `NDC,_2026_CODE,HCPCS dosage,PKG SIZE
00409-4888-20,J1234,1 MG,10
00409-4888-20,J1234,1 MG,20
00409-4888-20,j5678,2 MG,20
`;
		const rows = parseCrosswalkCsv(csv, 'OPPS');
		assert.deepEqual(
			rows.map((row) => [row.hcpcs, row.pkgSize]),
			[
				['J1234', 20],
				['J5678', 20]
			]
		);
	});

	it('reads blanks and placeholders as unknown, not zero', () => {
		const csv = `NDC,_2026_CODE,HCPCS dosage,PKG SIZE,PKG QTY,BILLUNITS,BILLUNITSPKG
00409-4888-20,J1234,  ,,N/A, ,
`;
		const [row] = parseCrosswalkCsv(csv, 'ASP');
		assert.partialDeepStrictEqual(row, {
			hcpcsDosage: null,
			pkgSize: null,
			pkgQty: null,
			billUnits: null,
			billUnitsPkg: null
		});
	});

	it('finds a header whose NDC column is named NDC2', () => {
		const csv = `HCPCS Code,NDC2,HCPCS dosage,PKG SIZE
J1234,00409-4888-20,1 MG,20
`;
		assert.equal(parseCrosswalkCsv(csv, 'ASP').length, 1);
	});

	it('returns nothing for a file with no NDC header', () => {
		assert.deepEqual(parseCrosswalkCsv('just,a,title\n1,2,3\n', 'ASP'), []);
		assert.deepEqual(parseCrosswalkCsv('', 'ASP'), []);
	});

	it('names quarters in any case and rejects other months', () => {
		assert.equal(crosswalkQuarter('JANUARY 2027 ASP NDC-HCPCS'), 'January 2027');
		assert.equal(crosswalkQuarter('april-2026-ndc-hcpcs-crosswalk.zip'), 'April 2026');
		assert.equal(crosswalkQuarter('March 2026 update'), null);
	});

	it('ignores links to anything but a crosswalk zip', () => {
		const html = `<a href="/files/zip/october-2026-asp-pricing-file.zip"></a>
<a href="/files/document/october-2026-crosswalk.pdf"></a>`;
		assert.equal(latestCrosswalkUrl(html), null);
	});
});

describe('N4 unit qualifiers for dose forms', () => {
	it('bills injectable liquids by the mL and powders and kits by the unit', () => {
		for (const [form, qualifier] of [
			['INJECTION, SOLUTION', 'ML'],
			['INJECTION, EMULSION', 'ML'],
			['INJECTION, SOLUTION, CONCENTRATE', 'ML'],
			['INJECTION, POWDER, FOR SUSPENSION', 'UN'],
			['INJECTION, POWDER, LYOPHILIZED, FOR LIPOSOMAL SUSPENSION', 'UN'],
			['KIT', 'UN'],
			['IMPLANT', 'UN'],
			['PELLET, IMPLANTABLE', 'UN'],
			['PATCH, EXTENDED RELEASE', 'UN'],
			['GEL', 'GR'],
			['POWDER, FOR SUSPENSION', 'ML']
		] as const)
			assert.equal(unitQualifierFor(form), qualifier, form);
	});

	it('falls back to the HCPCS dosage when the dose form says nothing', () => {
		assert.equal(unitQualifierFor(null, '1 ML'), 'ML');
		assert.equal(unitQualifierFor('', '10 MG'), 'UN');
		assert.equal(unitQualifierFor(null), 'UN');
	});

	it('bills every capsule and tablet by the unit', () => {
		for (const form of [
			'CAPSULE, LIQUID FILLED',
			'CAPSULE, GELATIN COATED',
			'TABLET, FOR SUSPENSION',
			'TABLET, FOR SOLUTION'
		])
			assert.equal(unitQualifierFor(form), 'UN', form);
		// Cyclosporine (J7502) bills each capsule.
		const bill = billingFormat(
			crosswalkRow({ hcpcs: 'J7502', hcpcsDosage: '100 MG', pkgSize: 30, pkgQty: 1 }),
			'CAPSULE, LIQUID FILLED',
			'q'
		);
		assert.equal(bill.n4, 'N400409488820UN30');
	});

	it('scales the NDC quantity by the package count', () => {
		const bill = billingFormat(
			crosswalkRow({ pkgSize: 2, pkgQty: 25 }),
			'INJECTION, SOLUTION',
			'October 2026'
		);
		assert.equal(bill.ndcQuantity, 50);
		assert.equal(bill.n4, 'N400409488820ML50');
		// Fractional mL survive to three places.
		assert.equal(
			billingFormat(crosswalkRow({ pkgSize: 0.4, pkgQty: 10 }), 'INJECTION, SOLUTION', 'q')
				.ndcQuantity,
			4
		);
		assert.equal(
			billingFormat(crosswalkRow({ pkgSize: 0.3333, pkgQty: 1 }), 'INJECTION, SOLUTION', 'q')
				.ndcQuantity,
			0.333
		);
	});

	it('prefers billable units per package over per unit', () => {
		assert.equal(
			billingFormat(crosswalkRow({ billUnits: 1, billUnitsPkg: 20 }), 'INJECTION, SOLUTION', 'q')
				.billUnitsPerPackage,
			20
		);
		assert.equal(
			billingFormat(crosswalkRow({ billUnits: 1, billUnitsPkg: null }), 'INJECTION, SOLUTION', 'q')
				.billUnitsPerPackage,
			1
		);
	});

	it('never builds an N4 segment without a quantity', () => {
		const bill = billingFormat(
			crosswalkRow({ pkgSize: null }),
			'INJECTION, SOLUTION',
			'October 2026'
		);
		assert.equal(bill.ndcQuantity, null);
		assert.equal(bill.n4, null);
	});
});
