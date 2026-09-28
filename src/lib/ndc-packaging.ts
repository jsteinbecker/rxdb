// ── Packaging description parsing ────────────────────────────────────────────
// openFDA's NDC directory describes a package as nested levels joined by " / ",
// outermost first, each level shaped `<qty> [unit] in 1 <container>` with the
// package NDC parenthesized:
//
//   "10 VIAL in 1 CARTON (25021-321-04)  / 4 mL in 1 VIAL"
//   "100 TABLET in 1 BOTTLE (0093-1234-01)"
//   ".05 mL in 1 VIAL, SINGLE-DOSE (85006-2908-1)"
//
// The *innermost* level is the unit of use — the thing a nurse actually picks
// up. That is the field RxNorm cannot give us: `0.25 mg/mL Bumetanide` names a
// concentration, and only packaging says whether that's a 4 mL or a 10 mL vial.

/**
 * Bump whenever a change to `parseUnitOfUse` or `classifyMultiDose` below
 * would read an already-stored `package_description` differently — a new
 * separator, a widened container list, a fixed regex. `ndc-enrichment.ts`
 * stamps this on every row it writes and re-derives, locally and without an
 * upstream call, any row a newer version would parse differently. Without the
 * bump those rows sit `UNSPECIFIED` forever: the description was right there,
 * only an older parser ever looked at it.
 */
export const CURRENT_PARSER_VERSION = 3;

/** Innermost container as dispensed, with its quantity. */
export interface UnitOfUseSize {
	/** `volume`/`mass` are measured amounts; `count` is discrete units. */
	kind: 'volume' | 'mass' | 'count';
	value: number;
	/** Normalized unit for measured amounts; the counted noun otherwise ('TABLET'). */
	unit: string | null;
	/** Innermost container ('VIAL', 'BOTTLE', 'SYRINGE'). */
	container: string;
	/** How many unit-of-use containers the package holds (1 when unpackaged). */
	packQty: number;
}

// Canonical spellings for the measured units openFDA uses.
const MEASURED: Record<string, { kind: 'volume' | 'mass'; unit: string }> = {
	ml: { kind: 'volume', unit: 'mL' },
	l: { kind: 'volume', unit: 'L' },
	mcg: { kind: 'mass', unit: 'mcg' },
	ug: { kind: 'mass', unit: 'mcg' },
	mg: { kind: 'mass', unit: 'mg' },
	g: { kind: 'mass', unit: 'g' },
	gm: { kind: 'mass', unit: 'g' },
	kg: { kind: 'mass', unit: 'kg' }
};

// Nouns that name a *container*, not a thing a nurse picks up. When one of
// these is the counted unit ("1 BOTTLE in 1 CARTON", "6 POUCH in 1 BOX") the
// level is packaging, so that level never states a unit of use — the tablet
// count lives in a deeper level, which the labeler may or may not have written.
//
// Matched permissively because labelers spell containers many ways: an
// optional modifier ("PREFILLED SYRINGE"), a trailing noun ("BLISTER PACK",
// "CELLO PACK"), a plural, and a qualifier tail ("VIAL, SINGLE-DOSE") all name
// the same kind of thing.
// KIT is deliberately absent: a kit is heterogeneous by construction, so
// "1 KIT in 1 CARTON" never has a deeper level restating it as a unit of
// use the way "1 BOTTLE in 1 CARTON / 100 TABLET in 1 BOTTLE" does — the kit
// itself is the thing a nurse picks up, so it stays eligible to be one.
const CONTAINER_NOUN =
	/^(?:PREFILLED\s+|PRE-FILLED\s+|SINGLE-?\s*DOSE\s+|UNIT-?\s*DOSE\s+|MULTI-?\s*DOSE\s+)?(?:BOTTLE|CARTON|BOX|CASE|POUCH|PACKAGE|PACKET|CONTAINER|TRAY|TUB|DRUM|PAIL|BAG|CUP|JAR|CAN|BLISTER|PACK|STRIP|WRAPPER|VIAL|AMPULE|AMPOULE|SYRINGE|CYLINDER|CARTRIDGE|DEWAR|CANISTER|INHALER|TUBE|SACHET|CARBOY|BUCKET|CRATE|ROLL|BOOK|BAR|WELL|CARBOARD)S?(?:\s+(?:PACK|PACKAGE|CARD)S?)?(?:\s*,.*)?$/i;

/** Whether a level's counted noun names packaging rather than a unit of use. */
const isContainerUnit = (unit: string) => CONTAINER_NOUN.test(unit.trim());

