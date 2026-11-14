/**
 * Consensus vial preparation across every NDC a compound component may use.
 *
 * A compound line names one package, but the formulary item it belongs to
 * admits several — different labelers' ceftriaxone 1 g vials, say. Whoever
 * prepares the compound may pull any of them, so a reconstitution step only
 * belongs in the compound's procedure when every allowed dry-fill vial's label
 * agrees with it: same diluent volume, the same stated concentration, and at
 * least one diluent they all allow. One labeler's 9.6 mL of SWFI for 100 mg/mL
 * is not the procedure if another's label says 10 mL for 95 mg/mL.
 *
 * Packages that are not dry fills need no preparation and do not vote. A dry
 * fill whose label yielded no instruction is reported, and blocks consensus:
 * silence is not agreement.
 *
 * When the compound's route is given, label instructions that name only other
 * routes are set aside first: an IM-only 2.1 mL step says nothing about an IV
 * compound. Instructions that name no route still apply to every route.
 *
 * Pure and offline; the caller supplies each package's parsed facts.
 *
 * @module
 */
import type { ProseReconstitution } from '../labels/dry-fill-volume';
import type { ReconstitutionRoute } from '../labels/reconstitution-terms';

export interface VialPrepPackage {
	packageId: string;
	ndc: string;
	title: string;
	/** False for ready-to-use packages, null when the catalog has no facts for it. */
	isDryFill: boolean | null;
	reconstitution: readonly ProseReconstitution[];
}

/** One instruction every voting package's label states. */
export interface ConsensusStep {
	vialMassMg: number | null;
	diluentMl: number;
	/** Concentration the labels state; null when none of them states one. */
	concentrationMgPerMl: number | null;
	/** Diluents every label allows; empty when no label names one. */
	diluents: string[];
	/** Routes every label that names a route assigns; empty when none says. */
	routes: ReconstitutionRoute[];
	/** An oral bottle's constituted volume; absent for a vial. */
	bottleMl?: number;
}

export type VialPrepConsensus =
	/** No allowed package is a dry fill: nothing to prepare. */
	| { status: 'not-needed'; packages: VialPrepPackage[] }
	| {
			status: 'consensus' | 'partial' | 'conflict';
			steps: ConsensusStep[];
			/** Dry-fill packages that voted. */
			voters: VialPrepPackage[];
			/** Dry-fill (or unknown) packages whose labels gave no instruction. */
			missing: VialPrepPackage[];
	  };

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01 * Math.max(a, b);

const concentrationsOf = (row: ProseReconstitution) => row.concentrations.map((c) => c.mgPerMl);

/** Whether two instructions describe the same physical step. */
function sameStep(a: ProseReconstitution, b: ProseReconstitution): boolean {
	if (!near(a.diluentMl, b.diluentMl)) return false;
	if (a.vialMassMg !== null && b.vialMassMg !== null && !near(a.vialMassMg, b.vialMassMg))
		return false;
	// A concentration both state must match; one label stating none doesn't contradict.
	const left = concentrationsOf(a);
	const right = concentrationsOf(b);
	if (left.length && right.length && !left.some((x) => right.some((y) => near(x, y))))
		return false;
	// Both name diluents: they must share one. Both name routes: they must share one.
	if (a.diluents?.length && b.diluents?.length && !a.diluents.some((d) => b.diluents!.includes(d)))
		return false;
	if (a.routes?.length && b.routes?.length && !a.routes.some((r) => b.routes!.includes(r)))
		return false;
	return true;
}

const intersect = <T>(lists: (readonly T[] | undefined)[]): T[] => {
	const named = lists.filter((list): list is readonly T[] => !!list?.length);
	if (!named.length) return [];
	return named[0].filter((item) => named.every((list) => list.includes(item)));
};

function mergeStep(rows: ProseReconstitution[]): ConsensusStep {
	const stated = rows.flatMap(concentrationsOf);
	return {
		vialMassMg: rows.find((row) => row.vialMassMg !== null)?.vialMassMg ?? null,
		diluentMl: rows[0].diluentMl,
		concentrationMgPerMl:
			stated.find((value) => rows.every((row) => {
				const own = concentrationsOf(row);
				return !own.length || own.some((x) => near(x, value));
			})) ?? null,
		diluents: intersect(rows.map((row) => row.diluents)),
		routes: intersect(rows.map((row) => row.routes)),
		...(rows[0].bottle && rows[0].finalVolumeMl != null ? { bottleMl: rows[0].finalVolumeMl } : {})
	};
}

/** Both vial rows, or bottle rows of the same constituted volume. */
const sameContainer = (a: ProseReconstitution, b: ProseReconstitution) =>
	!!a.bottle === !!b.bottle &&
	(!a.bottle || (a.finalVolumeMl != null && b.finalVolumeMl != null && near(a.finalVolumeMl, b.finalVolumeMl)));

