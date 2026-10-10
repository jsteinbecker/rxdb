import { naturalCompare } from './natural-sort';
import { labelerGroup } from './labeler-group';
import { ingredientGroup } from './ingredient-group';
import type { ItemSummary } from './item-summary';

export type ScenarioIngredient = {
	key: string;
	name: string;
	kind: 'active' | 'inactive';
	/** NDCs whose label lists it. */
	ndcs: string[];
	/** The listed actives merged into it when grouped by moiety. */
	listed: string[];
};

/** NDCs that share exactly the same set of varying ingredients. */
export type Profile = {
	/** Keys of the varying ingredients these NDCs contain. */
	has: string[];
	ndcs: string[];
	/** Varying ingredients a formulary avoids by keeping only these NDCs. */
	avoids: string[];
};

export type Scenarios = {
	/** NDCs with ingredient data; the rest cannot be placed in a scenario. */
	ndcs: string[];
	/**
	 * NDCs whose data names actives but no inactive ingredient while others list
	 * theirs: an unread label, not one free of excipients, so they are left out.
	 */
	incomplete: string[];
	/** Inactives in every NDC with ingredient data, so no subset avoids them. */
	fixed: ScenarioIngredient[];
	/** Table columns: every active first, then the inactives that vary. */
	columns: ScenarioIngredient[];
	/** In some NDCs but not others: the ones a subset can avoid. */
	varying: ScenarioIngredient[];
	profiles: Profile[];
};

/**
 * Lay an item's ingredients out as scenarios: which combinations its NDCs
 * actually come in, and which ingredients each one lets a formulary avoid
 * by limiting the item to it.
 */
export function ingredientScenarios(
	summary: Pick<ItemSummary, 'active' | 'inactive'>,
	{ byMoiety = true } = {}
): Scenarios {
	// By moiety, VANCOMYCIN and VANCOMYCIN HCL are one column; listed, two.
	const actives = new Map<string, ScenarioIngredient>();
	for (const entry of summary.active) {
		// A lone moiety names the column only when it is the drug part of the salt
		// (VANCOMYCIN in VANCOMYCIN HCL). An electrolyte's label moiety is an ion —
		// SODIUM CHLORIDE lists CHLORIDE ION — so those fall to `ingredientGroup`.
		const lone = entry.moieties.length === 1 ? entry.moieties[0] : null;
		const moiety =
			lone && entry.name.toUpperCase().includes(lone.toUpperCase()) ? lone : ingredientGroup(entry.name);
		const key = byMoiety
			? `a:${moiety.toUpperCase()}`
			: `a:${entry.unii ?? entry.name.toUpperCase()}`;
		const known = actives.get(key);
		if (!known) {
			actives.set(key, {
				key,
				name: byMoiety ? moiety : entry.name,
				kind: 'active',
				ndcs: [...entry.ndcs],
				listed: [entry.name]
			});
			continue;
		}
		for (const ndc of entry.ndcs) if (!known.ndcs.includes(ndc)) known.ndcs.push(ndc);
		if (!known.listed.includes(entry.name)) known.listed.push(entry.name);
	}
	const ingredients: ScenarioIngredient[] = [
		...actives.values(),
		...summary.inactive.map((entry) => ({
			key: `i:${entry.value.toUpperCase()}`,
			name: entry.value,
			kind: 'inactive' as const,
			ndcs: entry.ndcs,
			listed: [entry.value]
		}))
	];
	const all = [...new Set(ingredients.flatMap((entry) => entry.ndcs))].sort();
	const listingInactives = new Set(summary.inactive.flatMap((entry) => entry.ndcs));
	const ndcs = listingInactives.size ? all.filter((ndc) => listingInactives.has(ndc)) : all;
	const incomplete = all.filter((ndc) => !ndcs.includes(ndc));
	if (incomplete.length)
		for (const entry of ingredients) entry.ndcs = entry.ndcs.filter((ndc) => listingInactives.has(ndc));
	const fixed = ingredients.filter(
		(entry) => entry.kind === 'inactive' && entry.ndcs.length === ndcs.length
	);
	const varying = ingredients
		.filter((entry) => entry.ndcs.length < ndcs.length)
		.sort(
			(a, b) =>
				(a.kind === b.kind ? 0 : a.kind === 'active' ? -1 : 1) ||
				b.ndcs.length - a.ndcs.length ||
				naturalCompare(a.name, b.name)
		);

	const byProfile = new Map<string, Profile>();
	for (const ndc of ndcs) {
		const has = varying.filter((entry) => entry.ndcs.includes(ndc)).map((entry) => entry.key);
		const id = has.join('|');
		const profile = byProfile.get(id) ?? {
			has,
			ndcs: [],
			avoids: varying.filter((entry) => !has.includes(entry.key)).map((entry) => entry.key)
		};
		profile.ndcs.push(ndc);
		byProfile.set(id, profile);
	}
	const profiles = [...byProfile.values()].sort(
		(a, b) => b.ndcs.length - a.ndcs.length || b.avoids.length - a.avoids.length
	);
	const columns = [
		...ingredients
			.filter((entry) => entry.kind === 'active')
			.sort((a, b) => b.ndcs.length - a.ndcs.length || naturalCompare(a.name, b.name)),
		...varying.filter((entry) => entry.kind === 'inactive')
	];
	return { ndcs, incomplete, fixed, columns, varying, profiles };
}

