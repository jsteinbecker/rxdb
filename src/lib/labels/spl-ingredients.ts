/**
 * What a label says is *in* the product.
 *
 * The one question no other source in this app can answer.
 *
 * RxNorm names the active moiety and its strength, and that is the whole of
 * what it knows: `lidocaine 25 MG/ML`. The FDA NDC directory adds the salt form
 * and a strength string per active ingredient. Neither of them lists the
 * excipients — and the excipients are what decide whether a patient with a
 * benzyl-alcohol sensitivity can have the vial in your hand, whether the
 * product is latex- or sulfite-free, and which of two otherwise identical
 * generics a compounding pharmacist will reach for.
 *
 * Only the SPL carries them, and only in the XML: DailyMed's v2 JSON endpoints
 * expose document metadata, never the product data elements, and openFDA's
 * `inactive_ingredient` field is OTC-label prose ("contains: water, glycerin"),
 * absent from every prescription label. So this parses the structured
 * `<ingredient>` elements out of the document itself, which is the same place
 * the directory's own active-ingredient strings are derived from.
 *
 * The parser is deliberately small and total. SPL is a fully general HL7 CDA
 * document and parsing one properly is a library's worth of work, but the
 * subtree this reads is a fixed, shallow shape that has not changed since R4:
 * a product element carrying `<ingredient>` children and, somewhere beneath it,
 * the package codes those ingredients belong to. Everything else in the
 * document — the prescribing information, the sections, the media — is walked
 * past without being understood, and anything unrecognized yields no rows
 * rather than an exception.
 *
 * @module
 */

/** Where a strength number comes from, per the ingredient's `classCode`. */
export type StrengthBasis = 'ingredient' | 'moiety' | 'reference';

/**
 * `classCode` on `<ingredient>`, decoded.
 *
 * The three active codes differ only in what the strength is *measured* as, and
 * that distinction is load-bearing: `ACTIM` means the number on the label is
 * the moiety's mass, so a 100 mg ACTIM dose of a salt weighs more than 100 mg
 * in the vial. Anything not listed here — ADJV, CNTM, and the colourant and
 * flavour codes — is not an ingredient claim and is skipped.
 */
const CLASS_CODES: Record<string, { kind: IngredientKind; basis: StrengthBasis | null }> = {
	ACTIB: { kind: 'active', basis: 'ingredient' },
	ACTIM: { kind: 'active', basis: 'moiety' },
	ACTIR: { kind: 'active', basis: 'reference' },
	ACTI: { kind: 'active', basis: null },
	IACT: { kind: 'inactive', basis: null }
};

export type IngredientKind = 'active' | 'inactive';

/** OID for NDC codes; the same code element is used for products and packages. */
const OID_NDC = '2.16.840.1.113883.6.69';
/** OID for UNII substance codes. */
const OID_UNII = '2.16.840.1.113883.4.9';
/** OID for the SPL characteristic vocabulary — `SPLCOLOR` and its siblings. */
const OID_SPL_CHARACTERISTIC = '2.16.840.1.113883.1.11.19255';

/** A substance named by the label, with its FDA unique ingredient identifier. */
export interface SplSubstance {
	name: string;
	/** Null when the label named a substance it did not code, which happens. */
	unii: string | null;
	/** Set when the label omitted this moiety and GSRS supplied it. */
	source?: 'gsrs';
}

/** One `<ingredient>` element, flattened. */
export interface SplIngredient extends SplSubstance {
	kind: IngredientKind;
	/** What the strength is measured as; null when the label did not say. */
	basis: StrengthBasis | null;

	// Strength as the document states it — a ratio, always, even for a tablet,
	// where the denominator is the unitless "1" of one tablet. Kept as stated
	// rather than normalized because normalizing needs the dose form, which is
	// a property of the product and not of this element.
	/** Numerator value, null when the element carried no quantity. */
	strength: number | null;
	strengthUnit: string | null;
	/** Denominator value; 1 for a per-unit strength. */
	per: number | null;
	perUnit: string | null;

