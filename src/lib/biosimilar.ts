// ── Biosimilars are not their reference product ──────────────────────────────
// FDA gives every biosimilar a four-letter suffix on its proper name —
// `adalimumab-adaz`, `insulin glargine-yfgn` — because a biosimilar is highly
// similar to its reference product, not identical, and is not interchangeable
// with it unless separately designated. Hierarchies, titles and groupings must
// therefore keep `ADALIMUMAB` and `ADALIMUMAB-ADAZ` apart.
//
// Sources are inconsistent about carrying the suffix: some directory and label
// rows name the substance `ADALIMUMAB-ADAZ`, others name only `ADALIMUMAB` and
// leave the suffix to the product's generic name or title. This recovers it
// from those other fields, and only when the suffixed name is the ingredient's
// own name plus the suffix, so `sulfamethoxazole-trimethoprim` never matches.

const SUFFIX = /-[a-z]{4}$/i;

/** Whether the name already carries a biosimilar suffix. */
export const hasBiosimilarSuffix = (name: string) => SUFFIX.test(name.trim());

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The ingredient name with its biosimilar suffix attached, found in any of the
 * `texts` (generic name, label title, RxNorm concept name). Unchanged when it
 * already has one or no text names a suffixed form of it.
 */
export function withBiosimilarSuffix(name: string, texts: (string | null | undefined)[]): string {
	const trimmed = name.trim();
	if (!trimmed || hasBiosimilarSuffix(trimmed)) return name;
	const pattern = new RegExp(
		`(?<![\\w-])${escape(trimmed).replace(/\s+/g, '\\s+')}-([a-z]{4})(?![\\w-])`,
		'i'
	);
	for (const text of texts) {
		const suffix = text?.match(pattern)?.[1];
		if (suffix)
			return `${trimmed}-${trimmed === trimmed.toUpperCase() ? suffix.toUpperCase() : suffix.toLowerCase()}`;
	}
	return name;
}
