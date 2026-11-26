/**
 * A standard reconstituted concentration for each dosable component ("Ampicillin
 * IV → 100 mg/mL") and for each of its formulary items that needs reconstitution.
 *
 * The labels of an item's NDCs often disagree, or state several alternatives
 * (IM 250 or 350 mg/mL), or state none. Rules, in order:
 *
 * 1. Only dry-fill packages vote; ready-to-use ones are ignored. An item with no
 *    dry fill needs no standard (`not-needed`).
 * 2. A package's instructions for the component's route are used. When it has
 *    none for the route, its instructions that name no route stand in, flagged
 *    `route-unstated`. Oral bottles only count for PO.
 * 3. Each instruction yields a concentration: the one the label states, else one
 *    computed from vial content ÷ stated final volume, else ÷ diluent volume.
 *    Computed values are flagged (`computed`), and the diluent-only case also
 *    `displacement`, since powder volume makes the true value lower.
 * 4. Concentrations within 1% are one value. Each package votes once for each
 *    value it states, so labels listing alternatives vote for each.
 * 5. The item's own pick is the value most packages state; a tie has no pick.
 * 6. The component's standard is the value most items pick (ties broken by NDC
 *    votes; a remaining tie has no standard).
 * 7. Each item then takes the component's standard when any of its packages
 *    states it (`standardized`), so alternatives and ties fall in line with the
 *    rest of the drug. Otherwise it keeps its own pick (`differs`), e.g. a
 *    pharmacy bulk vial made up stronger.
 *
 * Anything that needs a person is `review`: no pick, a pick fewer than half of
 * the voting packages state, only computed or route-unstated values, a
 * combination whose stated value names no ingredient, or most dry fills silent.
 *
 * Pure and offline.
 *
 * @module
 */
import type { ProseReconstitution } from '../labels/dry-fill-volume';
import type { VialPrepPackage } from './vial-prep-consensus';

export type ConcentrationFlag =
	| 'route-unstated'
	| 'computed'
	| 'displacement'
	| 'conflict'
	| 'tie'
	| 'minority'
	| 'silent-packages'
	| 'combination'
	| 'no-data';

export interface ConcentrationOption {
	mgPerMl: number;
	/** NDCs whose labels give this value. */
	ndcs: string[];
	/** No label states it; it was worked out from vial content and volume. */
	computed: boolean;
}

export interface ItemConcentration {
	itemId: string;
	/** not-needed: no dry fill. agreed: every label gives this one value. */
	status: 'not-needed' | 'agreed' | 'standardized' | 'majority' | 'differs' | 'review';
	/** The standard for this item; null when it needs a person or nothing is stated. */
	mgPerMl: number | null;
	/** Most-stated first. */
	options: ConcentrationOption[];
	/** Dry fills (or unknowns) that gave no usable step. */
	silent: string[];
	flags: ConcentrationFlag[];
}

export interface DosableConcentration {
	status: 'not-needed' | 'agreed' | 'majority' | 'review';
	mgPerMl: number | null;
	items: ItemConcentration[];
	/** Items held to a value other than the component's standard. */
	differing: string[];
	/** Items that need a person. */
	review: string[];
}