	/**
	 * The moieties this substance delivers — `CHLORIDE ION` and `SODIUM CATION`
	 * for sodium chloride. Empty for inactive ingredients, which have none.
	 *
	 * Carried because it is the join to RxNorm: RxNorm names products by moiety
	 * and the label names them by salt, so a stored moiety is what lets
	 * "does this vial contain the drug I searched for" be answered without a
	 * second vocabulary lookup.
	 */
	moieties: SplSubstance[];

	/** Position among this product's ingredients, so document order survives. */
	sequence: number;
}

/**
 * One `<characteristic>` observation, flattened and undecoded.
 *
 * SPL states a solid oral's appearance here and nowhere else — colour, shape,
 * size, score and imprint are observations hung off the product, not fields on
 * it — and the same element shape carries a dozen unrelated codes besides
 * (combination-product type, flavour, DEA schedule). So the parser keeps every
 * code it finds in the SPL characteristic vocabulary and leaves the deciding to
 * $lib/labels/spl-characteristics.ts, which knows which five make a pill.
 */
export interface SplCharacteristic {
	/** The characteristic's own code — `SPLCOLOR`, `SPLSHAPE`, `SPLSIZE`, … */
	code: string;
	/** `displayName` for a coded value, the element's text for a plain one. */
	value: string | null;
	/**
	 * The `code` of a coded (CE) value — an NCI Thesaurus concept such as
	 * `C48348` for ROUND. Stabler than `displayName`, whose spelling varies
	 * (`HEXAGON (6 SIDED)`, `SEMI-CIRCLE`) between labels and versions.
	 */
	valueCode: string | null;
	/** What the labeler wrote when the code flattened it: `pale yellow`. */
	originalText: string | null;
	/** The `value` attribute of an INT or PQ value; null for anything else. */
	number: number | null;
	/** The unit of a PQ value — `mm`, for the one characteristic that has one. */
	unit: string | null;
	/**
	 * The file an ED value points at — `AHP48801.jpg` for an `SPLIMAGE`, the
	 * label's own photo of the product. A name within the label's media, not a URL.
	 */
	reference: string | null;
}

/** One product in a label, with the packages its ingredients describe. */
export interface SplProduct {
	/** The labeler-product NDC segment, hyphenated as the label writes it. */
	productCode: string | null;
	name: string | null;
	genericName: string | null;
	doseForm: string | null;
	/** Package NDCs, hyphenated. A kit part inherits the kit's packages. */
	packageCodes: string[];
	ingredients: SplIngredient[];
	/**
	 * The product's `<characteristic>` observations, undecoded.
	 *
	 * Inherited from the wrapper element when the product itself carries none,
	 * for the reason `packageCodes` are: SPL hangs appearance off the outer
	 * `<manufacturedProduct>` (or a kit's `<part>`), as a *sibling* of the
	 * inner product element that holds the ingredients, so a product read in
	 * isolation has none of its own.
	 */
	characteristics: SplCharacteristic[];
	/**
	 * The innermost package: `513 mg in 1 VIAL`. What a strength denominator
	 * *should* name, and what a miscoded one (`513 mg in 1 mg`) is corrected to
	 * — see $lib/labels/spl-strength-checks.ts. Null when the product has no packaging
	 * of its own (a kit part).
	 */
	presentation: SplPresentation | null;
	/**
	 * Set when the product is one `<part>` of a kit: how much of it the kit
	 * holds (`7.5 g`, `145 mL`) and the kit's own product code. A kit part's
	 * strength is per its own measure — vancomycin powder is `1 g/1 g` — so
	 * this quantity is what turns the ratio into the bottle's content.
	 */
	part: SplPart | null;
}

