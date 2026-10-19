// ── CMS Part B billing format ────────────────────────────────────────────────
// CMS publishes a quarterly NDC–HCPCS crosswalk for Medicare Part B drugs: which
// HCPCS code each 11-digit NDC bills under, the code's dosage descriptor, and how
// many billable units one package holds. A claim line pairs that HCPCS code and
// unit count with the NDC in the N4 format: `N4` + 11-digit NDC + unit qualifier
// (UN, ML, GR, F2, ME) + NDC quantity, e.g. `N400409488820ML20`.

import { formatNdc, toNdc11, type Ndc11 } from './ndc';

export type CrosswalkFile = 'ASP' | 'OPPS' | 'AWP' | 'PrEP';

export type CrosswalkRow = {
	ndc11: Ndc11;
	hcpcs: string;
	file: CrosswalkFile;
	descriptor: string | null;
	labelerName: string | null;
	drugName: string | null;
	hcpcsDosage: string | null;
	pkgSize: number | null;
	pkgQty: number | null;
	billUnits: number | null;
	billUnitsPkg: number | null;
};

export type NdcUnitQualifier = 'UN' | 'ML' | 'GR' | 'F2' | 'ME';

export type CmsBillingFormat = {
	hcpcs: string;
	descriptor: string | null;
	file: CrosswalkFile;
	hcpcsDosage: string | null;
	/** HCPCS billable units in one NDC package. */
	billUnitsPerPackage: number | null;
	ndc: string;
	unitQualifier: NdcUnitQualifier;
	/** NDC quantity for one whole package, in `unitQualifier` units. */
	ndcQuantity: number | null;
	/** The N4 claim segment for one whole package; null without a package size to state. */
	n4: string | null;
	quarter: string;
};

/** The file a crosswalk CSV inside the CMS zip holds, from its name. */
export function crosswalkFileOf(name: string): CrosswalkFile | null {
	if (!/section 508/i.test(name) || !/\.csv$/i.test(name) || /introduction/i.test(name)) return null;
	if (/\bOPPS\b/.test(name)) return 'OPPS';
	if (/\bAWP\b/.test(name)) return 'AWP';
	if (/\bPrEP\b/i.test(name)) return 'PrEP';
	if (/\bASP\b/.test(name)) return 'ASP';
	return null;
}

/** The newest quarterly crosswalk zip linked from the CMS ASP pricing files page. */
export function latestCrosswalkUrl(html: string, base = 'https://www.cms.gov'): string | null {
	for (const [, href] of html.matchAll(/href="([^"]+\.zip)"/gi)) {
		if (/crosswalk/i.test(href) && !/vaccine/i.test(href)) return new URL(href, base).toString();
	}
	return null;
}

/** "October 2026" from a crosswalk title line or file name. */
export function crosswalkQuarter(text: string): string | null {
	const match = /(january|april|july|october)[\s-]+(\d{4})/i.exec(text);
	if (!match) return null;
	return `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}`;
}

/** RFC 4180 CSV rows. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') (field += '"'), i++;
			else if (char === '"') quoted = false;
			else field += char;
		} else if (char === '"') quoted = true;
		else if (char === ',') row.push(field), (field = '');
		else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[i + 1] === '\n') i++;
			row.push(field), rows.push(row), (row = []), (field = '');
		} else field += char;
	}
	if (field || row.length) row.push(field), rows.push(row);
	return rows;
}

const number = (value: string | undefined) => {
	const parsed = Number((value ?? '').replace(/,/g, '').trim());
	return value?.trim() && Number.isFinite(parsed) ? parsed : null;
};
const text = (value: string | undefined) => value?.trim().replace(/\s+/g, ' ') || null;

/** Rows of one crosswalk CSV; the header row is found by its NDC column, below the title block. */
export function parseCrosswalkCsv(csv: string, file: CrosswalkFile): CrosswalkRow[] {
	const rows = parseCsv(csv);
	// `NDC`, or `NDC2` in some quarters' files.
	const headerAt = rows.findIndex((row) => row.some((cell) => /^NDC\d*\b/i.test(cell.trim())));
	if (headerAt < 0) return [];
	const header = rows[headerAt].map((cell) => cell.trim().toUpperCase());
	const col = (test: (name: string) => boolean) => header.findIndex(test);
	const at = {
		hcpcs: col((name) => /HCPCS CODE|_CODE$/.test(name)),
		descriptor: col((name) => /DESCRI/.test(name)),
		labeler: col((name) => /LABELER/.test(name)),
		ndc: col((name) => /^NDC/.test(name)),
		drug: col((name) => /DRUG NAME/.test(name)),
		dosage: col((name) => /HCPCS DOSAGE/.test(name)),
		pkgSize: col((name) => name === 'PKG SIZE'),
		pkgQty: col((name) => name === 'PKG QTY'),
		billUnits: col((name) => name === 'BILLUNITS'),
		billUnitsPkg: col((name) => name === 'BILLUNITSPKG')
	};
	const out = new Map<string, CrosswalkRow>();
	for (const row of rows.slice(headerAt + 1)) {
		const ndc11 = toNdc11(row[at.ndc] ?? '');
		const hcpcs = text(row[at.hcpcs])?.toUpperCase();
		// Alternate IDs (non-NDC) can't key a formulary package.
		if (!ndc11 || !hcpcs) continue;
		out.set(`${ndc11}|${hcpcs}`, {
			ndc11,
			hcpcs,
			file,
			descriptor: text(row[at.descriptor]),
			labelerName: text(row[at.labeler]),
			drugName: text(row[at.drug]),
			hcpcsDosage: text(row[at.dosage]),
			pkgSize: number(row[at.pkgSize]),
			pkgQty: number(row[at.pkgQty]),
			billUnits: number(row[at.billUnits]),
			billUnitsPkg: number(row[at.billUnitsPkg])
		});
	}
	return [...out.values()];
}

