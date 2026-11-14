import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '../../../generated/client';
import { exclusionReason } from '../../catalog/package-facts';
import { CACHE_SOURCE } from '../catalog/cache';
import { reconcileFormularyEligibility } from '../catalog/entity-store';
import { packageFixture } from '../testing/package-fixture';
import { loadToFormulary } from './membership';

/**
 * Opt-in: all fixture writes are rolled back, even if an assertion fails.
 *
 * Obsolete repackager NDCs (33358-0028-xx) stayed on the formulary because a fix
 * reached only the package someone opened and refetched. This covers both ways a
 * package leaves: refused at load, and unlinked later from stored evidence alone.
 */
test(
	'PostgreSQL formulary load refuses excluded packages and reconcile unlinks stale ones',
	{ skip: process.env.RUN_DB_TESTS !== '1', timeout: 120_000 },
	async () => {
		const db = new PrismaClient({
			adapter: new PrismaPg({
				connectionString: process.env.DATABASE_URL,
				connectionTimeoutMillis: 5_000
			})
		});
		const rollback = new Error('ROLLBACK_MEMBERSHIP_FIXTURES');
		const base = `99998${String(randomInt(1000, 9999))}`;
		const fixtureName = `Membership test ${randomUUID()}`;
		try {
			await db.$transaction(
				async (tx) => {
					const nested = new Proxy(tx, {
						get(target, property) {
							if (property === '$transaction')
								return (work: (client: Prisma.TransactionClient) => unknown) => work(tx);
							return Reflect.get(target, property);
						}
					}) as unknown as PrismaClient;
					const fixture = (suffix: string, overrides: Parameters<typeof packageFixture>[0]) =>
						packageFixture({
							ndc: `${base}${suffix}`,
							productCode: `${base.slice(0, 5)}-${base.slice(5)}`,
							labelerName: fixtureName,
							brandName: fixtureName,
							genericName: fixtureName,
							ingredients: [{ name: fixtureName, strength: '5 mg/mL' }],
							description: '4 mL in 1 VIAL',
							isDryFill: false,
							...overrides
						});
					const listed = fixture('01', {});
					// The 33358-0028 shape: product found, package missing, no SPL, RxNav still ACTIVE.
					const stale = fixture('02', { listed: null, splPresent: false, rxcuiStatus: 'ACTIVE' });
					const veterinary = fixture('03', { isVeterinary: true });
					// An outage is not absence: a 429'd directory with no product code keeps the package.
					const outage = fixture('04', {
						listed: null,
						productCode: null,
						splPresent: null,
						rxcuiStatus: 'ACTIVE'
					});
					assert.equal(exclusionReason(stale), 'no-spl');
					assert.equal(exclusionReason(outage), null);

					const scope = await tx.scope.create({ data: { kind: 'formulary', name: fixtureName } });
					const target = { kind: 'package', ndc: listed.ndc } as const;
					const packages = [listed, stale, veterinary, outage];
					const result = await loadToFormulary(nested, scope.id, target, null, packages);
					assert.equal(result.created, true);
					assert.equal(result.packagesLinked, 2);
					assert.deepEqual(
						result.packagesSkipped.sort((a, b) => a.ndc.localeCompare(b.ndc)),
						[
							{ ndc: stale.ndc, reason: 'no-spl' },
							{ ndc: veterinary.ndc, reason: 'veterinary' }
						]
					);
					const linkedNdcs = async () =>
						(
							await tx.externalIdentifier.findMany({
								where: {
									namespace: 'ndc11',
									validTo: null,
									entity: {
										package: {
											formularyItemPackages: {
												some: { formularyItemId: result.formularyItemId, validTo: null }
											}
										}
									}
								},
								select: { normalizedValue: true }
							})
						)
							.map((row) => row.normalizedValue)
							.sort();
					assert.deepEqual(await linkedNdcs(), [listed.ndc, outage.ndc]);
					// Excluded packages never become catalog entities through a load.
					assert.equal(
						await tx.externalIdentifier.count({
							where: { namespace: 'ndc11', normalizedValue: { in: [stale.ndc, veterinary.ndc] } }
						}),
						0
					);

					// Loading again links nothing twice and still refuses the excluded ones.
					const again = await loadToFormulary(nested, scope.id, target, null, packages);
					assert.equal(again.created, false);
					assert.equal(again.formularyItemId, result.formularyItemId);
					assert.equal(again.packagesLinked, 2);
					assert.equal(again.packagesSkipped.length, 2);

					// Later the stored snapshot turns out to be the 33358-0028 shape, and it was
					// written by an older CATALOG_VERSION. Nobody opens the package; reconcile
					// must still take it off, from stored evidence and without a provider call.
					const updated = await tx.$executeRaw`
						UPDATE source_record r
						SET payload = jsonb_set(
							jsonb_set(
								jsonb_set(
									jsonb_set(r.payload, '{version}', '"catalog-sync-v1"'),
									'{item,listed}', 'null'),
								'{item,splPresent}', 'false'),
							'{item,rxcuiStatus}', '"ACTIVE"')
						FROM ingestion_run run
						WHERE run.id = r.ingestion_run_id AND run.source = ${CACHE_SOURCE}
							AND r.source_native_id = ${listed.ndc}`;
					assert.ok(updated > 0, 'the fixture package has a stored snapshot');
					const original = globalThis.fetch;
					globalThis.fetch = async () => {
						throw new Error('reconcile must not call a provider');
					};
					try {
						const reconciled = await reconcileFormularyEligibility(nested);
						assert.ok(reconciled.excluded.includes(listed.ndc));
						assert.ok(!reconciled.excluded.includes(outage.ndc));
					} finally {
						globalThis.fetch = original;
					}
					assert.deepEqual(await linkedNdcs(), [outage.ndc]);
					const listedEntity = await tx.externalIdentifier.findFirstOrThrow({
						where: { namespace: 'ndc11', normalizedValue: listed.ndc, validTo: null },
						select: { entity: { select: { status: true } } }
					});
					assert.equal(listedEntity.entity.status, 'catalog-excluded');
					throw rollback;
				},
				{ timeout: 110_000 }
			);
		} catch (error) {
			if (error !== rollback) throw error;
			assert.equal(
				await db.externalIdentifier.count({
					where: { namespace: 'ndc11', normalizedValue: { startsWith: base } }
				}),
				0
			);
		} finally {
			await db.$disconnect();
		}
	}
);
