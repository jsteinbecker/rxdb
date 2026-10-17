// ── What each label ingredient is made of ────────────────────────────────────
// A label lists salts. What a patient gets from them is something smaller — a
// moiety, an ion, or for a racemate two enantiomers — and several salts can
// deliver the same one. The ingredient table shows that as a tree: each label
// ingredient is a row, the pieces it delivers sit beneath it, and where one
// piece comes from more than one ingredient a total row adds them up.
//
//   Σ dextroamphetamine 3.75 mg = 1.25 + 1.25 + 0.625 + 0.625
//   ┃ AMPHETAMINE SULFATE          1.25 mg
//   ┃   ├ dextroamphetamine  ½     0.625 mg
//   ┃   └ levoamphetamine    ½     0.625 mg
//   ┃ DEXTROAMPHETAMINE SULFATE    1.25 mg   (moiety: dextroamphetamine)
//   ┃ …
//
// The ingredients a total adds up are kept together as one group under it.
//
// A shared moiety is only totalled when the product's RxNorm concept names it:
// that is the evidence the pieces are one drug given as several salts. Citric
// acid beside sodium citrate in ACD-A share a moiety too, but they are a buffer
// pair, not a dose, and adding them states nothing. A product-level override
// (`details.spl.totalSharedMoieties`) forces totals on or off.
//
// A whole moiety never gets its own row — its amount is the parent's, so it
// would only repeat it; it stays in the moiety column.

import type { LabelIngredient } from './server/catalog-providers';
import { enantiomerShares } from './ingredient-group';
import { formatStrength, parseStrengthText } from './ingredient-correction';

export type Constituent = {
	kind: 'enantiomer' | 'moiety' | 'ion';
	name: string;
	unii: string | null;
	/** The parent's share that is this piece: ½ for each enantiomer of a racemate. */
	share: number;
	/** This piece's amount, already scaled by `share`; null when it can't be stated. */
	strength: string | null;
	/** The amount is the salt's mass, not the piece's own (an ingredient-basis salt). */
	saltMass: boolean;
	/** The label's own ion row, for an ion; its strength notes and edits stay with it. */
	row?: LabelIngredient;
	/** An ion supplied by several salts: every one of them, this parent among them. */
	sources?: string[];
};

export type IngredientNode = { ingredient: LabelIngredient; constituents: Constituent[] };

export type ConstituentTotal = {
	name: string;
	unii: string | null;
	/** The sum, or null when the pieces' units or denominators differ. */
	strength: string | null;
	/** Each piece's amount, in parent order. */
	parts: (string | null)[];
	/** The label ingredient each part comes from, beside `parts`. */
	sources: string[];
	/** Every piece is a salt mass, so the sum is too. */
	saltMass: boolean;
	/** Why the pieces were not added, when `strength` is null. */
	unsummed: 'units' | 'basis' | null;
};

/** Actives that share a total, kept together, with their totals after them. */
export type IngredientGroup = { nodes: IngredientNode[]; totals: ConstituentTotal[] };

const key = (name: string) => name.trim().toLowerCase();

/** `strength` × `share`, in the strength's own unit and denominator. */
function scaled(strength: string | null, share: number): string | null {
	if (!strength) return null;
	const parsed = parseStrengthText(strength);
	if (!parsed) return share === 1 ? strength : null;
	return formatStrength({ ...parsed, value: String(Number((Number(parsed.value) * share).toPrecision(6))) });
}

/** Words that name a form of a moiety rather than a different substance. */
const FORM_WORDS = /\b(?:anhydrous|dextro|levo)/g;
const stem = (name: string) => key(name).replace(FORM_WORDS, ' ').replace(/\s+/g, ' ').trim();

/** Whether RxNorm's concept name mentions `piece`, ignoring hydration and handedness. */
export function rxNormNames(rxNormName: string | null | undefined, piece: string): boolean {
	if (!rxNormName) return false;
	const name = ` ${stem(rxNormName.replace(/[^\p{L}\p{N}\s-]/gu, ' '))} `;
	return name.includes(` ${stem(piece)}`);
}

/** The sum of strengths in one unit and denominator, or null when they differ. */
function summed(strengths: (string | null)[]): string | null {
	const parsed = strengths.map(parseStrengthText);
	const [first] = parsed;
	if (
		!first ||
		parsed.some(
			(item) => !item || item.unit !== first.unit || item.per !== first.per || item.perUnit !== first.perUnit
		)
	)
		return null;
	const total = parsed.reduce((sum, item) => sum + Number(item!.value), 0);
	return formatStrength({ ...first, value: String(Number(total.toPrecision(6))) });
}

/**
 * The label's ingredients as a tree: actives with what they deliver beneath
 * them, any ion whose salts are all missing, then the excipients. `totals`
 * holds one row per piece delivered by more than one active.
 */
