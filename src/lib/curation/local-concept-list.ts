/**
 * Display helpers for the local concepts list page.
 *
 * @module
 */
/** "RxCUI 123 · name" for a superseded concept; a stopped one is marked. */
export function supersedesText(
	supersedes: { rxcui: string; name: string | null; active: boolean } | null
): string {
	if (!supersedes) return 'Nothing';
	const label = supersedes.name
		? `RxCUI ${supersedes.rxcui} · ${supersedes.name}`
		: `RxCUI ${supersedes.rxcui}`;
	return supersedes.active ? label : `${label} (stopped)`;
}

/** "set id · vN" for the label a concept was defined from. */
export function evidenceText(evidence: { setId: string; version: string }): string {
	return `${evidence.setId} · v${evidence.version}`;
}

/** The evidence NDC whose page opens the concept editor, or null when none usable was recorded. */
export function editNdc(evidenceNdc: string | null): string | null {
	return evidenceNdc && /^\d{11}$/.test(evidenceNdc) ? evidenceNdc : null;
}

/**
 * Whether a row's Edit item works. The NDC page only resolves a concept through an active
 * mapping, so Edit needs one plus a usable evidence NDC; otherwise says why not.
 */
export function editState(row: {
	supersedes: { active: boolean } | null;
	evidence: { ndc: string | null };
}): { ndc: string; reason?: undefined } | { ndc: null; reason: string } {
	if (!row.supersedes)
		return {
			ndc: null,
			reason: 'Not superseding anything; choose Supersede… to edit it from its NDC page'
		};
	if (!row.supersedes.active)
		return { ndc: null, reason: 'Supersede again to edit it from its NDC page' };
	const ndc = editNdc(row.evidence.ndc);
	if (!ndc)
		return {
			ndc: null,
			reason:
				'No evidence NDC was recorded for this concept, so there is no package page to edit it from.'
		};
	return { ndc };
}

/**
 * The row's supersede item: a stopped mapping is re-created as it was; a concept that
 * never superseded anything gets its target from its evidence NDC; an active one has none.
 */
export function supersedeItem(row: {
	supersedes: { active: boolean } | null;
}):
	| { action: 'localConceptResupersede'; label: 'Supersede again' }
	| { action: 'localConceptSupersede'; label: 'Supersede…' }
	| null {
	if (!row.supersedes) return { action: 'localConceptSupersede', label: 'Supersede…' };
	if (!row.supersedes.active)
		return { action: 'localConceptResupersede', label: 'Supersede again' };
	return null;
}

/** The badge text on a formulary item. */
export function badgeText(local: { code: string; supersedes: { rxcui: string } }): string {
	return `Local concept ${local.code} · supersedes RxCUI ${local.supersedes.rxcui}`;
}
