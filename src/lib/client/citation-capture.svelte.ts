/**
 * Shared state between an open SPL citation picker and the label sections on the
 * page: while a capture is set, table rows offer a checkmark that cites the whole
 * row.
 *
 * @module
 */

/**
 * What an open SPL citation picker offers the label sections on the page: while
 * one is set, table rows show a checkmark that cites the whole row.
 */
export type RowCapture = {
	/** Whether this row is already cited; reads the picker's passages reactively. */
	rowPicked: (row: HTMLTableRowElement) => boolean;
	/** Cites the row with `excerpt` as its text, or drops it when already cited. */
	toggleRow: (row: HTMLTableRowElement, excerpt: string) => void;
};

class CitationCapture {
	// Raw, so the picker can tell its own registration apart when it unmounts.
	current = $state.raw<RowCapture | null>(null);
}

export const citationCapture = new CitationCapture();
