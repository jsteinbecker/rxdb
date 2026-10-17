import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hyphenCandidates, toNdc11 } from '../ndc';
import type { SplProduct } from '../spl-ingredients';
import { exclusionReason } from './catalog-facts';
import {
	fdaApiKeysFrom,
	setFdaApiKeys,
	searchFdaProducts,
	completeMoieties,
	discoverRxNav,
	discoverRxNavPage,
	enrichPackages,
	labelIngredientsOf,
	providerFailures,
	routesFromLabelText,
	routesFromProductText
} from './catalog-providers';

test('NDC normalization preserves segment boundaries and rejects ambiguous inputs', () => {
	for (const [input, expected] of [
		['0002-8215-01', '00002821501'],
		['25021-321-04', '25021032104'],
		['12345-6789-0', '12345678900']
	]) {
		assert.equal(toNdc11(input), expected);
		assert.ok(hyphenCandidates(expected).includes(input));
	}
	for (const input of ['1234567890', '1-2-3', 'abc', '12345-67890-12']) {
		assert.equal(toNdc11(input), null);
	}
});

test('ingredient discovery traverses a precise ingredient through its base and retains evidence', async () => {
	const original = globalThis.fetch;
	const urls: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		urls.push(url.href);
		let data: unknown;
		if (url.pathname.endsWith('/rxcui.json')) data = { idGroup: { rxnormId: ['10'] } };
		else if (url.pathname.endsWith('/properties.json'))
			data = { properties: { rxcui: '10', name: 'precise ingredient', tty: 'PIN' } };
		else if (url.pathname.endsWith('/ndcs.json'))
			data = { ndcGroup: { ndcList: { ndc: ['25021032104', '25021032104'] } } };
		else if (url.searchParams.get('tty') === 'IN MIN')
			data = {
				relatedGroup: {
					conceptGroup: [{ tty: 'IN', conceptProperties: [{ rxcui: '20', name: 'base' }] }]
				}
			};
		else if (url.pathname.includes('/20/'))
			data = {
				relatedGroup: {
					conceptGroup: [{ tty: 'SCD', conceptProperties: [{ rxcui: '30', name: 'drug' }] }]
				}
			};
		else data = { relatedGroup: {} };
		return Response.json(data);
	};
	try {
		const concepts = await discoverRxNav('precise ingredient');
		assert.equal(concepts.length, 1);
		assert.equal(concepts[0].rxcui, '30');
		assert.equal(concepts[0].tty, 'SCD');
		assert.deepEqual(concepts[0].ndcs, ['25021032104']);
		assert.ok(concepts[0].evidence.some((item) => item.nativeId === 'related:10:IN+MIN'));
		assert.ok(
			urls.some(
				(url) =>
					new URL(url).searchParams.get('tty') ===
					'SCD SBD GPCK BPCK SCDF SBDF SCDFP SBDFP SCDG SBDG SCDGP'
			)
		);
		assert.ok(urls.some((url) => url.includes('/20/related.json')));
	} finally {
		globalThis.fetch = original;
	}
});

test('FDA enrichment matches labeled NDCs and tolerates unavailable label providers', async () => {
	const original = globalThis.fetch;
	const searches: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname === '/drug/ndc.json') {
			searches.push(url.searchParams.get('search') ?? '');
			return Response.json({
				results: [
					{
						product_ndc: '25021-321',
						labeler_name: 'Example',
						packaging: [{ package_ndc: '25021-321-04', description: 'One vial' }]
					}
				]
			});
		}
		return new Response('', { status: 503 });
	};
	try {
		const packages = await enrichPackages(['25021-321-04', '25021032104', 'invalid']);
		assert.equal(packages.length, 1);
		assert.equal(packages[0].description, 'One vial');
		assert.equal(packages[0].ndc, '25021032104');
		assert.equal(packages[0].splXml, null);
		// Asked once, at product level, so sibling packages share the answer.
		assert.ok(searches[0].includes('product_ndc:"25021-321"'));
		assert.equal(searches.length, 1);
		assert.ok(packages[0].evidence.some((item) => item.source === 'openfda-ndc'));
	} finally {
		globalThis.fetch = original;
	}
});

