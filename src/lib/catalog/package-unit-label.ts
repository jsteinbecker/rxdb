/**
 * Unit-of-sale and unit-of-use labels without volumes (`10 x vial, single dose`,
 * `1 bottle x 90 tablets`, `tablet`).
 *
 * @module
 */
import type { UnitOfUseSize } from './ndc-packaging';

const VOLUME =
	/\b\d[\d,]*(?:\.\d+)?\s*-?\s*(?:ml|milliliters?|millilitres?|l|liters?|litres?|cc|fl\.?\s*oz)\b\.?/gi;

/** A container name with any volumetric size removed: `30 mL vial, single dose` → `vial, single dose`. */
export function containerWithoutVolume(container: string): string {
	return container
		.replace(VOLUME, ' ')
		.replace(/\s+/g, ' ')
		.replace(/\s+,/g, ',')
		.replace(/^[\s,]+|[\s,]+$/g, '')
		.toLowerCase();
}

/**
 * Counted nouns for oral solids. A nurse picks up the tablet, not the bottle,
 * so these are the unit of use, and the container is only how they are sold.
 */
const ORAL_SOLID = /^(tablet|capsule|caplet|lozenge|troche|pill|wafer|pastille)s?\b/i;

type Size = Pick<UnitOfUseSize, 'kind' | 'value' | 'unit' | 'container' | 'packQty'>;

/** The oral solid a counted size names, without its qualifiers: `TABLET, FILM COATED` → `tablet`. */
function oralSolid(size: Size): string | null {
	if (size.kind !== 'count' || !size.unit) return null;
	return ORAL_SOLID.exec(size.unit.trim())?.[1].toLowerCase() ?? null;
}

/**
 * Unit of sale without volumes: `1 vial`, `10 x vial, single dose`. Oral
 * solids also count their contents: `1 bottle x 90 tablets`.
 */
export function unitOfSaleLabel(size: Size): string {
	const name = containerWithoutVolume(size.container);
	const containers = size.packQty === 1 ? `1 ${name}` : `${size.packQty} x ${name}`;
	const solid = oralSolid(size);
	if (!solid) return containers;
	return `${containers} x ${size.value} ${size.value === 1 ? solid : `${solid}s`}`;
}

/** Unit of use without volumes: `vial`, or `tablet` for oral solids. */
export function unitOfUseLabel(size: Size): string {
	return oralSolid(size) ?? containerWithoutVolume(size.container);
}
