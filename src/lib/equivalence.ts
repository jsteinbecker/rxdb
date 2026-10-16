// ── Equivalence groups ───────────────────────────────────────────────────────
// Values of one hierarchy dimension that should read as one node, e.g. dose
// forms "Tablet, Coated" and "Tablet, Film Coated" shown as "Tablet, Coated".
// Members match loosely: case, punctuation, hyphens, word order, plurals and
// common abbreviations ("TABS, FILM-COATED") are ignored, and a member with
// `*` is a wildcard over the words ("tablet * coated").

export type EquivalenceGroup = {
	/** Dimension key the group merges within, e.g. "doseForm". */
	dimension: string;
	/** The label merged nodes read as. */
	display: string;
	/** Values, or `*` patterns, that merge into the display. */
	members: string[];
};

export type ValueCount = { label: string; count: number };

const ABBREVIATIONS: Record<string, string> = {
	tab: 'tablet',
	tabs: 'tablet',
	cap: 'capsule',
	caps: 'capsule',
	sol: 'solution',
	soln: 'solution',
	susp: 'suspension',
	inj: 'injection',
	injectable: 'injection',
	oint: 'ointment',
	crm: 'cream',
	ophth: 'ophthalmic',
	pwd: 'powder',
	pwdr: 'powder',
	conc: 'concentrate',
	er: 'extended release',
	xr: 'extended release',
	xl: 'extended release',
	sr: 'extended release',
	dr: 'delayed release',
	ec: 'enteric coated',
	odt: 'orally disintegrating',
	iv: 'intravenous',
	im: 'intramuscular',
	sc: 'subcutaneous',
	sq: 'subcutaneous',
	subq: 'subcutaneous',
	po: 'oral',
	hcl: 'hydrochloride',
	mdv: 'multi dose vial',
	sdv: 'single dose vial',
	coat: 'coated',
	filmcoated: 'film coated'
};

const STOPWORDS = new Set(['and', 'the', 'of', 'a', 'an']);

/**
 * Words that change what a product is, not how it is described: release,
 * route, and how it is taken. Values differing by one are never proposed as
 * alike ("Tablet" vs "Tablet, Extended Release"), whereas "film" or "sugar"
 * before "coated" only describe.
 */
const SIGNIFICANT = new Set(
	`extended delayed release enteric chewable orally disintegrating dispersible effervescent
	sublingual buccal soluble injection intravenous intramuscular subcutaneous intrathecal
	intradermal epidural oral ophthalmic otic nasal inhalation topical transdermal vaginal rectal
	urethral dental powder solution suspension emulsion concentrate lyophilized liposomal kit
	pack multi single dose prefilled cartridge pen generic`.split(/\s+/)
);

/** Plural to singular for ordinary nouns; leaves "gas", "class", "virus", "basis" alone. */
const singular = (word: string) =>
	word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;

/** A value's words, lowercased and expanded: "TABS, Film-Coated" → tablet film coated. */
export function equivalenceWords(value: string): string[] {
	return value
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/(\d)\s+(?=[a-zµ%])/g, '$1')
		.replace(/[^a-z0-9.%µ*]+/g, ' ')
		.replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
		.split(' ')
		.filter(Boolean)
		.flatMap((word) =>
			(ABBREVIATIONS[singular(word)] ?? ABBREVIATIONS[word] ?? singular(word)).split(' ')
		)
		.filter((word) => !STOPWORDS.has(word));
}

/**
 * The spelling-free identity two values share when they are the same text in
 * different formatting. Word order is ignored, except among numbers, where it
 * tells "500mg / 125mg" from "125mg / 500mg".
 */
export function equivalenceKey(value: string): string {
	const words = equivalenceWords(value);
	return (words.some((word) => /\d/.test(word)) ? words : [...words].sort()).join(' ');
}

const isPattern = (member: string) => member.includes('*');

