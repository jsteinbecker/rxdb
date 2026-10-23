/**
 * The citation a person enters to support a correction — SPL passages, a URL
 * excerpt, an equivalent NDC or no source — and how it is written into the
 * `override` form action's fields.
 *
 * @module
 */

/** One highlighted passage of a package's SPL, located within its section. */
export type SplPassageDraft = {
	sectionKey: string;
	excerpt: string;
	subsectionTitle: string;
	/** Character offsets within the section element's text, for re-highlighting. */
	startOffset: number;
	endOffset: number;
};

/** The most passages one citation may quote. */
export const MAX_SPL_PASSAGES = 10;

/** What the user has entered to support a correction, before it is checked server side. */
export type CitationDraft = {
	source: 'spl' | 'url' | 'ndc' | 'none';
	passages: SplPassageDraft[];
	url: string;
	urlTitle: string;
	urlExcerpt: string;
	ndc: string;
};

export const emptyCitation = (hasSpl: boolean): CitationDraft => ({
	source: hasSpl ? 'spl' : 'url',
	passages: [],
	url: '',
	urlTitle: '',
	urlExcerpt: '',
	ndc: ''
});

/** Whether the draft cites enough for the server to accept it. */
export const citationReady = (draft: CitationDraft): boolean =>
	draft.source === 'spl'
		? draft.passages.length > 0
		: draft.source === 'url'
			? !!draft.url.trim() && !!draft.urlExcerpt.trim()
			: draft.source === 'none' || !!draft.ndc;

/** Writes SPL passages as the field the `override` form action reads. */
export function appendPassages(form: FormData, passages: SplPassageDraft[]): void {
	form.set('passages', JSON.stringify(passages));
}

/** Writes the draft as the fields the `override` form action reads. */
export function appendCitation(form: FormData, draft: CitationDraft): void {
	form.set('source', draft.source);
	if (draft.source === 'spl') appendPassages(form, draft.passages);
	else if (draft.source === 'url') {
		form.set('url', draft.url);
		form.set('title', draft.urlTitle);
		form.set('excerpt', draft.urlExcerpt);
	} else if (draft.source === 'ndc') form.set('ndc', draft.ndc);
}
