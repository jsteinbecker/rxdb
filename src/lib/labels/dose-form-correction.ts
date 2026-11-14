/**
 * Correcting a liquid dose form that is really a powder.
 *
 * The FDA NDC directory's `dosage_form` is copied from the SPL's `<formCode>`,
 * and labelers regularly code a constitutable powder as the liquid it becomes.
 * Cipla's amoxicillin/clavulanate (69097-098-43) is coded `SUSPENSION` — in
 * the directory *and* in the SPL XML — while every human-readable part of the
 * same label says otherwise: the Dosage Forms section lists "Powder for Oral
 * Suspension", the carton reads "… for Oral Suspension, USP", and the
 * pharmacist is told to tap the bottle until the powder flows freely and add
 * water. The miscoding matters downstream: `isDryFillForm` keys off the form,
 * so the bottle's "75 mL" is taken as a finished volume instead of a
 * post-constitution one.
 *
 * Correction is deliberately narrow, because a wrong "fix" is worse than the
 * original error:
 *
 * - It only ever *promotes* a liquid to its own powder-for counterpart, from a
 *   fixed table. It never picks a form out of free text, never changes route,
 *   and never demotes a powder to a liquid.
 * - It requires two independent kinds of evidence: the label *declaring* the
 *   product a "… for <liquid>" (USP naming for a dry solid meant to be
 *   constituted), and the label *instructing* constitution of it. Either alone
 *   is common on genuine liquids — a suspension label may say "reconstituted
 *   suspension" when comparing to a sibling powder, and a solution label may
 *   say "for oral solution" of nothing at all.
 * - Declarations are read only from product-identifying text (names, SPL
 *   title, principal display panel, Dosage Forms and Strengths), not the body,
 *   where a sibling product or a diluent ("Sterile Water for Injection") is
 *   routinely named.
 * - Any veto — ready-to-use wording, or a sibling product in the same SPL that
 *   is *already* coded as the powder (meaning the liquid coding is likely a
 *   genuinely separate product) — blocks the correction outright.
 *
 * An injection is often coded plain `INJECTION` (Hikma's meropenem 0143-9430)
 * with no "for Injection" in any name, and only the Description or How
 * Supplied says the vial holds a powder. That prose stands in for the
 * declaration (`description` evidence), on stricter terms, since one SPL can
 * cover a powder vial and a ready-made solution:
 *
 * - A sentence counts only if it is about this product: it names this NDC, or
 *   this NDC's strength and no sibling's. A sentence naming nobody counts
 *   only when every other product on the label is coded as this one is. With
 *   a powder-coded sibling, only a sentence naming this NDC counts.
 * - Powder words must describe the article, not the drug substance:
 *   "meropenem is a white crystalline powder" is chemistry, true of a solution
 *   too. "Lyophilized", "dry powder", "sterile … powder" always qualify;
 *   a bare "powder" only beside a vial, "for injection" or constitution.
 * - A counted sentence calling the product a clear, sterile solution (not one
 *   made from it) vetoes the correction.
 *
 * The original form is always kept alongside the correction, with the
 * evidence, so the change is auditable and reversible.
 *
 * @module
 */

import type { LabelScope } from './label-relevance';
import { toMg } from '../medication/units';

export type DoseFormEvidenceKind =
	'declaration' | 'description' | 'preparation' | 'reconstitution-table';

export interface DoseFormEvidence {
	kind: DoseFormEvidenceKind;
	/** Where it was found: `generic_name`, `spl_title`, `dosage_forms_and_strengths`, … */
	source: string;
	/** A short excerpt around the match, for a human to check. */
	excerpt: string;
}

export interface DoseFormCorrection {
	from: string;
	to: string;
	evidence: DoseFormEvidence[];
}

export interface DoseFormInput {
	/** The imported form, e.g. openFDA `dosage_form`. */
	doseForm: string | null;
	/** Product-identifying text keyed by source: names, SPL title, PDP, DF&S. */
	identity: Record<string, string | null | undefined>;
	/** Instructional text keyed by source: D&A, how supplied, storage, … */
	instructions: Record<string, string | null | undefined>;
	/** Structured reconstitution rows already parsed from the label. */
	reconstitutionRows?: number;
	/** SPL `<formCode>` of the *other* products in the same document. */
	siblingForms?: (string | null)[];
	/** Text describing the article as supplied, keyed by source: description, how supplied. */
	supplied?: Record<string, string | null | undefined>;
	/** This NDC's product and package codes, hyphenated as the SPL writes them. */
	ownCodes?: string[];
	/** The other products' codes in the same document. */
	siblingCodes?: string[];
	/** The strengths this NDC and its label siblings come in (`labelScope`). */
	scope?: LabelScope | null;
}