// `<qty> [unit] in <n> <container>`. Both the unit and the `in <n>` clause vary
// more than the openFDA examples suggest, so each part is matched loosely:
//
//   - the unit may be absent ("10  in 1 CARTON"), or several words with commas
//     ("30 TABLET, FILM COATED in 1 BOTTLE") — the dominant real-world shape,
//     and one a letters-only unit pattern silently drops on the floor;
//   - `in` may be capitalized, and the container count is not always 1.
//
// The unit is lazy so it stops at the *first* " in ", which is where the
// container clause always begins; container names never contain the word.
const LEVEL = /^([\d.,]+)\s*(.*?)\s+in\s+([\d.,]+)\s+(.+)$/i;

/**
 * Strip the parenthesized package NDC openFDA appends to a level, along with
 * the punctuation and stray whitespace labelers leave behind. Non-breaking
 * spaces in particular are common and invisible, and defeat a `\s`-free match.
 */
const cleanLevel = (level: string) =>
	level
		.replace(/[\u00a0\u2007\u202f]/g, ' ')
		.replace(/\(\s*(?:NDC\s*:?\s*)?[\d\s-]+\)/gi, '')
		.replace(/[.;*>]+\s*$/, '')
		.replace(/\s+/g, ' ')
		.trim();

interface Level {
	qty: number;
	unit: string;
	container: string;
}

const toNumber = (raw: string) => {
	const value = Number(raw.replace(/,/g, ''));
	return Number.isFinite(value) && value > 0 ? value : null;
};

function parseLevel(raw: string): Level | null {
	const match = LEVEL.exec(cleanLevel(raw));
	if (!match) return null;

	const qty = toNumber(match[1]);
	const containers = toNumber(match[3]);
	if (qty === null || containers === null) return null;

	return {
		// "100 TABLET in 2 BOTTLE" is fifty per bottle. Almost every level says
		// "in 1", but reading the count keeps the rare one from inflating a
		// presentation to twice its real size.
		qty: qty / containers,
		unit: match[2].trim(),
		container: match[4].trim()
	};
}

// openFDA joins nesting levels with " / ", and joins a kit's independent
// components with " * " ("1 KIT in 1 CARTON * 5 mL in 1 VIAL * 5 mL in 1
// VIAL"). Asterisk-separated components must stay distinct so their amounts
// are not multiplied. Splitting on a bare slash also splits units and
// qualifiers that contain one ("mg/mL", "VIAL, SINGLE-DOSE/SINGLE-USE"),
// shredding a parseable level — the same reason " * " is only a separator
// surrounded by spaces, since a bare trailing "*" is a footnote marker, not a
// join.
const LEVEL_SEPARATOR = /\s+\/\s+|\s*\/\s+|\s+\/\s*/;
const COMPONENT_SEPARATOR = /\s+\*\s+/;

/** A packaging description's nesting levels, outermost first. */
export const splitLevels = (description: string) =>
	description.split(COMPONENT_SEPARATOR).flatMap((component) => component.split(LEVEL_SEPARATOR));

/** The package NDC openFDA parenthesizes on a level, when it wrote one. */
const LEVEL_NDC = /\(\s*(?:NDC\s*:?\s*)?(\d[\d-]*\d)\s*\)/i;

/** An inner package a description names but the directory doesn't list. */
export interface InnerPackage {
	/** The NDC as written on the level — hyphenated, not yet normalized. */
	ndc: string;
	/** That level and everything below it, as its own packaging description. */
	description: string;
}

/**
 * The nested packages a description names below its outermost level.
 *
 * "6 BAG in 1 CARTON (0143-9466-06) / 250 mL in 1 BAG (0143-9466-01)" describes
 * two packages, but openFDA's directory only lists the carton: ask it about
 * -01 and it answers with nothing at all. The bag is a real, orderable package
 * whose size and dose form the carton's own description already states, so it
 * is read back out of the text rather than left unknown.
 *
 * A level's description is that level *and* the levels below it, so a middle
 * level keeps the pack quantity that makes it a carton of six rather than one
 * bag.
 */
export function innerPackages(description: string): InnerPackage[] {
	const levels = splitLevels(description);
	const inner: InnerPackage[] = [];

	// From 1: level 0 is the package the description belongs to.
	for (let i = 1; i < levels.length; i++) {
		const ndc = LEVEL_NDC.exec(levels[i])?.[1];
		if (!ndc) continue;
		inner.push({ ndc, description: levels.slice(i).join(' / ') });
	}
	return inner;
}

/**
 * Restate the unit of use's quantity in a description — `1025 mg in 1 VIAL`
 * becomes `1000 mg in 1 VIAL` — leaving every other level as written. Returns
 * null when no level states `size` as its own quantity and unit.
 */
