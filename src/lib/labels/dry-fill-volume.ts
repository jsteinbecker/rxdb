/**
 * What does a dry-fill vial's labeled volume actually mean?
 *
 * `medication/ingredient-content.ts` establishes that a lyophilized vial's
 * strength denominator is labeler choice, not physics, and keys content
 * equivalence on the mass numerator instead. That fixes *concept* grouping. It does not fix the
 * presentation tier, which reads its volume from the packaging description —
 * and that number is the same labeler choice wearing a different hat.
 *
 * Piperacillin/tazobactam 225 mg/mL is the clean case. Every one of these
 * packages holds one of exactly two vials, 13.5 g or 40.5 g of drug substance:
 *
 * ```text
 *   Hospira    0409-2999   "12 g/60mL"    60 mL in 1 VIAL, PHARMACY BULK
 *   Sandoz     0781-3117   "12 g/100mL"   (13.5 g, same vial)
 *   Provepharm 81284-155   "36 g/180mL"   180 mL in 1 VIAL, PHARMACY BULK
 *   Sagent     25021-181   "36 g/152mL"   152 mL in 1 BOTTLE
 *   Sandoz     0781-3180   "36 g/250mL"   250 mL in 1 VIAL, PHARMACY BULK
 *   Eugia      55150-473   "36 g/250mL"   152 mL in 1 VIAL, PHARMACY BULK
 * ```
 *
 * and the labels say why they disagree. Sagent: "Reconstitute the pharmacy bulk
 * package bottle with exactly 152 mL ... to a concentration of 200 mg per mL of
 * piperacillin". Hospira: "with exactly 51 mL". Both describe the same
 * reconstitution — 200 mg/mL piperacillin — so 152 mL is *diluent added* while
 * Hospira's 60 mL is the *volume that results* from adding 51 mL. Sandoz's
 * 250 mL is neither: it is the bottle's capacity. Eugia writes one number in
 * the strength and another in the packaging.
 *
 * Three incompatible meanings for one field, and nothing in the NDC directory
 * distinguishes them. The label does, and it is a document this app already
 * fetches: `server/catalog/enrich-packages.ts` pulls whole prescribing-information
 * documents from openFDA to settle multi-dose. Mining reconstitution out of the same response
 * costs no additional call.
 *
 * The arithmetic that closes it:
 *
 * ```text
 *   finalVolume = contentMass / statedConcentration
 * ```
 *
 * — 40 500 mg ÷ 225 mg/mL = 180 mL, 13 500 mg ÷ 225 mg/mL = 60 mL. Never
 * diluent + something: powder displaces diluent, so 152 mL of diluent yields
 * 180 mL, not 152. The stated concentration is the only honest route, which is
 * why a row with no concentration resolves nothing here rather than guessing.
 *
 * Everything in this module is pure. Fetching is the caller's job.
 *
 * @module
 */

import {
	diluentList,
	diluentsIn,
	type ReconstitutionRoute,
	routeList,
	routesIn
} from './reconstitution-terms.js';
import { mgPer } from '../medication/units.js';

/** What a labeled volume on a dry-fill package turns out to denote. */
export type VolumeMeaning =
	/** The volume the reconstituted vial yields — a real, comparable size. */
	| 'final'
	/** Diluent to be added. Smaller than the yield; not a container size. */
	| 'diluent'
	/** Neither: the container's capacity, or a number the label never uses. */
	| 'capacity'
	/** No label evidence reached this package. */
	| 'unknown';

/** One ingredient's stated post-reconstitution concentration. */
export interface StatedConcentration {
	/** Ingredient as the sentence names it, uppercased; null when unattributed. */
	name: string | null;
	mgPerMl: number;
}

/** A reconstitution instruction recovered from label prose. */
export interface ProseReconstitution {
	/** Vial content the sentence names ("of 13.5 grams/vial"), when it does. */
	vialMassMg: number | null;
	/** Diluent to add, in mL. */
	diluentMl: number;
	/** Concentrations the sentence says result. Empty when it states none. */
	concentrations: StatedConcentration[];
	/** Volume the label states the vial yields ("Withdrawal Volume"), when it does. */
	finalVolumeMl?: number | null;
	/** `finalVolumeMl` is the volume to withdraw for the vial's content (reconstitution.ts). */
	withdrawn?: true;
	/**
	 * Routes this instruction is for, when the label says. Absent means
	 * unstated, not "any": a label with one instruction often never names it.
	 */
	routes?: ReconstitutionRoute[];
	/** Diluents the label allows for this instruction (`reconstitution-terms.ts` codes). */
	diluents?: string[];
	/**
	 * An oral-constitution bottle row: `finalVolumeMl` is the bottle, and its
	 * concentration is the product's strength rather than a vial's yield. Only
	 * `resolveBottleVolume` reads these; a vial resolver dividing a per-5 mL
	 * strength by them would invent a volume.
	 */
	bottle?: true;
	/**
	 * Stable handle for this row within its package, derived from its content
	 * (`reconstitutionRowId`). Assigned per package, so bare parser output has none.
	 */
	id?: string;
}

/**
 * Sentence boundaries, minus the one that matters here: a period between two
 * digits is a decimal point. "Reconstitute the pharmacy bulk vial of 13.5
 * grams/vial with exactly 152 mL" is one sentence, and a naive split turns the
 * vial mass into a fragment and the diluent volume into a sentence with no
 * reconstitution verb in it — losing both halves of the pair.
 */
const SENTENCE = /[.;](?=\s|$)|\n+/;

/** Split label prose into sentences without severing decimal numbers. */
export const sentences = (text: string): string[] =>
	text
		.split(SENTENCE)
		.map((sentence) => sentence.replace(/\s+/g, ' ').trim())
		.filter(Boolean);

