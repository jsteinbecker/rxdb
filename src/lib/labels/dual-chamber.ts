/**
 * Whether a package keeps its powder and diluent apart inside one container.
 *
 * B. Braun's DUPLEX® bag (0264-3153-11: ceftriaxone 1 g over 50 mL of 3.74%
 * dextrose), Pfizer's Act-O-Vial and the dual-chamber syringes are sold
 * already holding their diluent. Nobody draws up diluent and adds it: the
 * seal between the chambers is broken and the contents mix in place, so a
 * vial-and-syringe reconstitution diagram describes something that never
 * happens. Nothing structured says so — openFDA calls the DUPLEX bag a
 * "CONTAINER" of "INJECTION, POWDER, FOR SOLUTION", and its SPL lists the
 * dextrose as an inactive ingredient — so this reads the label's own words.
 *
 * A system that pairs a separate vial with a separate bag (ADD-Vantage,
 * MINI-BAG Plus, Vial-Mate) is not one container and is not matched here.
 *
 * Pure and shared, like $lib/labels/kit-parts.ts.
 *
 * @module
 */

import type { ExternalPackage } from '../catalog/types';
import { toNdc11 } from '../catalog/ndc';
import { toMg } from '../medication/units';

export type DualChamberContainer = 'bag' | 'syringe' | 'cartridge' | 'vial';

export interface DualChamber {
	/** The labeler's name for the system ("DUPLEX"), when the label gives one. */
	system: string | null;
	container: DualChamberContainer;
	/** What the diluent chamber holds ("3.74% dextrose injection"), when stated. */
	diluent: string | null;
	/** Volume of the diluent chamber, mL, when stated. */
	diluentMl: number | null;
	/** The label passage that says the container has two chambers. */
	evidence: string;
}

type Pkg = Pick<ExternalPackage, 'ndc' | 'description' | 'size'> & {
	details?: Pick<NonNullable<ExternalPackage['details']>, 'label'> | null;
	reconstitution?: Pick<ExternalPackage['reconstitution'][number], 'vialMassMg'>[];
};

/** Proprietary names for a single container with a drug and a diluent chamber. */
const SYSTEMS: [RegExp, string, DualChamberContainer][] = [
	[/\bDUPLEX\b/, 'DUPLEX', 'bag'],
	[/\bAct-O-Vial\b/i, 'Act-O-Vial', 'vial'],
	[/\bMix-O-Vial\b/i, 'Mix-O-Vial', 'vial'],
	[/\bUni-?Vial\b/i, 'Univial', 'vial']
];

/**
 * "dual chamber container", "two-compartment syringe", "flexible dual chamber
 * container". The container noun is required: Clinical Pharmacology's
 * "two-compartment model" is about the patient, not the package.
 */
const CHAMBERED =
	/\b(?:dual|two|double|2)[- ]?(?:chamber|compartment)(?:ed)?\b[^.;]{0,40}?\b(container|bag|syringe|cartridge|pen|vial|unit|system|package)s?\b/i;
/** "the diluent chamber", "drug chamber" — said only of a chambered container. */
const NAMED_CHAMBER = /\b(?:diluent|drug|powder|solution)\s+(?:chamber|compartment)\b/i;

/** Sections a labeler describes its container in; the rest only mention it. */
const SECTIONS = [
	'package_label_principal_display_panel',
	'how_supplied',
	'dosage_forms_and_strengths',
	'description',
	'dosage_and_administration'
];

const PLAIN_CONTAINER = /^(?:VIAL|BOTTLE|AMPULE|JAR)\b/i;

const containerOf = (noun: string | null, packaged: string | null): DualChamberContainer => {
	const word = `${noun ?? ''} ${packaged ?? ''}`.toUpperCase();
	if (/SYRINGE|\bPEN\b/.test(word)) return 'syringe';
	if (/CARTRIDGE/.test(word)) return 'cartridge';
	if (/VIAL/.test(word)) return 'vial';
	return 'bag';
};