test('package enrichment keeps RxNav route properties when FDA has no product row', async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.hostname === 'api.fda.gov') return new Response('', { status: 404 });
		if (url.pathname.endsWith('/ndcproperties.json'))
			return Response.json({
				ndcPropertyList: {
					ndcProperty: [
						{
							rxcui: '123',
							propertyConceptList: {
								propertyConcept: [{ propName: 'ROUTE', propValue: 'by mouth' }]
							}
						}
					]
				}
			});
		return Response.json({});
	};
	try {
		const [item] = await enrichPackages(['12345678901']);
		assert.deepEqual(item.details?.product?.routes, ['ORAL']);
	} finally {
		globalThis.fetch = original;
	}
});

test('route inference uses product titles and rejects anatomy mentioned as an indication', () => {
	assert.deepEqual(routesFromProductText('Amoxicillin 400 MG/5 ML Oral Suspension'), ['ORAL']);
	assert.deepEqual(routesFromProductText('Miconazole Vaginal Cream'), ['VAGINAL']);
	assert.deepEqual(routesFromProductText('Ophthalmic Solution'), ['OPHTHALMIC']);
	assert.deepEqual(
		routesFromLabelText(
			'Gonorrhea, acute uncomplicated (ano-genital and urethral infections); single oral dose.'
		),
		[]
	);
	assert.deepEqual(
		routesFromLabelText(
			'Nasal congestion, rectal bleeding, vaginal infection, and intraocular pressure.'
		),
		[]
	);
	assert.deepEqual(routesFromLabelText('The product is for urethral administration.'), [
		'URETHRAL'
	]);
	assert.deepEqual(routesFromLabelText('Take by mouth. Administered intravenously.'), [
		'ORAL',
		'INTRAVENOUS'
	]);
});

test('amoxicillin suspension enrichment reads RxNorm title without treating urethral indication as route', async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('/drug/ndc.json')) return new Response('', { status: 404 });
		if (url.pathname.endsWith('/drug/label.json'))
			return Response.json({
				results: [
					{
						openfda: { package_ndc: ['61919-0401-32'] },
						dosage_and_administration: [
							'Gonorrhea, acute uncomplicated (ano-genital and urethral infections).'
						]
					}
				]
			});
		if (url.pathname.endsWith('/ndcstatus.json'))
			return Response.json({
				ndcStatus: {
					status: 'ACTIVE',
					rxcui: '123',
					conceptName: 'amoxicillin 400 MG/5 ML Oral Suspension'
				}
			});
		if (url.pathname.endsWith('/ndcproperties.json'))
			return Response.json({ ndcPropertyList: { ndcProperty: [{ rxcui: '123' }] } });
		return Response.json({});
	};
	try {
		const [item] = await enrichPackages(['61919040132']);
		assert.deepEqual(item.details?.product?.routes, ['ORAL']);
	} finally {
		globalThis.fetch = original;
	}
});

test('enrichment does not silently drop every package after the first concept budget', async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async () => Response.json({});
	try {
		const ndcs = Array.from({ length: 13 }, (_, i) => `123456789${String(i).padStart(2, '0')}`);
		assert.equal((await enrichPackages(ndcs)).length, 13);
	} finally {
		globalThis.fetch = original;
	}
});

test('numeric RxCUI retains the concrete seed when it has no neighbors', async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith('/123.json')) return Response.json({ idGroup: { name: 'Drug' } });
		if (path.endsWith('/properties.json'))
			return Response.json({ properties: { rxcui: '123', name: 'Drug', tty: 'SCD' } });
		return Response.json({});
	};
	try {
		const concepts = await discoverRxNav('123');
		assert.deepEqual(
			concepts.map((item) => item.rxcui),
			['123']
		);
	} finally {
		globalThis.fetch = original;
	}
});

