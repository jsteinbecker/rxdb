export const MAX_CLASS_LENGTH = 160;

export class RuleInputError extends Error {}

/** Trim, drop blanks, de-duplicate; reject over-long names, and empty lists unless the mode is `suppress`. */
export function normalizeRuleClasses(classes: string[], mode: string): string[] {
	const cleaned = [...new Set(classes.map((name) => name.trim()).filter(Boolean))];
	if (cleaned.some((name) => name.length > MAX_CLASS_LENGTH))
		throw new RuleInputError(`A pharmacologic class is limited to ${MAX_CLASS_LENGTH} characters.`);
	if (!cleaned.length && mode !== 'suppress')
		throw new RuleInputError('Add at least one pharmacologic class.');
	return cleaned;
}

/** The moiety UNIIs in a rule's `|`-joined key. */
export const moietyUniis = (moietyKey: string): string[] =>
	[...new Set(moietyKey.split('|').filter(Boolean))];