const normalize = (text: string) =>
	text
		.replace(/[‐-―−]/g, '-')
		.replace(/(\d)\s*-\s*(?=\d)/g, '$1-')
		.replace(/\s+/g, ' ');

/**
 * Whether the passage that names `ndc` in `text` says the container has two
 * chambers: from the end of the previous NDC (or `reach` characters back) to
 * the end of the sentence, stopping short of the next NDC. Solu-Medrol's list
 * names its plain vials and its Act-O-Vials one after another; each NDC's own
 * stretch says which it is.
 */
function namesNdcNearby(text: string, ndc: string, reach = 200): boolean {
	const ndcs = [...text.matchAll(/\b\d{4,5}-\d{3,4}-\d{1,2}\b/g)];
	return ndcs.some((match, i) => {
		if (toNdc11(match[0]) !== ndc) return false;
		const at = match.index ?? 0;
		const previousEnd = i ? (ndcs[i - 1].index ?? 0) + ndcs[i - 1][0].length : 0;
		const end = at + match[0].length;
		const next = ndcs[i + 1]?.index ?? text.length;
		const sentenceEnd = text.indexOf('. ', end);
		const stop = Math.min(next, sentenceEnd < 0 ? text.length : sentenceEnd + 1, end + reach);
		const window = text.slice(Math.max(previousEnd, at - reach), stop);
		return (
			CHAMBERED.test(window) ||
			NAMED_CHAMBER.test(window) ||
			SYSTEMS.some(([re]) => re.test(window))
		);
	});
}

const DILUENT_NAME = String.raw`((?:\d+(?:\.\d+)?\s*%\s+)?[a-z][a-z ]*?(?:injection|(?:chloride|dextrose|water)(?:\s+(?:for\s+)?injection)?)(?:,?\s*USP)?)\b`;

/**
 * "1 g ceftriaxone for injection and 50 mL of 3.74% dextrose injection": each
 * strength's drug and diluent, as Dosage Forms and Strengths pairs them. A
 * parenthetical between them ("(as a blend of … USP/NF)") is skipped whole.
 */
const PAIRING = new RegExp(
	String.raw`(\d+(?:\.\d+)?)\s*(mcg|mg|g)\b(?:\([^)]*\)|[^.;()]){0,80}?\band\s+(?:approximately\s+)?(\d+(?:\.\d+)?)\s*mL\s+of\s+` +
		DILUENT_NAME,
	'gi'
);

