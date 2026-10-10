type RuleKey = {
	moietyNames: string;
	doseFormGroup: string | null;
	route: string | null;
	strengthKey: string | null;
};

const oneText = (part: string): string => {
	const match = /^(\d+)\/(\d+) (.+)$/.exec(part);
	if (!match) return part;
	const [, num, den, rawUnit] = match;
	const unit = rawUnit.replace(/\/1$/, '');
	const value = Number(num) / Number(den);
	return `${Number.isInteger(value) ? value : Number(value.toPrecision(6))} ${unit}`;
};

/**
 * `20/1 mg/mL` reads as `20 mg/mL` and `5/1 mg/1` as `5 mg`. A combination key (`UNII=5/1 mg/1|UNII=...`) is
 * sorted by moiety UNII, and `moietyNames` is captured in that same order, so the n-th strength belongs to the
 * n-th name and is written `Name 5 mg + Name 10 mg`. When the counts disagree no pairing is claimed.
 */
function strengthText(strengthKey: string, moietyNames: string): string {
	const parts = strengthKey.split('|');
	const texts = parts.map((entry) => oneText(entry.replace(/^[^=]*=/, '')));
	const names = moietyNames.split(' / ');
	if (parts.length > 1 && parts.every((part) => part.includes('=')) && names.length === parts.length)
		return texts.map((text, index) => `${names[index]} ${text}`).join(' + ');
	return texts.join(' + ');
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A rule's key in words, e.g. `Lidocaine · Injectable · 20 mg/mL`; unset facets are left out. */
export function ruleKeyText(rule: RuleKey): string {
	return [
		rule.moietyNames,
		rule.doseFormGroup ? capitalized(rule.doseFormGroup.replace(/-/g, ' ')) : null,
		rule.route ? capitalized(rule.route.toLowerCase()) : null,
		rule.strengthKey ? strengthText(rule.strengthKey, rule.moietyNames) : null
	]
		.filter(Boolean)
		.join(' · ');
}
