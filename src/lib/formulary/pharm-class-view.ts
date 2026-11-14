/**
 * Read-side application of pharmacologic class rules to packages, recording which
 * source classes a rule replaced, added or removed.
 *
 * @module
 */
import type { ExternalPackage } from '../catalog/types';
import { packageClassKey } from './pharm-class-key';
import { resolvePharmClasses, type PharmClassRule } from './pharm-class-rules';

type Resolvable = Pick<ExternalPackage, 'doseForm' | 'details'>;

/**
 * Read-side only: copies of `items` whose `details.product.pharmClasses` has the
 * rules applied and whose `pharmClassResolution` records the source classes and
 * the rules used. Never call this on a write path; staged data keeps the source's classes.
 * Makes one `loadRules` call, and none when no item has a moiety key.
 */
export async function applyPharmClassRules<T extends Resolvable>(
	items: T[],
	loadRules: (moietyKeys: string[]) => Promise<PharmClassRule[]>
): Promise<T[]> {
	const keyed = items.map((item) => (item.details?.product ? packageClassKey(item) : null));
	const moietyKeys = keyed.flatMap((key) => (key?.moietyKey ? [key.moietyKey] : []));
	if (!moietyKeys.length) return items;
	const rules = await loadRules([...new Set(moietyKeys)]);
	return items.map((item, index) => {
		const key = keyed[index];
		const product = item.details?.product;
		if (!key || !product || !item.details) return item;
		const { classes, source, applied } = resolvePharmClasses(
			product.pharmClasses ?? [],
			key,
			rules
		);
		return {
			...item,
			details: {
				...item.details,
				product: { ...product, pharmClasses: classes, pharmClassResolution: { source, applied } }
			}
		};
	});
}
