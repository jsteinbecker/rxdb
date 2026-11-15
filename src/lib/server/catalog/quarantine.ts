/**
 * The review queue for quarantined packages ($lib/catalog/quarantine.ts):
 * every package live on a formulary item whose curated facts are quarantined.
 * Read from stored package state only, with no provider calls.
 *
 * @module
 */
import type { PrismaClient } from '../../../generated/client';
import { quarantineReason, type QuarantineReason } from '../../catalog/quarantine';
import { loadPackageStates, stateSnapshot } from './package-state-store';

export type QuarantinedPackage = {
	ndc: string;
	reason: QuarantineReason;
	title: string | null;
	doseForm: string | null;
	labelerName: string | null;
	items: { id: string; displayName: string }[];
};

export async function listQuarantined(db: PrismaClient): Promise<QuarantinedPackage[]> {
	// Narrowed in SQL to packages that could need making up: their stored or
	// overridden dose form says so, or they are a dry fill. The rule itself is
	// applied to the curated package below.
	const links = await db.$queryRaw<{ ndc: string; itemId: string; displayName: string }[]>`
    SELECT ei.normalized_value AS ndc, fi.id AS "itemId", fi.display_name AS "displayName"
    FROM formulary_item_package f
    JOIN entity e ON e.id = f.package_id AND e.status = 'active' AND e.retired_at IS NULL
    JOIN external_identifier ei ON ei.entity_id = e.id AND ei.namespace = 'ndc11' AND ei.valid_to IS NULL
    JOIN formulary_item fi ON fi.id = f.formulary_item_id
    JOIN entity fe ON fe.id = fi.id AND fe.retired_at IS NULL
    JOIN package_curation pc ON pc.ndc = ei.normalized_value
    WHERE f.valid_to IS NULL
      AND (pc.baseline ->> 'doseForm' ~* 'FOR (SUSPENSION|SOLUTION)|LYOPHILIZED'
        OR pc.overrides ->> 'doseForm' IS NOT NULL
        OR (pc.baseline ->> 'isDryFill')::boolean)`;
	const itemsByNdc = new Map<string, { id: string; displayName: string }[]>();
	for (const link of links) {
		const list = itemsByNdc.get(link.ndc) ?? [];
		if (!list.some((item) => item.id === link.itemId))
			list.push({ id: link.itemId, displayName: link.displayName });
		itemsByNdc.set(link.ndc, list);
	}
	const states = await loadPackageStates(db, [...itemsByNdc.keys()], { withoutLabel: true });
	const quarantined: QuarantinedPackage[] = [];
	for (const [ndc, state] of states) {
		const item = stateSnapshot(state).item;
		const reason = quarantineReason(item);
		if (!reason) continue;
		quarantined.push({
			ndc,
			reason,
			title: item.description ?? item.genericName ?? item.brandName,
			doseForm: item.doseForm,
			labelerName: item.labelerName,
			items: itemsByNdc.get(ndc) ?? []
		});
	}
	return quarantined.sort(
		(a, b) => (a.labelerName ?? '').localeCompare(b.labelerName ?? '') || a.ndc.localeCompare(b.ndc)
	);
}