test('hyphenated NDC is normalized before the RxNav lookup', async () => {
	const original = globalThis.fetch;
	let requested = '';
	globalThis.fetch = async (input) => {
		requested = String(input);
		return Response.json({});
	};
	try {
		assert.deepEqual(await discoverRxNav('0002-8215-01'), []);
		assert.equal(new URL(requested).searchParams.get('id'), '00002821501');
	} finally {
		globalThis.fetch = original;
	}
});

test('group membership traverses forms and rolls branded counterparts into their generic', async () => {
	const original = globalThis.fetch;
	const calls: string[] = [];
	const concept = (rxcui: string, tty: string) => ({ rxcui, tty, name: `${tty} ${rxcui}` });
	const related = (...concepts: ReturnType<typeof concept>[]) => ({
		relatedGroup: { conceptGroup: [{ conceptProperties: concepts }] }
	});
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		calls.push(url.href);
		const id = url.pathname.split('/')[3];
		if (url.pathname.endsWith('/rxcui.json'))
			return Response.json({ idGroup: { rxnormId: ['1'] } });
		if (url.pathname.endsWith('/properties.json'))
			return Response.json({ properties: concept('1', 'SCDG') });
		if (url.searchParams.get('rela') === 'inverse_isa')
			return Response.json(
				id === '1' ? related(concept('2', 'SCDF')) : related(concept('3', 'SCD'))
			);
		if (url.pathname.endsWith('/related.json'))
			return Response.json(id === '3' ? related(concept('4', 'SBD')) : related());
		if (url.pathname.endsWith('/allProperties.json'))
			return Response.json({
				propConceptGroup: {
					propConcept:
						id === '4'
							? [{ propName: 'RXNAV_VET_DRUG' }]
							: [{ propName: 'RXNAV_HUMAN_DRUG' }, { propName: 'RXNAV_VET_DRUG' }]
				}
			});
		return Response.json({ ndcGroup: { ndcList: { ndc: ['12345678901'] } } });
	};
	try {
		const concepts = await discoverRxNav('ingredient');
		// The branded SBD rolls up into its generic SCD rather than standing alone.
		assert.deepEqual(
			concepts.map((c) => c.rxcui),
			['3']
		);
		assert.deepEqual(concepts[0].ndcs, ['12345678901']);
		assert.equal(concepts[0].vetOnly, false);
		const [brand] = concepts[0].details!.brandedProducts;
		assert.equal(brand.rxcui, '4');
		// A veterinary-only brand contributes no NDCs to the human generic.
		assert.deepEqual(brand.ndcs, []);
		assert.equal(calls.filter((url) => url.includes('rela=inverse_isa')).length, 2);
	} finally {
		globalThis.fetch = original;
	}
});

test('FDA 404 is known absence, 503 is unknown, and evidence never contains the API key', async () => {
	const original = globalThis.fetch;
	let code = 404;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.hostname === 'api.fda.gov') return new Response('', { status: code });
		if (url.pathname.endsWith('/ndcproperties.json'))
			return Response.json({
				ndcPropertyList: {
					ndcProperty: [
						{
							propertyConceptList: {
								propertyConcept: [
									{ propName: 'LABEL_TYPE', propValue: 'ANIMAL COMPOUNDED DRUG LABEL' }
								]
							}
						}
					]
				}
			});
		if (url.pathname.endsWith('/spls.json')) return Response.json({ data: [] });
		return Response.json({ ndcStatus: { status: 'ACTIVE' } });
	};
	try {
		const [missing] = await enrichPackages(['12345678901'], 'test-secret');
		assert.equal(missing.listed, false);
		assert.equal(missing.splPresent, false);
		assert.equal(missing.isVeterinary, true);
		assert.ok(
			missing.evidence.every(
				(item) => !item.url.includes('test-secret') && !item.url.includes('api_key')
			)
		);
		code = 503;
		const [failed] = await enrichPackages(['12345678901']);
		assert.equal(failed.listed, null);
		assert.equal(failed.complete, false);
	} finally {
		globalThis.fetch = original;
	}
});