/** NDCs left when a formulary avoids every ingredient in `avoid`. */
export function remainingNdcs(scenarios: Scenarios, avoid: Iterable<string>): string[] {
	const avoided = new Set(avoid);
	return scenarios.profiles
		.filter((profile) => !profile.has.some((key) => avoided.has(key)))
		.flatMap((profile) => profile.ndcs)
		.sort();
}

/** At most this many companies before a group falls back to a generated name. */
const NAMED_LABELERS = 2;

/**
 * A short name for each profile's NDCs: the companies behind them when there
 * are only a few, otherwise "Group A", "Group B"… Repeats get a number.
 */
export function profileNames(
	profiles: Profile[],
	labelers: { value: string; ndcs: string[] }[]
): string[] {
	let generated = 0;
	const names = profiles.map((profile) => {
		const companies = new Map<string, number>();
		for (const labeler of labelers) {
			const count = labeler.ndcs.filter((ndc) => profile.ndcs.includes(ndc)).length;
			if (!count || /^unknown\b/i.test(labeler.value)) continue;
			const name = labelerGroup(labeler.value);
			companies.set(name, (companies.get(name) ?? 0) + count);
		}
		if (companies.size && companies.size <= NAMED_LABELERS)
			return [...companies].sort((a, b) => b[1] - a[1]).map(([name]) => name).join(' + ');
		return `Group ${String.fromCharCode(65 + (generated++ % 26))}`;
	});
	const seen = new Map<string, number>();
	const totals = new Map<string, number>();
	for (const name of names) totals.set(name, (totals.get(name) ?? 0) + 1);
	// Repeats of one company are told apart by product NDC when each is a single, distinct product.
	const productOf = (profile: Profile) => {
		const codes = new Set(profile.ndcs.map((ndc) => (ndc.length === 11 ? ndc.slice(0, 9) : null)));
		const [code] = codes;
		return codes.size === 1 && code ? `${code.slice(0, 5)}-${code.slice(5)}` : null;
	};
	const products = profiles.map(productOf);
	const byProduct = new Set(
		[...totals.keys()].filter((name) => {
			const codes = names.flatMap((other, i) => (other === name ? [products[i]] : []));
			return codes.every(Boolean) && new Set(codes).size === codes.length;
		})
	);
	return names.map((name, i) => {
		if (totals.get(name) === 1) return name;
		if (byProduct.has(name)) return `${name} ${products[i]}`;
		const n = (seen.get(name) ?? 0) + 1;
		seen.set(name, n);
		return `${name} ${n}`;
	});
}
