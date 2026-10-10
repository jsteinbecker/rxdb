/** What the user has entered to support a correction, before it is checked server side. */
export type CitationDraft = {
  source: 'spl' | 'url' | 'ndc' | 'none';
  sectionKey: string;
  excerpt: string;
  subsectionTitle: string;
  startOffset: number;
  endOffset: number;
  url: string;
  urlTitle: string;
  urlExcerpt: string;
  ndc: string;
};

export const emptyCitation = (hasSpl: boolean): CitationDraft => ({
  source: hasSpl ? 'spl' : 'url',
  sectionKey: '',
  excerpt: '',
  subsectionTitle: '',
  startOffset: 0,
  endOffset: 0,
  url: '',
  urlTitle: '',
  urlExcerpt: '',
  ndc: ''
});

/** Whether the draft cites enough for the server to accept it. */
export const citationReady = (draft: CitationDraft): boolean =>
  draft.source === 'spl'
    ? !!draft.excerpt && !!draft.sectionKey
    : draft.source === 'url'
      ? !!draft.url.trim() && !!draft.urlExcerpt.trim()
      : draft.source === 'none' || !!draft.ndc;

/** Writes the draft as the fields the `override` form action reads. */
export function appendCitation(form: FormData, draft: CitationDraft): void {
  form.set('source', draft.source);
  if (draft.source === 'spl') {
    form.set('sectionKey', draft.sectionKey);
    form.set('excerpt', draft.excerpt);
    form.set('subsectionTitle', draft.subsectionTitle);
    form.set('startOffset', String(draft.startOffset));
    form.set('endOffset', String(draft.endOffset));
  } else if (draft.source === 'url') {
    form.set('url', draft.url);
    form.set('title', draft.urlTitle);
    form.set('excerpt', draft.urlExcerpt);
  } else if (draft.source === 'ndc') form.set('ndc', draft.ndc);
}
