/**
 * How well a drug name answers a search, shared by the live RxNav ranking and
 * the local catalog search so both order results the same way.
 *
 * A query is read as ingredient or brand words, strengths (`500`, `500 mg`,
 * `5/325`) and dose-form words (`tab`, `ER`, `inj`, `oral`). A name matches when
 * every part of the query is found in it or in one of its aliases (the brand
 * names rolled up into a generic node); the score orders the matches.
 */

/** Query and name words that mean the same dose form or release, by canonical key. */
const FORM_WORDS: Record<string, string> = {
	tab: 'tablet', tabs: 'tablet', tablet: 'tablet', tablets: 'tablet',
	cap: 'capsule', caps: 'capsule', capsule: 'capsule', capsules: 'capsule',
	er: 'extended', xr: 'extended', xl: 'extended', sr: 'extended', cr: 'extended', la: 'extended',
	extended: 'extended', hr: 'extended',
	dr: 'delayed', ec: 'delayed', delayed: 'delayed',
	odt: 'disintegrating', disintegrating: 'disintegrating',
	chew: 'chewable', chewable: 'chewable',
	inj: 'injectable', injection: 'injectable', injectable: 'injectable', iv: 'injectable',
	im: 'injectable', subq: 'injectable', sc: 'injectable', subcutaneous: 'injectable',
	sol: 'solution', soln: 'solution', solution: 'solution',
	susp: 'suspension', suspension: 'suspension',
	syr: 'syrup', syrup: 'syrup',
	crm: 'cream', cream: 'cream',
	oint: 'ointment', ointment: 'ointment',
	gel: 'gel', lotion: 'lotion', foam: 'foam', powder: 'powder', spray: 'spray',
	patch: 'transdermal', transdermal: 'transdermal',
	oph: 'ophthalmic', ophth: 'ophthalmic', ophthalmic: 'ophthalmic', eye: 'ophthalmic',
	otic: 'otic', ear: 'otic',
	nasal: 'nasal', nose: 'nasal',
	inh: 'inhalation', inhal: 'inhalation', inhaler: 'inhalation', inhalation: 'inhalation',
	supp: 'suppository', suppository: 'suppository', rectal: 'rectal', vaginal: 'vaginal',
	oral: 'oral', po: 'oral', topical: 'topical',
	pen: 'pen', syringe: 'syringe', prefilled: 'syringe', injector: 'injector'
};

const UNITS: Record<string, string> = {
	mg: 'mg', mcg: 'mcg', ug: 'mcg', g: 'g', gm: 'g', ml: 'ml', meq: 'meq', mmol: 'mmol',
	unt: 'unt', unit: 'unt', units: 'unt', iu: 'unt', '%': '%'
};

const STOP_WORDS = new Set(['and', 'with', 'of', 'the', 'in', 'per', 'for', 'w']);

export type ParsedQuery = {
	/** Ingredient, brand or other name words. */
	words: string[];
	strengths: { value: number; unit: string | null }[];
	/** Canonical dose-form keys. */
	forms: string[];
};

function tokens(text: string): string[] {
	return text
		.toLocaleLowerCase()
		.replace(/(\d)([a-z%])/g, '$1 $2')
		.replace(/([a-z])(\d)/g, '$1 $2')
		.split(/[^a-z0-9.%]+/)
		.map((token) => token.replace(/^\.+|\.+$/g, ''))
		.filter(Boolean);
}

const isNumber = (token: string) => /^\d+(?:\.\d+)?$/.test(token) || /^\.\d+$/.test(token);

export function parseQuery(query: string): ParsedQuery {
	const parsed: ParsedQuery = { words: [], strengths: [], forms: [] };
	const list = tokens(query);
	for (let i = 0; i < list.length; i++) {
		const token = list[i];
		if (isNumber(token)) {
			const unit = UNITS[list[i + 1] ?? ''] ?? null;
			parsed.strengths.push({ value: Number(token), unit });
			if (unit) i++;
		} else if (FORM_WORDS[token]) {
			if (!parsed.forms.includes(FORM_WORDS[token])) parsed.forms.push(FORM_WORDS[token]);
		} else if (!STOP_WORDS.has(token) && !UNITS[token]) {
			parsed.words.push(token);
		}
	}
	return parsed;
}

/** Bounded edit distance: anything over `max` returns `max + 1`. */
function distance(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let best = i;
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
			best = Math.min(best, current[j]);
		}
		if (best > max) return max + 1;
		previous = current;
	}
	return previous[b.length];
}

type WordHit = 'exact' | 'prefix' | 'fuzzy' | null;

function wordHit(word: string, candidates: string[]): WordHit {
	if (candidates.includes(word)) return 'exact';
	if (word.length >= 2 && candidates.some((token) => token.startsWith(word))) return 'prefix';
	const max = word.length >= 8 ? 2 : word.length >= 5 ? 1 : 0;
	if (max && candidates.some((token) => token.length >= 4 && distance(word, token, max) <= max))
		return 'fuzzy';
	return null;
}

const STRENGTH = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|unt|meq|mmol|%)?/g;

function nameStrengths(name: string) {
	return [...name.toLocaleLowerCase().matchAll(STRENGTH)].map((match) => ({
		value: Number(match[1]),
		unit: match[2] ?? null
	}));
}

