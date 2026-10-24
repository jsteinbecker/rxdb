/**
 * Two-letter clinical abbreviations for SPL route names, as written on orders
 * (ORAL → PO, SUBCUTANEOUS → SQ).
 *
 * @module
 */

/**
 * Two-letter clinical abbreviations for SPL route names, as written on orders
 * (ORAL → PO, SUBCUTANEOUS → SQ). Routes without a conventional abbreviation
 * fall back to their first two letters.
 */
const CODES: Record<string, string> = {
	ORAL: 'PO',
	SUBLINGUAL: 'SL',
	BUCCAL: 'BU',
	SUBCUTANEOUS: 'SQ',
	INTRAVENOUS: 'IV',
	'INTRAVENOUS BOLUS': 'IV',
	'INTRAVENOUS DRIP': 'IV',
	INTRAMUSCULAR: 'IM',
	INTRADERMAL: 'ID',
	INTRATHECAL: 'IT',
	INTRAOSSEOUS: 'IO',
	INTRAOCULAR: 'OC',
	INTRAVITREAL: 'VT',
	'INTRA-ARTICULAR': 'IA',
	'INTRA-ARTERIAL': 'IA',
	INTRACAVERNOUS: 'IC',
	INTRACARDIAC: 'IC',
	INTRALESIONAL: 'IL',
	INTRAPERITONEAL: 'IP',
	INTRAVESICAL: 'VS',
	INTRAUTERINE: 'IU',
	EPIDURAL: 'EP',
	PERINEURAL: 'PN',
	INFILTRATION: 'IF',
	TOPICAL: 'TP',
	CUTANEOUS: 'TP',
	TRANSDERMAL: 'TD',
	PERCUTANEOUS: 'PC',
	OPHTHALMIC: 'OP',
	OTIC: 'OT',
	NASAL: 'IN',
	INHALATION: 'IH',
	'RESPIRATORY (INHALATION)': 'IH',
	OROPHARYNGEAL: 'OR',
	DENTAL: 'DT',
	PERIODONTAL: 'PD',
	RECTAL: 'PR',
	VAGINAL: 'PV',
	URETHRAL: 'UR',
	ENTERAL: 'EN',
	NASOGASTRIC: 'NG',
	IRRIGATION: 'IR'
};

export const routeCode = (route: string): string => {
	const key = route.trim().toUpperCase();
	return CODES[key] ?? key.replace(/[^A-Z]/g, '').slice(0, 2);
};
