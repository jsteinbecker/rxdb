import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PrismaClient } from '../../../generated/client';
import { CACHE_SOURCE, snapshotPackage } from './cache';
import { packageFixture } from '../testing/package-fixture';
import {
	latestCacheRecords,
	latestPropertyOverrides,
	payloadHash,
	stageCollection
} from './snapshot-store';

test('staging stores evidence and snapshots without promoting catalog identities', async () => {
	const item = packageFixture({
		splXml: '<document/>',
		details: {
			product: null,
			packaging: null,
			spl: null,
			rxnav: null,
			label: {
				effectiveTime: '20260101',
				version: '3',
				setId: 'set-1',
				sections: [
					{ key: 'description', title: 'Description', text: 'A tablet.' },
					{ key: 'how_supplied', title: 'How supplied', text: 'Bottles of 30.' }
				]
			}
		},
		propertyOverrides: { doseForm: { value: 'TABLET', createdAt: '2026-10-19', source: 'none' } },
		evidence: [
			{
				source: 'openfda-ndc',
				nativeId: 'same',
				url: 'https://api.fda.gov/drug/ndc.json?api_key=secret',
				payload: { revision: 1 }
			},
			{
				source: 'openfda-ndc',
				nativeId: 'same',
				url: 'https://api.fda.gov/drug/ndc.json?api_key=secret',
				payload: { revision: 2 }
			}
		]
	});
	const records: { sourceUrl: string; payload?: unknown; payloadRef?: Uint8Array }[] = [];
	const shared = new Map<string, unknown>();
	const labels: { hash: Uint8Array }[] = [];
	const sections: { labelHash: Uint8Array; position: number; text: string }[] = [];
	const finished: string[] = [];
	let transactions = 0;
	const tx = {
		$queryRaw: async () => [],
		packageCuration: {
			findMany: async () => [],
			upsert: async ({ create }: { create: Record<string, unknown> }) => ({
				revision: 0,
				initialized: true,
				review: {},
				unknownKeys: [],
				legacyBaseline: null,
				legacySnapshot: null,
				updatedAt: new Date(),
				...create
			})
		},
		source: { upsert: async () => ({}) },
		sourcePayload: {
			createMany: async ({ data }: { data: { hash: Uint8Array; payload: unknown }[] }) => {
				for (const row of data) shared.set(Buffer.from(row.hash).toString('hex'), row.payload);
				return { count: data.length };
			}
		},
		splLabel: {
			createMany: async ({ data }: { data: { hash: Uint8Array }[] }) => {
				// skipDuplicates: the baseline and the snapshot carry the same label.
				const fresh = data.filter(
					(row) => !labels.some((label) => Buffer.from(label.hash).equals(row.hash))
				);
				labels.push(...fresh);
				return { count: fresh.length };
			}
		},
		splLabelSection: {
			createMany: async ({ data }: { data: typeof sections }) => {
				sections.push(...data);
				return { count: data.length };
			}
		},
		ingestionRun: {
			create: async () => ({ id: randomUUID() }),
			update: async ({ where }: { where: { id: string } }) => {
				finished.push(where.id);
			}
		},
		sourceRecord: {
			create: async ({ data }: { data: (typeof records)[number] }) => {
				records.push(data);
				return { id: randomUUID() };
			}
		}
	};
	const db = {
		$transaction: async (work: (client: typeof tx) => unknown) => {
			transactions++;
			return work(tx);
		}
	} as unknown as PrismaClient;
	await stageCollection(db, [], [item]);
	assert.equal(transactions, 1);
	assert.equal(records.length, 2);
	assert.equal(finished.length, 2);
	// Raw provider payloads are shared by content, not stored inline.
	assert.equal(records[0].payload, undefined);
	assert.deepEqual(shared.get(Buffer.from(records[0].payloadRef!).toString('hex')), {
		revision: 2
	});
	assert.equal(new URL(records[0].sourceUrl).searchParams.has('api_key'), false);
	const stored = records[1].payload as ReturnType<typeof snapshotPackage>;
	assert.equal(stored.item.splXml, null);
	assert.deepEqual(stored.item.evidence, []);
	assert.deepEqual(stored.item.propertyOverrides, item.propertyOverrides);
	// The snapshot keeps its label sections by hash, stored once in spl_label.
	const storedLabel = stored.item.details?.label as unknown as {
		sectionsHash: string;
		sections?: unknown;
	};
	assert.equal(storedLabel.sections, undefined);
	assert.equal(labels.length, 1);
	assert.equal(Buffer.from(labels[0].hash).toString('hex'), storedLabel.sectionsHash);
	assert.deepEqual(
		sections.map((section) => section.text),
		item.details!.label!.sections.map((section) => section.text)
	);
	// Staging must not strip raw evidence from the caller's package.
	assert.equal(item.splXml, '<document/>');
	assert.equal(item.evidence.length, 2);
});