/** A `*` member as a test over a value's words, in order: "tablet*coated". */
function patternTest(member: string): (value: string) => boolean {
	const body = member
		.split('*')
		.map((part) =>
			equivalenceWords(part)
				.join(' ')
				.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		)
		.join('.*');
	const pattern = new RegExp(`(?:^| )${body}(?: |$)`);
	return (value) => pattern.test(equivalenceWords(value).join(' '));
}

/** Whether a member (a value or a `*` pattern) captures a value. */
export function memberMatches(member: string, value: string): boolean {
	return isPattern(member)
		? patternTest(member)(value)
		: equivalenceKey(member) === equivalenceKey(value);
}

/** Maps a dimension's value to the label its equivalence group reads as. */
export type Equivalence = (dimension: string, value: string) => string;

/** Every value maps to itself. */
export const NO_EQUIVALENCE: Equivalence = (_, value) => value;

/**
 * Index groups for lookup. A value belongs to the first group that captures
 * it, by exact member, by formatting variant, or by pattern.
 */
export function equivalence(groups: EquivalenceGroup[]): Equivalence {
	if (!groups.length) return NO_EQUIVALENCE;
	type Entry = { keys: Map<string, string>; patterns: [(value: string) => boolean, string][] };
	const byDimension = new Map<string, Entry>();
	for (const group of groups) {
		const entry: Entry = byDimension.get(group.dimension) ?? { keys: new Map(), patterns: [] };
		byDimension.set(group.dimension, entry);
		for (const member of [group.display, ...group.members]) {
			if (isPattern(member)) entry.patterns.push([patternTest(member), group.display]);
			else {
				const key = equivalenceKey(member);
				if (!entry.keys.has(key)) entry.keys.set(key, group.display);
			}
		}
	}
	const cache = new Map<string, string>();
	return (dimension, value) => {
		const entry = byDimension.get(dimension);
		if (!entry) return value;
		const cacheKey = `${dimension}\u0000${value}`;
		let found = cache.get(cacheKey);
		if (found === undefined) {
			found =
				entry.keys.get(equivalenceKey(value)) ??
				entry.patterns.find(([test]) => test(value))?.[1] ??
				value;
			cache.set(cacheKey, found);
		}
		return found;
	};
}

/** Edit distance, for misspellings ("Hydrocloride"). */
function distance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++)
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		previous = current;
	}
	return previous[b.length];
}

/**
 * How alike two values read, 0–1. 1 is the same text in other formatting;
 * shared words count, a multi-word value contained in the other counts more,
 * and near-identical spellings count by edit distance.
 */
export function similarity(a: string, b: string): number {
	const keyA = equivalenceKey(a);
	const keyB = equivalenceKey(b);
	if (keyA === keyB) return 1;
	const wordsA = new Set(keyA.split(' '));
	const wordsB = new Set(keyB.split(' '));
	const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
	const union = new Set([...wordsA, ...wordsB]).size;
	const smaller = wordsA.size <= wordsB.size ? wordsA : wordsB;
	const contained = smaller.size >= 2 && shared === smaller.size;
	const words = shared / union + (contained ? 0.2 : 0);
	const sortedA = [...wordsA].sort().join(' ');
	const sortedB = [...wordsB].sort().join(' ');
	const spelling = 1 - distance(sortedA, sortedB) / Math.max(sortedA.length, sortedB.length);
	// Numbers must agree; "5mg" and "50mg" are one letter apart but not alike.
	const numbers = (words: Set<string>) => [...words].filter((word) => /\d/.test(word)).join(' ');
	if (numbers(wordsA) !== numbers(wordsB)) return Math.min(words, 0.5);
	const differing = [...wordsA, ...wordsB].filter(
		(word) => !(wordsA.has(word) && wordsB.has(word))
	);
	if (differing.some((word) => SIGNIFICANT.has(word))) return Math.min(words, 0.5);
	return Math.min(0.99, Math.max(words, spelling >= 0.85 ? spelling : 0));
}