export interface ItemInput {
	itemId: string;
	packages: readonly VialPrepPackage[];
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01 * Math.max(a, b);
const round = (value: number) => Math.round(value * 1000) / 1000;

interface Candidate {
	mgPerMl: number;
	computed: boolean;
	displacement: boolean;
	unattributed: boolean;
}

function candidatesOf(row: ProseReconstitution, combination: boolean): Candidate[] {
	if (row.concentrations.length) {
		// A combination's label may give one value per ingredient; keep the lead's.
		const named = row.concentrations.filter((c) => c.name);
		const lead = combination && named.length ? [named[0]] : row.concentrations;
		return lead.map((c) => ({
			mgPerMl: c.mgPerMl,
			computed: false,
			displacement: false,
			unattributed: combination && !c.name
		}));
	}
	if (row.vialMassMg === null) return [];
	const finalMl = !row.bottle && !row.withdrawn ? row.finalVolumeMl : null;
	if (finalMl)
		return [
			{
				mgPerMl: round(row.vialMassMg / finalMl),
				computed: true,
				displacement: false,
				unattributed: false
			}
		];
	if (!row.diluentMl) return [];
	return [
		{
			mgPerMl: round(row.vialMassMg / row.diluentMl),
			computed: true,
			displacement: true,
			unattributed: false
		}
	];
}

/** Item-level options and own pick, before the component's standard is known. */
function itemOptions(input: ItemInput, route: string, combination: boolean) {
	const flags = new Set<ConcentrationFlag>();
	const relevant = input.packages.filter((pkg) => pkg.isDryFill !== false);
	const usable = (row: ProseReconstitution) => (route === 'PO' ? true : !row.bottle);
	if (
		!relevant.length ||
		relevant.every((pkg) => pkg.isDryFill === null && !pkg.reconstitution.some(usable))
	)
		return null;

	const options: (ConcentrationOption & { anyStated: boolean })[] = [];
	const silent: string[] = [];
	let onlyRouteless = true;
	for (const pkg of relevant) {
		const rows = pkg.reconstitution.filter(usable);
		let chosen = rows.filter((row) => row.routes?.includes(route as never));
		if (chosen.length) onlyRouteless = false;
		else chosen = rows.filter((row) => !row.routes?.length);
		const candidates = chosen.flatMap((row) => candidatesOf(row, combination));
		if (!candidates.length) {
			silent.push(pkg.ndc);
			continue;
		}
		if (!chosen.some((row) => row.routes?.includes(route as never))) flags.add('route-unstated');
		const voted: ConcentrationOption[] = [];
		for (const candidate of candidates) {
			if (candidate.unattributed) flags.add('combination');
			let option = options.find((o) => near(o.mgPerMl, candidate.mgPerMl));
			if (!option) {
				option = { mgPerMl: candidate.mgPerMl, ndcs: [], computed: true, anyStated: false };
				options.push(option);
			}
			if (!candidate.computed) {
				option.anyStated = true;
				// A stated value is the one to show, over a computed neighbour.
				if (option.computed) option.mgPerMl = candidate.mgPerMl;
				option.computed = false;
			}
			if (candidate.displacement && option.computed) flags.add('displacement');
			if (!voted.includes(option)) {
				option.ndcs.push(pkg.ndc);
				voted.push(option);
			}
		}
	}
	options.sort((a, b) => b.ndcs.length - a.ndcs.length || Number(a.computed) - Number(b.computed));
	const voters = relevant.length - silent.length;
	if (!voters) flags.add('no-data');
	if (onlyRouteless && voters) flags.add('route-unstated');
	else if (!onlyRouteless) flags.delete('route-unstated');
	if (silent.length * 2 > relevant.length && voters) flags.add('silent-packages');
	if (options.some((o) => o.computed)) flags.add('computed');
	if (!flags.has('computed')) flags.delete('displacement');
	if (options.length > 1 && options.some((o) => o.ndcs.length < voters)) flags.add('conflict');

	const [top, second] = options;
	const tie = !!top && !!second && top.ndcs.length === second.ndcs.length;
	if (tie) flags.add('tie');
	const own = top && !tie ? top : null;
	if (own && own.ndcs.length * 2 < voters) flags.add('minority');
	return {
		options: options.map(({ mgPerMl, ndcs, computed }) => ({ mgPerMl, ndcs, computed })),
		own,
		silent,
		flags,
		voters
	};
}

/** Flags that leave a value standing but need a person to confirm it. */
const NEEDS_REVIEW: ConcentrationFlag[] = [
	'route-unstated',
	'combination',
	'minority',
	'silent-packages'
];

/**
 * The standard concentration for one dosable component and its items.
 * `combination`: the component has more than one ingredient.
 */
export function standardConcentration(
	route: string,
	items: readonly ItemInput[],
	combination = false
): DosableConcentration {
	const built = items.map((input) => ({ input, result: itemOptions(input, route, combination) }));

	// The component's standard: the value most items pick, then most NDCs.
	const tally: { mgPerMl: number; items: number; ndcs: number; computed: boolean }[] = [];
	for (const { result } of built) {
		if (!result?.own) continue;
		const entry = tally.find((t) => near(t.mgPerMl, result.own!.mgPerMl));
		if (entry) {
			entry.items++;
			entry.ndcs += result.own.ndcs.length;
			entry.computed &&= result.own.computed;
		} else
			tally.push({
				mgPerMl: result.own.mgPerMl,
				items: 1,
				ndcs: result.own.ndcs.length,
				computed: result.own.computed
			});
	}
	tally.sort(
		(a, b) => b.items - a.items || b.ndcs - a.ndcs || Number(a.computed) - Number(b.computed)
	);
	const [first, runnerUp] = tally;
	const standardTie =
		!!first && !!runnerUp && first.items === runnerUp.items && first.ndcs === runnerUp.ndcs;
	const standard = first && !standardTie ? first.mgPerMl : null;

	const out: ItemConcentration[] = built.map(({ input, result }) => {
		if (!result)
			return {
				itemId: input.itemId,
				status: 'not-needed',
				mgPerMl: null,
				options: [],
				silent: [],
				flags: []
			};
		const flags = new Set(result.flags);
		const matching =
			standard === null ? undefined : result.options.find((o) => near(o.mgPerMl, standard));
		let status: ItemConcentration['status'];
		let pick: ConcentrationOption | null;
		if (matching) {
			pick = matching;
			// The standard settles a tie or a minority alternative.
			if (result.own && near(result.own.mgPerMl, standard!)) {
				status = result.options.length === 1 && !result.silent.length ? 'agreed' : 'majority';
			} else {
				status = 'standardized';
				flags.delete('tie');
			}
			flags.delete('minority');
		} else if (result.own) {
			pick = result.own;
			status = standard === null ? 'majority' : 'differs';
		} else {
			pick = null;
			status = 'review';
		}
		if (pick?.computed) flags.add('computed');
		else if (pick) {
			flags.delete('computed');
			flags.delete('displacement');
		}
		if (status !== 'review' && (pick?.computed || NEEDS_REVIEW.some((flag) => flags.has(flag))))
			status = 'review';
		if (status === 'agreed' && flags.size) status = 'majority';
		return {
			itemId: input.itemId,
			status,
			mgPerMl: pick?.mgPerMl ?? null,
			options: result.options,
			silent: result.silent,
			flags: [...flags]
		};
	});

	const needing = out.filter((item) => item.status !== 'not-needed');
	const review = out.filter((item) => item.status === 'review').map((item) => item.itemId);
	const differing = out
		.filter((item) => item.mgPerMl !== null && standard !== null && !near(item.mgPerMl, standard))
		.map((item) => item.itemId);
	const status: DosableConcentration['status'] = !needing.length
		? 'not-needed'
		: standard === null || first?.computed
			? 'review'
			: needing.every((item) => item.status === 'agreed')
				? 'agreed'
				: 'majority';
	return { status, mgPerMl: standard, items: out, differing, review };
}

/** Plain-language text for each flag, for the page. */
export const FLAG_TEXT: Record<ConcentrationFlag, string> = {
	'route-unstated': 'labels give no step for this route; a step naming no route was used',
	computed: 'no label states the concentration; it was worked out from vial content and volume',
	displacement: 'worked out from diluent volume alone, so powder displacement is ignored',
	conflict: 'labels state different concentrations',
	tie: 'two concentrations are stated equally often',
	minority: 'fewer than half of the labels state the picked value',
	'silent-packages': 'most dry-fill NDCs give no reconstitution step',
	combination: 'a combination product whose stated concentration names no ingredient',
	'no-data': 'no label gives a reconstitution step'
};
