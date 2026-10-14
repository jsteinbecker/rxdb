// Display helpers for the local concepts list page.

/** "RxCUI 123 · name" for a superseded concept; a stopped one is marked. */
export function supersedesText(
  supersedes: { rxcui: string; name: string | null; active: boolean } | null
): string {
  if (!supersedes) return 'Nothing';
  const label = supersedes.name ? `RxCUI ${supersedes.rxcui} · ${supersedes.name}` : `RxCUI ${supersedes.rxcui}`;
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

/** The badge text on a formulary item. */
export function badgeText(local: { code: string; supersedes: { rxcui: string } }): string {
  return `Local concept ${local.code} · supersedes RxCUI ${local.supersedes.rxcui}`;
}
