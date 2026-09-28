/** Build a readable NDC title with RxNorm's clinical drug as the lead. */
export function packageDisplayTitle(input: {
	rxNormName: string | null | undefined;
	packageDescription?: string | null;
	splTitle?: string | null;
	isMultiDose?: boolean | null;
	labeler?: string | null;
}): string | null {
	const name = input.rxNormName?.trim();
	if (!name) return null;

	const title = name.charAt(0).toLocaleUpperCase() + name.slice(1);
	const context: string[] = [];
	if (/\bCONCENTRATE\b/i.test(input.splTitle ?? '')) context.push('(Concentrate)');
	if (input.isMultiDose === true) context.push('MDV');

	const description = input.packageDescription ?? '';
	const carton = description.match(/\b(\d+)\s+([A-Z][A-Z ,/-]*?)\s+in\s+1\s+CARTON\b/i);
	if (carton) {
		const container = carton[2]
			.replace(/,?\s*(?:SINGLE|MULTI)[-\s]?DOSE\b/gi, '')
			.replace(/\s*,\s*/g, ' ')
			.trim()
			.toUpperCase();
		context.push(`CARTON of ${carton[1]} ${container}`);
	}
	if (input.labeler?.trim()) context.push(`[${input.labeler.trim()}]`);

	return context.length ? `${title} ${context.join(', ')}` : title;
}
