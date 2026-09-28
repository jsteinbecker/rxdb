import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectPackages } from './catalog-collection';
import { snapshotPackage, type PackageSnapshot } from './catalog-cache';
import { packageFixture } from './catalog-test-fixtures';

test('a new collector reads durable snapshots without another provider request or write', async () => {
	const stored = new Map<string, PackageSnapshot>();
	let fetches = 0;
	let writes = 0;
	let now = new Date('2026-09-22T00:00:00Z');
	const item = packageFixture();
	const makeStore = () => ({
		load: async () => new Map(stored),
		fetch: async () => {
			fetches++;
			return [item];
		},
		save: async (items: (typeof item)[]) => {
			writes++;
			for (const item of items) stored.set(item.ndc, snapshotPackage(item, now));
		}
	});
	await collectPackages([item.ndc, item.ndc], makeStore(), now);
	assert.equal(fetches, 1);
	assert.equal(writes, 1);
	now = new Date('2026-09-22T01:00:00Z');
	const cached = await collectPackages([item.ndc], makeStore(), now);
	assert.equal(fetches, 1);
	assert.equal(writes, 1);
	assert.equal(cached[0].description, item.description);
	now = new Date('2026-09-23T01:00:00Z');
	await collectPackages([item.ndc], makeStore(), now);
	assert.equal(fetches, 2);
});

test('expired negative snapshots are retried and become enriched when the directory lists them', async () => {
	const now = new Date('2026-09-22T00:00:00Z');
	const old = packageFixture({ listed: false, description: null, ingredients: [] });
	const snapshot = snapshotPackage(old, new Date('2026-09-01T00:00:00Z'));
	const found = packageFixture({ description: 'Newly listed vial' });
	let saved = false;
	const results = await collectPackages(
		[old.ndc],
		{
			load: async () => new Map([[old.ndc, snapshot]]),
			fetch: async (ndcs) => {
				assert.deepEqual(ndcs, [old.ndc]);
				return [found];
			},
			save: async (items) => {
				saved = true;
				assert.equal(items[0].listed, true);
			}
		},
		now
	);
	assert.equal(saved, true);
	assert.equal(results[0].description, 'Newly listed vial');
});

test('a requested NDC does not wait for product-family sibling enrichment', async () => {
	const item = packageFixture();
	item.details = {
		packaging: {
			marketingStartDate: null,
			sample: null,
			siblings: [{ ndc: '12345678901', description: 'Sibling package' }]
		}
	} as NonNullable<typeof item.details>;
	const fetched: string[][] = [];
	const results = await collectPackages([item.ndc], {
		load: async () => new Map(),
		fetch: async (ndcs) => {
			fetched.push(ndcs);
			return [item];
		},
		save: async () => {}
	});
	assert.deepEqual(fetched, [[item.ndc]]);
	assert.deepEqual(results.map((result) => result.ndc), [item.ndc]);
});
