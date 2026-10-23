/**
 * Browser-safe catalog contracts. Provider adapters and read projections share
 * these shapes; this module must not depend on server modules.
 *
 * @module
 */
import type { UnitOfUseSize } from './ndc-packaging';
import type { ProseReconstitution, ResolvedDryFillVolume } from '../labels/dry-fill-volume';
import type { KitComposition } from '../labels/kit-parts';
import type { PropertyOverride } from '../curation/property-override-fields';
import type { LocalConceptView } from '../curation/local-concept-view';
import type { IngredientKind } from '../labels/spl-ingredients';
import type { StrengthCorrectionKind } from '../labels/spl-strength-checks';
import type { PillAppearance } from '../labels/spl-characteristics';
import type { DoseFormCorrection } from '../labels/dose-form-correction';
import type { LabelBlock } from '../labels/spl-sections';
import type { LabelScope } from '../labels/label-relevance';
import type { ConceptMatch } from './search-relevance';

/**
 * A unit of use the directory states as the salt's mass, restated as the
 * active moiety's. `description` and `size` carry the corrected values;
 * `from` keeps the description as imported.
 */
export type UnitOfUseCorrection = {
	from: string;
	description: string;
	note: string;
};

export type PackageFacts = {
	size: UnitOfUseSize | null;
	/** Set when `size` was restated from salt to moiety mass. */
	unitOfUseCorrection: UnitOfUseCorrection | null;
	isMultiDose: boolean | null;
	isDryFill: boolean;
	reconstitution: ProseReconstitution[];
	resolvedVolume: ResolvedDryFillVolume | null;
	/** A kit's parts for this NDC — the drug and its diluent — when it is one, or is one's part. */
	kit?: KitComposition | null;
};

export type SourcePayload = { source: string; nativeId: string; url: string; payload: unknown };
export type RxProperty = { name: string; value: string };
export type RxRelated = { rxcui: string; name: string; tty: string | null };
/** Everything RxNav says about a concrete drug concept beyond its identity. */
export type RxConceptDetails = {
	synonym: string | null;
	species: { human: boolean; vet: boolean } | null;
	ingredients: RxRelated[];
	brands: RxRelated[];
	doseForms: RxRelated[];
	/** Dose-form and group concepts the drug was reached through. */
	parents: RxRelated[];
	/** Brand/generic counterparts (SCD <-> SBD, GPCK <-> BPCK). */
	counterparts: RxRelated[];
	/** Branded concepts rolled up into this generic node, with the NDCs each contributed. */
	brandedProducts: (RxRelated & { ndcs: string[] })[];
	properties: RxProperty[];
	ndcCount: number;
};
export type RxConcept = {
	rxcui: string;
	name: string;
	tty: string | null;
	ndcs: string[];
	evidence: SourcePayload[];
	vetOnly: boolean | null;
	details?: RxConceptDetails;
};
export type LabelIngredient = {
	name: string;
	unii: string | null;
	kind: 'active' | 'inactive' | 'ionic';
	basis: string | null;
	strength: string | null;
	moieties: { name: string; unii: string | null }[];
	productCode: string | null;
	/** Why `strength` differs from what the label coded — see $lib/labels/spl-strength-checks.ts. */
	strengthNotes?: string[];
	/**
	 * What `strength` read before a salt correction changed the label's number,
	 * that number being the mass of `unii`, the salt itself. Undoing the
	 * correction restores it exactly instead of converting the rounded moiety
	 * strength back.
	 */
	labelStrength?: {
		strength: string;
		unii: string | null;
		/** Which correction moved the number; a `moiety-equivalent` is derived, never displayed. */
		correction?: StrengthCorrectionKind;
	};
	/** The kit part the ingredient is in: `GRAPE FLAVORED DILUENT (145 mL)`. */
	part?: string;
	/** Label-declared elemental content supplied by one or more salt ingredients. */
	ionicContent?: {
		element: string;
		massMg: number;
		mEq: number;
		sourceIngredients: string[];
		nonAdditive: true;
	};
};
/** Full provider detail for one package, beyond the facts that drive catalog rules. */
export type PackageDetails = {
	product: {
		productType: string | null;
		routes: string[];
		marketingCategory: string | null;
		applicationNumber: string | null;
		deaSchedule: string | null;
		marketingStartDate: string | null;
		listingExpirationDate: string | null;
		finished: boolean | null;
		pharmClasses: string[];
		/** Read-side only: set when pharm-class rules were applied to `pharmClasses`. */
		pharmClassResolution?: {
			source: string[];
			applied: { ruleId: string; mode: string; classes: string[] }[];
		};
		rxcuis: string[];
		uniis: string[];
		manufacturers: string[];
		splId: string | null;
	} | null;
	packaging: {
		marketingStartDate: string | null;
		sample: boolean | null;
		/** Every package of the same product the directory lists. */
		siblings: { ndc: string; description: string | null }[];
	} | null;
	label: {
		effectiveTime: string | null;
		version: string | null;
		setId: string | null;
		/** Set when the label was found through a sibling package's NDC. */
		siblingNdc?: string | null;
		/** `blocks` is the SPL's own structure for the section; `text` is openFDA's flattening. */
		sections: { key: string; title: string; text: string; blocks?: LabelBlock[] }[];
		/**
		 * The other products sharing this label, so the page can set aside
		 * their passages ($lib/labels/label-relevance.ts). Null when there are none;
		 * absent on snapshots stored before it existed.
		 */
		scope?: LabelScope | null;
	} | null;
	spl: {
		version: string | null;
		publishedDate: string | null;
		doseForm: string | null;
		ingredients: LabelIngredient[];
		appearances: PillAppearance[];
		otherLabels: { setId: string; title: string | null }[];
		/** Set when this NDC has no SPL of its own and a sibling package's was used. */
		siblingNdc?: string | null;
		/** Overridden: total shared moieties (true) or never (false); unset follows RxNorm. */
		totalSharedMoieties?: boolean;
	} | null;
	rxnav: {
		status: string | null;
		rxcui: string | null;
		conceptName: string | null;
		conceptStatus: string | null;
		history: {
			activeRxcui: string | null;
			originalRxcui: string | null;
			start: string | null;
			end: string | null;
		}[];
		properties: RxProperty[];
		packaging: string[];
	} | null;
};
/** A provider call that failed on the package's latest fetch. */
export type ProviderError = {
	source: 'openFDA' | 'DailyMed' | 'RxNav';
	status: number | null;
	message: string;
};

