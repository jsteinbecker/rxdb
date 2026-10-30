/**
 * Storage adapter: the common strength grammar in the catalog's numeric column
 * shape.
 *
 * @module
 */
import { parseStrengthParts } from './strength';

/** Storage adapter: the common strength grammar in the catalog's numeric column shape. */
export function parseStrength(value: string | null) {
	const parts = parseStrengthParts(value);
	return parts
		? {
				strengthNumMag: Number(parts.value),
				strengthNumUom: parts.unit,
				strengthDenMag: Number(parts.per),
				strengthDenUom: parts.perUnit || '1'
			}
		: null;
}
