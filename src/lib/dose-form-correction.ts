// ── Correcting a liquid dose form that is really a powder ────────────────────
// The FDA NDC directory's `dosage_form` is copied from the SPL's `<formCode>`,
// and labelers regularly code a constitutable powder as the liquid it becomes.
// Cipla's amoxicillin/clavulanate (69097-098-43) is coded `SUSPENSION` — in
// the directory *and* in the SPL XML — while every human-readable part of the
// same label says otherwise: the Dosage Forms section lists "Powder for Oral
// Suspension", the carton reads "… for Oral Suspension, USP", and the
// pharmacist is told to tap the bottle until the powder flows freely and add
// water. The miscoding matters downstream: `isDryFillForm` keys off the form,
// so the bottle's "75 mL" is taken as a finished volume instead of a
// post-constitution one.
//
// Correction is deliberately narrow, because a wrong "fix" is worse than the
// original error:
//
// - It only ever *promotes* a liquid to its own powder-for counterpart, from a
//   fixed table. It never picks a form out of free text, never changes route,
//   and never demotes a powder to a liquid.
// - It requires two independent kinds of evidence: the label *declaring* the
//   product a "… for <liquid>" (USP naming for a dry solid meant to be
//   constituted), and the label *instructing* constitution of it. Either alone
//   is common on genuine liquids — a suspension label may say "reconstituted
//   suspension" when comparing to a sibling powder, and a solution label may
//   say "for oral solution" of nothing at all.
// - Declarations are read only from product-identifying text (names, SPL
//   title, principal display panel, Dosage Forms and Strengths), not the body,
//   where a sibling product or a diluent ("Sterile Water for Injection") is
//   routinely named.
// - Any veto — ready-to-use wording, or a sibling product in the same SPL that
//   is *already* coded as the powder (meaning the liquid coding is likely a
//   genuinely separate product) — blocks the correction outright.
//
// The original form is always kept alongside the correction, with the
// evidence, so the change is auditable and reversible.

export type DoseFormEvidenceKind = 'declaration' | 'preparation' | 'reconstitution-table';

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
}

interface Rule {
	to: string;
	declaration: RegExp;
}

// Declarations follow USP monograph naming, where "X for Oral Suspension" is
// the dry article and "X Oral Suspension" the liquid.
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
	'INJECTION, SOLUTION': { to: 'INJECTION, POWDER, FOR SOLUTION', declaration: FOR_INJECTION }
};

// Diluents named "for Injection" are products in their own right and say
// nothing about the drug being dry.
const DILUENT =
	/\b(?:sterile\s+|bacteriostatic\s+)?(?:water|sodium\s+chloride|dextrose|lactated\s+ringer'?s?)\b[^.;:]{0,30}?\bfor\s+injection\b/gi;

const PREPARATION = [
	/\b(?:re)?constitut(?:e|ed|ing|ion)\b/i,
	/\btap\s+(?:the\s+)?bottle\b[^.]{0,40}\bpowder\b/i,
	/\badd\b[^.]{0,60}\b(?:water|diluent)\b[^.]{0,40}\b(?:to|into)\s+the\s+(?:powder|bottle|vial)\b/i,
	/\bdry\s+powder\b/i,
	/\b(?:prior\s+to|before)\s+(?:re)?constitution\b/i
];

// Wording that says the product as supplied is already the liquid.
const READY_TO_USE =
	/\bready[-\s]to[-\s]use\b|\bdoes\s+not\s+require\s+(?:re)?constitution\b|\bno\s+(?:re)?constitution\s+(?:is\s+)?(?:required|necessary)\b|\bpremixed\b/i;

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

	if ((input.siblingForms ?? []).some((form) => form && normalize(form) === rule.to)) return null;
	const everything = { ...input.identity, ...input.instructions };
	if (findFirst(everything, READY_TO_USE)) return null;

	const declared = findFirst(input.identity, rule.declaration, (text) =>
		text.replace(DILUENT, ' ')
	);
	if (!declared) return null;

	const evidence: DoseFormEvidence[] = [{ kind: 'declaration', ...declared }];
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
	return evidence.some((item) => item.kind !== 'declaration')
		? { from: input.doseForm, to: rule.to, evidence }
		: null;
}
