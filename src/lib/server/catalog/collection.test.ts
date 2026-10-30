import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectPackages } from './collection';
import { type PackageSnapshot, snapshotPackage } from './cache';
import { packageFixture } from '../testing/package-fixture';

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
	assert.deepEqual(
		results.map((result) => result.ndc),
		[item.ndc]
	);
});

test('a rate-limited refetch keeps the product facts the failed provider supplied before', async () => {
	const productSection = (overrides: object) =>
		({
			productType: null,
			routes: [],
			marketingCategory: null,
			applicationNumber: null,
			deaSchedule: null,
			marketingStartDate: null,
			listingExpirationDate: null,
			finished: null,
			pharmClasses: [],
			rxcuis: [],
			uniis: [],
			manufacturers: [],
			splId: null,
			...overrides
		}) as NonNullable<NonNullable<ReturnType<typeof packageFixture>['details']>['product']>;
	const old = packageFixture();
	old.details = {
		product: productSection({
			productType: 'HUMAN PRESCRIPTION DRUG',
			marketingCategory: 'ANDA',
			routes: ['INTRAVENOUS'],
			rxcuis: ['1']
		})
	} as NonNullable<typeof old.details>;
	// openFDA failed; RxNorm alone rebuilt the product section with a new rxcui.
	const partial = packageFixture({
		complete: false,
		providerErrors: [{ source: 'openFDA', status: 429, message: 'rate limit exceeded' }]
	});
	partial.details = {
		product: productSection({ rxcuis: ['2'] })
	} as NonNullable<typeof partial.details>;
	const [result] = await collectPackages(
		[old.ndc],
		{
			load: async () =>
				new Map([[old.ndc, snapshotPackage(old, new Date('2026-09-01T00:00:00Z'))]]),
			fetch: async () => [partial],
			save: async () => {}
		},
		new Date('2026-09-22T00:00:00Z')
	);
	assert.equal(result.details?.product?.productType, 'HUMAN PRESCRIPTION DRUG');
	assert.equal(result.details?.product?.marketingCategory, 'ANDA');
	assert.deepEqual(result.details?.product?.routes, ['INTRAVENOUS']);
	assert.deepEqual(result.details?.product?.rxcuis, ['2']);
	assert.equal(result.providerErrors?.[0].status, 429);
});

test('overrides survive a CATALOG_VERSION bump that leaves no readable snapshot', async () => {
	const override = {
		value: 'Hand-corrected vial',
		createdAt: '2026-10-01T00:00:00Z',
		source: 'none' as const
	};
	let saved: string | null | undefined;
	const [result] = await collectPackages([packageFixture().ndc], {
		load: async () => new Map(),
		loadOverrides: async (ndcs) => new Map(ndcs.map((ndc) => [ndc, { description: override }])),
		fetch: async () => [packageFixture({ description: 'Provider vial' })],
		save: async (items) => {
			saved = items[0].description;
		}
	});
	assert.deepEqual(result.propertyOverrides?.description, override);
	assert.equal(result.description, 'Hand-corrected vial');
	assert.equal(saved, 'Provider vial');
});
