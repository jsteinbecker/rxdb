/** RxNorm leads a time-release name with its period: "24 HR metoprolol …". */
export const LEADING_PERIOD = /^(\d+(?:\.\d+)?\s*(?:HR|HOURS?|DAYS?|WEEKS?|MONTHS?))\s+/i;

/**
 * Moves RxNorm's leading release period behind the release modifier of the
 * dose form: "24 HR metoprolol succinate 100 MG Extended Release Oral Tablet"
 * → "metoprolol succinate 100 MG Extended Release (24 HR) Oral Tablet".
 */
export function timeReleaseAfterRelease(name: string): string {
  const period = name.match(LEADING_PERIOD)?.[1];
  if (!period) return name;
  const rest = name.replace(LEADING_PERIOD, '');
  const placed = rest.replace(
    /\b(Extended|Delayed|Controlled|Sustained)([- ]Release)\b/i,
    `$1$2 (${period.toUpperCase()})`
  );
  return placed === rest ? `${rest} (${period.toUpperCase()})` : placed;
}

const MODIFIED_RELEASE = /\b(?:Extended|Delayed|Controlled|Sustained)[- ]Release(?:\s*\(([^)]+)\))?/i;
const TRAILING_PERIOD = /\((\d+(?:\.\d+)?\s*(?:HR|HOURS?|DAYS?|WEEKS?|MONTHS?))\)/i;

/** The release period of a timed name ("12 HR"), or null when it has none. */
export function releasePeriod(name: string): string | null {
  const period =
    name.match(LEADING_PERIOD)?.[1] ??
    name.match(MODIFIED_RELEASE)?.[1] ??
    name.match(TRAILING_PERIOD)?.[1];
  return period && TRAILING_PERIOD.test(`(${period})`) ? period.toUpperCase() : null;
}

export const MAX_RELEASE_ABBREVIATION = 8;

/** A user's release abbreviation ("SR", "XL"): letters and digits, upper-cased; blank clears it. */
export function parseReleaseAbbreviation(
  raw: unknown
): { abbreviation: string | null } | { error: string } {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!value) return { abbreviation: null };
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(value))
    return { error: 'Use letters and digits only, such as SR or XR.' };
  if (value.length > MAX_RELEASE_ABBREVIATION)
    return { error: `Abbreviations are limited to ${MAX_RELEASE_ABBREVIATION} characters.` };
  return { abbreviation: value };
}

/**
 * Swaps a timed name's release modifier and period for the user's abbreviation:
 * "bupropion hydrochloride 150 MG Extended Release (12 HR) Oral Tablet" with SR
 * → "bupropion hydrochloride 150 MG SR Oral Tablet". Untimed names are unchanged.
 */
export function abbreviatedRelease(name: string, abbreviation: string | null): string {
  if (!abbreviation) return name;
  const placed = timeReleaseAfterRelease(name);
  if (!releasePeriod(placed)) return name;
  const swapped = placed.replace(MODIFIED_RELEASE, abbreviation);
  return swapped === placed ? placed.replace(TRAILING_PERIOD, abbreviation) : swapped;
}
