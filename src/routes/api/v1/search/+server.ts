import { toNdc11 } from '$lib/ndc';
import { naturalCompare } from '$lib/natural-sort';
import { hierarchyDoseForm, labelerLabel } from '$lib/formulary-hierarchy';
import { ttyLabel } from '$lib/rxnorm-tty';
import { json } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { stagedTree, syncExternalSearch } from '$lib/server/catalog-sync';
import { defaultScope } from '$lib/server/catalog-formulary';
import { withPharmClassRulesInTree } from '$lib/server/pharm-class-view';
import { withLocalConceptsInTree } from '$lib/server/local-concept-view';
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
	/** The page that shows it, when one does. */
	href?: string | null;
};

const amount = (value: unknown) => String(Number(Number(value).toPrecision(6)));
/** `500 mg`, `25 mg/mL`, `100 mg/4 mL`: a stored strength as a reader says it. */
function strengthText(row: {
	strengthNumMag: unknown;
	strengthNumUom: string;
	strengthDenMag: unknown;
	strengthDenUom: string;
}) {
	const den = Number(row.strengthDenMag);
	// "per 1 capsule" or "per 1 {tablet}" says nothing; a volume or mass denominator does.
	const perUnit = den === 1 && !/^(?:m?l|g|mg|kg)$/i.test(row.strengthDenUom);
	const per = perUnit ? '' : `/${den === 1 ? '' : `${amount(den)} `}${row.strengthDenUom}`;
	return `${amount(row.strengthNumMag)} ${row.strengthNumUom}${per}`;
}

/** Rules only change what is displayed, so a failed lookup must not discard a successful search. */
async function stagedWithRules(tree: Awaited<ReturnType<typeof stagedTree>>) {
	try {
		const scopeId = (await defaultScope(prisma)).id;
		return await withLocalConceptsInTree(
			prisma,
			scopeId,
			await withPharmClassRulesInTree(prisma, scopeId, tree)
		);
	} catch (cause) {
		console.error('pharm-class rules lookup failed; returning source classes', cause);
		return tree;
	}
}

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
 *   [&local=1 | &external=1]
 *
 * `offset` pages the staged RxNav concepts (10 per page); catalog results are unaffected.
 * `local=1` skips the live lookup; `external=1` returns only it (`results` is empty).
 * Staged concepts arrive without packages: GET /api/v1/search/packages?rxcui= fetches them.
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
					// Display classes with the scope's rules applied; staged data keeps the source's.
					staged: await stagedWithRules(await stagedTree(staged))
				}))
				.catch((error: unknown) => ({
					sync: {
						concepts: 0,
						ndcs: 0,
						packages: 0,
						excluded: 0,
						partial: true,
						total: 0,
						offset,
						warning: error instanceof Error ? error.message : 'External catalog sync failed.'
					},
					staged: { scope: null, concepts: [], packages: [] }
				}));

	if (externalSearch && url.searchParams.get('external') === '1')
		return json({ query, ...(await externalSearch), results: [] });

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
						where: { isActive: true, validTo: null },
						orderBy: { ordinal: 'asc' },
						select: {
							ingredient: { select: { name: true } },
							strengthNumMag: true,
							strengthNumUom: true,
							strengthDenMag: true,
							strengthDenUom: true
						}
					}
				},
				// Grouped below by name, form and strength, so fetch enough to fill the groups.
				take: limit * 4
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
							externalIdentifiers: {
								where: { namespace: 'ndc11', validTo: null },
								select: { normalizedValue: true },
								take: 1
							},
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
			detail: ttyLabel(row.tty),
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
	// The same drug from many repackagers reads as one row: name, form and strength,
	// with how many labelers sell it.
	const productGroups = new Map<
		string,
		{ row: (typeof products)[number]; name: string; strength: string; doseForm: string; labelers: Set<string>; matched: boolean }
	>();
	for (const row of products) {
		const needle = query.toLocaleLowerCase();
		const matchedIngredient = row.productIngredients.find((item) =>
			item.ingredient.name.toLocaleLowerCase().includes(needle)
		)?.ingredient.name;
		const name = row.proprietaryName ?? matchedIngredient ?? row.productIngredients[0]?.ingredient.name ?? 'Unnamed product';
		const strength = row.productIngredients.map(strengthText).join(' / ');
		// One spelling per form and per company, as the formulary uses.
		const doseForm = row.doseForm ? hierarchyDoseForm(row.doseForm) : '';
		const key = [name.toLocaleLowerCase(), doseForm, strength].join('|');
		const group = productGroups.get(key) ?? {
			row,
			name,
			strength,
			doseForm,
			labelers: new Set<string>(),
			matched: Boolean(matchedIngredient && !row.proprietaryName?.toLocaleLowerCase().includes(needle))
		};
		group.labelers.add(labelerLabel(row.labeler.name));
		productGroups.set(key, group);
	}
	for (const { row, name, strength, doseForm, labelers, matched } of [...productGroups.values()].slice(0, limit)) {
		const names = [...labelers];
		add({
			id: row.id,
			kind: 'product',
			name: [name, strength].filter(Boolean).join(' '),
			detail:
				[
					doseForm,
					names.length === 1
						? names[0]
						: `${names.length} labelers (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''})`
				]
					.filter(Boolean)
					.join(' · ') || null,
			matchedOn: matched ? 'ingredient' : 'name',
			identifiers: identifiersByEntity.get(row.id) ?? []
		});
	}
	for (const row of packages) {
		const matchedDrug = row.entity.relationshipsFrom[0]?.toEntity.clinicalDrug?.name;
		const ndc = row.entity.externalIdentifiers[0]?.normalizedValue;
		add({
			id: row.id,
			kind: 'package',
			href: ndc ? `/formulary/ndc/${ndc}` : null,
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
			detail: `On ${row.scope.name}`,
			href: `/formulary/items/${row.id}`,
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
					detail: ttyLabel(entity.clinicalDrug.tty),
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
					detail: `On ${entity.formularyItem.scope.name}`,
					href: `/formulary/items/${entity.id}`,
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
