/** Reject unrecognized strength syntax rather than partially parsing it. */
export function parseStrength(value: string | null) {
	const match = value?.match(
		/^\s*(\d+(?:\.\d+)?|\.\d+)\s*([a-zA-Z%][a-zA-Z0-9%]*)\s*(?:(?:\/|per)\s*(\d+(?:\.\d+)?|\.\d+)?\s*([a-zA-Z][a-zA-Z0-9]*)?)?\s*$/i
	);
	if (!match) return null;
	const numerator = Number(match[1]);
	const denominator = Number(match[3] ?? 1);
	if (
		!Number.isFinite(numerator) ||
		!Number.isFinite(denominator) ||
		!(numerator > 0) ||
		!(denominator > 0)
	)
		return null;
	return {
		strengthNumMag: numerator,
		strengthNumUom: match[2],
		strengthDenMag: denominator,
		strengthDenUom: match[4] ?? '1'
	};
}