test('snapshot hashes ignore freshness but retain changes to facts and user decisions', () => {
	const before = snapshotPackage(packageFixture(), new Date('2026-10-18'));
	const later = { ...before, refreshAt: '2026-10-21T00:00:00.000Z' };
	assert.deepEqual(payloadHash(CACHE_SOURCE, before), payloadHash(CACHE_SOURCE, later));
	assert.notDeepEqual(
		payloadHash(CACHE_SOURCE, before),
		payloadHash(CACHE_SOURCE, {
			...later,
			item: { ...before.item, manualExclusion: 'Review needed' }
		})
	);
	assert.notDeepEqual(payloadHash('raw-provider', before), payloadHash('raw-provider', later));
});

test('label-free reads isolate callers and invalidate cached payloads when observedAt changes', async () => {
	const id = randomUUID();
	const ndc = '12345678901';
	let observedAt = new Date('2026-10-18');
	let description = 'Original';
	let payloadReads = 0;
	const db = {
		$queryRaw: async (sql: TemplateStringsArray) => {
			if (sql.join('').includes('FROM package_curation')) return [];
			if (sql.join('').includes('DISTINCT ON')) return [{ id, sourceNativeId: ndc, observedAt }];
			payloadReads++;
			return [{ id, payload: { item: { ndc, description } } }];
		}
	} as unknown as PrismaClient;
	const [first] = await latestCacheRecords(db, [ndc], { withoutLabel: true });
	(first.payload as { item: { description: string } }).item.description = 'Caller mutation';
	const [second] = await latestCacheRecords(db, [ndc], { withoutLabel: true });
	assert.equal((second.payload as { item: { description: string } }).item.description, 'Original');
	assert.equal(payloadReads, 1);
	observedAt = new Date('2026-10-19');
	description = 'Refreshed';
	const [third] = await latestCacheRecords(db, [ndc], { withoutLabel: true });
	assert.equal((third.payload as { item: { description: string } }).item.description, 'Refreshed');
	assert.equal(payloadReads, 2);
});

test('override recovery reads the latest decisions independently of the snapshot parser version', async () => {
	const overrides = { doseForm: { source: 'none', value: 'TABLET', createdAt: '2026-10-19' } };
	const db = {
		$queryRaw: async (sql: TemplateStringsArray) => {
			if (sql.join('').includes('FROM package_curation')) return [];
			assert.equal(sql.join('').includes("payload ->> 'version'"), false);
			return [
				{ ndc: '12345678901', overrides },
				{ ndc: '12345678902', overrides: null }
			];
		}
	} as unknown as PrismaClient;
	assert.deepEqual(
		await latestPropertyOverrides(db, ['12345678901', '12345678902']),
		new Map([['12345678901', overrides]])
	);
});

test('snapshot reads replay current correction rules without mutating stored facts', async () => {
	const { readSnapshot } = await import('./cache');
	const snapshot = snapshotPackage(
		packageFixture({
			isDryFill: true,
			propertyOverrides: {
				doseForm: { value: 'INJECTION, SOLUTION', createdAt: '2026-10-19', source: 'none' }
			}
		})
	);
	const item = readSnapshot(snapshot)?.item;
	assert.equal(item?.isDryFill, false);
	assert.equal(snapshot.item.isDryFill, true);
});
