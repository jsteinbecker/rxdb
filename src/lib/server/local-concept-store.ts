import { Prisma, type PrismaClient } from '../../generated/client';
import { LocalConceptInputError, type LocalConceptInput } from '../local-concept-input.ts';
import { classifyDrift } from '../local-concept-drift.ts';
import { localConceptName, type LocalIngredient } from '../local-concept.ts';
import type { ExternalPackage, RxConcept } from './catalog-providers';
import type { LocalConceptRecord } from '../local-concept-view.ts';

export { LocalConceptInputError } from '../local-concept-input.ts';

/** A client or an open transaction; both are accepted so callers can compose. */
type Db = PrismaClient | Prisma.TransactionClient;

const NAMESPACE = 'local_concept';
const DRIFT_KIND = 'local_concept_drift';

/** Run `work` in a transaction, or directly when `db` already is one. */
async function inTransaction<T>(db: Db, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  if ('$transaction' in db) return db.$transaction(work, { timeout: 60_000 });
  return work(db);
}

const lock = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(731924, 1)::text`;

const ingredientRows = (ingredients: LocalIngredient[]) =>
  ingredients.map((i, ordinal) => ({
    ordinal,
    substanceUnii: i.substanceUnii,
    substanceName: i.substanceName,
    basis: i.basis,
    moietyUnii: i.moietyUnii,
    moietyName: i.moietyName,
    strengthNumMag: i.strengthNumMag,
    strengthNumUom: i.strengthNumUom,
    strengthDenMag: i.strengthDenMag,
    strengthDenUom: i.strengthDenUom
  }));

const json = (value: unknown) =>
  value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);

async function nextCode(tx: Prisma.TransactionClient): Promise<string> {
  await tx.identifierNamespace.upsert({
    where: { code: NAMESPACE },
    create: { code: NAMESPACE, appliesTo: ['clinical_drug'] },
    update: {}
  });
  const last = await tx.externalIdentifier.findFirst({
    where: { namespace: NAMESPACE },
    orderBy: { normalizedValue: 'desc' }
  });
  const n = last ? parseInt(last.normalizedValue.replace(/^LC/, ''), 10) || 0 : 0;
  return `LC${String(n + 1).padStart(6, '0')}`;
}

export async function createLocalConcept(
  db: Db,
  input: LocalConceptInput
): Promise<{ id: string; code: string }> {
  return inTransaction(db, async (tx) => {
    await lock(tx);
    const entity = await tx.entity.create({ data: { type: 'clinical_drug' } });
    await tx.clinicalDrug.create({
      data: {
        id: entity.id,
        tty: 'SCD',
        name: localConceptName({ ingredients: input.ingredients, doseForm: input.doseForm })
      }
    });
    await tx.localConcept.create({
      data: {
        id: entity.id,
        doseForm: input.doseForm,
        evidenceSetId: input.evidenceSetId,
        evidenceVersion: input.evidenceVersion,
        evidenceNdc: input.evidenceNdc,
        ionicContent: json(input.ionicContent),
        note: input.note,
        ingredients: { create: ingredientRows(input.ingredients) }
      }
    });
    const code = await nextCode(tx);
    await tx.externalIdentifier.create({
      data: { entityId: entity.id, namespace: NAMESPACE, value: code, normalizedValue: code, isPrimary: true }
    });
    return { id: entity.id, code };
  });
}

export async function updateLocalConcept(
  db: Db,
  id: string,
  input: LocalConceptInput
): Promise<void> {
  await inTransaction(db, async (tx) => {
    await lock(tx);
    const existing = await tx.localConcept.findUnique({ where: { id }, select: { brandName: true } });
    if (!existing) throw new LocalConceptInputError('Local concept not found');
    await tx.localConceptIngredient.deleteMany({ where: { localConceptId: id } });
    await tx.localConcept.update({
      where: { id },
      data: {
        doseForm: input.doseForm,
        evidenceSetId: input.evidenceSetId,
        evidenceVersion: input.evidenceVersion,
        evidenceNdc: input.evidenceNdc,
        ionicContent: json(input.ionicContent),
        note: input.note,
        ingredients: { create: ingredientRows(input.ingredients) }
      }
    });
    await tx.clinicalDrug.update({
      where: { id },
      data: {
        name: localConceptName({
          ingredients: input.ingredients,
          doseForm: input.doseForm,
          brandName: existing.brandName
        })
      }
    });
  });
}

const isUniqueViolation = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ||
  (typeof e === 'object' &&
    e !== null &&
    ((e as { code?: unknown }).code === '23505' ||
      (e as { cause?: { code?: unknown } }).cause?.code === '23505'));

export async function supersede(
  db: Db,
  scopeId: string,
  localId: string,
  rxcui: string,
  approvedBy: string | null
): Promise<{ mappingId: string }> {
  const already = () => new LocalConceptInputError(`RxCUI ${rxcui} is already superseded in this scope`);
  return inTransaction(db, async (tx) => {
    await lock(tx);
    const target = await tx.externalIdentifier.findFirst({
      where: { namespace: 'rxnorm_rxcui', normalizedValue: rxcui, validTo: null }
    });
    if (!target) throw new LocalConceptInputError(`RxCUI ${rxcui} is not in the catalog; load it first`);
    const local = await tx.clinicalDrug.findFirst({
      where: { id: localId, localConcept: { isNot: null }, entity: { retiredAt: null } }
    });
    if (!local) throw new LocalConceptInputError('Local concept not found');
    // Checked up front: a unique violation would abort an enclosing transaction.
    const open = await tx.entityMapping.findFirst({
      where: {
        objectEntityId: target.entityId,
        scopeId,
        mappingType: 'supersedes',
        validTo: null,
        supersededAt: null
      }
    });
    if (open) throw already();
    // The RxNorm concept's name at approval; drift detection compares it to the reloaded name.
    const rxnorm = await tx.clinicalDrug.findUnique({ where: { id: target.entityId }, select: { name: true } });
    try {
      const mapping = await tx.entityMapping.create({
        data: {
          subjectEntityId: localId,
          objectEntityId: target.entityId,
          mappingType: 'supersedes',
          scopeId,
          assertedBySource: 'local',
          supersededName: rxnorm?.name ?? null,
          approvedBy,
          approvedAt: new Date()
        }
      });
      return { mappingId: mapping.id };
    } catch (e) {
      if (isUniqueViolation(e)) throw already();
      throw e;
    }
  });
}

export async function stopSuperseding(db: Db, scopeId: string, mappingId: string): Promise<void> {
  const result = await db.entityMapping.updateMany({
    where: { id: mappingId, scopeId, mappingType: 'supersedes', validTo: null },
    data: { validTo: new Date(), invalidatedReason: 'stopped by user' }
  });
  if (!result.count) throw new LocalConceptInputError('No active supersede mapping found');
}

/** Retire the concept and end every mapping that points at it. */
export async function retireLocalConcept(db: Db, id: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const local = await tx.clinicalDrug.findFirst({
      where: { id, localConcept: { isNot: null } },
      select: { entity: { select: { retiredAt: true } } }
    });
    if (!local) throw new LocalConceptInputError('Local concept not found');
    if (local.entity.retiredAt) throw new LocalConceptInputError('Local concept is already retired');
    const now = new Date();
    await tx.entity.update({ where: { id }, data: { retiredAt: now } });
    await tx.entityMapping.updateMany({
      where: { subjectEntityId: id, mappingType: 'supersedes', validTo: null },
      data: { validTo: now, invalidatedReason: 'local concept retired' }
    });
  });
}

const rowFor = (row: {
  ordinal: number;
  substanceUnii: string;
  substanceName: string;
  basis: string;
  moietyUnii: string | null;
  moietyName: string | null;
  strengthNumMag: Prisma.Decimal;
  strengthNumUom: string;
  strengthDenMag: Prisma.Decimal;
  strengthDenUom: string;
}): LocalIngredient => ({
  substanceUnii: row.substanceUnii,
  substanceName: row.substanceName,
  basis: row.basis === 'active_moiety' ? 'active_moiety' : 'as_labeled',
  moietyUnii: row.moietyUnii,
  moietyName: row.moietyName,
  strengthNumMag: row.strengthNumMag.toFixed(),
  strengthNumUom: row.strengthNumUom,
  strengthDenMag: row.strengthDenMag.toFixed(),
  strengthDenUom: row.strengthDenUom
});

async function activeMappings(db: Db, scopeId: string, rxcuis?: string[]) {
  const rows = await db.entityMapping.findMany({
    where: {
      scopeId,
      mappingType: 'supersedes',
      validTo: null,
      supersededAt: null,
      subjectEntity: { retiredAt: null, clinicalDrug: { localConcept: { isNot: null } } },
      ...(rxcuis && {
        objectEntity: {
          externalIdentifiers: {
            some: { namespace: 'rxnorm_rxcui', normalizedValue: { in: rxcuis }, validTo: null }
          }
        }
      })
    },
    orderBy: { recordedAt: 'asc' },
    include: {
      objectEntity: {
        select: {
          externalIdentifiers: {
            where: { namespace: 'rxnorm_rxcui', validTo: null },
            select: { normalizedValue: true }
          }
        }
      },
      subjectEntity: {
        select: {
          externalIdentifiers: {
            where: { namespace: NAMESPACE, validTo: null },
            select: { value: true }
          },
          clinicalDrug: {
            select: {
              name: true,
              tty: true,
              localConcept: {
                include: { ingredients: { orderBy: { ordinal: 'asc' } } }
              }
            }
          }
        }
      }
    }
  });
  const wanted = rxcuis ? new Set(rxcuis) : null;
  const out: { rxcui: string; record: LocalConceptRecord }[] = [];
  for (const m of rows) {
    const drug = m.subjectEntity.clinicalDrug;
    const concept = drug?.localConcept;
    if (!drug || !concept) continue;
    const code = m.subjectEntity.externalIdentifiers[0]?.value;
    if (!code) continue;
    for (const { normalizedValue: rxcui } of m.objectEntity.externalIdentifiers) {
      if (wanted && !wanted.has(rxcui)) continue;
      out.push({
        rxcui,
        record: {
          id: concept.id,
          code,
          tty: drug.tty === 'SBD' ? 'SBD' : 'SCD',
          name: drug.name,
          doseForm: concept.doseForm,
          brandName: concept.brandName,
          ingredients: concept.ingredients.map(rowFor),
          ionicContent: concept.ionicContent,
          supersedes: { rxcui, name: m.supersededName, mappingId: m.id }
        }
      });
    }
  }
  return out;
}

/** Keyed by the superseded RxNorm rxcui; one query. */
export async function localConceptsForRxcuis(
  db: Db,
  scopeId: string,
  rxcuis: string[]
): Promise<Map<string, LocalConceptRecord>> {
  const keys = [...new Set(rxcuis.filter(Boolean))];
  if (!keys.length) return new Map();
  const found = await activeMappings(db, scopeId, keys);
  return new Map(found.map(({ rxcui, record }) => [rxcui, record]));
}

export type LocalConceptListRow = Omit<LocalConceptRecord, 'supersedes'> & {
  supersedes: { rxcui: string; name: string | null; mappingId: string; active: boolean } | null;
  openDrift: number;
  evidence: { setId: string; version: string; ndc: string | null };
};

/** Every non-retired local concept, with its latest supersede mapping in the scope. */
export async function listLocalConcepts(db: Db, scopeId: string): Promise<LocalConceptListRow[]> {
  const concepts = await db.localConcept.findMany({
    where: { clinicalDrug: { entity: { retiredAt: null } } },
    orderBy: { createdAt: 'asc' },
    include: {
      ingredients: { orderBy: { ordinal: 'asc' } },
      clinicalDrug: {
        select: {
          name: true,
          tty: true,
          entity: {
            select: {
              externalIdentifiers: {
                where: { namespace: NAMESPACE, validTo: null },
                select: { value: true }
              },
              mappingsAsSubject: {
                where: { scopeId, mappingType: 'supersedes' },
                orderBy: { recordedAt: 'desc' },
                take: 1,
                include: {
                  objectEntity: {
                    select: {
                      externalIdentifiers: {
                        where: { namespace: 'rxnorm_rxcui' },
                        orderBy: { validFrom: 'desc' },
                        take: 1,
                        select: { normalizedValue: true }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });
  const mappingIds = concepts.flatMap((c) =>
    c.clinicalDrug.entity.mappingsAsSubject.map((m) => m.id)
  );
  const drift = mappingIds.length
    ? await db.reviewItem.groupBy({
        by: ['mappingId'],
        where: { scopeId, kind: DRIFT_KIND, status: 'open', mappingId: { in: mappingIds } },
        _count: { _all: true }
      })
    : [];
  const counts = new Map(drift.map((d) => [d.mappingId, d._count._all]));
  return concepts.map((c) => {
    const drug = c.clinicalDrug;
    const m = drug.entity.mappingsAsSubject[0];
    return {
      id: c.id,
      code: drug.entity.externalIdentifiers[0]?.value ?? '',
      tty: drug.tty === 'SBD' ? 'SBD' : 'SCD',
      name: drug.name,
      doseForm: c.doseForm,
      brandName: c.brandName,
      ingredients: c.ingredients.map(rowFor),
      ionicContent: c.ionicContent,
      supersedes: m
        ? {
            rxcui: m.objectEntity.externalIdentifiers[0]?.normalizedValue ?? '',
            name: m.supersededName,
            mappingId: m.id,
            active: m.validTo === null && m.supersededAt === null
          }
        : null,
      openDrift: m ? (counts.get(m.id) ?? 0) : 0,
      evidence: { setId: c.evidenceSetId, version: c.evidenceVersion, ndc: c.evidenceNdc }
    };
  });
}

/** Packages of this call say the concept is no longer active in RxNorm. */
function inactiveRxcuis(packages: ExternalPackage[]): Set<string> {
  const out = new Set<string>();
  for (const pkg of packages) {
    const rxnav = pkg.details?.rxnav;
    if (!rxnav) continue;
    const status = rxnav.conceptStatus?.trim().toUpperCase();
    if (rxnav.rxcui && status && status !== 'ACTIVE') out.add(rxnav.rxcui);
    for (const h of rxnav.history ?? []) {
      if (h.originalRxcui && h.activeRxcui && h.activeRxcui !== h.originalRxcui) {
        out.add(h.originalRxcui);
      }
    }
  }
  return out;
}

/**
 * Opens one review item per superseded mapping whose RxNorm concept changed in
 * this load. Writes nothing else; returns the number of items created or updated.
 */
export async function checkLocalConceptDrift(
  db: Db,
  concepts: RxConcept[],
  packages: ExternalPackage[]
): Promise<number> {
  const byRxcui = new Map(concepts.map((c) => [c.rxcui, c]));
  if (!byRxcui.size) return 0;
  const mappings = await db.entityMapping.findMany({
    where: {
      mappingType: 'supersedes',
      validTo: null,
      supersededAt: null,
      subjectEntity: { retiredAt: null, clinicalDrug: { localConcept: { isNot: null } } },
      objectEntity: {
        externalIdentifiers: {
          some: { namespace: 'rxnorm_rxcui', normalizedValue: { in: [...byRxcui.keys()] }, validTo: null }
        }
      }
    },
    include: {
      objectEntity: {
        select: {
          externalIdentifiers: {
            where: { namespace: 'rxnorm_rxcui', validTo: null },
            select: { normalizedValue: true }
          }
        }
      },
      subjectEntity: {
        select: {
          clinicalDrug: {
            select: { localConcept: { include: { ingredients: { orderBy: { ordinal: 'asc' } } } } }
          }
        }
      }
    }
  });
  if (!mappings.length) return 0;
  const inactive = inactiveRxcuis(packages);
  let written = 0;
  for (const m of mappings) {
    const rxcui = m.objectEntity.externalIdentifiers
      .map((i) => i.normalizedValue)
      .find((v) => byRxcui.has(v));
    const concept = rxcui ? byRxcui.get(rxcui) : undefined;
    const local = m.subjectEntity.clinicalDrug?.localConcept;
    if (!rxcui || !concept || !local) continue;
    const drift = classifyDrift(
      m,
      { name: concept.name, inactive: inactive.has(rxcui) },
      local.ingredients.map(rowFor)
    );
    if (!drift) continue;
    await inTransaction(db, async (tx) => {
      await lock(tx); // review_item has no unique key; serialize find-then-create
      const open = await tx.reviewItem.findFirst({
        where: { kind: DRIFT_KIND, mappingId: m.id, status: 'open' }
      });
      if (open) {
        await tx.reviewItem.update({
          where: { id: open.id },
          data: { severity: drift.severity, note: drift.reason }
        });
      } else {
        await tx.reviewItem.create({
          data: {
            scopeId: m.scopeId,
            kind: DRIFT_KIND,
            severity: drift.severity,
            entityId: m.subjectEntityId,
            mappingId: m.id,
            note: drift.reason
          }
        });
      }
    });
    written++;
  }
  return written;
}
