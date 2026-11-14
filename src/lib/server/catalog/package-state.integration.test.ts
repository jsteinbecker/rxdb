import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../../generated/client';
import { packageFixture } from '../testing/package-fixture';
import { loadPackageSnapshots, recordEvidence, stageCollection } from './snapshot-store';
import {
	assertPackageRevision,
	loadPackageStates,
	PackageConflict,
	stateSnapshot
} from './package-state-store';
import { commitPackageChanges } from '../curation/package-corrections';
import { CATALOG_VERSION, isFresh, snapshotPackage } from './cache';

const stamp = (value: string) => ({ value, createdAt: '2026-10-20', source: 'none' as const });

test(
	'PostgreSQL durable baselines, offline correction removal, stale revisions, migration and atomic preview consumption',
	{ skip: process.env.RUN_DB_TESTS !== '1', timeout: 60_000 },
	async () => {
		const db = new PrismaClient({
			adapter: new PrismaPg({
				connectionString: process.env.DATABASE_URL,
				connectionTimeoutMillis: 5_000
			})
		});
		const rollback = new Error('ROLLBACK_PACKAGE_CURATION_FIXTURES');
		const ndc = `99888${randomInt(1000, 9999)}01`;
		try {
			await db.$transaction(
				async (tx) => {
					const nested = new Proxy(tx, {
						get(target, key) {
							return key === '$transaction'
								? (work: (client: Prisma.TransactionClient) => unknown) => work(tx)
								: Reflect.get(target, key);
						}
					}) as unknown as PrismaClient;
					const fixture = packageFixture({
						ndc,
						description: 'Provider vial',
						evidence: [
							{
								source: 'fixture',
								nativeId: ndc,
								url: `urn:fixture:${ndc}`,
								payload: { raw: true }
							}
						]
					});
					await stageCollection(nested, [], [fixture]);
					const original = (await loadPackageStates(tx, [ndc])).get(ndc)!;
					assert.equal(original.baseline.description, 'Provider vial');
					assert.equal(original.revision, 0);
					const changed = await commitPackageChanges(nested, [
						{
							ndc,
							expectedRevision: 0,
							overrides: { description: stamp('Corrected vial') },
							evidence: []
						}
					]);
					assert.equal(changed[0].description, 'Corrected vial');
					assert.equal(
						(await loadPackageStates(tx, [ndc])).get(ndc)?.baseline.description,
						'Provider vial'
					);
					await stageCollection(nested, [], [{ ...fixture, description: 'New provider vial' }]);
					const refreshed = (await loadPackageStates(tx, [ndc])).get(ndc)!;
					assert.equal(stateSnapshot(refreshed).item.description, 'Corrected vial');
					assert.throws(() => assertPackageRevision(refreshed, 1), PackageConflict);
					await assert.rejects(
						() =>
							commitPackageChanges(nested, [
								{ ndc, expectedRevision: 1, overrides: {}, evidence: [] }
							]),
						PackageConflict
					);
					const noNetwork = globalThis.fetch;
					globalThis.fetch = async () => {
						throw new Error('OFFLINE');
					};
					try {
						await commitPackageChanges(nested, [
							{ ndc, expectedRevision: refreshed.revision, overrides: {}, evidence: [] }
						]);
						assert.equal(
							(await loadPackageSnapshots(nested, [ndc])).get(ndc)?.item.description,
							'New provider vial'
						);
					} finally {
						globalThis.fetch = noNetwork;
					}
					// Parser invalidation changes freshness, never the lifetime of decisions.
					await tx.packageCuration.update({
						where: { ndc },
						data: { baselineVersion: 'older-parser', overrides: { description: stamp('Durable') } }
					});
					const stale = (await loadPackageSnapshots(nested, [ndc])).get(ndc)!;
					assert.equal(stale.item.description, 'Durable');
					assert.equal(isFresh(stale), false);
					const beforeRefresh = (await loadPackageStates(tx, [ndc])).get(ndc)!;
					await stageCollection(nested, [], [fixture]);
					const afterRefresh = (await loadPackageStates(tx, [ndc])).get(ndc)!;
					assert.equal(afterRefresh.baselineVersion, CATALOG_VERSION);
					assert.ok(afterRefresh.revision > beforeRefresh.revision);
					// Preview deletion belongs to the same transaction as its decisions.
					const token = randomUUID();
					await tx.packageReviewPreview.create({
						data: {
							token,
							ndc,
							sourceRevision: afterRefresh.revision,
							baseline: fixture as unknown as Prisma.InputJsonValue,
							overrides: {},
							review: {},
							evidence: [],
							expiresAt: new Date(Date.now() + 60_000)
						}
					});
					await commitPackageChanges(
						nested,
						[{ ndc, expectedRevision: afterRefresh.revision, overrides: {}, evidence: [] }],
						async (client) => {
							await client.packageReviewPreview.delete({ where: { token } });
						}
					);
					assert.equal(await tx.packageReviewPreview.count({ where: { token } }), 0);
					// Exercise the actual seed SQL against historical snapshots, not a hand-written backfill substitute.
					const legacyNdc = `99887${randomInt(1000, 9999)}01`;
					const raw = packageFixture({ ndc: legacyNdc, description: 'Recorded original' });
					const effective = {
						...raw,
						description: 'Legacy correction',
						propertyOverrides: { description: stamp('Legacy correction') }
					};
					const originalRecords = await recordEvidence(tx, [
						{
							source: 'catalog-enrichment',
							nativeId: legacyNdc,
							url: `urn:fixture:${legacyNdc}`,
							payload: snapshotPackage(raw)
						}
					]);
					await recordEvidence(tx, [
						{
							source: 'catalog-enrichment',
							nativeId: legacyNdc,
							url: `urn:fixture:${legacyNdc}`,
							payload: snapshotPackage(effective)
						}
					]);
					await tx.sourceRecord.updateMany({
						where: { id: { in: [...originalRecords.values()] } },
						data: { observedAt: new Date('2000-01-01T00:00:00Z') }
					});
					const migration = readFileSync(
						new URL(
							'../../../../prisma/migrations/20261020120000_package_curation/migration.sql',
							import.meta.url
						),
						'utf8'
					);
					const seed = migration.slice(
						migration.indexOf('INSERT INTO package_curation'),
						migration.lastIndexOf('COMMIT;')
					);
					await tx.$executeRawUnsafe(seed); // Static, audited migration SQL; fixture writes roll back below.
					const migrated = (await loadPackageStates(tx, [legacyNdc])).get(legacyNdc)!;
					assert.equal(migrated.baseline.description, 'Recorded original');
					assert.equal(stateSnapshot(migrated).item.description, 'Legacy correction');
					await commitPackageChanges(nested, [
						{ ndc: legacyNdc, expectedRevision: migrated.revision, overrides: {}, evidence: [] }
					]);
					assert.equal(
						(await loadPackageSnapshots(nested, [legacyNdc])).get(legacyNdc)?.item.description,
						'Recorded original'
					);
					throw rollback;
				},
				{ timeout: 55_000 }
			);
		} catch (error) {
			if (error !== rollback) throw error;
		} finally {
			await db.$disconnect();
		}
	}
);