test('NDC enrichment marks an explicit FDA or SPL listing independently', async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('/spls.json')) return Response.json({ data: [] });
		if (url.hostname === 'api.fda.gov')
			return Response.json({
				results: [{ product_ndc: '12345-678', packaging: [{ package_ndc: '12345-6789-01' }] }]
			});
		return Response.json({ ndcStatus: { status: 'ACTIVE' } });
	};
	try {
		const [item] = await enrichPackages(['12345678901']);
		assert.equal(item.listed, true);
		assert.equal(item.splPresent, false);
	} finally {
		globalThis.fetch = original;
	}
});

test('a directory product without this package reads as unlisted, not unknown', async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('/spls.json')) return Response.json({ data: [] });
		if (url.hostname === 'api.fda.gov')
			return Response.json({
				results: [{ product_ndc: '33358-028', packaging: [{ package_ndc: '33358-028-21' }] }]
			});
		// RxNav lags; its ACTIVE must not outweigh the directory and DailyMed.
		return Response.json({ ndcStatus: { status: 'ACTIVE' } });
	};
	try {
		const [item] = await enrichPackages(['33358002860']);
		assert.equal(item.listed, false);
		assert.equal(item.splPresent, false);
		assert.equal(exclusionReason(item), 'no-spl');
	} finally {
		globalThis.fetch = original;
	}
});

test('DailyMed is queried by labeled hyphenation and SPL product detail is parsed', async () => {
	const original = globalThis.fetch;
	const xml = `<document><manufacturedProduct><manufacturedProduct>
		<code code="0143-9262" codeSystem="2.16.840.1.113883.6.69"/><name>Cefazolin</name>
		<formCode code="INJ" displayName="INJECTION, POWDER, FOR SOLUTION"/>
		<ingredient classCode="ACTIM"><quantity><numerator value="1" unit="g"/><denominator value="1" unit="1"/></quantity>
		<ingredientSubstance><code code="P380M0454Z" codeSystem="2.16.840.1.113883.4.9"/><name>CEFAZOLIN SODIUM</name>
		<activeMoiety><activeMoiety><name>CEFAZOLIN</name></activeMoiety></activeMoiety></ingredientSubstance></ingredient>
		<asContent><containerPackagedProduct><code code="0143-9262-25" codeSystem="2.16.840.1.113883.6.69"/></containerPackagedProduct></asContent>
	</manufacturedProduct></manufacturedProduct></document>`;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('/spls.json'))
			return Response.json({
				data:
					url.searchParams.get('ndc') === '0143-9262-25'
						? [{ setid: 'abc', title: 'CEFAZOLIN', spl_version: 7 }]
						: []
			});
		if (url.pathname.endsWith('/abc.xml')) return new Response(xml);
		return Response.json({});
	};
	try {
		const [item] = await enrichPackages(['00143926225']);
		assert.equal(item.doseForm, 'INJECTION, POWDER, FOR SOLUTION');
		assert.equal(item.splPresent, true);
		assert.equal(item.splSetId, 'abc');
		assert.equal(item.details?.spl?.version, '7');
		const [ingredient] = item.details!.spl!.ingredients;
		assert.equal(ingredient.unii, 'P380M0454Z');
		assert.equal(ingredient.basis, 'moiety');
		assert.equal(ingredient.strength, '1 g');
		assert.deepEqual(
			ingredient.moieties.map((m) => m.name),
			['CEFAZOLIN']
		);
	} finally {
		globalThis.fetch = original;
	}
});