interface Rule {
	to: string;
	declaration: RegExp;
	/** Whether Description / How Supplied prose may stand in for the declaration. */
	described?: boolean;
	/** The form when the article is said to be lyophilized. */
	lyophilized?: string;
	/** The form when the article is said to be for a suspension. */
	suspension?: string;
}

/**
 * Declarations follow USP monograph naming, where "X for Oral Suspension" is
 * the dry article and "X Oral Suspension" the liquid.
 */
const FOR_SUSPENSION = /\b(?:powder|granules?)?\s*for\s+(?:oral\s+)?suspension\b/i;
const FOR_SOLUTION = /\b(?:powder|granules?)?\s*for\s+(?:oral\s+)?solution\b/i;
const FOR_INJECTABLE_SUSPENSION =
	/\bfor\s+(?:injectable|extended-release\s+injectable)\s+suspension\b/i;
const FOR_INJECTION = /\bfor\s+injection\b/i;

const RULES: Record<string, Rule> = {
	SUSPENSION: { to: 'POWDER, FOR SUSPENSION', declaration: FOR_SUSPENSION },
	'SUSPENSION, EXTENDED RELEASE': {
		to: 'POWDER, FOR SUSPENSION, EXTENDED RELEASE',
		declaration: FOR_SUSPENSION
	},
	SOLUTION: { to: 'POWDER, FOR SOLUTION', declaration: FOR_SOLUTION },
	'INJECTION, SUSPENSION': {
		to: 'INJECTION, POWDER, FOR SUSPENSION',
		declaration: FOR_INJECTABLE_SUSPENSION
	},
	'INJECTION, SOLUTION': {
		to: 'INJECTION, POWDER, FOR SOLUTION',
		declaration: FOR_INJECTION,
		described: true,
		lyophilized: 'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION'
	},
	// FDA's catch-all, and RxNorm's only injectable dose form: neither says
	// whether the vial holds a liquid or a powder.
	INJECTION: {
		to: 'INJECTION, POWDER, FOR SOLUTION',
		declaration: FOR_INJECTION,
		described: true,
		lyophilized: 'INJECTION, POWDER, LYOPHILIZED, FOR SOLUTION',
		suspension: 'INJECTION, POWDER, FOR SUSPENSION'
	}
};
RULES['INJECTABLE SOLUTION'] = RULES['INJECTION, SOLUTION'];

/**
 * Diluents named "for Injection" are products in their own right and say
 * nothing about the drug being dry.
 */
