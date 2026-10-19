<script lang="ts">
	import { watchJobs } from '$lib/jobs-watch';
	import RxCui from '$lib/components/RxCui.svelte';
	import BrandedName from '$lib/components/BrandedName.svelte';
      import {resolve} from '$app/paths';
      import {onDestroy, onMount} from 'svelte';
      import {replaceState} from '$app/navigation';
      import {page} from '$app/state';
      import {ttyLabel, ttyTitle} from '$lib/rxnorm-tty';
      import {SvelteMap, SvelteSet} from 'svelte/reactivity';
      import PackageDetail from '$lib/components/PackageDetail.svelte';
      import PageHeader from '$lib/components/PageHeader.svelte';
      import {packageTitle} from '$lib/package-title';
      import type {StagedConcept, StagedPackage} from '$lib/server/catalog-sync';
      import {filtersQuery, type MatchReason, type SearchFacets, type SearchFilters} from '$lib/search-relevance';

      type Result = {
		id: string;
		kind: string;
		name: string;
		detail: string | null;
		matchedOn: string;
		identifiers: string[];
		href?: string | null;
		localConcept?: true;
	};

	/** A curated product set the query names (`water`, `swfi`): no source returns it. */
	type SetResult = {
		key: string;
		name: string;
		description: string;
		formularyItemId: string | null;
	};

	type SyncSummary = {
		concepts: number;
		ndcs: number;
		packages: number;
		excluded: number;
		partial: boolean;
		total: number;
		offset: number;
		warning: string | null;
		facets: SearchFacets | null;
		suggestion: string | null;
	};

	type Staged = {
		scope: { id: string; name: string } | null;
		concepts: StagedConcept[];
		packages: StagedPackage[];
	};

	const KIND_LABELS: Record<string, string> = {
		clinical_drug: 'RxNorm drug',
		ingredient: 'Ingredient',
		product: 'Product',
		package: 'Package',
		formulary_item: 'Formulary item',
		labeler: 'Labeler'
	};

	const EMPTY_MESSAGE =
		'Start typing a drug name, ingredient, product, package, formulary item, or identifier.';

	let query = $state('');
	let results: Result[] = $state([]);
	let sets: SetResult[] = $state([]);
	let staged: Staged | null = $state(null);
	let loading = $state(false);
	let loadingMore = $state(false);
	let sync: SyncSummary | null = $state(null);
	let message = $state(EMPTY_MESSAGE);
	let hideExcluded = $state(true);
	let filters: SearchFilters = $state({});
	const open = new SvelteSet<string>();
	const pending = new SvelteSet<string>();
	let notices: Record<string, { ok: boolean; text: string }> = $state({});
	/** Per-concept package fetch, keyed by RxCUI; absent until the row is first expanded. */
	type PackageState =
		| { status: 'loading' }
		| { status: 'loaded'; warning: string | null }
		| { status: 'error'; message: string };
	const packageState = new SvelteMap<string, PackageState>();
	let controller: AbortController | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let liveTimer: ReturnType<typeof setTimeout> | undefined;
	/** Local results follow typing; live sources wait for a pause or Enter. */
	const LOCAL_DELAY_MS = 350;
	const LIVE_DELAY_MS = 900;

	type Snapshot = {
		query: string;
		results: Result[];
		sets: SetResult[];
		staged: Staged | null;
		sync: SyncSummary | null;
		message: string;
		hideExcluded: boolean;
		filters: SearchFilters;
		open: string[];
		loaded: [string, PackageState][];
	};

	// Keep the search, its results and expanded rows when coming back from a detail
	// page, rather than re-running the local + live search. Only settled package
	// fetches are kept; in-flight ones are refetched when their row is reopened.
	export const snapshot = {
		capture: (): Snapshot => ({
			query,
			results,
			sets,
			staged,
			sync,
			message,
			hideExcluded,
			filters,
			open: [...open],
			loaded: [...packageState].filter(([, state]) => state.status === 'loaded')
		}),
		restore: (value: Snapshot) => {
			query = value.query;
			results = value.results;
			sets = value.sets ?? [];
			staged = value.staged;
			sync = value.sync;
			message = value.message;
			hideExcluded = value.hideExcluded;
			filters = value.filters ?? {};
			lastTerm = value.query.trim();
			open.clear();
			for (const key of value.open) open.add(key);
			packageState.clear();
			for (const [rxcui, state] of value.loaded) packageState.set(rxcui, state);
			for (const key of value.open) {
				if (!key.startsWith('c:')) continue;
				const concept = staged?.concepts.find((c) => `c:${c.rxcui}` === key);
				if (concept) void loadPackages(concept);
			}
		}
	};

	function scheduleSearch() {
		clearTimeout(timer);
		clearTimeout(liveTimer);
		const term = query.trim();
		if (!term) {
			rememberQuery('');
			controller?.abort();
			results = [];
			sets = [];
			staged = null;
			sync = null;
			loading = false;
			message = EMPTY_MESSAGE;
			return;
		}
		if (term.length < 2) {
			results = [];
			sets = [];
			message = 'Enter at least two characters.';
			return;
		}
		timer = setTimeout(() => void search(term, { live: false }), LOCAL_DELAY_MS);
		// A live lookup for a fragment like "amo" only returns fuzzy noise.
		if (term.split(/\s+/).some((word) => word.length >= 3))
			liveTimer = setTimeout(() => void search(term), LIVE_DELAY_MS);
	}

	function searchNow(term = query.trim()) {
		clearTimeout(timer);
		clearTimeout(liveTimer);
		void search(term);
	}

	/** The search lives in the URL, so it can be shared, bookmarked and reopened. */
	function rememberQuery(term: string) {
		const url = new URL(page.url);
		if (term) url.searchParams.set('q', term);
		else url.searchParams.delete('q');
		if (url.search !== page.url.search) replaceState(url, page.state);
	}

	async function search(term = query.trim(), { live = true } = {}) {
		if (!term) return;
		// New words start unfiltered; chips belong to the search that offered them.
		if (term !== lastTerm) filters = {};
		lastTerm = term;
		rememberQuery(term);
		controller?.abort();
		const request = new AbortController();
		controller = request;
		loading = true;
		message = '';
		try {
			const response = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}&local=1`, {
				signal: request.signal
			});
			const payload = await response.json();
			if (!response.ok) {
				const msg = payload.message ?? 'Search could not be completed.';
				if (controller === request) {
					results = [];
					sets = [];
					staged = null;
					sync = null;
					message = msg;
				}
				return;
			}
			if (controller !== request) return;
			results = payload.results;
			sets = payload.sets ?? [];
			if (!live) {
				message = results.length || sets.length ? '' : `No local results for “${term}”.`;
				return;
			}
			staged = null;
			sync = null;
			notices = {};
			packageState.clear();
			message =
				results.length || sets.length ? '' : `No local results for “${term}”. Checking live sources…`;
			const externalResponse = await fetch(
				`/api/v1/search?q=${encodeURIComponent(term)}&external=1${filtersQuery(filters)}`,
				{ signal: request.signal }
			);
			const externalPayload = await externalResponse.json();
			if (!externalResponse.ok) {
				const msg = externalPayload.message ?? 'Live search could not be completed.';
				if (controller === request) {
					results = [];
					sets = [];
					staged = null;
					sync = null;
					message = msg;
				}
				return;
			}
			if (controller !== request) return;
			staged = externalPayload.staged;
			sync = externalPayload.sync;
			message =
				results.length || sets.length || staged?.concepts.length || staged?.packages.length
					? ''
					: `No results for “${term}”.`;
		} catch (error) {
			if ((error as Error).name === 'AbortError') return;
			if (controller === request) {
				results = [];
				sets = [];
				staged = null;
				sync = null;
				message = error instanceof Error ? error.message : 'Search could not be completed.';
			}
		} finally {
			if (controller === request) loading = false;
		}
	}

	let lastTerm = '';

	/** Re-run only the live lookup with new filters; local results stay. */
	async function applyFilters(next: SearchFilters) {
		const term = query.trim();
		if (!term) return;
		filters = next;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		loading = true;
		try {
			const response = await fetch(
				`/api/v1/search?q=${encodeURIComponent(term)}&external=1${filtersQuery(next)}`,
				{ signal: request.signal }
			);
			const payload = await response.json();
			if (controller !== request) return;
			if (!response.ok) {
				message = payload.message ?? 'Live search could not be completed.';
				return;
			}
			open.clear();
			packageState.clear();
			staged = payload.staged;
			sync = payload.sync;
		} catch (error) {
			if ((error as Error).name !== 'AbortError' && controller === request)
				message = error instanceof Error ? error.message : 'Live search could not be completed.';
		} finally {
			if (controller === request) loading = false;
		}
	}

	const toggleFilter = (key: 'form' | 'strength', value: string) =>
		void applyFilters({ ...filters, [key]: filters[key] === value ? undefined : value });

	const REASON_LABELS: Record<MatchReason, string> = {
		name: 'name',
		brand: 'brand name',
		strength: 'strength',
		form: 'dose form',
		spelling: 'close spelling'
	};

	const PAGE_SIZE = 10;
	let nextOffset = $derived(((sync as SyncSummary | null)?.offset ?? 0) + PAGE_SIZE);
	let remaining = $derived(Math.max(0, ((sync as SyncSummary | null)?.total ?? 0) - nextOffset));

	async function more() {
		const term = query.trim();
		if (!term || !staged || !sync || loadingMore) return;
		const request = controller;
		loadingMore = true;
		try {
			const response = await fetch(
				`/api/v1/search?q=${encodeURIComponent(term)}&offset=${nextOffset}&external=1${filtersQuery(filters)}`
			);
			const payload = await response.json();
			if (!response.ok) {
				const msg = payload.message ?? 'More results could not be loaded.';
				if (sync)
					sync = {
						...sync,
						warning: msg
					};
				return;
			}
			// A newer search replaced the list while this page was in flight.
			if (controller !== request || !staged || !sync) return;
			const seen = new Set(staged.concepts.map((concept) => concept.rxcui));
			staged = {
				...staged,
				concepts: [
					...staged.concepts,
					...payload.staged.concepts.filter((c: StagedConcept) => !seen.has(c.rxcui))
				]
			};
			sync = {
				...sync,
				offset: payload.sync.offset,
				total: payload.sync.total,
				concepts: sync.concepts + payload.sync.concepts,
				ndcs: sync.ndcs + payload.sync.ndcs,
				packages: sync.packages + payload.sync.packages,
				excluded: sync.excluded + payload.sync.excluded,
				partial: sync.partial || payload.sync.partial,
				facets: payload.sync.facets ?? sync.facets,
				warning: sync.warning ?? payload.sync.warning
			};
		} catch (error) {
			if (sync)
				sync = {
					...sync,
					warning: error instanceof Error ? error.message : 'More results could not be loaded.'
				};
		} finally {
			loadingMore = false;
		}
	}

	function toggle(key: string) {
		if (open.has(key)) open.delete(key);
		else open.add(key);
	}

	/** Packages are fetched when a concept is first expanded, not with the search. */
	async function loadPackages(concept: StagedConcept) {
		const { rxcui } = concept;
		const current = packageState.get(rxcui)?.status;
		if (current === 'loading' || current === 'loaded') return;
		if (!concept.ndcs.length) {
			packageState.set(rxcui, { status: 'loaded', warning: null });
			return;
		}
		const request = controller;
		packageState.set(rxcui, { status: 'loading' });
		try {
			const response = await fetch(`/api/v1/search/packages?rxcui=${encodeURIComponent(rxcui)}`);
			const payload = await response.json();
			// A newer search replaced the list while this concept was in flight.
			if (controller !== request) return;
			if (!response.ok) {
				packageState.set(rxcui, {
					status: 'error',
					message: payload.message ?? 'Packages could not be fetched.'
				});
				return;
			}
			const target = staged?.concepts.find((item) => item.rxcui === rxcui);
			if (target) target.packages = payload.packages;
			if (sync && payload.excluded) sync = { ...sync, excluded: sync.excluded + payload.excluded };
			packageState.set(rxcui, { status: 'loaded', warning: payload.warning });
		} catch (error) {
			if (controller !== request) return;
			packageState.set(rxcui, {
				status: 'error',
				message: error instanceof Error ? error.message : 'Packages could not be fetched.'
			});
		}
	}

	type LoadBody = ({ rxcui: string } | { ndc: string } | { set: string }) & { label?: string };

	async function load(key: string, body: LoadBody) {
		pending.add(key);
		watchJobs();
		try {
			const response = await fetch('/api/v1/formulary/load', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = await response.json();
			if (!response.ok) {
				notices[key] = {
					ok: false,
					text: payload.message ?? 'The node could not be loaded.'
				};
				return;
			}
			const skipped = payload.packagesSkipped.length
				? ` · ${payload.packagesSkipped.length} ineligible skipped`
				: '';
			notices[key] = {
				ok: true,
				text: `${payload.created ? 'Added to' : 'Updated in'} ${payload.scope.name} · ${payload.packagesLinked} package${payload.packagesLinked === 1 ? '' : 's'} linked${skipped}`
			};
			markLoaded(body, payload.formularyItemId);
		} catch (error) {
			notices[key] = {
				ok: false,
				text: error instanceof Error ? error.message : 'The node could not be loaded.'
			};
		} finally {
			pending.delete(key);
		}
	}

	function markLoaded(body: LoadBody, formularyItemId: string) {
		for (const set of sets) if ('set' in body && set.key === body.set) set.formularyItemId = formularyItemId;
		if (!staged) return;
		for (const concept of staged.concepts) {
			if ('rxcui' in body && concept.rxcui === body.rxcui) {
				concept.loaded = true;
				concept.formularyItemId = formularyItemId;
			}
			for (const item of concept.packages)
				if ('ndc' in body && item.ndc === body.ndc) {
					item.loaded = true;
					item.formularyItemId = formularyItemId;
				}
		}
		for (const item of staged.packages)
			if ('ndc' in body && item.ndc === body.ndc) {
					item.loaded = true;
					item.formularyItemId = formularyItemId;
				}
	}

	const grouped = (props: { name: string; value: string }[]) => {
		const out = new SvelteMap<string, string[]>();
		for (const prop of props) out.set(prop.name, [...(out.get(prop.name) ?? []), prop.value]);
		return [...out];
	};

	const visible = (items: StagedPackage[]) =>
		hideExcluded ? items.filter((item) => !item.exclusionReason) : items;
	/** Veterinary-only, or no NDCs in RxNorm: nothing a formulary could add. */
	const addable = (concept: StagedConcept) => !concept.vetOnly && concept.ndcs.length > 0;
	const shownConcepts = $derived.by(() => {
		const all = (staged as Staged | null)?.concepts ?? [];
		return hideExcluded ? all.filter(addable) : all;
	});
	const hiddenConcepts = $derived(
		((staged as Staged | null)?.concepts.length ?? 0) - shownConcepts.length
	);
	/** Counterparts not already listed as branded products. */
	const otherCounterparts = (details: NonNullable<StagedConcept['details']>) =>
		details.counterparts.filter(
			(counterpart) => !details.brandedProducts.some((brand) => brand.rxcui === counterpart.rxcui)
		);

	onMount(() => {
		const linked = page.url.searchParams.get('q')?.trim();
		// After a snapshot restore the results are already back; only a fresh visit searches.
		setTimeout(() => {
			if (linked && !query.trim()) {
				query = linked;
				searchNow(linked);
			}
		});
	});

	onDestroy(() => {
		clearTimeout(timer);
		clearTimeout(liveTimer);
		controller?.abort();
	});
</script>

<svelte:head>
	<title>RxDB search</title>
	<meta
		content="Search RxNav, openFDA, and DailyMed, review everything fetched, and load chosen nodes into RxDB's formulary."
		name="description"
	/>
</svelte:head>

<main>
	<PageHeader title="Search and import medications">
		{#snippet eyebrow()}
			RxDB · <a href={resolve('/formulary')}>View formulary →</a> · <a href={resolve('/settings')}>Settings</a>
		{/snippet}
		<p>
			Search RxNav, openFDA, and DailyMed. Results are only for review until you add a drug or a
			package to the formulary.
		</p>
	</PageHeader>

	<form
		onsubmit={(event) => {
			event.preventDefault();
			searchNow();
		}}
	>
		<label for="search">Search</label>
		<div class="search-box">
			<input
				autocomplete="off"
				bind:value={query}
				id="search"
				oninput={scheduleSearch}
				placeholder="Drug name, ingredient, NDC, or other identifier"
				type="search"
			/>
			<button disabled={!query.trim() || loading} type="submit">Search</button>
		</div>
	</form>

	{#if loading}<p class="status" aria-live="polite">{results.length ? 'Checking live sources…' : 'Searching local catalog…'}</p>{/if}
	{#if message}<p class="status" aria-live="polite">{message}</p>{/if}

	{#if sets.length}
		<h2 class="section-title">Curated sets</h2>
		<ul class="tree">
			{#each sets as set (set.key)}
				{@const key = `s:${set.key}`}
				<li class="node set">
					<div class="node-head">
						<div class="node-title">
							<span class="kind">Curated set</span>
							<h3>{set.name}</h3>
							<p class="meta">{set.description}</p>
						</div>
						{#if set.formularyItemId}
							{@render onFormulary(set.formularyItemId)}
						{/if}
						<button
							class="load"
							disabled={pending.has(key)}
							onclick={() => void load(key, { set: set.key, label: set.name })}
							type="button"
							title={set.formularyItemId
								? 'Fetch its packages again and update the formulary item'
								: undefined}
							>{pending.has(key) ? 'Adding…' : set.formularyItemId ? 'Refresh' : 'Add to formulary'}</button
						>
					</div>
					{#if notices[key]}<p class:warning-text={!notices[key].ok} class="notice">
							{notices[key].text}
						</p>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if sync}
		<!-- Counts follow the list below: the concepts on screen and the total the pager walks. -->
		{@const shown = shownConcepts.length}
		<section class:warning={sync.partial} class="import-status" aria-live="polite">
			<strong
				>Found {sync.total} clinical concept{sync.total === 1 ? '' : 's'}{shown < sync.total
					? ` · showing ${shown}`
					: ''}, listing {sync.ndcs}
				NDC{sync.ndcs === 1 ? '' : 's'}{sync.packages
					? ` and ${sync.packages} package${sync.packages === 1 ? '' : 's'}`
					: ''}</strong
			>
			<span
				>from RxNav, openFDA, and DailyMed. Expand a concept to fetch its packages. Nothing is added
				to the formulary until you choose Add to formulary.</span
			>
			{#if sync.excluded}<span
					>{sync.excluded} ineligible package{sync.excluded === 1 ? '' : 's'} found.</span
				>{/if}
			{#if sync.warning}<span>{sync.warning}</span>{/if}
		</section>
	{/if}

	{#if sync?.suggestion}
		<p class="suggestion">
			No exact match in RxNorm. Did you mean
			<button
				class="link"
				onclick={() => {
					query = sync!.suggestion!;
					searchNow();
				}}
				type="button">{sync.suggestion}</button
			>?
		</p>
	{/if}

	{#if sync?.facets && (sync.facets.forms.length > 1 || sync.facets.strengths.length > 1 || sync.facets.combos || sync.facets.weak || filters.form || filters.strength)}
		{@const facets = sync.facets}
		<section class="facets" aria-label="Narrow live results">
			{#if facets.forms.length > 1 || filters.form}
				<div class="facet-row">
					<span class="facet-label">Form</span>
					{#each facets.forms as facet (facet.value)}
						<button
							aria-pressed={filters.form === facet.value}
							class="chip"
							disabled={loading}
							onclick={() => toggleFilter('form', facet.value)}
							type="button">{facet.value} <span class="count">{facet.count}</span></button
						>
					{/each}
				</div>
			{/if}
			{#if facets.strengths.length > 1 || filters.strength}
				<div class="facet-row">
					<span class="facet-label">Strength</span>
					{#each facets.strengths as facet (facet.value)}
						<button
							aria-pressed={filters.strength === facet.value}
							class="chip"
							disabled={loading}
							onclick={() => toggleFilter('strength', facet.value)}
							type="button">{facet.value} <span class="count">{facet.count}</span></button
						>
					{/each}
				</div>
			{/if}
			{#if facets.combos || facets.weak}
				<div class="facet-row">
					<span class="facet-label">Also show</span>
					{#if facets.combos}
						<button
							aria-pressed={!!filters.combos}
							class="chip"
							disabled={loading}
							onclick={() => void applyFilters({ ...filters, combos: !filters.combos || undefined })}
							title="Combination products containing what you searched for"
							type="button">Combinations <span class="count">{facets.combos}</span></button
						>
					{/if}
					{#if facets.weak}
						<button
							aria-pressed={!!filters.weak}
							class="chip"
							disabled={loading}
							onclick={() => void applyFilters({ ...filters, weak: !filters.weak || undefined })}
							title="Concepts missing part of your search, such as a strength or dose form"
							type="button">Partial matches <span class="count">{facets.weak}</span></button
						>
					{/if}
				</div>
			{/if}
		</section>
	{/if}

	{#if staged && (staged.concepts.length || staged.packages.length)}
		<div class="section-head">
			<h2 class="section-title">Fetched from sources</h2>
			<label class="toggle"
				><input bind:checked={hideExcluded} type="checkbox" /> Hide what can't be added{hiddenConcepts
					? ` (${hiddenConcepts} concept${hiddenConcepts === 1 ? '' : 's'} hidden)`
					: ''}</label
			>
		</div>
		<ul class="tree">
			{#each shownConcepts as concept, index (concept.rxcui)}
				{@const key = `c:${concept.rxcui}`}
				{@const tier = concept.match?.tier ?? 'strong'}
				{#if tier !== 'strong' && (index === 0 || (shownConcepts[index - 1].match?.tier ?? 'strong') !== tier)}
					<li class="tier-divider">
						{tier === 'combo' ? 'Combination products' : 'Partial matches — missing part of your search'}
					</li>
				{/if}
				{@const packages = visible(concept.packages)}
				{@const fetched = packageState.get(concept.rxcui)}
				<li class="node">
					<div class="node-head">
						<button
							aria-expanded={open.has(key)}
							class="twisty"
							onclick={() => {
								toggle(key);
								if (open.has(key)) void loadPackages(concept);
							}}
							type="button">{open.has(key) ? '▾' : '▸'}</button
						>
						<div class="node-title">
							<span class="kind" title={ttyTitle(concept.tty)}>{ttyLabel(concept.tty)}</span>
							<h3>{concept.name}</h3>
							<p class="meta">
                                                RxCUI <RxCui rxcui={concept.rxcui} name={concept.name} />· {fetched?.status === 'loaded'
									? `${packages.length} package${packages.length === 1 ? '' : 's'}`
									: `${concept.ndcs.length} NDC${concept.ndcs.length === 1 ? '' : 's'}`}{concept.details && concept.details.ndcCount > concept.ndcs.length
									? ` (of ${concept.details.ndcCount} in RxNorm)`
									: ''}{concept.vetOnly ? ' · veterinary only' : ''}
							</p>
							{#if concept.match && (concept.match.reasons.length || concept.match.missing.length)}
								<p class="why">
									{#if concept.match.reasons.length}Matched on {concept.match.reasons
											.map((reason) => REASON_LABELS[reason])
											.join(', ')}{/if}{#if concept.match.missing.length}{concept.match.reasons.length
											? ' · '
											: ''}<span class="missing">no {concept.match.missing.join(', ')}</span>{/if}
								</p>
							{/if}
						</div>
						{#if concept.loaded}
							{@render onFormulary(concept.formularyItemId)}
						{/if}
						<button
							class="load"
							disabled={pending.has(key) || !!concept.vetOnly}
							onclick={() => void load(key, { rxcui: concept.rxcui, label: concept.name })}
							type="button"
							title={concept.loaded ? 'Fetch its packages again and update the formulary item' : undefined}
							>{pending.has(key)
								? 'Adding…'
								: concept.loaded
									? 'Refresh'
									: 'Add to formulary'}</button
						>
					</div>
					{#if notices[key]}<p class:warning-text={!notices[key].ok} class="notice">
							{notices[key].text}
						</p>{/if}
					{#if open.has(key)}
						{#if concept.details}
							{@const cd = concept.details}
							<dl class="concept-detail">
								{#if cd.synonym}<dt>Synonym</dt>
									<dd>{cd.synonym}</dd>{/if}
								<dt>Species</dt>
								<dd>
									{cd.species
										? [cd.species.human && 'human', cd.species.vet && 'veterinary']
												.filter(Boolean)
												.join(', ') || 'unspecified'
										: 'unknown'}
								</dd>
								{#if cd.brandedProducts.length}
									<dt>Branded products</dt>
									<dd>
										{#each cd.brandedProducts as brand, i (brand.rxcui)}{i ? '; ' : ''}{brand.name}
											<span class="mono small"
												><span title={ttyTitle(brand.tty)}>{ttyLabel(brand.tty)}</span>
												<RxCui rxcui={brand.rxcui} name={brand.name} /> · {brand.ndcs.length} NDC{brand.ndcs.length === 1
													? ''
													: 's'}</span
											>{/each}
									</dd>
								{/if}
								{#each [['Ingredients', cd.ingredients], ['Brand names', cd.brands], ['Dose forms', cd.doseForms], ['Reached through', cd.parents], ['Counterparts', otherCounterparts(cd)]] as const as [label, list] (label)}
									{#if list.length}
										<dt>{label}</dt>
										<dd>
											{#each list as rel, i (rel.rxcui)}{i ? '; ' : ''}{rel.name}
												<span class="mono small"><span title={ttyTitle(rel.tty)}>{ttyLabel(rel.tty)}</span> <RxCui rxcui={rel.rxcui} name={rel.name} /></span>{/each}
										</dd>
									{/if}
								{/each}
							</dl>
							{#if cd.properties.length}
								<details class="props">
									<summary>All RxNav properties ({cd.properties.length})</summary>
									<dl class="concept-detail">
										{#each grouped(cd.properties) as [name, values] (name)}
											<dt>{name}</dt>
											<dd class:mono={values.length > 1}>{values.join(', ')}</dd>
										{/each}
									</dl>
								</details>
							{/if}
						{/if}
						{#if fetched?.status === 'error'}
							<p class="notice warning-text">
								{fetched.message}
								<button class="retry" onclick={() => void loadPackages(concept)} type="button"
									>Retry</button
								>
							</p>
						{:else if fetched?.status === 'loaded'}
							{#if fetched.warning}<p class="notice warning-text">{fetched.warning}</p>{/if}
							<ul class="packages">
								{#each packages as item (item.ndc)}
									{@render packageNode(item)}
								{:else}
									<li class="muted">No eligible packages were returned.</li>
								{/each}
							</ul>
						{:else}
							<p class="muted" aria-live="polite">Fetching packages…</p>
						{/if}
					{/if}
				</li>
			{/each}
			{#each visible(staged.packages) as item (item.ndc)}
				{@render packageNode(item)}
			{/each}
		</ul>
		{#if remaining > 0}
			<button class="more" disabled={loadingMore} onclick={more} type="button">
				{loadingMore
					? 'Loading…'
					: `Show next ${Math.min(PAGE_SIZE, remaining)} (${remaining} more)`}
			</button>
		{/if}
	{/if}

	{#if results.length}
		<h2 class="section-title">In the catalog</h2>
		<p class="count">{results.length} result{results.length === 1 ? '' : 's'}</p>
		<ul class="results">
			{#each results as result (result.id)}
				<li>
					<div>
						<span class="kind">{result.localConcept ? 'Local concept' : (KIND_LABELS[result.kind] ?? result.kind.replace('_', ' '))}</span>
						<h2>{#if result.href}<a href={result.href}>{result.name}</a>{:else}{result.name}{/if}</h2>
					</div>
					{#if result.detail}<p>{result.detail}</p>{/if}
					{#if result.identifiers.length}<p class="identifiers">
							{result.identifiers.join(' · ')}
						</p>{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

{#snippet onFormulary(formularyItemId: string | null)}
	{#if formularyItemId}
		<a class="badge" href={resolve('/formulary/items/[id]', { id: formularyItemId })}>On formulary</a>
	{:else}
		<span class="badge">On formulary</span>
	{/if}
{/snippet}

{#snippet packageNode(item: StagedPackage)}
	{@const key = `p:${item.ndc}`}
	<li class="node package">
		<div class="node-head">
			<button aria-expanded={open.has(key)} class="twisty" onclick={() => toggle(key)} type="button"
				>{open.has(key) ? '▾' : '▸'}</button
			>
			<div class="node-title">
				<span class="kind">package</span>
				<h3><BrandedName text={packageTitle(item)} /></h3>
				<p class="meta">
					<span class="mono">{item.ndc}</span>
					{[
						item.genericName ?? item.brandName,
						item.brandName && item.brandName !== item.genericName
							? `brand: ${item.brandName}`
							: null,
						item.labelerName,
						item.doseForm
					]
						.filter(Boolean)
						.join(' · ')}
					{#if item.exclusionReason}<span class="warning-text">· {item.exclusionReason}</span>{/if}
				</p>
			</div>
			{#if item.loaded}{@render onFormulary(item.formularyItemId)}{/if}
			<button
				class="load"
				disabled={pending.has(key) || !!item.exclusionReason}
				onclick={() => void load(key, { ndc: item.ndc })}
				title={item.exclusionReason ? `Ineligible: ${item.exclusionReason}` : undefined}
				type="button"
				>{pending.has(key) ? 'Adding…' : item.loaded ? 'Refresh' : 'Add to formulary'}</button
			>
		</div>
		{#if notices[key]}<p class:warning-text={!notices[key].ok} class="notice">
				{notices[key].text}
			</p>{/if}
		{#if open.has(key)}<PackageDetail {item} />{/if}
	</li>
{/snippet}

<style>
	label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 700;
	}

	.suggestion {
		margin: 0.5rem 0;
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		color: #204f91;
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
	}
	.facets {
		display: grid;
		gap: 0.4rem;
		margin: 0.75rem 0;
	}
	.facet-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	.facet-label {
		font-size: 0.8rem;
		font-weight: 600;
		min-width: 5.5rem;
		opacity: 0.75;
	}
	.chip {
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.8rem;
		padding: 0.15rem 0.6rem;
		cursor: pointer;
	}
	.chip[aria-pressed='true'] {
		background: #204f91;
		border-color: #204f91;
		color: #fff;
	}
	.chip .count {
		opacity: 0.65;
		font-variant-numeric: tabular-nums;
	}
	.why {
		margin: 0.15rem 0 0;
		font-size: 0.78rem;
		opacity: 0.75;
	}
	.why .missing {
		color: #765416;
	}
	.tier-divider {
		list-style: none;
		margin: 1rem 0 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.7;
	}
	.search-box {
		display: flex;
		gap: 0.75rem;
	}

	input {
		min-width: 0;
		flex: 1;
		border: 1px solid #b9c3d0;
		border-radius: 0.55rem;
		padding: 0.85rem 1rem;
		font: inherit;
	}

	input:focus {
		outline: 3px solid #b9d3f6;
		border-color: #3464a5;
	}

	button {
		border: 0;
		border-radius: 0.55rem;
		background: #204f91;
		color: white;
		padding: 0.85rem 1.1rem;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.more {
		display: block;
		margin: 0.75rem auto 0;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.6;
	}

	.status,
	.count {
		color: #5c6777;
	}

	.import-status {
		margin-top: 1.25rem;
		border: 1px solid #c7d9f0;
		border-radius: 0.75rem;
		background: #eef5ff;
		padding: 1rem 1.15rem;
	}

	.import-status {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.55rem;
		color: #31506f;
	}

	.import-status strong {
		color: #173c69;
	}

	.import-status.warning {
		border-color: #ebc977;
		background: #fff8e7;
		color: #765416;
	}

	.warning-text {
		color: #8a3e1d !important;
	}

	.results {
		display: grid;
		gap: 0.75rem;
		margin: 1rem 0;
		padding: 0;
		list-style: none;
	}

	.results li {
		border: 1px solid #dbe1e8;
		border-radius: 0.75rem;
		background: white;
		padding: 1rem 1.15rem;
	}

	.results li div {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.kind {
		color: #3464a5;
		font-size: 0.75rem;
		font-weight: 750;
		text-transform: capitalize;
		white-space: nowrap;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
	}

	.results p {
		margin: 0.5rem 0 0;
		color: #5c6777;
	}

	.identifiers {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.85rem;
	}

	.section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.section-title {
		margin: 2rem 0 0.75rem;
		font-size: 1.15rem;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		font-weight: 500;
		color: #5c6777;
	}

	.toggle input {
		flex: none;
	}

	.tree,
	.packages {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.packages {
		margin-top: 0.75rem;
		padding-left: 1.25rem;
		border-left: 2px solid #e3e8ee;
	}

	.node {
		border: 1px solid #dbe1e8;
		border-radius: 0.75rem;
		background: white;
		padding: 0.85rem 1rem;
	}

	.node.package {
		background: #fbfcfd;
	}

	.node.set {
		border-color: #c9d8ec;
		background: #f7faff;
	}

	.node-head {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
	}

	.node-title {
		flex: 1;
		min-width: 0;
	}

	.node-title h3 {
		margin: 0.1rem 0 0;
		font-size: 1rem;
		overflow-wrap: anywhere;
	}

	.meta {
		margin: 0.3rem 0 0;
		color: #5c6777;
		font-size: 0.875rem;
	}

	.twisty {
		border: 0;
		background: none;
		color: #3464a5;
		padding: 0.1rem 0.3rem;
		font-size: 1rem;
	}

	.load {
		flex: none;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
	}

	.badge {
		flex: none;
		border-radius: 999px;
		background: #e2f3e8;
		color: #1f6b3a;
		padding: 0.3rem 0.6rem;
		font-size: 0.75rem;
		font-weight: 700;
	}

	a.badge {
		text-decoration: none;
	}

	a.badge:hover {
		text-decoration: underline;
	}

	.notice {
		margin: 0.5rem 0 0;
		color: #1f6b3a;
		font-size: 0.875rem;
	}

	.concept-detail {
		display: grid;
		grid-template-columns: minmax(7rem, max-content) 1fr;
		gap: 0.25rem 0.75rem;
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
	}

	.concept-detail dt {
		color: #5c6777;
	}

	.concept-detail dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.props {
		margin-top: 0.6rem;
		font-size: 0.875rem;
	}

	.props summary {
		cursor: pointer;
		color: #3464a5;
		font-weight: 650;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.small {
		color: #7a8594;
		font-size: 0.75rem;
	}

	.muted {
		color: #7a8594;
	}

	.retry {
		margin-left: 0.5rem;
		padding: 0.2rem 0.6rem;
		font-size: 0.8rem;
	}

	@media (max-width: 640px) {
		.node-head {
			flex-wrap: wrap;
		}

		.load {
			width: 100%;
		}
	}

	@media (max-width: 480px) {
		.search-box {
			flex-direction: column;
		}
	}
</style>
