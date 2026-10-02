import { toNdc11 } from '$lib/ndc';
import { naturalCompare } from '$lib/natural-sort';
import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { stagedTree, syncExternalSearch } from '$lib/server/catalog-sync';
import type { RequestHandler } from './$types';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SearchKind =
  'clinical_drug' | 'ingredient' | 'product' | 'package' | 'formulary_item' | 'labeler';

export type SearchResult = {
  id: string;
  kind: SearchKind;
  name: string;
  detail: string | null;
  matchedOn: 'name' | 'ingredient' | 'identifier' | 'description';
  identifiers: string[];
};

const activeEntity = { status: 'active', retiredAt: null } as const;

function requestedLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : DEFAULT_LIMIT;
}

/** Normalize labeled NDC segments before matching canonical identifiers.
 * Other identifiers ignore punctuation; ambiguous ten-digit NDCs are not padded. */
function normalizeIdentifier(value: string): string {
  return toNdc11(value) ?? value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function rank(result: SearchResult, query: string, exactIdentifierIds: Set<string>): number {
  if (exactIdentifierIds.has(result.id)) return 0;
  if (result.name.toLocaleLowerCase() === query.toLocaleLowerCase()) return 1;
  if (result.name.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) return 2;
  return result.matchedOn === 'name' ? 3 : 4;
}

/**
 * GET /api/v1/search?q=<name-or-identifier>[&scope=<formulary-scope-uuid>][&limit=24][&offset=0]
 *
 * `offset` pages the staged RxNav concepts (10 per page); catalog results are unaffected.
 *
 * Searches the application's canonical entity models instead of rebuilding the
 * legacy RxNorm traversal.  Identifier matching is normalized and uses the
 * identifier table; product matches traverse ProductIngredient, preserving the
 * schema's explicit product/ingredient relationship.
 */
export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q')?.trim() ?? '';
  if (!query) return json({ message: 'The q parameter is required.' }, { status: 400 });
  if (query.length > 160)
    return json({ message: 'The q parameter must be 160 characters or fewer.' }, { status: 400 });

  const limit = requestedLimit(url.searchParams.get('limit'));
  const scopeId = url.searchParams.get('scope');
  if (scopeId && !UUID.test(scopeId))
    return json({ message: 'scope must be a UUID.' }, { status: 400 });
  // A live lookup refreshes the local catalog before it is queried. The
  // persisted catalog remains useful when a provider is temporarily down.
  // Fetched data is staged only; the catalog and formulary change when a
  // staged node is explicitly loaded (POST /api/v1/formulary/load).
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '', 10) || 0);
  const localOnly = url.searchParams.get('local') === '1';
  const externalSearch = localOnly
    ? null
    : syncExternalSearch(query, offset)
        .then(async ({ staged, ...summary }) => ({
          sync: {
            ...summary,
            warning: summary.partial
              ? 'Some providers were unavailable; known values were preserved.'
              : null
          },
          staged: await stagedTree(staged)
        }))
        .catch((error: unknown) => ({
          sync: {
            concepts: 0,
            packages: 0,
            excluded: 0,
            partial: true,
            total: 0,
            offset,
            warning: error instanceof Error ? error.message : 'External catalog sync failed.'
          },
          staged: { scope: null, concepts: [], packages: [] }
        }));

  const identifierQuery = normalizeIdentifier(query);
  const identifierWhere = identifierQuery
    ? { normalizedValue: { startsWith: identifierQuery }, validTo: null }
    : undefined;

  const [clinicalDrugs, ingredients, products, packages, formularyItems, labelers, identifiers] =
    await Promise.all([
      prisma.clinicalDrug.findMany({
        where: { name: { contains: query, mode: 'insensitive' }, entity: activeEntity },
        select: { id: true, name: true, tty: true },
        take: limit
      }),
      prisma.ingredient.findMany({
        where: { name: { contains: query, mode: 'insensitive' }, entity: activeEntity },
        select: { id: true, name: true },
        take: limit
      }),
      prisma.product.findMany({
        where: {
          entity: activeEntity,
          OR: [
            { proprietaryName: { contains: query, mode: 'insensitive' } },
            { labeler: { name: { contains: query, mode: 'insensitive' } } },
            {
              productIngredients: {
                some: { ingredient: { name: { contains: query, mode: 'insensitive' } } }
              }
            }
          ]
        },
        select: {
          id: true,
          proprietaryName: true,
          doseForm: true,
          labeler: { select: { name: true } },
          productIngredients: {
            where: { ingredient: { name: { contains: query, mode: 'insensitive' } } },
            select: { ingredient: { select: { name: true } } },
            take: 1
          }
        },
        take: limit
      }),
      prisma.package.findMany({
        where: {
          entity: activeEntity,
          OR: [
            { description: { contains: query, mode: 'insensitive' } },
            {
              entity: {
                relationshipsFrom: {
                  some: {
                    relationshipType: 'package_clinical_drug',
                    validTo: null,
                    toEntity: { clinicalDrug: { name: { contains: query, mode: 'insensitive' } } }
                  }
                }
              }
            }
          ]
        },
        select: {
          id: true,
          description: true,
          containerType: true,
          entity: {
            select: {
              relationshipsFrom: {
                where: { relationshipType: 'package_clinical_drug', validTo: null },
                select: { toEntity: { select: { clinicalDrug: { select: { name: true } } } } },
                take: 1
              }
            }
          }
        },
        take: limit
      }),
      prisma.formularyItem.findMany({
        where: {
          displayName: { contains: query, mode: 'insensitive' },
          entity: activeEntity,
          ...(scopeId ? { scopeId } : {})
        },
        select: { id: true, displayName: true, kind: true, scope: { select: { name: true } } },
        take: limit
      }),
      prisma.labeler.findMany({
        where: { name: { contains: query, mode: 'insensitive' }, entity: activeEntity },
        select: { id: true, name: true },
        take: limit
      }),
      identifierWhere
        ? prisma.externalIdentifier.findMany({
            where: identifierWhere,
            select: { entityId: true, value: true, normalizedValue: true },
            take: limit
          })
        : Promise.resolve([])
    ]);

  const identifiersByEntity = new Map<string, string[]>();
  const exactIdentifierIds = new Set<string>();
  for (const identifier of identifiers) {
    const values = identifiersByEntity.get(identifier.entityId) ?? [];
    values.push(identifier.value);
    identifiersByEntity.set(identifier.entityId, values);
    if (identifier.normalizedValue === identifierQuery) exactIdentifierIds.add(identifier.entityId);
  }

  const results = new Map<string, SearchResult>();
  const add = (result: SearchResult) => {
    const existing = results.get(result.id);
    if (
      !existing ||
      rank(result, query, exactIdentifierIds) < rank(existing, query, exactIdentifierIds)
    ) {
      results.set(result.id, result);
    }
  };

  const external = externalSearch ? await externalSearch : { sync: null, staged: null };
  const { sync, staged } = external;

  for (const row of clinicalDrugs) {
    add({
      id: row.id,
      kind: 'clinical_drug',
      name: row.name,
      detail: row.tty,
      matchedOn: 'name',
      identifiers: identifiersByEntity.get(row.id) ?? []
    });
  }
  for (const row of ingredients) {
    add({
      id: row.id,
      kind: 'ingredient',
      name: row.name,
      detail: null,
      matchedOn: 'name',
      identifiers: identifiersByEntity.get(row.id) ?? []
    });
  }
  for (const row of products) {
    const matchedIngredient = row.productIngredients[0]?.ingredient.name;
    add({
      id: row.id,
      kind: 'product',
      name: row.proprietaryName ?? matchedIngredient ?? 'Unnamed product',
      detail: [row.labeler.name, row.doseForm].filter(Boolean).join(' · ') || null,
      matchedOn:
        matchedIngredient &&
        !row.proprietaryName?.toLocaleLowerCase().includes(query.toLocaleLowerCase())
          ? 'ingredient'
          : 'name',
      identifiers: identifiersByEntity.get(row.id) ?? []
    });
  }
  for (const row of packages) {
    const matchedDrug = row.entity.relationshipsFrom[0]?.toEntity.clinicalDrug?.name;
    add({
      id: row.id,
      kind: 'package',
      name: row.description ?? 'Unnamed package',
      detail: [row.containerType, matchedDrug].filter(Boolean).join(' · ') || null,
      matchedOn: row.description?.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        ? 'description'
        : 'ingredient',
      identifiers: identifiersByEntity.get(row.id) ?? []
    });
  }
  for (const row of formularyItems) {
    add({
      id: row.id,
      kind: 'formulary_item',
      name: row.displayName,
      detail: [row.kind, row.scope.name].filter(Boolean).join(' · ') || null,
      matchedOn: 'name',
      identifiers: identifiersByEntity.get(row.id) ?? []
    });
  }
  for (const row of labelers) {
    add({
      id: row.id,
      kind: 'labeler',
      name: row.name,
      detail: null,
      matchedOn: 'name',
      identifiers: identifiersByEntity.get(row.id) ?? []
    });
  }

  // Identifier-only hits need their display models, not a generic entity row.
  const unresolvedIdentifierIds = [...identifiersByEntity.keys()].filter((id) => !results.has(id));
  if (unresolvedIdentifierIds.length) {
    const entities = await prisma.entity.findMany({
      where: { id: { in: unresolvedIdentifierIds }, ...activeEntity },
      select: {
        id: true,
        type: true,
        ingredient: { select: { name: true } },
        clinicalDrug: { select: { name: true, tty: true } },
        product: {
          select: { proprietaryName: true, doseForm: true, labeler: { select: { name: true } } }
        },
        package: { select: { description: true, containerType: true } },
        formularyItem: {
          select: { displayName: true, kind: true, scope: { select: { name: true } } }
        },
        labeler: { select: { name: true } }
      }
    });
    for (const entity of entities) {
      const identifiers = identifiersByEntity.get(entity.id) ?? [];
      if (entity.clinicalDrug)
        add({
          id: entity.id,
          kind: 'clinical_drug',
          name: entity.clinicalDrug.name,
          detail: entity.clinicalDrug.tty,
          matchedOn: 'identifier',
          identifiers
        });
      else if (entity.ingredient)
        add({
          id: entity.id,
          kind: 'ingredient',
          name: entity.ingredient.name,
          detail: null,
          matchedOn: 'identifier',
          identifiers
        });
      else if (entity.product)
        add({
          id: entity.id,
          kind: 'product',
          name: entity.product.proprietaryName ?? 'Unnamed product',
          detail:
            [entity.product.labeler.name, entity.product.doseForm].filter(Boolean).join(' · ') ||
            null,
          matchedOn: 'identifier',
          identifiers
        });
      else if (entity.package)
        add({
          id: entity.id,
          kind: 'package',
          name: entity.package.description ?? 'Unnamed package',
          detail: entity.package.containerType,
          matchedOn: 'identifier',
          identifiers
        });
      else if (entity.formularyItem)
        add({
          id: entity.id,
          kind: 'formulary_item',
          name: entity.formularyItem.displayName,
          detail:
            [entity.formularyItem.kind, entity.formularyItem.scope.name]
              .filter(Boolean)
              .join(' · ') || null,
          matchedOn: 'identifier',
          identifiers
        });
      else if (entity.labeler)
        add({
          id: entity.id,
          kind: 'labeler',
          name: entity.labeler.name,
          detail: null,
          matchedOn: 'identifier',
          identifiers
        });
    }
  }

  return json({
    query,
    sync,
    staged,
    results: [...results.values()]
      .sort(
        (a, b) =>
          rank(a, query, exactIdentifierIds) - rank(b, query, exactIdentifierIds) ||
          naturalCompare(a.name, b.name)
      )
      .slice(0, limit)
  });
};