/**
 * Diluent volume from "with exactly 152 mL", "with 10 mL of Sterile Water".
 *
 * `and`/`or` continue a `with` clause rather than opening one — "with exactly
 * 51mL (for 13.5 g bottle) and 152 mL (for 40.5 bottle)" states two
 * instructions under one verb. They are safe to admit only because the verb
 * governing the *first* volume is checked separately (see `head` below); on
 * their own they would swallow the stability paragraph's bag sizes.
 */
const DILUENT =
	/\b(?:with|and|or|by adding)\s+(?:exactly\s+|approximately\s+|about\s+)?([\d.]+)\s*mL\b/gi;

/**
 * Vial content the sentence states before a diluent clause — "the pharmacy
 * bulk vial of 13.5 grams/vial with exactly 152 mL", and the `and 40.5 grams`
 * that continues the same sentence for the other bottle. The negative lookahead
 * keeps "to a concentration of 200 mg per mL" from reading as a vial mass.
 */
const VIAL_MASS =
	/(?:\bof|\band)\s+([\d.]+)\s*(mcg|ug|mg|gm|grams?|g)\b(?!\s*(?:\/|\s+per\s+)\s*mL)/gi;

/**
 * The vial a volume is for, stated after it instead of before — "with exactly
 * 51mL (for 13.5 g bottle) and 152 mL (for 40.5 bottle)". The unit is optional
 * because labelers drop it on the second one, having written it on the first.
 */