export type ExternalPackage = PackageFacts & {
	/** Optimistic concurrency token covering provider facts and user decisions. */
	editRevision?: number;
	/** Legacy corrections whose unmodified source value was never recorded. */
	baselineUnavailable?: string[];
	propertyOverrides?: Record<string, PropertyOverride>;
	/** Why a user kept this NDC off the formulary, set through the `manualExclusion` override. */
	manualExclusion?: string | null;
	/** Read-side only: the local concept superseding this package's RxNorm concept, applied at read time and never stored. */
	localConcept?: LocalConceptView;
	listed: boolean | null;
	marketingEndDate: string | null;
	splPresent: boolean | null;
	splInactivated?: boolean | null;
	isVeterinary: boolean | null;
	complete: boolean;
	/** Providers that failed on the latest fetch; values they own may be stale or missing. */
	providerErrors?: ProviderError[];
	ndc: string;
	description: string | null;
	/** Imported form, or its evidence-backed correction; see `doseFormCorrection`. */
	doseForm: string | null;
	/** Set when `doseForm` was corrected; `from` keeps the imported value. */
	doseFormCorrection: DoseFormCorrection | null;
	brandName: string | null;
	genericName: string | null;
	labelerName: string | null;
	labelerCode: string | null;
	productCode: string | null;
	ingredients: { name: string; strength: string | null }[];
	rxcuiStatus: string | null;
	splSetId: string | null;
	splTitle: string | null;
	splXml: string | null;
	labelIngredients: LabelIngredientName[];
	details: PackageDetails | null;
	evidence: SourcePayload[];
};

/** `kind` is null on snapshots predating ingredient classification. */
export type LabelIngredientName = { name: string; kind: IngredientKind | null };

export type StagedPackage = Omit<ExternalPackage, 'evidence' | 'splXml'> & {
	exclusionReason: string | null;
	loaded: boolean;
	formularyItemId: string | null;
};
export type StagedConcept = Omit<RxConcept, 'evidence'> & {
	/** Why a live search listed it; absent outside a search. */
	match?: ConceptMatch;
	loaded: boolean;
	formularyItemId: string | null;
	packages: StagedPackage[];
};