/** Whether a label instruction applies to `route`; one naming no route applies to all. */
const forRoute = (row: ProseReconstitution, route: ReconstitutionRoute | null) =>
	!route || !row.routes?.length || row.routes.includes(route);

/**
 * The preparation every allowed package agrees on.
 *
 * - `consensus`: every dry-fill package voted, and at least one step is common to all.
 * - `partial`: common steps exist among the voters, but some dry fills gave no instruction.
 * - `conflict`: the voters share no step.
 */
export function vialPrepConsensus(
	packages: readonly VialPrepPackage[],
	route: ReconstitutionRoute | null = null
): VialPrepConsensus {
	/** Vial rows only (oral-constitution bottle rows are not vial preparation), for this route. */
	const vialRows = (pkg: VialPrepPackage) =>
		pkg.reconstitution.filter((row) => !row.bottle && forRoute(row, route));
	const relevant = packages.filter((pkg) => pkg.isDryFill !== false);
	if (!relevant.length || relevant.every((pkg) => pkg.isDryFill === null && !vialRows(pkg).length))
		return { status: 'not-needed', packages: [...packages] };

	const voters = relevant.filter((pkg) => vialRows(pkg).length);
	const missing = relevant.filter((pkg) => !vialRows(pkg).length);
	if (!voters.length) return { status: 'partial', steps: [], voters, missing };

	// Each of the first voter's instructions survives if every other voter has a matching one.
	const [first, ...rest] = voters;
	const steps: ConsensusStep[] = [];
	for (const row of vialRows(first)) {
		const matches = rest.map((pkg) => vialRows(pkg).find((other) => sameStep(row, other)));
		if (matches.every(Boolean)) {
			const step = mergeStep([row, ...(matches as ProseReconstitution[])]);
			if (!steps.some((seen) => near(seen.diluentMl, step.diluentMl) &&
				seen.concentrationMgPerMl === step.concentrationMgPerMl &&
				seen.routes.join() === step.routes.join()))
				steps.push(step);
		}
	}
	const status = !steps.length ? 'conflict' : missing.length ? 'partial' : 'consensus';
	return { status, steps, voters, missing };
}

/** A consensus step adopted into a compound component, as stored on its slot. */
export interface AdoptedVialPrep {
	step: ConsensusStep;
	/** The NDCs whose labels agreed when it was adopted. */
	ndcs: string[];
	adoptedAt: string;
}

/** Same step, compared the way consensus de-duplicates them. */
export const sameConsensusStep = (a: ConsensusStep, b: ConsensusStep) =>
	near(a.diluentMl, b.diluentMl) &&
	(a.vialMassMg === null) === (b.vialMassMg === null) &&
	(a.vialMassMg === null || near(a.vialMassMg, b.vialMassMg!)) &&
	a.concentrationMgPerMl === b.concentrationMgPerMl &&
	a.diluents.join() === b.diluents.join() &&
	a.routes.join() === b.routes.join();

/** A stored value read back as an adopted step, or null when it isn't one. */
export function parseAdoptedVialPrep(value: unknown): AdoptedVialPrep | null {
	if (!value || typeof value !== 'object') return null;
	const { step, ndcs, adoptedAt } = value as Record<string, unknown>;
	if (!step || typeof step !== 'object' || !Array.isArray(ndcs) || typeof adoptedAt !== 'string')
		return null;
	const s = step as Record<string, unknown>;
	if (typeof s.diluentMl !== 'number' || !Array.isArray(s.diluents) || !Array.isArray(s.routes))
		return null;
	return { step: step as ConsensusStep, ndcs: ndcs.map(String), adoptedAt };
}

/** One step as some of the item's labels state it, and which NDCs state it. */
export interface VialPrepVariant {
	step: ConsensusStep;
	ndcs: string[];
	/** Labels stating any step for this route and container (vial, or this bottle size). */
	of: number;
}

/** Every step stated for one route (null: the labels name no route at all). */
export interface VialPrepRouteGroup {
	route: ReconstitutionRoute | null;
	/** Most-stated first. */
	variants: VialPrepVariant[];
	/**
	 * Judged against the labels that state any step for this route (voters).
	 * Two steps every voter states are alternatives (IM 2.1 mL → 350 mg/mL and
	 * 3.6 mL → 250 mg/mL on the same labels), not disagreement.
	 * - `unanimous`: every variant is stated by every voter, and no dry fill is silent.
	 * - `incomplete`: the same, but some dry fills state no step for this route.
	 * - `split`: some variant is stated by only some voters.
	 * - `unassigned`: the route-null group beside routed ones: steps a few labels give without a route.
	 */
	status: 'unanimous' | 'split' | 'incomplete' | 'unassigned';
	/** Labels stating any step for this route. */
	voters: number;
	/** Dry fills (or unknowns) stating no step for this route. */
	missing: string[];
	/** Per variant, the fields that differ from the most-stated variant (the first's are all false). */
	differs: { diluentMl: boolean; concentration: boolean; diluents: boolean }[];
}

