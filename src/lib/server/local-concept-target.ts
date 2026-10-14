import type { PrismaClient } from '../../generated/client';
import type { DraftSource } from '../local-concept-draft';
import { loadConceptSnapshots, scdsForSbds } from './catalog-store';

export type SupersedeTarget = {
  /** The RxNorm SCD this NDC's concept is, or generalizes to, when known. */
  scd: { rxcui: string; name: string | null } | null;
  /** Why a new local concept can't supersede `scd` here; null when it can. */
  blocked: string | null;
};

/**
 * The SCD a local concept defined from this NDC supersedes: the NDC's own
 * RxCUI when it is an SCD, else its SCD counterpart from the concept snapshot.
 * Used by the NDC page's editor and by the local concepts list's "Supersede…".
 */
export async function supersedeTarget(
  db: PrismaClient,
  scopeId: string,
  item: Pick<DraftSource, 'details'>
): Promise<SupersedeTarget> {
  const rxcui = item.details?.rxnav?.rxcui;
  if (!rxcui) return { scd: null, blocked: 'This NDC has no RxCUI to supersede.' };
  const concept = (await loadConceptSnapshots(db, [rxcui])).get(rxcui);
  // Brands roll up into their generic's node, so an SBD has no snapshot of its
  // own; its SCD is found from the SCD snapshots that list it.
  const viaSbd = concept ? null : (await scdsForSbds(db, [rxcui])).get(rxcui);
  if (!concept && !viaSbd)
    return {
      scd: null,
      blocked: `RxCUI ${rxcui} has no cached concept, so its SCD is unknown; search for ${rxcui} once to cache it.`
    };
  const counterpart = concept?.details?.counterparts.find((c) => c.tty === 'SCD');
  const scd = viaSbd
    ? {
        rxcui: viaSbd.scdRxcui,
        name: (await loadConceptSnapshots(db, [viaSbd.scdRxcui])).get(viaSbd.scdRxcui)?.name ?? null
      }
    : concept?.tty === 'SCD'
      ? { rxcui, name: concept.name }
      : counterpart
        ? { rxcui: counterpart.rxcui, name: counterpart.name }
        : null;
  if (!scd) return { scd: null, blocked: `RxCUI ${rxcui} (${concept?.tty ?? 'unknown type'}) has no SCD counterpart.` };
  const target = await db.externalIdentifier.findFirst({
    where: { namespace: 'rxnorm_rxcui', normalizedValue: scd.rxcui, validTo: null },
    select: { entityId: true }
  });
  if (!target) return { scd, blocked: `RxCUI ${scd.rxcui} is not in the catalog yet; load it to the formulary first.` };
  const open = await db.entityMapping.findFirst({
    where: { objectEntityId: target.entityId, scopeId, mappingType: 'supersedes', validTo: null, supersededAt: null },
    select: { id: true }
  });
  return { scd, blocked: open ? `RxCUI ${scd.rxcui} is already superseded in this formulary.` : null };
}