const DILUENT =
	/\b(?:sterile\s+|bacteriostatic\s+)?(?:water|sodium\s+chloride|dextrose|lactated\s+ringer'?s?)\b[^.;:]{0,30}?\bfor\s+injection\b/gi;

const PREPARATION = [
	/\b(?:re)?constitut(?:e|ed|ing|ion)\b/i,
	/\btap\s+(?:the\s+)?bottle\b[^.]{0,40}\bpowder\b/i,
	/\badd\b[^.]{0,60}\b(?:water|diluent)\b[^.]{0,40}\b(?:to|into)\s+the\s+(?:powder|bottle|vial)\b/i,
	/\bdry\s+powder\b/i,
	/\b(?:prior\s+to|before)\s+(?:re)?constitution\b/i
];

/**
 * Wording that says the product as supplied is already the liquid. "Do not
 * remove the foil strip until ready to use" (a Duplex powder) is not.
 */
const READY_TO_USE =
	/(?<!\b(?:until|when|if)\s+)\bready[-\s]to[-\s]use\b|\bdoes\s+not\s+require\s+(?:re)?constitution\b|\bno\s+(?:re)?constitution\s+(?:is\s+)?(?:required|necessary)\b|\bpremixed\b/i;

/**
 * The article as supplied is dry. A bare "powder" is too often the drug
 * substance's chemistry to count without something tying it to the vial.
 */
const POWDER_ARTICLE =
	/\blyophili[sz](?:ed|ate)\b|\bfreeze[-\s]dried\b|\bdry\s+powder\b|\bsterile\b[^.;]{0,40}\bpowder\b|\bpowder\s+for\s+(?:injection|solution|suspension|reconstitution)\b/i;
const POWDER = /\bpowder\b/i;
const ARTICLE_CONTEXT =
	/\bvials?\b|\bfor\s+injection\b|\bsupplied\b|\bcontainers?\b|\b(?:re)?constitut/i;
const LYOPHILIZED = /\blyophili[sz](?:ed|ate)\b|\bfreeze[-\s]dried\b/i;
const SUSPENSION_ARTICLE =
	/\bfor\s+(?:injectable\s+|extended-release\s+injectable\s+)?suspension\b/i;

/**
 * The article as supplied is a liquid: the product *is* or *is supplied as* a
 * solution — unless the sentence is about the solution made from it, or about
 * a diluent (a Duplex container's dextrose chamber). Drug-substance chemistry
 * ("the pH of a 1% aqueous solution is 6.7") says nothing either way.
 */
const LIQUID =
	/\b(?:is|are)\s+(?:a|an)\b[^.;]{0,60}\bsolutions?\b|\bsupplied\s+as\s+(?:a\s+)?[^.;]{0,40}\bsolutions?\b|\beach\s+mL\s+contains\b/i;
const MADE_UP = /\b(?:re)?constitut|\bdilut|\badmix|\bprepared\b|\bresulting\b|\bafter\b|\bwhen\b/i;
const DILUENT_SUBJECT = /\b(?:dextrose|sodium\s+chloride|water|diluent|lactated)\b/i;

const MASS = /(\d+(?:\.\d+)?)\s*(mcg|mg|grams?|gm|g)(?![a-z])/gi;

const normalize = (form: string) => form.trim().toUpperCase().replace(/\s+/g, ' ');

function excerpt(text: string, index: number, length: number): string {
	const start = Math.max(0, index - 50);
	const end = Math.min(text.length, index + length + 50);
	return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

function findFirst(
	sources: Record<string, string | null | undefined>,
	pattern: RegExp,
	clean: (text: string) => string = (text) => text
): { source: string; excerpt: string } | null {
	for (const [source, raw] of Object.entries(sources)) {
		if (!raw) continue;
		const text = clean(raw);
		const match = pattern.exec(text);
		if (match) return { source, excerpt: excerpt(text, match.index, match[0].length) };
	}
	return null;
}

const sentencesOf = (text: string) =>
	text
		.replace(DILUENT, ' ')
		.split(/(?<=[.;])\s+|\n+/)
		.map((sentence) => sentence.trim())
		.filter(Boolean);

const namesCode = (sentence: string, codes: string[]) =>
	codes.some((code) =>
		new RegExp(`(?<![\\d-])${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d])`).test(sentence)
	);

function massesIn(sentence: string): number[] {
	return [...sentence.matchAll(MASS)].flatMap((match) => {
		const unit = match[2].toLowerCase();
		const mg = toMg(Number(match[1]), unit.startsWith('gram') || unit === 'gm' ? 'g' : unit);
		return mg === null ? [] : [mg];
	});
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.005 * Math.max(a, b);

type Attribution = 'ndc' | 'strength' | 'none' | 'sibling';

/** Whom a sentence of a shared label is about. */
function attribute(sentence: string, input: DoseFormInput): Attribution {
	const own = namesCode(sentence, input.ownCodes ?? []);
	const sibling = namesCode(sentence, input.siblingCodes ?? []);
	if (own && !sibling) return 'ndc';
	if (sibling && !own) return 'sibling';
	if (own && sibling) return 'none';
	const scope = input.scope;
	if (!scope) return 'none';
	const masses = massesIn(sentence);
	const names = (strengths: { mg: number | null }[]) =>
		strengths.some((s) => s.mg !== null && masses.some((mg) => near(mg, s.mg!)));
	const ownNamed = names(scope.own.strengths);
	const siblingNamed = names(scope.siblings.flatMap((s) => s.strengths));
	if (ownNamed && !siblingNamed) return 'strength';
	if (siblingNamed && !ownNamed) return 'sibling';
	return 'none';
}

interface Described {
	evidence: { source: string; excerpt: string } | null;
	liquid: boolean;
	lyophilized: boolean;
	suspension: boolean;
}

/** What this product's own Description / How Supplied sentences say it is. */
function describe(input: DoseFormInput, from: string): Described {
	const result: Described = {
		evidence: null,
		liquid: false,
		lyophilized: false,
		suspension: false
	};
	const otherForms = (input.siblingForms ?? []).filter(
		(form): form is string => !!form && normalize(form) !== from
	);
	const powderSibling = otherForms.some((form) =>
		/\b(?:POWDER|LYOPHILIZED)\b/.test(normalize(form))
	);
	for (const [source, raw] of Object.entries(input.supplied ?? {})) {
		if (!raw) continue;
		for (const sentence of sentencesOf(raw)) {
			const by = attribute(sentence, input);
			if (by === 'sibling') continue;
			if (powderSibling ? by !== 'ndc' : by === 'none' && otherForms.length) continue;
			if (
				LIQUID.test(sentence.replace(/\bfor\s+(?:injectable\s+)?solution\b/gi, ' ')) &&
				!MADE_UP.test(sentence) &&
				!DILUENT_SUBJECT.test(sentence)
			)
				result.liquid = true;
			const powder =
				POWDER_ARTICLE.test(sentence) || (POWDER.test(sentence) && ARTICLE_CONTEXT.test(sentence));
			if (!powder) continue;
			result.evidence ??= { source, excerpt: excerpt(sentence, 0, sentence.length) };
			if (LYOPHILIZED.test(sentence)) result.lyophilized = true;
			if (SUSPENSION_ARTICLE.test(sentence)) result.suspension = true;
		}
	}
	return result;
}

/**
 * The powder-for form a miscoded liquid should carry, with the evidence for
 * it — or null when the imported form is not a known miscoding target, the
 * evidence is incomplete, or anything argues against it.
 */
export function correctDoseForm(input: DoseFormInput): DoseFormCorrection | null {
	if (!input.doseForm) return null;
	const from = normalize(input.doseForm);
	const rule = RULES[from];
	if (!rule) return null;

	const everything = { ...input.identity, ...input.instructions };
	if (findFirst(everything, READY_TO_USE)) return null;

	const described = rule.described ? describe(input, from) : null;
	if (described?.liquid) return null;
	// Any powder sibling (`…, POWDER, LYOPHILIZED, FOR SOLUTION` included) means the
	// label's dry-product text may describe that product rather than this one —
	// unless the description names this NDC (`describe` counts nothing else then).
	const powderSibling = (input.siblingForms ?? []).some(
		(form) => form && /\b(?:POWDER|LYOPHILIZED)\b/.test(normalize(form))
	);
	const declared = powderSibling
		? null
		: findFirst(input.identity, rule.declaration, (text) => text.replace(DILUENT, ' '));
	if (!declared && !described?.evidence) return null;

	const evidence: DoseFormEvidence[] = [
		...(declared ? [{ kind: 'declaration' as const, ...declared }] : []),
		...(described?.evidence ? [{ kind: 'description' as const, ...described.evidence }] : [])
	];
	for (const pattern of PREPARATION) {
		const found = findFirst(everything, pattern);
		if (found) {
			evidence.push({ kind: 'preparation', ...found });
			break;
		}
	}
	if (input.reconstitutionRows) {
		evidence.push({
			kind: 'reconstitution-table',
			source: 'label',
			excerpt: `${input.reconstitutionRows} reconstitution instruction(s) parsed from the label`
		});
	}
	if (!evidence.some((item) => item.kind === 'preparation' || item.kind === 'reconstitution-table'))
		return null;
	const identityText = Object.values(input.identity).filter(Boolean).join('\n');
	const lyophilized = described?.lyophilized || LYOPHILIZED.test(identityText);
	const suspension = described?.suspension || SUSPENSION_ARTICLE.test(identityText);
	const to = (lyophilized && rule.lyophilized) || (suspension && rule.suspension) || rule.to;
	return { from: input.doseForm, to, evidence };
}