/** "50 mL of 0.45% Sodium Chloride 0264- 3446-11": a How Supplied row's diluent, just before its NDC. */
const ROW_DILUENT = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*mL\s+of\s+` + DILUENT_NAME, 'gi');

/** "The diluent chamber contains approximately 50 mL of 0.9% Sodium Chloride Injection USP." */
const DILUENT_CHAMBER =
	/\bdiluent\s+(?:chamber|compartment)\s+contains\s+(?:approximately\s+)?(?:(\d+(?:\.\d+)?)\s*mL\s+of\s+)?((?:[^.;]|\.(?=\d))+)/i;

type Diluent = { name: string; ml: number | null };

/** The How Supplied row naming `ndc`, read for its diluent. */
function rowDiluent(text: string, ndc: string): Diluent | null {
	let previousEnd = 0;
	for (const match of text.matchAll(/\b\d{4,5}-\d{3,4}-\d{1,2}\b/g)) {
		const start = match.index ?? 0;
		if (toNdc11(match[0]) === ndc) {
			const found = [
				...text.slice(Math.max(previousEnd, start - 80), start).matchAll(ROW_DILUENT)
			].at(-1);
			return found ? { name: found[2], ml: Number(found[1]) } : null;
		}
		previousEnd = start + match[0].length;
	}
	return null;
}

/**
 * What the diluent chamber holds: this NDC's How Supplied row, else the
 * pairing for this package's drug mass, else the label's sentence about the
 * diluent chamber, else the one pairing every strength shares.
 */
function diluentOf(sections: string[], ndc: string, massMg: number | null): Diluent | null {
	const text = sections.join(' ');
	const row = sections.map((section) => rowDiluent(section, ndc)).find(Boolean) ?? null;
	const pairs = [...text.matchAll(PAIRING)].map((m) => ({
		massMg: toMg(Number(m[1]), m[2]),
		ml: Number(m[3]),
		name: m[4]
	}));
	const only = (list: typeof pairs) =>
		new Set(list.map((p) => `${p.ml} ${p.name.toLowerCase()}`)).size === 1 ? list[0] : null;
	const forMass =
		massMg === null
			? null
			: only(pairs.filter((p) => p.massMg !== null && Math.abs(p.massMg - massMg) < 1e-6));
	// "contains 225 mg of sodium chloride and 50 mL of water" lists a recipe, not a diluent.
	const match = DILUENT_CHAMBER.exec(text);
	const stated =
		match && !/^\d+(?:\.\d+)?\s*(?:mcg|mg|g)\b/i.test(match[2].trim())
			? { name: match[2], ml: match[1] ? Number(match[1]) : null }
			: null;
	// Meropenem's rows say "50 mL of sodium chloride injection"; only the sentence says 0.9%.
	const specific = row ?? forMass;
	if (specific && !(stated?.name.includes('%') && !specific.name.includes('%'))) return specific;
	return stated ?? only(pairs);
}

const tidy = (name: string) =>
	name
		.trim()
		.replace(/\s+/g, ' ')
		.replace(/,?\s*USP$/i, '')
		.toLowerCase();

/**
 * The dual-chamber container `item` is, or null when it is not one. The label
 * must say so in a section about the package, and the passage must be about
 * this NDC: its own package description, a container that is not a plain vial
 * or bottle, or the NDC named beside the passage. A label shared by ordinary
 * vials and an Act-O-Vial matches only the Act-O-Vial's NDC.
 */
export function dualChamber(item: Pkg): DualChamber | null {
	const description = normalize(item.description ?? '');
	const sections = (item.details?.label?.sections ?? [])
		.filter((section) => SECTIONS.includes(section.key))
		.map((section) => normalize(section.text));
	const corpus = [description, ...sections].join(' \n ');

	const system = SYSTEMS.find(([re]) => re.test(corpus));
	const chambered = CHAMBERED.exec(corpus);
	if (!system && !chambered) return null;

	const packaged = item.size?.container ?? null;
	const own =
		CHAMBERED.test(description) ||
		SYSTEMS.some(([re]) => re.test(description)) ||
		(!!packaged && !PLAIN_CONTAINER.test(packaged)) ||
		sections.some((text) => namesNdcNearby(text, item.ndc));
	if (!own) return null;

	const evidenceAt = chambered?.index ?? system![0].exec(corpus)?.index ?? 0;
	const evidence = sentenceAround(corpus, evidenceAt);
	const massMg = item.reconstitution?.find((row) => row.vialMassMg !== null)?.vialMassMg ?? null;
	const diluent = diluentOf(sections, item.ndc, massMg);
	const sizeMl =
		item.size?.kind === 'volume' && /^ml$/i.test(item.size.unit ?? '') ? item.size.value : null;
	return {
		system: system?.[1] ?? null,
		container: system?.[2] ?? containerOf(chambered?.[1] ?? null, packaged),
		diluent: diluent ? tidy(diluent.name) : null,
		diluentMl: diluent?.ml ?? sizeMl,
		evidence
	};
}

function sentenceAround(text: string, at: number): string {
	const start = Math.max(text.lastIndexOf('. ', at) + 2, text.lastIndexOf('\n', at) + 1, 0);
	const stop = text.indexOf('. ', at);
	const sentence = text
		.slice(start, stop < 0 ? undefined : stop + 1)
		// "3 DOSAGE FORMS AND STRENGTHS Dual-chamber, …": the section heading is not the label's words.
		.replace(/^\s*\d+(?:\.\d+)*\s+[A-Z][A-Z/&, ]+?\s+(?=[A-Z][a-z]|[A-Z]+-[a-z])/, '')
		.trim();
	return sentence.length <= 200 ? sentence : `${sentence.slice(0, 200).replace(/\s+\S*$/, '')}…`;
}
