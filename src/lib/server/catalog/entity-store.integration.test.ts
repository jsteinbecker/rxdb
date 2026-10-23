import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '../../../generated/client';
import { loadPackageSnapshots } from './snapshot-store';
import { persistCollection, refreshPackageEligibility } from './entity-store';
import { packageFixture } from '../testing/package-fixture';
import { CACHE_SOURCE } from './cache';
import { mergePackage } from '../../catalog/effective-package';

/** Opt-in: all fixture writes are rolled back, even if an assertion fails. */
test(
	'PostgreSQL collection refresh, identity, history, and persistent cache',
	{
		skip: process.env.RUN_DB_TESTS !== '1',
		timeout: 60_000
	},
	async () => {
		const db = new PrismaClient({
			adapter: new PrismaPg({
				connectionString: process.env.DATABASE_URL,
				connectionTimeoutMillis: 5_000
			})
		});
		const rollback = new Error('ROLLBACK_COLLECTION_FIXTURES');
		const ndc = `99999${String(randomInt(1000, 9999))}01`;
		const fixtureName = `Collection test ${randomUUID()}`;
		try {
			await db.$transaction(
				async (tx) => {
					// Run the production storage operations in this outer rollback transaction.
					const nested = new Proxy(tx, {
						get(target, property) {
							if (property === '$transaction')
								return (work: (client: Prisma.TransactionClient) => unknown) => work(tx);
							return Reflect.get(target, property);
						}
					}) as unknown as PrismaClient;
					assert.equal(
						await tx.externalIdentifier.count({
							where: { namespace: 'ndc11', normalizedValue: ndc }
						}),
						0
					);
					const item = packageFixture({
						ndc,
						productCode: `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}`,
						labelerName: fixtureName,
						ingredients: [{ name: fixtureName, strength: '5 mg/mL' }],
						description: '10 VIAL in 1 CARTON / 4 mL in 1 VIAL',
						doseForm: 'INJECTION, SOLUTION',
						isDryFill: false,
						size: { kind: 'volume', value: 4, unit: 'mL', container: 'VIAL', packQty: 10 },
						isMultiDose: false
					});
					await tx.identifierNamespace.upsert({
						where: { code: 'rxnorm_rxcui' },
						create: { code: 'rxnorm_rxcui', appliesTo: ['clinical_drug'] },
						update: {}
					});
					const drug = await tx.entity.create({ data: { type: 'clinical_drug' } });
					await tx.clinicalDrug.create({ data: { id: drug.id, name: fixtureName } });
					await tx.externalIdentifier.create({
						data: {
							entityId: drug.id,
							namespace: 'rxnorm_rxcui',
							value: 'test-rxcui',
							normalizedValue: 'test-rxcui'
						}
					});
					item.details = {
						product: null,
						packaging: null,
						label: null,
						spl: null,
						rxnav: {
							status: 'ACTIVE',
							rxcui: 'test-rxcui',
							conceptName: fixtureName,
							conceptStatus: 'ACTIVE',
							history: [],
							properties: [],
							packaging: []
						}
					};
					await persistCollection(nested, [], [item]);
					const first = await tx.externalIdentifier.findFirstOrThrow({
						where: { namespace: 'ndc11', normalizedValue: ndc }
					});
					const component = await tx.packageComponent.findFirstOrThrow({
						where: { parentPackageId: first.entityId, validTo: null }
					});
					assert.equal(
						(
							await tx.relationshipType.findUniqueOrThrow({
								where: { code: 'package_clinical_drug' }
							})
						).toType,
						'clinical_drug'
					);
					assert.equal(
						await tx.entityRelationship.count({
							where: {
								relationshipType: 'package_clinical_drug',
								fromEntityId: first.entityId,
								toEntityId: drug.id,
								validTo: null
							}
						}),
						1
					);
					assert.equal(Number(component.quantityMag), 10);
					assert.equal(
						(await tx.package.findUniqueOrThrow({ where: { id: first.entityId } })).containerType,
						'VIAL'
					);
					assert.equal(
						Number(
							(await tx.containerSpec.findUniqueOrThrow({ where: { packageId: first.entityId } }))
								.labeledFillMag
						),
						4
					);
					assert.equal(
						(await loadPackageSnapshots(nested, [ndc])).get(ndc)?.item.description,
						item.description
					);
					// PostgreSQL now() is constant within this rollback transaction; make ordering explicit.
					await tx.sourceRecord.updateMany({
						where: { sourceNativeId: ndc, ingestionRun: { source: CACHE_SOURCE } },
						data: { observedAt: new Date('2000-01-01') }
					});
					const updated = {
						...item,
						description: 'Updated description',
						brandName: 'Updated brand',
						ingredients: [{ name: fixtureName, strength: '10 mg/mL' }]
					};
					await persistCollection(nested, [], [updated]);
					// A refresh that finds nothing new updates the snapshot in place.
					const cacheRecords = () =>
						tx.sourceRecord.count({
							where: { sourceNativeId: ndc, ingestionRun: { source: CACHE_SOURCE } }
						});
					const before = await cacheRecords();
					await persistCollection(nested, [], [updated]);
					assert.equal(await cacheRecords(), before);
					assert.equal(
						(await loadPackageSnapshots(nested, [ndc])).get(ndc)?.item.description,
						'Updated description'
					);
					assert.equal(
						await tx.externalIdentifier.count({
							where: { namespace: 'ndc11', normalizedValue: ndc }
						}),
						1
					);
					assert.equal(
						(await tx.package.findUniqueOrThrow({ where: { id: first.entityId } })).description,
						'Updated description'
					);
					assert.equal(
						(await tx.product.findUniqueOrThrow({ where: { id: component.childProductId! } }))
							.proprietaryName,
						'Updated brand'
					);
					assert.equal(
						await tx.productIngredient.count({
							where: { productId: component.childProductId!, validTo: null }
						}),
						1
					);
					assert.equal(
						await tx.productIngredient.count({
							where: { productId: component.childProductId!, validTo: { not: null } }
						}),
						1
					);
					assert.equal(
						(await loadPackageSnapshots(nested, [ndc])).get(ndc)?.item.description,
						'Updated description'
					);
					const scope = await tx.scope.create({ data: { kind: 'formulary', name: fixtureName } });
					const formularyItem = await tx.entity.create({ data: { type: 'formulary_item' } });
					await tx.formularyItem.create({
						data: {
							id: formularyItem.id,
							scopeId: scope.id,
							kind: 'package',
							displayName: fixtureName
						}
					});
					const link = () =>
						tx.formularyItemPackage.create({
							data: { formularyItemId: formularyItem.id, packageId: first.entityId }
						});
					const linked = () =>
						tx.formularyItemPackage.count({
							where: { formularyItemId: formularyItem.id, packageId: first.entityId, validTo: null }
						});
					await link();
					const partial = mergePackage(updated, {
						...updated,
						description: null,
						ingredients: [],
						complete: false,
						listed: null
					});
					await persistCollection(nested, [], [partial]);
					assert.equal(
						(await tx.package.findUniqueOrThrow({ where: { id: first.entityId } })).description,
						'Updated description'
					);
					const sibling = { ...item, ndc: `${ndc.slice(0, 9)}02` };
					await persistCollection(nested, [], [sibling]);
					const siblingId = await tx.externalIdentifier.findFirstOrThrow({
						where: { namespace: 'ndc11', normalizedValue: sibling.ndc }
					});
					assert.equal(
						(
							await tx.packageComponent.findFirstOrThrow({
								where: { parentPackageId: siblingId.entityId, validTo: null }
							})
						).childProductId,
						component.childProductId
					);
					// A provider that did not answer is no evidence; the package stays on the formulary.
					assert.equal(await linked(), 1);
					await persistCollection(nested, [], [{ ...updated, isVeterinary: true }]);
					assert.equal(
						(await tx.entity.findUniqueOrThrow({ where: { id: first.entityId } })).status,
						'catalog-excluded'
					);
					assert.equal(await linked(), 0);
					await link();
					await persistCollection(nested, [], [updated]);
					assert.equal(
						(await tx.entity.findUniqueOrThrow({ where: { id: first.entityId } })).status,
						'active'
					);
					// Restoring the package leaves the link made since in place.
					assert.equal(await linked(), 1);
					await refreshPackageEligibility(nested, [{ ...updated, marketingEndDate: '20000101' }]);
					assert.equal(
						(await tx.entity.findUniqueOrThrow({ where: { id: first.entityId } })).status,
						'catalog-excluded'
					);
					assert.equal(await linked(), 0);
					await refreshPackageEligibility(nested, [updated]);
					assert.equal(
						(await tx.entity.findUniqueOrThrow({ where: { id: first.entityId } })).status,
						'active'
					);
					await refreshPackageEligibility(nested, [
						{ ...updated, isVeterinary: true },
						{ ...sibling, isVeterinary: true }
					]);
					assert.equal(
						(await tx.entity.findUniqueOrThrow({ where: { id: component.childProductId! } }))
							.status,
						'catalog-excluded'
					);
					await refreshPackageEligibility(nested, [updated]);
					assert.equal(
						(await tx.entity.findUniqueOrThrow({ where: { id: component.childProductId! } }))
							.status,
						'active'
					);
					// A snapshot stored before "product found, package missing" read as unlisted
					// (33358-0028-60): no SPL and a stale RxNav ACTIVE still take it off the formulary.
					await link();
					await refreshPackageEligibility(nested, [
						{ ...updated, listed: null, splPresent: false, rxcuiStatus: 'ACTIVE' }
					]);
					assert.equal(
						(await tx.entity.findUniqueOrThrow({ where: { id: first.entityId } })).status,
						'catalog-excluded'
					);
					assert.equal(await linked(), 0);
					await refreshPackageEligibility(nested, [updated]);
					await tx.entity.update({ where: { id: first.entityId }, data: { status: 'inactive' } });
					await refreshPackageEligibility(nested, [updated]);
					assert.equal(
						(await tx.entity.findUniqueOrThrow({ where: { id: first.entityId } })).status,
						'inactive'
					);
					// A dry fill's stated 152 mL never becomes physical liquid fill.
					await persistCollection(nested, [], [{ ...updated, isDryFill: true }]);
					assert.equal(
						(await tx.containerSpec.findUniqueOrThrow({ where: { packageId: first.entityId } }))
							.labeledFillMag,
						null
					);
					assert.equal(
						await tx.ingestionRun.count({
							where: {
								source: CACHE_SOURCE,
								status: 'running',
								sourceRecords: { some: { sourceNativeId: ndc } }
							}
						}),
						0
					);
					throw rollback;
				},
				{ timeout: 50_000 }
			);
		} catch (error) {
			if (error !== rollback) throw error;
			assert.equal(
				await db.externalIdentifier.count({ where: { namespace: 'ndc11', normalizedValue: ndc } }),
				0
			);
		} finally {
			await db.$disconnect();
		}
	}
);
