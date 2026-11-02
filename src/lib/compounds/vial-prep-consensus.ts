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
		routes: intersect(rows.map((row) => row.routes))
	};
}

/** Vial rows only: oral-constitution bottle rows are not vial preparation. */
const vialRows = (pkg: VialPrepPackage) => pkg.reconstitution.filter((row) => !row.bottle);

/**
 * The preparation every allowed package agrees on.
 *
 * - `consensus`: every dry-fill package voted, and at least one step is common to all.
 * - `partial`: common steps exist among the voters, but some dry fills gave no instruction.
 * - `conflict`: the voters share no step.
 */
export function vialPrepConsensus(packages: readonly VialPrepPackage[]): VialPrepConsensus {
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
