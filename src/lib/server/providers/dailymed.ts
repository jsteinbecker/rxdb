/**
 * DailyMed endpoints, and the compliance-inactivation flag only its HTML label
 * page shows.
 *
 * @module
 */
export const DAILYMED_SPL = 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json';
export const DAILYMED_DOCUMENT = 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls';
export const DAILYMED_INFO = 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm';

/** DailyMed flags compliance-inactivated NDCs only on its HTML label page. */
export function inactivatedOnDailyMed(html: string, candidates: string[]): boolean {
	const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
	return candidates.some((code) =>
		new RegExp(`(^|[^\\d-])${code.replaceAll('-', '\\-')} \\(inactivated\\)`, 'i').test(text)
	);
}
