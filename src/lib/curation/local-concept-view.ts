/**
 * Read-side resolution of local superseding concepts. Pure: the caller loads
 * the records; nothing here touches the database or mutates its input.
 *
 * @module
 */

import { localConceptName, type LocalIngredient } from './local-concept.ts';

export type LocalConceptRecord = {
	id: string;
	code: string;
	tty: 'SCD' | 'SBD';
	name: string;
	doseForm: string;
	brandName: string | null;
	ingredients: LocalIngredient[];
	ionicContent: unknown | null;
	supersedes: { rxcui: string; name: string | null; mappingId: string };
};

export type LocalConceptView = Omit<LocalConceptRecord, 'supersedes'> & {
	supersedes: { rxcui: string; name: string | null };
	/** True when this SBD was derived from its SCD counterpart, not mapped itself. */
	derived: boolean;
};

/**
 * rxcuis -> view. `byRxcui` holds direct mappings; `counterparts` maps an SBD
 * rxcui to its SCD rxcui; `brands` maps an SBD rxcui to its brand name.
 * A direct mapping wins over a derived one; unmapped rxcuis are absent.
 */
export function resolveLocal(
	rxcuis: string[],
	byRxcui: Map<string, LocalConceptRecord>,
	counterparts: Map<string, string>,
	brands: Map<string, string>
): Map<string, LocalConceptView> {
	const out = new Map<string, LocalConceptView>();
	for (const rxcui of rxcuis) {
		const direct = byRxcui.get(rxcui);
		if (direct) {
			out.set(rxcui, {
				...direct,
				supersedes: { rxcui: direct.supersedes.rxcui, name: direct.supersedes.name },
				derived: false
			});
			continue;
		}
		const scdRxcui = counterparts.get(rxcui);
		const scd = scdRxcui ? byRxcui.get(scdRxcui) : undefined;
		const brandName = brands.get(rxcui);
		if (!scd || !brandName) continue;
		out.set(rxcui, {
			id: scd.id,
			code: scd.code,
			tty: 'SBD',
			name: localConceptName({
				ingredients: scd.ingredients,
				doseForm: scd.doseForm,
				brandName
			}),
			doseForm: scd.doseForm,
			brandName,
			ingredients: scd.ingredients,
			ionicContent: scd.ionicContent,
			supersedes: { rxcui, name: null },
			derived: true
		});
	}
	return out;
}

type Resolvable = { details: { rxnav: { rxcui: string | null } | null } | null };

/**
 * Read-side only: copies of `items` with `localConcept` set where the item's
 * RxNav rxcui is superseded locally. `details.rxnav` is left as RxNav gave it.
 * Makes one `load` call, and none when no item has an rxcui.
 */
export async function applyLocalConcepts<T extends Resolvable>(
	items: T[],
	load: (rxcuis: string[]) => Promise<Map<string, LocalConceptView>>
): Promise<(T & { localConcept?: LocalConceptView })[]> {
	const rxcuis = [
		...new Set(
			items.flatMap((item) => (item.details?.rxnav?.rxcui ? [item.details.rxnav.rxcui] : []))
		)
	];
	if (!rxcuis.length) return items.map((item) => ({ ...item }));
	const views = await load(rxcuis);
	return items.map((item) => {
		const rxcui = item.details?.rxnav?.rxcui;
		const localConcept = rxcui ? views.get(rxcui) : undefined;
		return localConcept ? { ...item, localConcept } : { ...item };
	});
}

/** The ⋯ menu's edit entry: a derived SBD view edits its underlying local SCD. */
export const editActionLabel = (view: Pick<LocalConceptView, 'derived'>) =>
	view.derived ? 'Edit local SCD…' : 'Edit local concept…';