export type VialPrepVariants =
	| { status: 'not-needed'; readyToUse: string[] }
	| {
			status: 'stated';
			groups: VialPrepRouteGroup[];
			/** Dry fills whose labels gave no vial step at all. */
			missing: string[];
			readyToUse: string[];
	  };

/**
 * Every vial preparation an item's packages' labels state, grouped by route and
 * clustered by `sameStep`, with the NDCs stating each — the item-level view of
 * the variation `vialPrepConsensus` collapses to a yes or no.
 *
 * Steps that name a route go in that route's group; steps naming none go in a
 * group of their own (route null), shown as such rather than copied into every
 * route, where a lidocaine IM step would read as an IV one. A package with a
 * route-less step is not counted missing from a route group.
 */
export function vialPrepVariants(packages: readonly VialPrepPackage[]): VialPrepVariants {
	// Oral bottles are constituted too, and belong on the item's card (as PO).
	const vialRows = (pkg: VialPrepPackage) => pkg.reconstitution;
	const readyToUse = packages.filter((pkg) => pkg.isDryFill === false).map((pkg) => pkg.ndc);
	const relevant = packages.filter((pkg) => pkg.isDryFill !== false);
	if (!relevant.length || relevant.every((pkg) => pkg.isDryFill === null && !vialRows(pkg).length))
		return { status: 'not-needed', readyToUse };

	const named = [...new Set(relevant.flatMap((pkg) => vialRows(pkg).flatMap((row) => row.routes ?? [])))];
	const order = (r: ReconstitutionRoute) => ['IV', 'IM', 'SC', 'PO'].indexOf(r);
	const routes: (ReconstitutionRoute | null)[] = [...named.sort((a, b) => order(a) - order(b)), null];
	const routeless = (pkg: VialPrepPackage) => vialRows(pkg).some((row) => !row.routes?.length);

	const groups: VialPrepRouteGroup[] = [];
	for (const route of routes) {
		const clusters: { rows: ProseReconstitution[]; ndcs: string[] }[] = [];
		const missing: string[] = [];
		for (const pkg of relevant) {
			const rows = vialRows(pkg).filter((row) =>
				route ? row.routes?.includes(route) : !row.routes?.length
			);
			if (!rows.length && (route ? !routeless(pkg) : !named.length)) missing.push(pkg.ndc);
			for (const row of rows) {
				const cluster = clusters.find((c) =>
					c.rows.every((other) => sameStep(row, other) && sameContainer(row, other))
				);
				if (!cluster) clusters.push({ rows: [row], ndcs: [pkg.ndc] });
				else {
					cluster.rows.push(row);
					if (!cluster.ndcs.includes(pkg.ndc)) cluster.ndcs.push(pkg.ndc);
				}
			}
		}
		if (!clusters.length) continue;
		const variants = clusters
			.map((c) => {
				const step = mergeStep(c.rows);
				// Within a route group the route is implied; keep only the group's.
				return { step: { ...step, routes: route ? [route] : step.routes }, ndcs: c.ndcs, of: 0 };
			})
			.sort(
				(a, b) =>
					(a.step.bottleMl ?? 0) - (b.step.bottleMl ?? 0) ||
					b.ndcs.length - a.ndcs.length ||
					a.step.diluentMl - b.step.diluentMl
			);
		const topFor = (step: ConsensusStep) =>
			variants.find((v) => size(v.step) === size(step))!.step;
		const voters = new Set(clusters.flatMap((c) => c.ndcs)).size;
		// Agreement is judged among the labels stating a step for the same
		// container: an 80 mL and a 150 mL bottle take different water and do
		// not disagree, as two labels for one vial size would.
		const size = (step: ConsensusStep) => step.bottleMl ?? 'vial';
		const votersFor = (step: ConsensusStep) =>
			new Set(
				clusters
					.filter((c) => size(mergeStep(c.rows)) === size(step))
					.flatMap((c) => c.ndcs)
			).size;
		for (const variant of variants) variant.of = votersFor(variant.step);
		const agreed = (v: VialPrepVariant) => v.ndcs.length === v.of;
		groups.push({
			route,
			variants,
			status:
				route === null && named.length
					? 'unassigned'
					: !variants.every(agreed)
						? 'split'
						: missing.length
							? 'incomplete'
							: 'unanimous',
			voters,
			missing,
			// An alternative every voter states is not a difference to flag.
			differs: variants.map((variant) => {
				const { step } = variant;
				const top = topFor(step);
				const flag = !agreed(variant);
				return {
					diluentMl: flag && !near(step.diluentMl, top.diluentMl),
					concentration: flag && step.concentrationMgPerMl !== top.concentrationMgPerMl,
					diluents: flag && step.diluents.join() !== top.diluents.join()
				};
			})
		});
	}
	const missing = relevant.filter((pkg) => !vialRows(pkg).length).map((pkg) => pkg.ndc);
	return { status: 'stated', groups, missing, readyToUse };
}