/** A kit part's `<part><quantity>`, and the kit it belongs to. */
export interface SplPart {
	amount: number | null;
	amountUnit: string | null;
	/** The enclosing kit's labeler-product code, `65628-206`. */
	kitCode: string | null;
}

/** One `<asContent>` level: how much product is in one container of `form`. */
export interface SplPresentation {
	amount: number | null;
	amountUnit: string | null;
	/** Container count, normally 1. */
	per: number | null;
	/** The container's form — `VIAL`, `CARTON`, `BOTTLE`. */
	form: string | null;
}

// ── A minimal XML reader ─────────────────────────────────────────────────────
// Tag stream in, tree out. Text is kept only on elements that have no children,
// because the only text this file reads is a `<name>`.

interface XmlNode {
	tag: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
}

const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
};

/** Resolve the five predefined entities and numeric references. */
const decode = (text: string): string =>
	text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, body: string) => {
		if (body[0] === '#') {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[body] ?? whole;
	});

function attrsOf(source: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	ATTR.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ATTR.exec(source))) attrs[match[1]] = decode(match[2]);
	return attrs;
}

/**
 * Parse a document into a tree, tolerantly.
 *
 * A close tag that does not match the open element is treated as closing
 * whatever it names if that element is on the stack, and ignored otherwise —
 * a real SPL is schema-valid and will never exercise either path, but a
 * truncated download is a thing that happens over a public API, and the right
 * answer to half a document is the ingredients in the half that arrived.
 */
function parseXml(xml: string): XmlNode {
	const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' };
	const stack: XmlNode[] = [root];
	// Comments, CDATA, the declaration and the DOCTYPE carry nothing this
	// reads, and each has its own escaping rules — dropped before tokenizing
	// so the tag scanner never has to know they exist.
	const body = xml
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
		.replace(/<\?[\s\S]*?\?>/g, '')
		.replace(/<!DOCTYPE[^>]*>/gi, '');

	const tags = /<\s*(\/?)\s*([\w:.-]+)((?:"[^"]*"|[^>"])*?)(\/?)\s*>/g;
	let match: RegExpExecArray | null;
	let cursor = 0;

	while ((match = tags.exec(body))) {
		const [whole, closing, tag, rawAttrs, selfClosing] = match;
		const parent = stack[stack.length - 1];

		const between = body.slice(cursor, match.index);
		if (between.trim()) parent.text += between;
		cursor = match.index + whole.length;

		if (closing) {
			const depth = stack.findLastIndex((node) => node.tag === tag);
			if (depth > 0) stack.length = depth;
			continue;
		}

		const node: XmlNode = { tag, attrs: attrsOf(rawAttrs), children: [], text: '' };
		parent.children.push(node);
		if (!selfClosing) stack.push(node);
	}

	return root;
}

const childrenNamed = (node: XmlNode, tag: string): XmlNode[] =>
	node.children.filter((child) => child.tag === tag);

const firstNamed = (node: XmlNode, tag: string): XmlNode | undefined =>
	node.children.find((child) => child.tag === tag);

/** HL7 coded values usually carry their readable label in displayName, but
 * some SPLs provide only code or element text. */
const codedValue = (node: XmlNode | undefined): string | null => {
	if (!node) return null;
	const value = node.attrs.displayName ?? node.attrs.code ?? node.text.trim();
	return value ? decode(value).trim() || null : null;
};

/** The text of a direct `<name>` child, trimmed. */
const nameOf = (node: XmlNode | undefined): string | null => {
	const text = firstNamed(
		node ?? { tag: '', attrs: {}, children: [], text: '' },
		'name'
	)?.text.trim();
	return text ? decode(text) : null;
};

/** A `<code>` child's value, when it is in the expected code system. */
function codeOf(node: XmlNode | undefined, system: string): string | null {
	const code = node && firstNamed(node, 'code');
	if (!code) return null;
	if (code.attrs.codeSystem && code.attrs.codeSystem !== system) return null;
	return code.attrs.code || null;
}