export function nestIngredients(
	ingredients: LabelIngredient[],
	options: {
		/** The product's RxNorm concept name; a shared moiety is totalled only when it names it. */
		rxNormName?: string | null;
		/** A product-level override: true totals every shared moiety, false none. */
		totalShared?: boolean | null;
	} = {}
): {
	nodes: IngredientNode[];
	totals: ConstituentTotal[];
	/** The active nodes in groups: one per set of actives linked by a total or a shared ion. */
	groups: IngredientGroup[];
	/** Unplaced ions and excipients, after the groups. */
	others: IngredientNode[];
} {
	const active = ingredients.filter((i) => i.kind === 'active');
	const ionic = ingredients.filter((i) => i.kind === 'ionic');
	const inactive = ingredients.filter((i) => i.kind === 'inactive');

	// What each active delivers: its enantiomers when it is a racemate beside one
	// of them, else its one moiety (or itself, when it is the moiety).
	const delivered = (enantiomerShares(active.map((i) => (i.moieties.length === 1 ? i.moieties[0].name : i.name))) ??
		active.map((i) => [{ name: i.moieties.length === 1 ? i.moieties[0].name : i.name, share: 1 }])
	).map((pieces, index) =>
		pieces.map(({ name, share }) => {
			const ingredient = active[index];
			const moiety = ingredient.moieties.find((m) => key(m.name) === key(name));
			const itself = key(ingredient.name) === key(name) || (!!moiety?.unii && moiety.unii === ingredient.unii);
			return {
				name,
				unii: moiety?.unii ?? (itself ? ingredient.unii : null),
				share,
				itself,
				strength: scaled(ingredient.strength, share),
				saltMass: !itself && ingredient.basis !== 'moiety'
			};
		})
	);

	// Pieces that more than one active delivers are totalled, in first-seen order.
	const byPiece = new Map<
		string,
		{ name: string; unii: string | null; parts: { strength: string | null; saltMass: boolean; index: number }[] }
	>();
	delivered.forEach((pieces, index) => {
		for (const piece of pieces) {
			const entry = byPiece.get(key(piece.name)) ?? { name: piece.name, unii: piece.unii, parts: [] };
			entry.unii ??= piece.unii;
			entry.parts.push({ ...piece, index });
			byPiece.set(key(piece.name), entry);
		}
	});
	const totalsWithMembers = [...byPiece.values()]
		.filter(
			(entry) =>
				entry.parts.length > 1 &&
				(options.totalShared ?? rxNormNames(options.rxNormName, entry.name))
		)
		.map((entry) => {
			// A salt's mass and a moiety's mass are different quantities; adding
			// them gives a number that is neither, so it isn't stated.
			const mixed = new Set(entry.parts.map((part) => part.saltMass)).size > 1;
			const strength = mixed ? null : summed(entry.parts.map((part) => part.strength));
			return {
				members: entry.parts.map((part) => part.index),
				total: {
					name: entry.name,
					unii: entry.unii,
					parts: entry.parts.map((part) => part.strength),
					sources: entry.parts.map((part) => active[part.index].name),
					strength,
					saltMass: entry.parts.every((part) => part.saltMass),
					unsummed: mixed ? ('basis' as const) : strength ? null : ('units' as const)
				}
			};
		});
	const totals = totalsWithMembers.map(({ total }) => total);

	// Each ion sits under the last salt it comes from, so it reads as part of
	// those salts rather than as one more ingredient.
	const placed = new Set<LabelIngredient>();
	const nodes: IngredientNode[] = active.map((ingredient, index) => {
		// A whole moiety says nothing a row of its own would add — its amount is
		// the parent's — so it stays in the moiety column; only a racemate's
		// halves get rows. A shared moiety shows up in its group's total instead.
		const pieces = delivered[index].filter((piece) => !piece.itself && piece.share !== 1);
		const ions = ionic.filter(
			(ion) =>
				!placed.has(ion) &&
				ion.ionicContent?.sourceIngredients.includes(ingredient.name) &&
				!active.slice(index + 1).some((later) => ion.ionicContent?.sourceIngredients.includes(later.name))
		);
		ions.forEach((ion) => placed.add(ion));
		return {
			ingredient,
			constituents: [
				...pieces.map(({ name, unii, share, strength, saltMass }) => ({
					kind: share === 1 ? ('moiety' as const) : ('enantiomer' as const),
					name,
					unii,
					share,
					strength,
					saltMass
				})),
				...ions.map((ion) => ({
					kind: 'ion' as const,
					name: ion.ionicContent?.element ?? ion.name,
					unii: ion.unii,
					share: 1,
					strength: ion.strength,
					saltMass: false,
					row: ion,
					...((ion.ionicContent?.sourceIngredients.length ?? 0) > 1
						? { sources: ion.ionicContent!.sourceIngredients }
						: {})
				}))
			]
		};
	});

	// Actives linked by a total, or by an ion several of them supply, form one
	// group; each group is pulled together at its first member's place.
	const root = active.map((_, index) => index);
	const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
	const join = (indexes: number[]) => indexes.forEach((i) => (root[find(i)] = find(indexes[0])));
	totalsWithMembers.forEach(({ members }) => join(members));
	for (const ion of ionic) {
		const sources = active.flatMap((ingredient, index) =>
			ion.ionicContent?.sourceIngredients.includes(ingredient.name) ? [index] : []
		);
		if (sources.length > 1) join(sources);
	}
	const byRoot = new Map<number, IngredientGroup>();
	nodes.forEach((node, index) => {
		const group = byRoot.get(find(index)) ?? { nodes: [], totals: [] };
		group.nodes.push(node);
		byRoot.set(find(index), group);
	});
	for (const { members, total } of totalsWithMembers) byRoot.get(find(members[0]))!.totals.push(total);
	const groups = [...byRoot.values()];

	const others = [
		...ionic.filter((ion) => !placed.has(ion)).map((ingredient) => ({ ingredient, constituents: [] })),
		...inactive.map((ingredient) => ({ ingredient, constituents: [] }))
	];
	return {
		nodes: [...groups.flatMap((group) => group.nodes), ...others],
		totals,
		groups,
		others
	};
}