test('SPL liquid concentration is scaled to the package fill volume', async () => {
	const original = globalThis.fetch;
	const xml = `<document><manufacturedProduct><manufacturedProduct>
		<code code="72572-0207" codeSystem="2.16.840.1.113883.6.69"/>
		<ingredient classCode="ACTIM"><quantity><numerator value="500" unit="mg"/><denominator value="5" unit="mL"/></quantity>
		<ingredientSubstance><name>VANCOMYCIN</name></ingredientSubstance></ingredient>
		<asContent><containerPackagedProduct><code code="72572-0207-01" codeSystem="2.16.840.1.113883.6.69"/></containerPackagedProduct></asContent>
	</manufacturedProduct></manufacturedProduct></document>`;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname === '/drug/ndc.json')
			return Response.json({
				results: [
					{
						product_ndc: '72572-0207',
						dosage_form: 'INJECTION, SOLUTION',
						packaging: [{ package_ndc: '72572-0207-01', description: '100 mL in 1 BAG' }]
					}
				]
			});
		if (url.pathname.endsWith('/spls.json'))
			return Response.json({ data: [{ setid: 'vancomycin' }] });
		if (url.pathname.endsWith('/vancomycin.xml')) return new Response(xml);
		return Response.json({});
	};
	try {
		const [item] = await enrichPackages(['72572020701']);
		assert.equal(item.details?.spl?.ingredients[0]?.strength, '10000 mg');
	} finally {
		globalThis.fetch = original;
	}
});

test('package enrichment does not borrow an unmatched sibling SPL dose form', async () => {
	const original = globalThis.fetch;
	const xml = `<document><manufacturedProduct><manufacturedProduct>
		<code code="11111-1111" codeSystem="2.16.840.1.113883.6.69"/><name>Sibling</name>
		<formCode code="SUSP" displayName="SUSPENSION"/>
		<ingredient classCode="ACTI"><ingredientSubstance><name>ONE</name></ingredientSubstance></ingredient>
		<asContent><containerPackagedProduct><code code="11111-1111-01" codeSystem="2.16.840.1.113883.6.69"/></containerPackagedProduct></asContent>
	</manufacturedProduct><manufacturedProduct>
		<code code="22222-2222" codeSystem="2.16.840.1.113883.6.69"/><name>Target</name>
		<formCode code="TAB" displayName="TABLET"/>
		<ingredient classCode="ACTI"><ingredientSubstance><name>TWO</name></ingredientSubstance></ingredient>
		<asContent><containerPackagedProduct><code code="22222-2222-01" codeSystem="2.16.840.1.113883.6.69"/></containerPackagedProduct></asContent>
	</manufacturedProduct></manufacturedProduct></document>`;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('/drug/ndc.json')) return Response.json({});
		if (url.pathname.endsWith('/drug/label.json'))
			return Response.json({
				results: [
					{ dosage_and_administration: ['For IV infusion; oral tablets are also available.'] }
				]
			});
		if (url.pathname.endsWith('/spls.json')) return Response.json({ data: [{ setid: 'multi' }] });
		if (url.pathname.endsWith('/multi.xml')) return new Response(xml);
		if (url.pathname.endsWith('/ndcstatus.json')) return Response.json({ ndcStatus: {} });
		if (url.pathname.endsWith('/ndcproperties.json')) return Response.json({});
		return Response.json({});
	};
	try {
		const [item] = await enrichPackages(['22222-2222-01']);
		assert.equal(item.doseForm, 'TABLET');
		assert.equal(item.details?.spl?.doseForm, 'TABLET');
		assert.deepEqual(item.details?.product?.routes, []);
		assert.deepEqual(
			item.details?.spl?.ingredients.map((ingredient) => ingredient.name),
			['TWO']
		);
	} finally {
		globalThis.fetch = original;
	}
});

