type RuleKey = {
	moietyNames: string;
	doseFormGroup: string | null;
	route: string | null;
	strengthKey: string | null;
};

/** `20/1 mg/mL` reads as `20 mg/mL`; several actives join with ` + `. */
function strengthText(strengthKey: string): string {
	return strengthKey
		.split('|')
		.map((part) => {
			const match = /^(\d+)\/(\d+) (.+)$/.exec(part);
			if (!match) return part;
			const [, num, den, unit] = match;
			const value = Number(num) / Number(den);
			return `${Number.isInteger(value) ? value : Number(value.toPrecision(6))} ${unit}`;
		})
		.join(' + ');
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A rule's key in words, e.g. `Lidocaine · Injectable · 20 mg/mL`; unset facets are left out. */
export function ruleKeyText(rule: RuleKey): string {
	return [
		rule.moietyNames,
		rule.doseFormGroup ? capitalized(rule.doseFormGroup.replace(/-/g, ' ')) : null,
		rule.route ? capitalized(rule.route.toLowerCase()) : null,
		rule.strengthKey ? strengthText(rule.strengthKey) : null
	]
		.filter(Boolean)
		.join(' · ');
}
