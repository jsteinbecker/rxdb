// Packages whose facts are too incomplete to dispense from, held for review.
//
// A quarantine is a flag, not an exclusion: the package stays on the
// formulary, shows as quarantined, and is listed at /formulary/quarantine
// until someone resolves it by adding the missing facts (overrides), accepting
// it as it is (`quarantineRelease`), or excluding it (`manualExclusion`).

import type { ExternalPackage } from './types';

export type QuarantineReason = 'reconstitution-missing';

export const QUARANTINE_LABELS: Record<QuarantineReason, string> = {
	'reconstitution-missing': 'Needs reconstituting, but no reconstitution instructions were found'
};

// "INJECTION, POWDER, FOR SOLUTION", "POWDER, FOR SUSPENSION", "GRANULE, FOR
// SUSPENSION", "…, LYOPHILIZED, …". A tablet or capsule "for suspension" is
// dispersed as it is, with no volume to make up.
const MADE_UP = /\bFOR (?:SUSPENSION|SOLUTION)\b|\bLYOPHILIZED\b/i;
const DISPERSED_SOLID = /^\s*(?:TABLET|CAPSULE)\b/i;

/** Whether this dose form is made up to a volume before use. */
export function isMadeUpForm(doseForm: string | null | undefined): boolean {
	return !!doseForm && MADE_UP.test(doseForm) && !DISPERSED_SOLID.test(doseForm);
}

export type QuarantineInput = Pick<ExternalPackage, 'doseForm' | 'reconstitution'> &
	Partial<Pick<ExternalPackage, 'isDryFill' | 'manualExclusion' | 'quarantineRelease'>>;

/**
 * Why a curated package is quarantined, or null. Read it from the curated
 * package (overrides applied), so a row the user added clears it.
 */
export function quarantineReason(item: QuarantineInput): QuarantineReason | null {
	// An exclusion or an accepted release already settled it.
	if (item.manualExclusion || item.quarantineRelease) return null;
	const madeUp = isMadeUpForm(item.doseForm) || item.isDryFill === true;
	if (madeUp && !item.reconstitution?.length) return 'reconstitution-missing';
	return null;
}