test("label ingredients come from this NDC's own SPL product, actives first, once each", () => {
	const product = (code: string, names: [string, 'active' | 'inactive'][]) =>
		({
			productCode: code,
			packageCodes: [],
			ingredients: names.map(([name, kind]) => ({ name, kind }))
		}) as unknown as SplProduct;
	const own = product('0143-9001', [
		['SODIUM HYDROXIDE', 'inactive'],
		['VANCOMYCIN', 'active'],
		['GELATIN, UNSPECIFIED', 'inactive'],
		['Sodium  hydroxide', 'inactive']
	]);
	const sibling = product('0143-9002', [['LIDOCAINE', 'active']]);
	assert.deepEqual(labelIngredientsOf([own, sibling, own], [own, own]), [
		{ name: 'VANCOMYCIN', kind: 'active' },
		{ name: 'SODIUM HYDROXIDE', kind: 'inactive' },
		{ name: 'GELATIN', kind: 'inactive' }
	]);
	// No product names this NDC: every product's, still once each.
	assert.deepEqual(
		labelIngredientsOf([own, sibling], []).map((item) => item.name),
		['VANCOMYCIN', 'LIDOCAINE', 'SODIUM HYDROXIDE', 'GELATIN']
	);
});

test('provider failures name each failed source once and call out rate limits', () => {
	const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
	const failures = providerFailures([
		['openFDA', { status: 'rejected', reason: new Error('x') }],
		['openFDA', { status: 'rejected', reason: new Error('y') }],
		['DailyMed', { status: 'fulfilled', value: {} }],
		['RxNav', { status: 'rejected', reason: timeout }]
	]);
	assert.deepEqual(
		failures.map((f) => [f.source, f.message]),
		[
			['openFDA', 'did not answer'],
			['RxNav', 'timed out']
		]
	);
});

test('an openFDA rate limit is reported on the package instead of read as unlisted', async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.hostname === 'api.fda.gov')
			return Response.json({ error: { code: 'OVER_RATE_LIMIT' } }, { status: 429 });
		return Response.json({});
	};
	try {
		const [item] = await enrichPackages(['70594004302']);
		assert.deepEqual(item.providerErrors, [
			{ source: 'openFDA', status: 429, message: 'rate limit exceeded' }
		]);
		assert.equal(item.listed, null);
		assert.equal(item.complete, false);
	} finally {
		globalThis.fetch = original;
	}
});

test('sibling packages of one product share provider answers', async () => {
	const original = globalThis.fetch;
	const calls = new Map<string, number>();
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		const key =
			url.pathname === '/drug/ndc.json' ? `ndc:${url.searchParams.get('search')}` : url.pathname;
		calls.set(key, (calls.get(key) ?? 0) + 1);
		if (url.pathname === '/drug/ndc.json')
			return Response.json({
				results: [
					{
						product_ndc: '25021-321',
						labeler_name: 'Example',
						packaging: [
							{ package_ndc: '25021-321-04', description: 'One vial' },
							{ package_ndc: '25021-321-10', description: 'Ten vials' }
						]
					}
				]
			});
		return new Response('', { status: 503 });
	};
	try {
		const packages = await enrichPackages(['25021032104', '25021032110']);
		assert.deepEqual(
			packages.map((item) => item.description),
			['One vial', 'Ten vials']
		);
		const productSearches = [...calls].filter(([key]) => key.includes('product_ndc'));
		assert.equal(productSearches.length, 1);
		assert.equal(productSearches[0][1], 1);
	} finally {
		globalThis.fetch = original;
	}
});

test('a salt label missing one of its ions is completed from GSRS', async () => {
	const ingredient = (moieties: { name: string; unii: string }[]) => ({
		name: 'SODIUM CHLORIDE',
		unii: '451W47IQ8X',
		kind: 'active' as const,
		basis: 'ingredient' as const,
		strength: 9,
		strengthUnit: 'mg',
		per: 1,
		perUnit: 'mL',
		moieties,
		sequence: 0
	});
	const chloride = { name: 'CHLORIDE ION', unii: 'Q32ZN48698' };
	const sodium = { name: 'SODIUM CATION', unii: 'LYR4M0NH37' };
	const partial = ingredient([chloride]);
	const unrelated = ingredient([{ name: 'SOMETHING ELSE', unii: 'ZZZZZZZZZZ' }]);
	let calls = 0;
	await completeMoieties([{ ingredients: [partial, unrelated] }], async () => {
		calls++;
		return [chloride, sodium];
	});
	assert.deepEqual(partial.moieties, [chloride, { ...sodium, source: 'gsrs' }]);
	// A label naming a moiety GSRS does not list is left as written.
	assert.equal(unrelated.moieties.length, 1);
	assert.equal(calls, 1);
});