const TRAILING_VIAL_MASS = /^\s*\(\s*(?:for\s+)?(?:the\s+)?([\d.]+)\s*(mcg|ug|mg|gm|grams?|g)?\b/i;

/**
 * The vial named as the *destination* of the diluent — "by adding 47 mL of
 * Sterile Water for Injection to the 5 g vial of dry, sterile vancomycin
 * powder". Bounded to a few words between the mass and the container noun so
 * it cannot reach into a later clause.
 */
const DESTINATION_VIAL_MASS =
	/^[^,;]*?\bto\s+(?:the|each|a)\s+([\d.]+)\s*(mcg|ug|mg|gm|grams?|g)\s+(?:[\w-]+\s+){0,3}?(?:vial|bottle|package)\b/i;

/**
 * Verbs that can govern a diluent volume. The last one before the first
 * volume decides whether the sentence is reconstitution; "the reconstituted
 * solution" is a noun phrase and never governs.
 */
const GOVERNING_VERB =
	/\b(?<!(?:the|this|of|with)\s)(reconstitut\w*|dilut\w*|mix\w*|combin\w*|sweeten\w*|blend\w*)/gi;

/** Where the resulting concentration is announced. */
const YIELD = /\b(?:to|yield(?:s|ing)?|resulting in|providing|giving)\b[^]*$/i;

/**
 * "200 mg/mL of piperacillin", "25 mg per mL of tazobactam", "100 mg/mL".
 * The ingredient tail is optional: a single-ingredient label states the
 * concentration bare, and attributing it to nothing is the honest reading.
 */
const CONCENTRATION =
	/([\d.]+)\s*(mcg|ug|mg|gm|grams?|g)\s*(?:\/|\s+per\s+)\s*mL\b(?:\s+of\s+([A-Za-z][A-Za-z' -]*?))?(?=\s*(?:and\b|[,.;:(]|$))/gi;

/**
 * Where a diluent clause ends and the sentence moves on — to the yield ("to
 * yield 2 mL", "to a concentration of") or to a next step ("then further
 * dilute in 100 mL of 0.9% Sodium Chloride").
 */
const DILUENT_CLAUSE_END =
	/\b(?:then|further|yield\w*|resulting|giving|providing|to\s+(?:a|an|yield|make|give|provide|obtain|prepare)\b)/i;

const HEADING_SMALL_WORD = /^(?:and|or|of|for|the|to|in|by|with|a|an|use)$/;

/**
 * A heading line — "Intramuscular Injection", "For Intravenous Use",
 * "Storage" — rather than a sentence: a few capitalized words and no volume.
 * Headings set the route context for what follows; one naming no route clears it.
 */
const isHeading = (sentence: string): boolean => {
	const words = sentence.replace(/[:.]$/, '').split(' ');
	return (
		words.length <= 6 &&
		!/\d/.test(sentence) &&
		words.every((word) => /^[A-Z(]/.test(word) || HEADING_SMALL_WORD.test(word))
	);
};

const finite = (value: number): number | null =>
	Number.isFinite(value) && value > 0 ? value : null;

const toMg = (value: string, unit: string): number | null => {
	const scale = mgPer(unit);
	return scale === null ? null : finite(Number(value) * scale);
};

const normalizeName = (name: string): string => name.trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * Reconstitution instructions stated in prose.
 *
 * Complements `parseReconstitutionTable` in reconstitution.ts, which reads the
 * matrix tables that carry the same facts for products like ceftriaxone. Some
 * labels tabulate and some write a sentence; piperacillin/tazobactam does both,
 * and the prose is the half that names the diluent volume for the bulk bottle.
 *
 * A sentence yields a row only when it pairs the reconstitution verb with a
 * diluent volume, which is what keeps the dilution, stability and Y-site
 * compatibility paragraphs — same document, plenty of volumes — out of the
 * result.
 */
export function parseReconstitutionProse(text: string): ProseReconstitution[] {
	const rows: ProseReconstitution[] = [];
	const seen = new Set<string>();
	// Route named by the nearest heading above ("Intramuscular Injection"),
	// until the next heading replaces or clears it.
	let headingRoutes: ReconstitutionRoute[] = [];

	for (const sentence of sentences(text)) {
		if (isHeading(sentence)) {
			headingRoutes = routesIn(sentence);
			continue;
		}
		// One sentence can carry several instructions. Sandoz's bulk label
		// writes "the pharmacy bulk bottle of 13.5 grams with exactly 51 mL and
		// 40.5 grams with exactly 152 mL of a compatible reconstitution
		// diluent" — a single sentence covering both bottles, and stopping at
		// the first pair answers the 13.5 g vial while leaving the 40.5 g one,
		// which is the package actually being asked about, unresolved.
		const diluents = [...sentence.matchAll(DILUENT)];
		if (!diluents.length) continue;

		// The clause introducing the first "with N mL" is what says whether the
		// sentence is a reconstitution instruction at all. Testing the whole
		// sentence is too loose: "Dilute the reconstituted solution with 50 mL
		// of 0.9% sodium chloride" names reconstitution and a volume, and is an
		// instruction about the bag, not the vial. The verb governing the
		// volume is the one that matters, and it sits before it.
		//
		// Only the *nearest* such verb counts. A section heading can open the
		// sentence — "Reconstitution and Dilution 5 g Pharmacy Bulk Package Vial
		// ... reconstitute by adding 47 mL" — so a `dilut` anywhere in the head
		// is no veto; one after the last `reconstitut` is. Compounding verbs
		// count too: the oral-use recipe "Mix sucrose and sterile water ... (e.g.,
		// 10 g sucrose and 20 mL sterile water)" sits right after "the
		// reconstituted Vancomycin hydrochloride solution", and "the
		// reconstituted" is an adjective naming what gets mixed, not an
		// instruction to reconstitute.
		const head = sentence.slice(0, diluents[0].index);
		const verbs = [...head.matchAll(GOVERNING_VERB)];
		const governing = verbs[verbs.length - 1];
		if (!governing || !/^reconstitut/i.test(governing[1])) continue;

		// The shared tail: "to a concentration of 200 mg/mL of piperacillin and
		// 25 mg/mL of tazobactam" is stated once and governs every pair, since
		// the whole point of the sentence is that both bottles reconstitute to
		// the same concentration.
		const last = diluents[diluents.length - 1];
		const tail = YIELD.exec(sentence.slice(last.index + last[0].length))?.[0] ?? '';
		const concentrations: StatedConcentration[] = [];
		for (const match of tail.matchAll(CONCENTRATION)) {
			const mgPerMl = toMg(match[1], match[2]);
			if (mgPerMl === null) continue;
			concentrations.push({ name: match[3] ? normalizeName(match[3]) : null, mgPerMl });
		}

		// Collected before they are converted, because a trailing parenthetical
		// may omit its unit and borrow the one a sibling in the same sentence
		// wrote: "(for 13.5 g bottle) and 152 mL (for 40.5 bottle)".
		const pairs: {
			diluentMl: number;
			mass: [string, string | undefined] | null;
			routes: ReconstitutionRoute[];
			diluents: string[];
		}[] = [];
		let from = 0;
		for (const [index, match] of diluents.entries()) {
			const diluentMl = finite(Number(match[1]));
			const before = sentence.slice(from, match.index);
			const after = sentence.slice(match.index + match[0].length);
			from = match.index + match[0].length;
			if (diluentMl === null) continue;

			// This pair's own stretch runs to the next volume. The diluent is named
			// in it ("with 10 mL of Sterile Water for Injection or 0.9% Sodium
			// Chloride"), but only up to where the sentence moves on to what the
			// solution becomes or where it goes next: "then further dilute in
			// 100 mL of 0.9% Sodium Chloride" names the bag's diluent, not the vial's.
			const next = diluents[index + 1];
			const own = next ? sentence.slice(from, next.index) : after;
			const diluentClause = own.split(DILUENT_CLAUSE_END)[0];

			// A route stated before this volume and after the previous one is this
			// pair's; failing that, the last pair of a sentence may state it after
			// ("with 10 mL ... for intravenous use"). Anything still unset inherits
			// from its sibling or the heading, below.
			const routes = routesIn(before);
			if (!routes.length && !next) routes.push(...routesIn(own));

			// The mass belonging to this pair is the last one stated before its
			// "with" clause and after the previous pair's — anchored on `of` or
			// `and` so "to a concentration of 200 mg" downstream can never be
			// read as one — or, failing that, the parenthetical right after it.
			let mass: [string, string | undefined] | null = null;
			for (const found of before.matchAll(VIAL_MASS)) mass = [found[1], found[2]];
			if (!mass) {
				const leading =
					/([\d.]+)\s*(mcg|ug|mg|gm|grams?|g)\s*(?:single[- ]dose\s+)?(?:vial|bottle)/i.exec(
						before
					);
				if (leading) mass = [leading[1], leading[2]];
			}
			if (!mass) {
				const destination = DESTINATION_VIAL_MASS.exec(after);
				if (destination) mass = [destination[1], destination[2]];
			}
			if (!mass) {
				const trailing = TRAILING_VIAL_MASS.exec(after);
				if (trailing) mass = [trailing[1], trailing[2]];
			}
			pairs.push({ diluentMl, mass, routes, diluents: diluentsIn(diluentClause) });
		}

		const statedUnit = pairs.find((pair) => pair.mass?.[1])?.mass?.[1];
		// Like the concentration tail, a diluent named once after the last volume
		// serves every pair: "the 500 mg vial with 2 mL and the 1 g vial with
		// 4 mL of Sterile Water for Injection".
		const sharedDiluents = pairs[pairs.length - 1]?.diluents ?? [];
		let inheritedRoutes = headingRoutes;
		for (const { diluentMl, mass, ...pair } of pairs) {
			const unit = mass?.[1] ?? statedUnit;
			const vialMassMg = mass && unit ? toMg(mass[0], unit) : null;
			if (pair.routes.length) inheritedRoutes = pair.routes;
			const routes = routeList(inheritedRoutes);
			const diluents = diluentList(pair.diluents.length ? pair.diluents : sharedDiluents);

			const key = `${vialMassMg}|${diluentMl}|${concentrations.map((c) => `${c.name}:${c.mgPerMl}`).join('+')}|${routes}|${diluents}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const finalVolume =
				pairs.length === 1
					? /(?:final|total|resulting|available) volume (?:of )?([\d.]+)\s*mL\b|yield(?:s|ing)?\s+(?:approximately\s+)?([\d.]+)\s*mL\b/i.exec(
							tail
						)
					: null;
			rows.push({
				vialMassMg,
				diluentMl,
				concentrations,
				...(finalVolume ? { finalVolumeMl: finite(Number(finalVolume[1] ?? finalVolume[2])) } : {}),
				...(routes ? { routes } : {}),
				...(diluents ? { diluents } : {})
			});
		}
	}

	return dedupeProseReconstitutions(rows);
}

// ── Concentrations the label states apart from its instructions ─────────────
// Vancomycin writes the instruction and its result in different sections:
// "Reconstitute the 500 mg vial with 10 mL" under Dosage and Administration,
// "When reconstituted with Sterile Water for Injection to a concentration of
// 50 mg/mL, the pH of the solution is between 2.5 and 4.5" under Description.
// Neither sentence resolves the vial alone; together they are exact.

/** A reconstituted concentration stated anywhere in a label. */
export interface LabelConcentration {
	mgPerMl: number;
	/** The vial it is stated for ("100 mg/mL for the 10 g bottle"), when it names one. */
	vialMassMg: number | null;
}

/**
 * "50 mg/mL", "50 mg per mL", "500 mg/10 mL", "50 mg of vancomycin/mL". Mass
 * units only: epoprostenol's "3,000 ng/mL" is an infusion, and units/mL is
 * not a mass.
 */
const STATED_CONCENTRATION =
	/(\d[\d,]*(?:\.\d+)?)\s*(mcg|ug|mg|gm|grams?|g)\s*(?:of\s+[A-Za-z-]+\s*)?(?:\/|\s+per\s+)\s*(?:([\d.]+)\s*)?mL\b/gi;

/** "Each 5 mL of reconstituted solution contains ... 250 mg". */
const EACH_CONTAINS =
	/\beach\s+([\d.]+)\s*mL\b[^;]{0,80}?\bcontains?\b[^;]{0,80}?\b([\d.]+)\s*(mcg|mg|gm|grams?|g)\b/gi;

/** A limit, not a result: "to no more than 5 mg/mL", "not to exceed 10 mg/mL". */
const LIMIT_BEFORE =
	/(?:no more than|not (?:to )?exceed|up to|less than|maximum(?: of)?|at least|final concentrations? of)\s*$/i;

const VIAL_AFTER = /^\s*(?:for|in)\s+(?:the|each|a)\s+([\d.]+)\s*(mcg|ug|mg|gm|grams?|g)\b/i;

/**
 * Reconstituted concentrations a label states, wherever it states them.
 *
 * A concentration counts only when reconstitution is what produced it: the
 * nearest governing verb before it is `reconstitut…`, never `dilut…` — the
 * same label goes on to "further dilute to a final concentration of no more
 * than 5 mg/mL", which is the bag. Limits are dropped for the same reason.
 */
export function statedReconstitutedConcentrations(text: string): LabelConcentration[] {
	const found: LabelConcentration[] = [];
	for (const sentence of sentences(text)) {
		if (!/reconstitut/i.test(sentence)) continue;
		for (const match of sentence.matchAll(STATED_CONCENTRATION)) {
			const before = sentence.slice(0, match.index);
			const verbs = [...before.matchAll(/\b(reconstitut\w*|dilut\w*|mix\w*|combin\w*)/gi)];
			if (!verbs.length || !/^reconstitut/i.test(verbs[verbs.length - 1][1])) continue;
			if (LIMIT_BEFORE.test(before)) continue;
			const mass = toMg(match[1].replace(/,/g, ''), match[2]);
			const per = match[3] ? finite(Number(match[3])) : 1;
			if (mass === null || per === null) continue;
			const vial = VIAL_AFTER.exec(sentence.slice(match.index + match[0].length));
			found.push({ mgPerMl: mass / per, vialMassMg: vial ? toMg(vial[1], vial[2]) : null });
		}
		if (/dilut/i.test(sentence)) continue;
		for (const match of sentence.matchAll(EACH_CONTAINS)) {
			const mass = toMg(match[2], match[3]);
			const per = finite(Number(match[1]));
			if (mass !== null && per !== null) found.push({ mgPerMl: mass / per, vialMassMg: null });
		}
	}
	const unique = new Map(found.map((c) => [`${c.mgPerMl}|${c.vialMassMg}`, c]));
	return [...unique.values()];
}

/**
 * Most diluent a gram of powder displaces. Labels run from almost none
 * (vancomycin: 10 mL onto 500 mg yields 10 mL) to cefepime's 1.2 mL/g with its
 * arginine; 1.5 leaves room for that and nothing like a wrong concentration.
 */
const MAX_DISPLACEMENT_ML_PER_G = 1.5;

/**
 * Give rows that state no result the one label concentration that fits them.
 *
 * A concentration fits a row when the volume it implies for the vial is what
 * adding that row's diluent could produce: at least the diluent, and no more
 * than the powder can displace on top of it. Pharmacy bulk labels state two
 * ("50 mg/mL for the 5 g bottle and 100 mg/mL for the 10 g bottle"); the vial
 * each names, or failing that the physics, picks one. A row that more than one
 * fits, or none, keeps no concentration — it stays unresolved rather than guessed.
 */
export function withLabelConcentrations(
	rows: readonly ProseReconstitution[],
	stated: readonly LabelConcentration[],
	vialMg: number | null
): ProseReconstitution[] {
	if (!stated.length) return [...rows];
	return rows.map((row) => {
		if (row.concentrations.length || row.finalVolumeMl != null) return row;
		const mass = row.vialMassMg ?? vialMg;
		if (!(mass && mass > 0)) return row;
		const fitting = new Set(
			stated
				.filter(
					(c) =>
						c.vialMassMg === null ||
						near(c.vialMassMg, mass) ||
						Math.abs(c.vialMassMg - mass) <= SALT_TOLERANCE * Math.max(c.vialMassMg, mass)
				)
				.filter((c) => {
					const yieldMl = mass / c.mgPerMl;
					return (
						yieldMl >= row.diluentMl * (1 - TOLERANCE) &&
						yieldMl - row.diluentMl <=
							(mass / 1000) * MAX_DISPLACEMENT_ML_PER_G + TOLERANCE * yieldMl
					);
				})
				.map((c) => c.mgPerMl)
		);
		if (fitting.size !== 1) return row;
		return { ...row, concentrations: [{ name: null, mgPerMl: [...fitting][0] }] };
	});
}

/**
 * Whether two rows could be the same instruction as far as route goes. A row
 * that names no route is compatible with any — the table and the prose often
 * state one instruction, and only one of them says what it is for — but IM
 * and IV rows with the same volume are two instructions, never one.
 */
const sameRoutes = (
	a: Pick<ProseReconstitution, 'routes'>,
	b: Pick<ProseReconstitution, 'routes'>
) => !a.routes?.length || !b.routes?.length || `${a.routes}` === `${b.routes}`;

const optionFields = (
	routes: ReconstitutionRoute[] | undefined,
	diluents: string[] | undefined
) => ({
	...(routes?.length ? { routes } : {}),
	...(diluents?.length ? { diluents } : {})
});

/** Collapse exact instructions and keep the version with the most evidence. */
export function dedupeProseReconstitutions(
	rows: readonly ProseReconstitution[]
): ProseReconstitution[] {
	const byInstruction = new Map<string, ProseReconstitution>();
	for (const row of rows) {
		const concentrations = [...row.concentrations].sort((a, b) =>
			`${a.name ?? ''}:${a.mgPerMl}`.localeCompare(`${b.name ?? ''}:${b.mgPerMl}`)
		);
		const baseKey = `${row.vialMassMg}|${row.diluentMl}`;
		const compatible = (previous: ProseReconstitution) =>
			(previous.finalVolumeMl == null ||
				row.finalVolumeMl == null ||
				previous.finalVolumeMl === row.finalVolumeMl) &&
			sameRoutes(previous, row) &&
			!previous.concentrations.some((a) =>
				concentrations.some((b) => a.name === b.name && a.mgPerMl !== b.mgPerMl)
			);
		const key =
			[...byInstruction.keys()].find(
				(key) => key.startsWith(`${baseKey}|`) && compatible(byInstruction.get(key)!)
			) ?? `${baseKey}|${byInstruction.size}`;
		const previous = byInstruction.get(key);
		if (!previous) {
			byInstruction.set(key, { ...row, concentrations });
			continue;
		}
		const merged = new Map<string, StatedConcentration>();
		for (const concentration of [...previous.concentrations, ...concentrations]) {
			merged.set(`${concentration.name ?? ''}:${concentration.mgPerMl}`, concentration);
		}
		byInstruction.set(key, {
			...(previous.bottle || row.bottle ? { bottle: true as const } : {}),
			vialMassMg: row.vialMassMg ?? previous.vialMassMg,
			diluentMl: row.diluentMl,
			concentrations: [...merged.values()],
			finalVolumeMl: previous.finalVolumeMl ?? row.finalVolumeMl,
			...((previous.finalVolumeMl != null ? previous.withdrawn : row.withdrawn)
				? { withdrawn: true as const }
				: {}),
			...optionFields(
				previous.routes ?? row.routes,
				diluentList([...(previous.diluents ?? []), ...(row.diluents ?? [])])
			)
		});
	}
	const deduped = [...byInstruction.values()];
	return deduped.filter((row) => {
		if (row.vialMassMg !== null) return true;
		return !deduped.some(
			(specific) =>
				specific !== row &&
				specific.vialMassMg !== null &&
				specific.diluentMl === row.diluentMl &&
				sameRoutes(specific, row) &&
				(row.concentrations.length === 0 ||
					specific.concentrations.some((candidate) =>
						row.concentrations.some(
							(existing) =>
								existing.name === candidate.name && existing.mgPerMl === candidate.mgPerMl
						)
					))
		);
	});
}

/**
 * Reconstitution rows from an SPL table, in the shape this module resolves.
 *
 * `reconstitutionFromLabel` (reconstitution.ts) mines the matrix tables, which
 * is where ceftriaxone and the rest of the tabulating labels keep the same
 * facts the piperacillin label writes as a sentence. A table row always names
 * its vial size, so it filters by mass exactly as a prose row does.
 */
export const fromReconstitutionRows = (
	rows: readonly {
		vialMassMg: number;
		diluentMl: number;
		concentrationMgPerMl: number | null;
		finalVolumeMl: number | null;
		withdrawn?: true;
		routes?: ReconstitutionRoute[];
		diluents?: string[];
	}[]
): ProseReconstitution[] =>
	rows.map((row) => ({
		vialMassMg: row.vialMassMg,
		diluentMl: row.diluentMl,
		concentrations:
			row.concentrationMgPerMl === null ? [] : [{ name: null, mgPerMl: row.concentrationMgPerMl }],
		finalVolumeMl: row.finalVolumeMl,
		...(row.withdrawn ? { withdrawn: true as const } : {}),
		...optionFields(row.routes, row.diluents)
	}));

/**
 * Bottle instructions stated in prose: vancomycin oral's "80 mL – Slowly add
 * 80 mL water and shake vigorously", or "For the 100 mL bottle, add 69 mL of
 * water". The water clause is required, which keeps "dilute in 1 oz of water"
 * and the dosing paragraphs out.
 */
const BOTTLE_PROSE =
	/\b([\d.]+)\s*mL(?:\s+bottle)?\s*(?:[–—:,-]|\s)\s*(?:slowly\s+)?add\s+([\d.]+)\s*mL\s+(?:of\s+)?(?:(?:purified|distilled|tap)\s+)?water\b/gi;

export function parseBottleProse(
	text: string
): { bottleMl: number; waterMl: number; concentrationMgPerMl: null }[] {
	const rows = new Map<string, { bottleMl: number; waterMl: number; concentrationMgPerMl: null }>();
	for (const match of text.matchAll(BOTTLE_PROSE)) {
		const bottleMl = finite(Number(match[1]));
		const waterMl = finite(Number(match[2]));
		if (bottleMl === null || waterMl === null || waterMl > bottleMl * (1 + TOLERANCE)) continue;
		rows.set(`${bottleMl}|${waterMl}`, { bottleMl, waterMl, concentrationMgPerMl: null });
	}
	return [...rows.values()];
}

/**
 * Bottle rows in the shape this module resolves. A bottle names no mass — its
 * content is whatever its strength times its volume comes to — so the row is
 * about any bottle of that finished volume, which is what `finalVolumeMl` says.
 */
export const fromBottleRows = (
	rows: readonly { bottleMl: number; waterMl: number; concentrationMgPerMl: number | null }[]
): ProseReconstitution[] =>
	rows.map((row) => ({
		vialMassMg: null,
		diluentMl: row.waterMl,
		concentrations:
			row.concentrationMgPerMl === null ? [] : [{ name: null, mgPerMl: row.concentrationMgPerMl }],
		finalVolumeMl: row.bottleMl,
		bottle: true
	}));

/**
 * Resolve a bottle whose strength is per volume ("400 mg/5mL") and whose
 * carton states a volume, from the label's bottle rows.
 *
 * `resolveDryFillVolume` needs a content mass to divide, and an oral powder
 * declares none: its strength is what the constituted suspension will be. The
 * evidence here is different and just as direct — the label lists this bottle
 * size and the water that makes it — so a row whose finished volume is the
 * labeled one, at this package's strength when the row states one, settles
 * the number as `final`. Rows that match but disagree on water resolve nothing.
 */
export function resolveBottleVolume(
	labeledMl: number | null,
	packageMgPerMl: number | null,
	rows: readonly ProseReconstitution[]
): ResolvedDryFillVolume {
	const unresolved: ResolvedDryFillVolume = {
		meaning: 'unknown',
		finalVolumeMl: null,
		diluentMl: null,
		concentrationMgPerMl: null
	};
	if (labeledMl === null) return unresolved;
	const matching = rows.filter(
		(row) =>
			row.bottle &&
			row.finalVolumeMl != null &&
			near(row.finalVolumeMl, labeledMl) &&
			(!row.concentrations.length ||
				(packageMgPerMl !== null &&
					row.concentrations.some((c) => near(c.mgPerMl, packageMgPerMl))))
	);
	if (!matching.length || new Set(matching.map((row) => row.diluentMl)).size !== 1)
		return unresolved;
	const row = matching[0];
	return {
		meaning: 'final',
		finalVolumeMl: labeledMl,
		diluentMl: row.diluentMl,
		concentrationMgPerMl: packageMgPerMl,
		...(row.id ? { rowId: row.id } : {})
	};
}

/**
 * A row's id: a hash of what it instructs, so it survives the reparse that
 * reorders rows (a positional key would then point an override at the wrong
 * instruction) and changes only when the instruction itself does — at which
 * point an override written against the old one should stop applying.
 */
export function reconstitutionRowId(row: ProseReconstitution): string {
	const content = [
		row.vialMassMg,
		row.diluentMl,
		row.finalVolumeMl ?? null,
		row.concentrations
			.map((c) => `${c.name ?? ''}:${c.mgPerMl}`)
			.sort()
			.join('+'),
		[...(row.routes ?? [])].sort().join('+'),
		[...(row.diluents ?? [])].sort().join('+')
	].join('|');
	// FNV-1a, 32-bit: short, dependency-free, and plenty for a dozen rows.
	let hash = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `r${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** The rows with ids assigned, suffixed on the off chance two rows hash alike. */
export function withRowIds(rows: readonly ProseReconstitution[]): ProseReconstitution[] {
	const used = new Map<string, number>();
	return rows.map((row) => {
		const base = reconstitutionRowId(row);
		const count = (used.get(base) ?? 0) + 1;
		used.set(base, count);
		return { ...row, id: count === 1 ? base : `${base}-${count}` };
	});
}

/**
 * The rows that apply to a vial of `totalMg`: those naming that mass, and
 * those naming none (which are about whatever vial the label was fetched for).
 * A shared label lists its sibling vial sizes too, and their volumes are wrong
 * for this one.
 */
export const rowsForVial = <T extends { vialMassMg: number | null }>(
	rows: readonly T[],
	totalMg: number
): T[] => {
	const labeled = rows.flatMap((row) => (row.vialMassMg === null ? [] : [row.vialMassMg]));
	// The package may state its salt while the label names the vial by its base:
	// Hikma's vancomycin bulk vial is "5.13 g" of the hydrochloride and "the 5
	// g vial" in the instructions. When no size matches outright, the closest
	// one within salt-conversion distance is this vial — never a sibling that
	// is merely nearer than the rest.
	const target = labeled.some((mg) => near(mg, totalMg))
		? totalMg
		: labeled
				.filter((mg) => Math.abs(mg - totalMg) <= SALT_TOLERANCE * Math.max(mg, totalMg))
				.sort((a, b) => Math.abs(a - totalMg) - Math.abs(b - totalMg))[0];
	return rows.filter(
		(row) => row.vialMassMg === null || (target !== undefined && near(row.vialMassMg, target))
	);
};

/** Widest salt-to-base mass ratio treated as the same vial (e.g. HCl salts). */
const SALT_TOLERANCE = 0.1;

// ── Resolving a package's labeled volume ────────────────────────────────────

/** What the label settled about one dry-fill package. */
export interface ResolvedDryFillVolume {
	/** Difference between resulting volume and added diluent, when both are known. */
	powderDisplacementMl?: number | null;
	/** What the packaging description's volume turned out to denote. */
	meaning: VolumeMeaning;
	/** Volume the reconstituted vial yields, in mL; null when unresolved. */
	finalVolumeMl: number | null;
	/** Diluent the label says to add, in mL; null when it never said. */
	diluentMl: number | null;
	/** Concentration used to derive `finalVolumeMl`, in mg/mL. */
	concentrationMgPerMl: number | null;
	/**
	 * The label's stated concentration and its withdrawal volume disagree
	 * about the vial's content, and the volume was taken (`resolveDryFillVolume`).
	 * Cefepime 1 g: "approximately 100 mg/mL", withdraw 10.5 mL — 1,050 mg.
	 * The row still shows the label's 100; this records why the resolved
	 * concentration is 95.2.
	 */
	concentrationConflict?: { statedMgPerMl: number; withdrawnMl: number };
	/**
	 * Id of the reconstitution row this was resolved from — the package's
	 * default instruction among possibly several (IM, IV, ...). Absent when the
	 * rows carry no ids or nothing resolved.
	 */
	rowId?: string;
}

/**
 * How close two volumes must be to count as the same number.
 *
 * Labels round: 12 g ÷ 200 mg/mL is exactly 60 mL, but a label declaring
 * "approximately 200 mg/mL" for a vial whose true yield is 61 mL is stating
 * the same instruction. 2% keeps that together while still separating Sagent's
 * 152 mL from the 180 mL it yields (an 18% gap) and Sandoz's 250 mL capacity
 * from both.
 */
const TOLERANCE = 0.02;

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE * Math.max(a, b);

/** Ingredient masses sealed in one container, keyed by normalized name. */
export type ContentMasses = ReadonlyMap<string, number>;

/**
 * Total content mass, in mg, summed across ingredients.
 *
 * Summing is right for the *combination* concentration a label states for a
 * co-formulated product ("225 mg/mL" for piperacillin + tazobactam), and is
 * the fallback when a concentration names no ingredient to match against.
 */
export const totalContentMg = (masses: ContentMasses): number =>
	[...masses.values()].reduce((sum, mg) => sum + mg, 0);

/**
 * Volume one reconstitution row yields for a vial of these contents, or null.
 *
 * Matches each stated concentration to the ingredient it names, so
 * "200 mg/mL of piperacillin" divides the piperacillin mass rather than the
 * combined one. An unattributed concentration divides the total, which is what
 * a single-ingredient label means and what a combination label's "225 mg/mL"
 * means. When several concentrations resolve they must agree — a sentence
 * whose ingredient ratios contradict the package's is describing a different
 * product, and the safe answer there is nothing at all.
 *
 * Names match on containment either way round: a label writes "piperacillin"
 * where openFDA writes "PIPERACILLIN SODIUM", and both name the same
 * ingredient whose declared mass is the salt-corrected one.
 */
export function yieldedVolumeMl(
	row: ProseReconstitution,
	masses: ContentMasses
): { volumeMl: number; concentrationMgPerMl: number } | null {
	const total = totalContentMg(masses);
	if (!(total > 0)) return null;

	const volumes: { volumeMl: number; concentrationMgPerMl: number }[] = [];
	for (const { name, mgPerMl } of row.concentrations) {
		if (!(mgPerMl > 0)) continue;
		let mass: number | null = null;
		if (name === null) mass = total;
		else {
			for (const [ingredient, mg] of masses) {
				if (ingredient.includes(name) || name.includes(ingredient)) {
					mass = mg;
					break;
				}
			}
		}
		if (mass === null) continue;
		volumes.push({ volumeMl: mass / mgPerMl, concentrationMgPerMl: mgPerMl });
	}
	if (!volumes.length) return null;
	if (!volumes.every((v) => near(v.volumeMl, volumes[0].volumeMl))) return null;

	// The combined concentration is the one worth reporting back: it is what
	// the resulting solution is, and it divides the whole content.
	return { volumeMl: volumes[0].volumeMl, concentrationMgPerMl: total / volumes[0].volumeMl };
}

/**
 * Decide what a dry-fill package's labeled volume denotes, from the label's
 * own reconstitution instructions.
 *
 * `rows` may come from prose (`parseReconstitutionProse`) or from the SPL
 * tables (`reconstitutionFromLabel` in reconstitution.ts) — a table row carries
 * a vial mass and a diluent volume and belongs here too, converted by the
 * caller. Rows for other vial sizes on the same label are filtered out by
 * `vialMassMg` when they state one, which is how a shared piperacillin label
 * covering both the 13.5 g and 40.5 g bottle answers each of them correctly.
 *
 * Returns `unknown` — never a guess — when no row resolves a yield. A package
 * whose meaning is unknown must keep displaying the number the labeler wrote;
 * replacing it with a derived one nobody confirmed is the failure this whole
 * module exists to avoid.
 */
export function resolveDryFillVolume(
	labeledMl: number | null,
	masses: ContentMasses,
	rows: readonly ProseReconstitution[]
): ResolvedDryFillVolume {
	const total = totalContentMg(masses);
	const unresolved: ResolvedDryFillVolume = {
		meaning: 'unknown',
		finalVolumeMl: null,
		diluentMl: null,
		concentrationMgPerMl: null
	};
	if (!(total > 0)) return unresolved;

	// A row naming a vial mass is only about that vial. One naming none is
	// about whatever vial the label was fetched for, which is this one.
	const applicable = rowsForVial(
		rows.filter((row) => !row.bottle),
		total
	);
	if (!applicable.length) return unresolved;

	let resolved: ResolvedDryFillVolume | null = null;
	for (const row of applicable) {
		// A stated concentration is the label's own arithmetic; failing that, a
		// stated withdrawal volume is, and dividing by it is exact rather than
		// the diluent-based guess the concentration docs warn against.
		const stated = yieldedVolumeMl(row, masses);
		const byVolume = row.finalVolumeMl
			? { volumeMl: row.finalVolumeMl, concentrationMgPerMl: total / row.finalVolumeMl }
			: null;
		// When the two disagree, a withdrawal volume wins over an "approximate"
		// concentration: concentrations are rounded to round numbers, volumes
		// are given to 0.1 mL, and the rest of the same table reconciles through
		// its volumes (cefepime: 280 × 3.6 and 160 × 12.5 are the vials; 100 ×
		// 10.5 is not). An available volume does not, since it holds overfill.
		const conflict =
			stated && byVolume && row.withdrawn && !near(stated.volumeMl, byVolume.volumeMl);
		const yielded = conflict ? byVolume : (stated ?? byVolume);
		if (!yielded) continue;
		const candidate: ResolvedDryFillVolume = {
			meaning: 'unknown',
			finalVolumeMl: yielded.volumeMl,
			diluentMl: row.diluentMl,
			concentrationMgPerMl: yielded.concentrationMgPerMl,
			...(conflict
				? {
						concentrationConflict: {
							statedMgPerMl: stated.concentrationMgPerMl,
							withdrawnMl: byVolume.volumeMl
						}
					}
				: {}),
			...(row.id ? { rowId: row.id } : {})
		};
		// A row whose diluent or yield matches the labeled number explains that
		// number, and is preferred over one that merely yields a volume — a
		// label listing several dilutions offers several yields, and the one
		// the packaging description echoes is the one it was written from.
		if (
			labeledMl !== null &&
			(near(labeledMl, row.diluentMl) || near(labeledMl, yielded.volumeMl))
		) {
			resolved = candidate;
			break;
		}
		resolved ??= candidate;
	}
	if (!resolved) return unresolved;

	const { finalVolumeMl, diluentMl } = resolved;
	const meaning: VolumeMeaning =
		labeledMl === null
			? 'unknown'
			: near(labeledMl, finalVolumeMl!)
				? 'final'
				: diluentMl !== null && near(labeledMl, diluentMl)
					? 'diluent'
					: 'capacity';

	return { ...resolved, meaning };
}

/**
 * A counted unit that is a parenteral dose form rather than a solid: openFDA's
 * "1 INJECTION, POWDER, FOR SOLUTION in 1 VIAL" counts the powder, not a volume.
 */
export const DOSE_FORM_UNIT = /\b(?:INJECTION|INJECTABLE|POWDER)\b/i;

// ── When is a label fetch worth it? ─────────────────────────────────────────

/**
 * Whether a package's labeled volume is ambiguous enough to spend a label
 * lookup on.
 *
 * `needsLabelLookup` (ndc-packaging.ts) asks the same question for multi-dose
 * and answers *no* for every powder — "multi-dose" is not a meaningful property
 * of a dry-fill vial, so those were deliberately kept out of Pass 2. This is
 * the other reason to fetch the same document, and it applies to exactly the
 * packages that one excludes: a lyophilized vial whose packaging description
 * states a volume that may be diluent, yield or capacity.
 *
 * A dry-fill package with no volume at all ("1 INJECTION, POWDER, FOR SOLUTION
 * in 1 VIAL") is asked too, but for the opposite reason: there is no number to
 * disambiguate, and the content mass alone cannot place it in the presentation
 * tier, which buckets on volume. Left unresolved it lands in a bare "VIAL"
 * bucket beside the sized ones (WG Critical Care's 36 g pharmacy bulk vial,
 * next to the 180 mL vials it is identical to). The label's stated
 * concentration turns its content into the same yield everyone else wrote down.
 */
export const needsVolumeLookup = (
	isDryFill: boolean,
	size: { kind: string; unit: string | null } | null
): boolean =>
	isDryFill &&
	((size?.kind === 'volume' && /^mL$/i.test(size.unit ?? '')) ||
		(size?.kind === 'count' && DOSE_FORM_UNIT.test(size.unit ?? '')));

/**
 * The volume to compare a dry-fill package by: the yield the label states, when
 * it stated one, and otherwise the number the labeler wrote.
 *
 * This is the whole point of the module at the display tier. Piperacillin/
 * tazobactam 225 mg/mL splits into six presentations — 51, 60, 152, 180, 250 mL
 * and a bare VIAL — describing two vials. Substituting the resolved yield sends
 * 51 to 60 and 152 and 250 to 180, leaving the two buckets that exist.
 *
 * Falling back to the labeled volume rather than to nothing is deliberate: an
 * unresolved package keeps showing the number on its carton, which is wrong
 * only in the way it was already wrong, instead of vanishing into UNSPECIFIED.
 */
export const comparableVolumeMl = (
	labeledMl: number | null,
	resolved: ResolvedDryFillVolume | null
): number | null => resolved?.finalVolumeMl ?? labeledMl;