/** Values most like any of the seeds, best first, excluding the seeds themselves. */
export function relatedValues(
	seeds: string[],
	values: ValueCount[],
	{ min = 0.34, limit = 12 } = {}
): (ValueCount & { score: number })[] {
	const seedKeys = new Set(seeds.filter((seed) => !isPattern(seed)).map(equivalenceKey));
	return values
		.filter((value) => !seedKeys.has(equivalenceKey(value.label)))
		.map((value) => ({
			...value,
			score: Math.max(
				0,
				...seeds.filter((seed) => !isPattern(seed)).map((seed) => similarity(seed, value.label))
			)
		}))
		.filter((value) => value.score >= min)
		.sort((a, b) => b.score - a.score || b.count - a.count)
		.slice(0, limit);
}

/** Readable casing beats SHOUTING, then the more common value, then the shorter. */
export function preferredDisplay(values: ValueCount[]): string | null {
	const shouting = (label: string) => /[A-Z]{3}/.test(label) && label === label.toUpperCase();
	return (
		[...values].sort(
			(a, b) =>
				Number(shouting(a.label)) - Number(shouting(b.label)) ||
				b.count - a.count ||
				a.label.length - b.label.length
		)[0]?.label ?? null
	);
}

export type Suggestion = {
	display: string;
	members: ValueCount[];
	/** "formatting" when the members differ only in spelling; "similar" otherwise. */
	kind: 'formatting' | 'similar';
};

/**
 * Groups worth proposing from the values a dimension currently has: values
 * that are the same text in other formatting, then values that read alike.
 * Values already captured by a group are left out.
 */
export function suggestGroups(
	values: ValueCount[],
	existing: EquivalenceGroup[] = [],
	{ threshold = 0.67 } = {}
): Suggestion[] {
	const captured = (label: string) =>
		existing.some((group) =>
			[group.display, ...group.members].some((member) => memberMatches(member, label))
		);
	const free = values.filter((value) => !captured(value.label));
	// Complete linkage: a value joins a cluster only when it is alike to every member,
	// so "A ≈ B" and "B ≈ C" never pull "A" and "C" together on their own.
	const score = free.map((a, i) =>
		free.map((b, j) => (i === j ? 1 : similarity(a.label, b.label)))
	);
	const order = free.map((_, index) => index).sort((a, b) => free[b].count - free[a].count);
	const clusters: number[][] = [];
	const placed = new Set<number>();
	for (const seed of order) {
		if (placed.has(seed)) continue;
		const cluster = [seed];
		for (const other of order)
			if (
				!placed.has(other) &&
				other !== seed &&
				cluster.every((member) => score[member][other] >= threshold)
			)
				cluster.push(other);
		cluster.forEach((index) => placed.add(index));
		clusters.push(cluster);
	}
	const anySimilar = new Set(
		clusters.flatMap((cluster) =>
			cluster.some((i) => cluster.some((j) => score[i][j] < 1)) ? cluster : []
		)
	);
	return clusters
		.filter((members) => members.length > 1)
		.map((indexes) => {
			const members = indexes.map((index) => free[index]).sort((a, b) => b.count - a.count);
			return {
				display: preferredDisplay(members)!,
				members,
				kind: indexes.some((index) => anySimilar.has(index))
					? ('similar' as const)
					: ('formatting' as const)
			};
		})
		.sort(
			(a, b) =>
				Number(a.kind === 'similar') - Number(b.kind === 'similar') ||
				b.members.length - a.members.length
		);
}

/** Groups from stored settings; malformed entries are dropped. */
export function parseEquivalenceGroups(
	value: unknown,
	dimensions?: Set<string>
): EquivalenceGroup[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((raw) => {
		if (!raw || typeof raw !== 'object') return [];
		const { dimension, display, members } = raw as Record<string, unknown>;
		if (typeof dimension !== 'string' || (dimensions && !dimensions.has(dimension))) return [];
		if (typeof display !== 'string' || !display.trim()) return [];
		const list = Array.isArray(members)
			? [
					...new Set(
						members
							.filter((member): member is string => typeof member === 'string')
							.map((member) => member.trim())
							.filter(Boolean)
					)
				]
			: [];
		return [{ dimension, display: display.trim(), members: list }];
	});
}