const LIQUID = /SOLUTION|SUSPENSION|EMULSION|SYRUP|ELIXIR|LIQUID|CONCENTRATE|TINCTURE|SPRAY|AEROSOL|DROPS|LOTION/;
const MASS = /CREAM|OINTMENT|GEL|PASTE|JELLY|GRANULE|POWDER/;
const COUNTED = /TABLET|CAPSULE|LOZENGE|TROCHE|SUPPOSITOR|PATCH|FILM|PELLET|INSERT|WAFER/;

/**
 * The N4 unit qualifier for a dose form. Liquids bill by the mL, topicals and
 * bulk powders by the gram, and everything else — vials of powder for
 * injection, kits, tablets — by the unit (each).
 */
export function unitQualifierFor(doseForm: string | null, hcpcsDosage: string | null = null): NdcUnitQualifier {
	const form = (doseForm ?? '').toUpperCase();
	if (/KIT/.test(form)) return 'UN';
	if (/INJECT|INFUSION/.test(form) && /POWDER|LYOPHILIZED/.test(form)) return 'UN';
	// The form's head decides: `CAPSULE, LIQUID FILLED` and `TABLET, FOR SUSPENSION`
	// are counted, whatever their qualifier says (and `GELATIN` is no gel).
	if (COUNTED.test(form.split(',')[0])) return 'UN';
	if (LIQUID.test(form) || (/INJECT/.test(form) && !COUNTED.test(form))) return 'ML';
	if (MASS.test(form)) return 'GR';
	if (COUNTED.test(form)) return 'UN';
	return /\bML\b/i.test(hcpcsDosage ?? '') ? 'ML' : 'UN';
}

const trim = (value: number) => Number(value.toFixed(3));

/** The CMS billing format for one package from its crosswalk row. */
export function billingFormat(row: CrosswalkRow, doseForm: string | null, quarter: string): CmsBillingFormat {
	const unitQualifier = unitQualifierFor(doseForm, row.hcpcsDosage);
	const size = row.pkgSize ?? null;
	const qty = row.pkgQty ?? 1;
	const perEach = unitQualifier !== 'UN' || COUNTED.test((doseForm ?? '').toUpperCase());
	const ndcQuantity = perEach ? (size === null ? null : trim(size * qty)) : trim(qty);
	return {
		hcpcs: row.hcpcs,
		descriptor: row.descriptor,
		file: row.file,
		hcpcsDosage: row.hcpcsDosage,
		billUnitsPerPackage: row.billUnitsPkg ?? row.billUnits,
		ndc: formatNdc(row.ndc11),
		unitQualifier,
		ndcQuantity,
		// A claim rejects an N4 segment without its quantity.
		n4: ndcQuantity === null ? null : `N4${row.ndc11}${unitQualifier}${ndcQuantity}`,
		quarter
	};
}

/** Files ranked by how directly they govern Part B payment. */
export const FILE_RANK: Record<CrosswalkFile, number> = { ASP: 0, OPPS: 1, PrEP: 2, AWP: 3 };