export type MatchReason = 'name' | 'brand' | 'strength' | 'form' | 'spelling';

export type Relevance = {
	/** Every part of the query was found. */
	matched: boolean;
	score: number;
	reasons: MatchReason[];
	/** Query words, strengths and forms the name lacks, as typed. */
	missing: string[];
};

export const isCombination = (name: string) => / \/ /.test(name.replace(/\{[^}]*\}/g, ''));

/** How well `name` (plus aliases such as rolled-up brand names) answers the query. */
export function relevance(
	query: ParsedQuery,
	candidate: { name: string; aliases?: string[] }
): Relevance {
	const nameTokens = tokens(candidate.name);
	const aliasTokens = (candidate.aliases ?? []).flatMap(tokens);
	const reasons = new Set<MatchReason>();
	const missing: string[] = [];
	let score = 0;
	const parts = query.words.length + query.strengths.length + query.forms.length;
	if (!parts) return { matched: true, score: 0, reasons: [], missing: [] };

	for (const word of query.words) {
		const inName = wordHit(word, nameTokens);
		const hit = inName ?? wordHit(word, aliasTokens);
		if (!hit) {
			missing.push(word);
			continue;
		}
		reasons.add(hit === 'fuzzy' ? 'spelling' : inName ? 'name' : 'brand');
		score += hit === 'exact' ? 12 : hit === 'prefix' ? 10 : 6;
	}
	const strengths = [...nameStrengths(candidate.name), ...(candidate.aliases ?? []).flatMap(nameStrengths)];
	for (const wanted of query.strengths) {
		const found = strengths.some(
			(have) => have.value === wanted.value && (!wanted.unit || have.unit === wanted.unit)
		);
		if (found) {
			reasons.add('strength');
			score += 8;
		} else missing.push(`${wanted.value}${wanted.unit ? ` ${wanted.unit}` : ''}`);
	}
	const forms = new Set(nameTokens.flatMap((token) => FORM_WORDS[token] ?? []));
	for (const form of query.forms) {
		if (forms.has(form)) {
			reasons.add('form');
			score += 6;
		} else missing.push(form);
	}

	const lower = candidate.name.toLocaleLowerCase();
	const first = query.words[0];
	if (first && lower.startsWith(first)) score += 5;
	const combination = isCombination(candidate.name);
	// One ingredient asked for: single-ingredient drugs answer it best. Two or more:
	// a combination naming them all does.
	if (combination && query.words.length < 2) score -= 8;
	if (combination && query.words.length >= 2 && !missing.some((m) => query.words.includes(m)))
		score += 8;
	// Normalize so a partial match never outranks a complete one.
	score = Math.round((score * (parts - missing.length)) / parts);
	return { matched: missing.length === 0, score, reasons: [...reasons], missing };
}

/** The query names one ingredient or brand, not a combination. */
export const singleIngredientQuery = (query: ParsedQuery) => query.words.length < 2;

const STRENGTH_TEXT =
	/\d+(?:\.\d+)?\s+(?:MG|MCG|ML|UNT|MEQ|MMOL|G|%|ACTUAT|IU|CELLS|BAU|AU|PNU)(?:\/(?:\d+(?:\.\d+)?\s*)?[A-Z]+)*/gi;

/** The dose form and strength an RxNorm drug name states, for filter chips. */
export function nameFacets(name: string): { form: string | null; strength: string | null } {
	const plain = name.replace(/\s*\[[^\]]*\]\s*$/, '');
	if (/^\{/.test(plain)) return { form: 'Pack', strength: null };
	const found = [...plain.matchAll(STRENGTH_TEXT)];
	const last = found.at(-1);
	if (!last) return { form: null, strength: null };
	const form = plain.slice(last.index! + last[0].length).trim() || null;
	return { form, strength: found.map((match) => match[0]).join(' / ') };
}

/** Live-search narrowing, carried in the URL as `form`, `strength`, `combos` and `weak`. */
export type SearchFilters = {
	form?: string;
	strength?: string;
	/** Include combination products demoted under a single-ingredient query. */
	combos?: boolean;
	/** Include names that miss part of the query. */
	weak?: boolean;
};

export function filtersFrom(params: URLSearchParams): SearchFilters {
	return {
		form: params.get('form') || undefined,
		strength: params.get('strength') || undefined,
		combos: params.get('combos') === '1' || undefined,
		weak: params.get('weak') === '1' || undefined
	};
}

export function filtersQuery(filters: SearchFilters): string {
	const params = new URLSearchParams();
	if (filters.form) params.set('form', filters.form);
	if (filters.strength) params.set('strength', filters.strength);
	if (filters.combos) params.set('combos', '1');
	if (filters.weak) params.set('weak', '1');
	const text = params.toString();
	return text ? `&${text}` : '';
}

export type FacetCount = { value: string; count: number };

export type SearchFacets = {
	forms: FacetCount[];
	strengths: FacetCount[];
	/** Combination products set aside under a single-ingredient query. */
	combos: number;
	/** Names missing part of the query. */
	weak: number;
};

/** Why a live concept is listed: complete match, combination set aside, or partial. */
export type ConceptMatch = {
	tier: 'strong' | 'combo' | 'weak';
	reasons: MatchReason[];
	missing: string[];
};