const numberOf = (value: string | undefined): number | null => {
	if (value === undefined) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

/** A unit attribute of `"1"` means "unitless", which is not a unit. */
const unitOf = (value: string | undefined): string | null =>
	value && value !== '1' ? value : null;

function substanceOf(node: XmlNode): SplSubstance | null {
	const name = nameOf(node);
	if (!name) return null;
	return { name: withoutUnspecified(name), unii: codeOf(node, OID_UNII) };
}

function ingredientOf(node: XmlNode, sequence: number): SplIngredient | null {
	const decoded = CLASS_CODES[node.attrs.classCode ?? ''];
	const substance = firstNamed(node, 'ingredientSubstance');
	if (!decoded || !substance) return null;

	const named = substanceOf(substance);
	if (!named) return null;

	const quantity = firstNamed(node, 'quantity');
	const numerator = quantity && firstNamed(quantity, 'numerator');
	const denominator = quantity && firstNamed(quantity, 'denominator');

	// `<activeMoiety><activeMoiety>` — the outer is the relationship, the inner
	// is the substance, and the label repeats the pair once per moiety.
	const moieties = childrenNamed(substance, 'activeMoiety')
		.flatMap((wrapper) => childrenNamed(wrapper, 'activeMoiety'))
		.map(substanceOf)
		.filter((moiety): moiety is SplSubstance => moiety !== null);

	return {
		...named,
		kind: decoded.kind,
		basis: decoded.basis,
		strength: numberOf(numerator?.attrs.value),
		strengthUnit: unitOf(numerator?.attrs.unit),
		per: numberOf(denominator?.attrs.value),
		perUnit: unitOf(denominator?.attrs.unit),
		moieties: decoded.kind === 'active' ? moieties : [],
		sequence
	};
}

/**
 * Every package NDC in a subtree.
 *
 * Both levels of a nested `<containerPackagedProduct>` count — the vial and the
 * tray of twenty-five vials are separate NDCs, both of them packages of the
 * same product, and both are things a formulary can stock.
 */
function packageCodesIn(node: XmlNode, into: string[] = []): string[] {
	for (const child of node.children) {
		if (child.tag === 'containerPackagedProduct') {
			const code = codeOf(child, OID_NDC);
			if (code && !into.includes(code)) into.push(code);
		}
		packageCodesIn(child, into);
	}
	return into;
}

/** The first packaging level directly beneath a product element. */
function presentationOf(node: XmlNode): SplPresentation | null {
	const content = firstNamed(node, 'asContent');
	const container = content && firstNamed(content, 'containerPackagedProduct');
	if (!content || !container) return null;
	const quantity = firstNamed(content, 'quantity');
	const numerator = quantity && firstNamed(quantity, 'numerator');
	const denominator = quantity && firstNamed(quantity, 'denominator');
	return {
		amount: numberOf(numerator?.attrs.value),
		amountUnit: unitOf(numerator?.attrs.unit),
		per: numberOf(denominator?.attrs.value),
		form: codedValue(firstNamed(container, 'formCode'))
	};
}

/**
 * The `<characteristic>` observations hung directly off an element.
 *
 * Direct children only, deliberately: a subtree sweep would pull in the
 * `SPLCMBPRDTP` observation SPL attaches to each `<asContent>` packaging level
 * and attribute it to the product, and — worse for a kit — would read one
 * part's colour onto another. Inheritance is handled where package codes are,
 * one level at a time and only into products that stated none of their own.
 */
function characteristicsIn(node: XmlNode): SplCharacteristic[] {
	const out: SplCharacteristic[] = [];

	for (const wrapper of childrenNamed(node, 'subjectOf')) {
		for (const observation of childrenNamed(wrapper, 'characteristic')) {
			const code = firstNamed(observation, 'code');
			const name = code?.attrs.code;
			if (!code || !name) continue;
			if (code.attrs.codeSystem && code.attrs.codeSystem !== OID_SPL_CHARACTERISTIC) continue;

			const value = firstNamed(observation, 'value');
			if (!value) continue;

			// A coded value names itself in `displayName`; a plain one (the
			// imprint, the only free text among them) is the element's text.
			const text = value.text.trim();
			out.push({
				code: name,
				value: value.attrs.displayName ?? (text ? decode(text) : null),
				valueCode: value.attrs.code?.trim() || null,
				originalText: firstNamed(value, 'originalText')?.text.trim() || null,
				number: numberOf(value.attrs.value),
				unit: unitOf(value.attrs.unit),
				reference: firstNamed(value, 'reference')?.attrs.value?.trim() || null
			});
		}
	}

	return out;
}

/**
 * The elements that are products carrying ingredients.
 *
 * Matched by shape rather than by name — "has direct `<ingredient>` children" —
 * because the element is `<manufacturedProduct>` for a plain drug and
 * `<partProduct>` for a component of a kit, and the two are otherwise
 * identical. The outer `<manufacturedProduct>` wrapper that SPL nests around
 * every product has no ingredients of its own and so is skipped for free.
 */
const isProduct = (node: XmlNode): boolean =>
	node.children.some((child) => child.tag === 'ingredient');

/** The kit a `<part>` belongs to: its carton codes and the part's quantity. */
interface KitContext {
	codes: string[];
	part: SplPart;
}

/** A `<part>` element's quantity, attributed to `kit`, the element it sits in. */
function kitContextOf(part: XmlNode, kit: XmlNode): KitContext {
	const quantity = firstNamed(part, 'quantity');
	const numerator = quantity && firstNamed(quantity, 'numerator');
	// The kit's cartons, not its parts' own bottles: those are listed under
	// each `<part>`, and a sibling part's bottle is not this part's package.
	const codes: string[] = [];
	for (const child of kit.children) if (child.tag !== 'part') packageCodesIn(child, codes);
	return {
		codes,
		part: {
			amount: numberOf(numerator?.attrs.value),
			amountUnit: unitOf(numerator?.attrs.unit),
			kitCode: codeOf(kit, OID_NDC)
		}
	};
}

function collectProducts(
	node: XmlNode,
	inherited: string[],
	inheritedCharacteristics: SplCharacteristic[],
	into: SplProduct[],
	kit: KitContext | null = null
): void {
	const own = packageCodesIn(node);
	// A kit part with no packaging of its own comes in the kit's carton, so it
	// is attributed there. Without this a kit's parts would parse to ingredient
	// lists belonging to no NDC at all. A part that has its own bottle NDC
	// (Wilshire's 52536-094-05) is in the kit's carton all the same: it is
	// attributed to both, or the kit would read as having no ingredients.
	const packageCodes =
		kit && isProduct(node) ? [...new Set([...own, ...kit.codes])] : own.length ? own : inherited;

	// Appearance is stated one level up from the ingredients — see
	// `SplProduct.characteristics` — so it descends the same way, and a product
	// that states its own (a kit part with two differently coloured tablets)
	// keeps them rather than taking the wrapper's.
	const ownCharacteristics = characteristicsIn(node);
	const characteristics = ownCharacteristics.length ? ownCharacteristics : inheritedCharacteristics;

	if (isProduct(node)) {
		const ingredients = childrenNamed(node, 'ingredient')
			.map((child, index) => ingredientOf(child, index))
			.filter((ingredient): ingredient is SplIngredient => ingredient !== null);

		if (ingredients.length) {
			into.push({
				productCode: codeOf(node, OID_NDC),
				name: nameOf(node),
				genericName: nameOf(firstNamed(node, 'asEntityWithGeneric')?.children[0]),
				doseForm: codedValue(firstNamed(node, 'formCode')),
				packageCodes,
				ingredients,
				characteristics,
				presentation: presentationOf(node),
				part: kit?.part ?? null
			});
		}
	}

	for (const child of node.children) {
		const context = child.tag === 'part' ? kitContextOf(child, node) : isProduct(node) ? null : kit;
		collectProducts(child, packageCodes, characteristics, into, context);
	}
}

/**
 * Every product an SPL document describes, with its ingredients and packages.
 *
 * Returns an empty array for a document that has no product data elements
 * section — an OTC monograph label, a "drug listing certification", or an
 * error page served with a 200 — rather than throwing, because absence of
 * ingredients is a normal and frequent answer that the caller must record just
 * as it records a successful parse.
 */
export function parseSplIngredients(xml: string): SplProduct[] {
	if (!xml || !xml.includes('<ingredient')) return [];
	const products: SplProduct[] = [];
	collectProducts(parseXml(xml), [], [], products);
	return products;
}

/**
 * An ingredient name without the substance registry's `, UNSPECIFIED` qualifier
 * and its variants (`GELATIN, UNSPECIFIED`, `MENTHOL, UNSPECIFIED FORM`,
 * `CARBOMER, UNSPECIFIED TYPE`). The qualifier only says no grade or form was
 * registered, so keeping it would split one substance into several for display
 * and aggregation. It is dropped wherever it closes a name, including inside a
 * combined name (`MENTHOL, UNSPECIFIED FORM AND METHYL SALICYLATE`).
 */
const UNSPECIFIED_QUALIFIER =
	/\s*,\s*unspecified(?:\s+(?:form|type|grade|kind|source|species|variety|strain))?(?=\s*$|\s*[,;/]|\s+and\s)/gi;
export const withoutUnspecified = (name: string): string =>
	name.replace(UNSPECIFIED_QUALIFIER, '').trimEnd();

/** Lowercased, whitespace-collapsed ingredient name — the dedupe and match key. */
export const ingredientKeyOf = (name: string): string =>
	withoutUnspecified(String(name ?? ''))
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');

/** The four fields a stated strength is made of, wherever they are stored. */
export interface StatedStrength {
	strength: number | null;
	strengthUnit: string | null;
	per: number | null;
	perUnit: string | null;
}

/**
 * Render an ingredient's strength the way a label reads it: `25 mg/1 g`, or
 * `9 mg` when the denominator is a unitless single unit. Null when the document
 * stated no quantity, which is the normal case for an excipient.
 */
export function strengthText(ingredient: StatedStrength): string | null {
	if (ingredient.strength === null) return null;
	const head = `${ingredient.strength}${ingredient.strengthUnit ? ` ${ingredient.strengthUnit}` : ''}`;
	if (ingredient.per === null || (ingredient.per === 1 && !ingredient.perUnit)) return head;
	return `${head}/${ingredient.per}${ingredient.perUnit ? ` ${ingredient.perUnit}` : ''}`;
}

// ── What a stored scrape looks like on the wire ──────────────────────────────

/** One stored ingredient claim, as `/api/v1/ndc/ingredients` returns it. */
export interface IngredientFact extends SplSubstance {
	kind: IngredientKind;
	basis: StrengthBasis | null;
	strength: number | null;
	strengthUnit: string | null;
	per: number | null;
	perUnit: string | null;
	moieties: SplSubstance[];
	/** The label's stated ratio, pre-rendered — see `strengthText`. */
	strengthText: string | null;
	/** Which product element in the label carried it; a kit part's own code. */
	productCode: string | null;
}

/** Why a package has the ingredient rows it has — or has none. See the schema. */
export type IngredientStatus = 'ok' | 'no-spl' | 'no-ingredients' | 'error';

/** Everything known about what is in one package. */
export interface PackageIngredients {
	ndc: string;
	status: IngredientStatus;
	/** The label that answered, where one did. */
	setId: string | null;
	/** Epoch millis, so the value survives JSON. */
	checkedAt: number;
	active: IngredientFact[];
	inactive: IngredientFact[];
}
