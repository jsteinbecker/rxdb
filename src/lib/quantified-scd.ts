import { timeReleaseAfterRelease } from './time-release';

/** `4 ML pembrolizumab 25 MG/ML Injection`: RxNorm's quantity-led SCD name. */
const QUANTIFIED = /^\s*([\d.]+)\s*ML\s+(\S.*)$/i;
const CONCENTRATION = /([\d.]+)\s*([A-Za-z[\]_']+)\/ML\b/g;

const number = (value: number) => String(Number(value.toPrecision(6)));

/**
 * Restates a quantified SCD by its total content rather than its volume and
 * concentration: `4 ML PEMBROLIZUMAB 25 MG/ML Injection` →
 * `PEMBROLIZUMAB 100 MG/4ML Injection`. Any other name is returned unchanged.
 */
export function quantifiedScdName(name: string): string {
	return timeReleaseAfterRelease(restatedVolume(name));
}

function restatedVolume(name: string): string {
	const match = name.match(QUANTIFIED);
	if (!match) return name;
	const volume = Number(match[1]);
	if (!(volume > 0)) return name;
	let scaled = false;
	const rest = match[2].replace(CONCENTRATION, (_, value: string, unit: string) => {
		scaled = true;
		return `${number(Number(value) * volume)} ${unit}/${number(volume)}ML`;
	});
	return scaled ? rest : name;
}
