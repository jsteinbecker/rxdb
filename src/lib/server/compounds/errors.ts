/** Errors the compound store raises for the page to show. @module */
/** A failure with a message fit to show the technician, and the status to send with it. */
export class CompoundError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}
