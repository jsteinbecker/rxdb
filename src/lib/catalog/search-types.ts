/**
 * Result shapes the search API returns, including curated product sets a query
 * names.
 *
 * @module
 */
type SearchKind =
	'clinical_drug' | 'ingredient' | 'product' | 'package' | 'formulary_item' | 'labeler';

export type SearchResult = {
	id: string;
	kind: SearchKind;
	name: string;
	detail: string | null;
	matchedOn: 'name' | 'ingredient' | 'identifier' | 'description';
	identifiers: string[];
	/** The page that shows it, when one does. */
	href?: string | null;
	/** A clinical_drug row that is a local concept (LC code), not an RxNorm concept. */
	localConcept?: true;
	/** What else the row answers to: a product's ingredients, the dose an overfilled vial delivers. */
	aliases?: string[];
};

/** A curated product set the query names: loadable though no source returns it. */
export type SetResult = {
	key: string;
	name: string;
	description: string;
	/** Its formulary item in the scope, when it is already loaded. */
	formularyItemId: string | null;
};