test('openFDA requests retry a 429 with the next configured key', async () => {
	setFdaApiKeys(fdaApiKeysFrom({ OPENFDA_API_KEY2: 'b', OPENFDA_API_KEY: 'a', OTHER: 'x' }));
	const original = globalThis.fetch;
	const keys: (string | null)[] = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		keys.push(url.searchParams.get('api_key'));
		return url.searchParams.get('api_key') === 'a'
			? new Response('', { status: 429 })
			: Response.json({ results: [] });
	}) as typeof fetch;
	try {
		assert.deepEqual(await searchFdaProducts('brand_name:"rotate-test"', 'a'), []);
		assert.deepEqual(keys, ['a', 'b']);
	} finally {
		globalThis.fetch = original;
		setFdaApiKeys([]);
	}
});

test('live search drops weak approximate candidates and sets combinations aside', async () => {
	const original = globalThis.fetch;
	const properties: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith('/rxcui.json')) return Response.json({ idGroup: {} });
		if (url.pathname.endsWith('/approximateTerm.json'))
			return Response.json({
				approximateGroup: {
					candidate: [
						{ rxcui: '1', score: '10' },
						{ rxcui: '9', score: '3' }
					]
				}
			});
		if (url.pathname.endsWith('/spellingsuggestions.json'))
			return Response.json({ suggestionGroup: { suggestionList: { suggestion: ['lisinopril'] } } });
		const id = url.pathname.split('/')[3];
		if (url.pathname.endsWith('/properties.json')) {
			properties.push(id);
			return Response.json({ properties: { rxcui: id, name: 'lisinopril', tty: 'IN' } });
		}
		if (url.pathname.endsWith('/related.json') && url.searchParams.get('tty'))
			return Response.json({
				relatedGroup: {
					conceptGroup: [
						{
							tty: 'SCD',
							conceptProperties: [
								{ rxcui: '2', name: 'lisinopril 10 MG Oral Tablet' },
								{ rxcui: '3', name: 'hydrochlorothiazide 12.5 MG / lisinopril 10 MG Oral Tablet' }
							]
						}
					]
				}
			});
		if (url.pathname.endsWith('/related.json')) return Response.json({ relatedGroup: {} });
		if (url.pathname.endsWith('/allProperties.json'))
			return Response.json({ propConceptGroup: { propConcept: [{ propName: 'RXNAV_HUMAN_DRUG' }] } });
		return Response.json({ ndcGroup: { ndcList: { ndc: ['12345678901'] } } });
	};
	try {
		const page = await discoverRxNavPage('lisinoprl tab');
		assert.deepEqual(properties, ['1']);
		assert.equal(page.suggestion, 'lisinopril');
		assert.deepEqual(page.concepts.map((c) => c.rxcui), ['2']);
		assert.deepEqual(page.matches['2'].reasons.sort(), ['form', 'spelling']);
		assert.equal(page.facets.combos, 1);
		assert.deepEqual(page.facets.forms, [{ value: 'Oral Tablet', count: 1 }]);
		const withCombos = await discoverRxNavPage('lisinoprl tab', 0, undefined, { combos: true });
		assert.deepEqual(withCombos.concepts.map((c) => c.rxcui), ['2', '3']);
		assert.equal(withCombos.matches['3'].tier, 'combo');
	} finally {
		globalThis.fetch = original;
	}
});