export function restateUnitOfUse(
	description: string,
	size: Pick<UnitOfUseSize, 'value' | 'unit'>,
	value: number
): string | null {
	const levels = splitLevels(description);
	for (let i = levels.length - 1; i >= 0; i--) {
		const level = parseLevel(levels[i]);
		if (!level || level.qty !== size.value) continue;
		if (MEASURED[level.unit.toLowerCase()]?.unit !== size.unit) continue;
		const restated = levels[i].replace(/^(\s*)[\d.,]+/, `$1${value}`);
		return description.replace(levels[i], restated);
	}
	return null;
}

/**
 * Parse a packaging description into its unit of use. Returns null when the
 * description doesn't match the expected shape at all, so callers can
 * distinguish "no size" from "not parseable" rather than inventing a number.
 */
export function parseUnitOfUse(description: string): UnitOfUseSize | null {
	// A slash denotes nested packaging; an asterisk separates the independent
	// contents of a kit. Flattening both makes a kit's ingredient quantities
	// look like carton levels and multiplies them into a nonsensical packQty.
	const components = description.split(COMPONENT_SEPARATOR).map((component) =>
		component
			.split(LEVEL_SEPARATOR)
			.map(parseLevel)
			.filter((level): level is Level => level !== null)
	);
	const levels = components.flat();
	if (!levels.length) return null;

	// The unit of use is the innermost level that counts something a nurse
	// picks up. Scanning inward-out for the last non-container level, rather
	// than demanding the innermost level be one, tolerates both a description
	// that ends in packaging and one written outermost-last.
	let component: Level[] | null = null;
	let index = -1;
	for (let i = components.length - 1; i >= 0; i--) {
		for (let j = components[i].length - 1; j >= 0; j--) {
			if (!isContainerUnit(components[i][j].unit)) {
				component = components[i];
				index = j;
				break;
			}
		}
		if (component) break;
	}
	if (!component) return null;
	// Every level counts containers, so the unit of use was never described.
	// Reporting "1 BOTTLE in 1 CARTON" as a `1 BOTTLE CARTON` presentation
	// would demote a bottle of tablets to a bucket of its own beside the real
	// "100 TABLET BOTTLE"; unknown is the honest answer.
	const inner = component[index];
	const measured = MEASURED[inner.unit.toLowerCase()];

	return {
		kind: measured?.kind ?? 'count',
		value: inner.qty,
		unit: measured?.unit ?? (inner.unit || null),
		container: inner.container,
		// Outer levels multiply: "10 VIAL in 1 CARTON / 4 mL in 1 VIAL" is ten
		// 4 mL vials. A single-level description is one unit of use.
		packQty: component.slice(0, index).reduce((total, level) => total * level.qty, 1)
	};
}

// ── Multi-dose classification (cheap tiers) ──────────────────────────────────
// Tiers 1-3 of the ladder: dose forms where the question is meaningless, then
// explicit tokens in the packaging text, then containers that are single-dose
// by construction. Whatever survives is left `null` for the label-text pass to
// resolve — never guessed as `false`, since "unknown" and "safe to re-enter"
// must not collapse into the same value at the UI.

const MULTI = /multi(?:ple)?[-\s]?dose/i;
const SINGLE = /single[-\s]?(?:dose|use)|unit[-\s]?dose/i;

// Containers that hold exactly one dose by construction.
const SINGLE_BY_FORM =
	/PREFILLED SYRINGE|AUTO-?INJECTOR|AMPULE|AMPOULE|APPLICATOR|DOSE PACK|BLISTER/i;

// Dose forms where "multi-dose" is not a meaningful property of the package.
const NOT_APPLICABLE =
	/TABLET|CAPSULE|POWDER, FOR SOLUTION|PATCH|SUPPOSITORY|LOZENGE|GRANULE|FILM|PELLET|IMPLANT/i;

/**
 * Classify a package from directory data alone.
 * `true`/`false` are asserted; `null` means unresolved (needs label text) or
 * not applicable to this dose form.
 */
export function classifyMultiDose(description: string, dosageForm: string): boolean | null {
	const haystack = `${description} ${dosageForm}`;

	if (MULTI.test(haystack)) return true;
	if (SINGLE.test(haystack)) return false;
	if (SINGLE_BY_FORM.test(haystack)) return false;
	return null;
}

/**
 * Whether an unresolved package is worth spending a label fetch on.
 *
 * Pass 1 returns null both for "the directory didn't say" and for dose forms
 * where the question is meaningless. Only the former should reach Pass 2 —
 * otherwise every tablet in a pool would drag a prescribing-information
 * document across the wire to learn nothing.
 */
export function needsLabelLookup(description: string, dosageForm: string): boolean {
	if (classifyMultiDose(description, dosageForm) !== null) return false;
	return !NOT_APPLICABLE.test(dosageForm);
}
