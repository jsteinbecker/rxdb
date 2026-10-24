<script lang="ts">
	import RxCui from '$lib/components/RxCui.svelte';
	import BrandedName from '$lib/components/BrandedName.svelte';
	import {formatNdc} from "$lib/catalog/ndc";
	import PageHeader from '$lib/components/PageHeader.svelte';
      import {enhance} from '$app/forms';
      import {SvelteMap} from 'svelte/reactivity';
      import {naturalCompare} from "$lib/shared/natural-sort";
      import type {LoadedItem} from "$lib/server/formulary/membership";
      import {targetValue} from "$lib/catalog/load-target";

      let { data, form } = $props();

	let filter = $state('');
	let level = $state<'all' | 'concept' | 'package' | 'set'>('all');
	// Per-row actions in flight, so several rows can refresh at once without resetting each other.
	const pending = new SvelteMap<string, 'update' | 'remove'>();
	let reloadingAll = $state(false);
	let reloadingSelected = $state(false);
	let selected = $state<Set<string>>(new Set());
	const busy = $derived(reloadingAll || reloadingSelected);

	// Keep the filter when returning from an item's page.
	export const snapshot = {
		capture: () => ({ filter, level }),
		restore: (value: { filter: string; level: typeof level }) => {
			filter = value.filter;
			level = value.level;
		}
	};

	const levelOf = (item: LoadedItem) =>
		item.target.kind === 'concept' ? (item.tty ?? 'Concept') : item.target.kind === 'set' ? 'Set' : 'NDC';
	const loadedSets = $derived(
		new Set(data.items.flatMap((item: LoadedItem) => (item.target.kind === 'set' ? [item.target.key] : [])))
	);

	const items = $derived.by(() => {
		const term = filter.trim().toLowerCase();
		return data.items
			.filter((item: LoadedItem) => level === 'all' || item.target.kind === level)
			.filter(
				(item: LoadedItem) =>
					!term ||
					[
						item.displayName,
						targetValue(item.target)
					].some((value) => value.toLowerCase().includes(term))
			)
			.sort((a: LoadedItem, b: LoadedItem) => naturalCompare(a.displayName, b.displayName));
	});

	// Only count selections still on the page (removed items drop out).
	const selectedItems = $derived(data.items.filter((item: LoadedItem) => selected.has(item.formularyItemId)));
	const allShownSelected = $derived(
		items.length > 0 && items.every((item: LoadedItem) => selected.has(item.formularyItemId))
	);

	const toggle = (id: string, on: boolean) => {
		const next = new Set(selected);
		if (on) next.add(id);
		else next.delete(id);
		selected = next;
	};

	const toggleShown = (on: boolean) => {
		const next = new Set(selected);
		for (const item of items) {
			if (on) next.add(item.formularyItemId);
			else next.delete(item.formularyItemId);
		}
		selected = next;
	};

	const counts = $derived({
		all: data.items.length,
		concept: data.items.filter((item: LoadedItem) => item.target.kind === 'concept').length,
		package: data.items.filter((item: LoadedItem) => item.target.kind === 'package').length,
		set: data.items.filter((item: LoadedItem) => item.target.kind === 'set').length
	});
	const totalPackages = $derived(data.items.reduce((sum: number, item: LoadedItem) => sum + item.packages, 0));
	const totalExcluded = $derived(
		data.items.reduce((sum: number, item: LoadedItem) => sum + item.excludedPackages, 0)
	);
	const levels = [
		['all', 'All'],
		['concept', 'Concepts'],
		['package', 'Packages'],
		['set', 'Sets']
	] as const;
	const availableSets = $derived(data.productSets.filter((set) => !loadedSets.has(set.key)));

	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
</script>

<svelte:head>
	<title>Loaded items · RxDB</title>
</svelte:head>

<main>
	<PageHeader title={data.scope.name}>
		{#snippet eyebrow()}
			<a href="/">RxDB</a> / <a href="/formulary">Formulary</a> / Loaded items ·
			<a href="/settings">Settings</a>
		{/snippet}
		<p>
			Each row is one load, at the level it was loaded. Removing a concept takes off every package
			it brought in; removing an NDC takes off just that package.
		</p>
	</PageHeader>

	<dl class="ledger">
		<div><dt>Loads</dt><dd>{counts.all}</dd></div>
		<div><dt>Packages linked</dt><dd>{totalPackages}</dd></div>
		<div class:muted={!totalExcluded}><dt>Excluded</dt><dd>{totalExcluded}</dd></div>
		<div class="ledger-action">
			<form
				method="POST"
				action="?/reloadAll"
				use:enhance={({ cancel }) => {
					// Every package is fetched again from every provider: slow, and thousands of requests.
					if (
						!confirm(
							`Refresh all ${data.items.length} items? This fetches all ${totalPackages} packages again from every source and can take a long time.`
						)
					)
						return cancel();
					reloadingAll = true;
					return async ({ update }) => {
						try {
							await update();
						} finally {
							reloadingAll = false;
						}
					};
				}}
			>
				<button class="ghost" disabled={!data.items.length || busy || pending.size > 0}>
					<span aria-hidden="true" class:spin={reloadingAll}>↻</span>
					{reloadingAll ? 'Refreshing all…' : 'Refresh all'}
				</button>
			</form>
		</div>
	</dl>

	{#if form?.removed}
		<p class="notice" role="status">
			Removed {form.removed.displayName} · {plural(form.removed.packagesUnlinked, 'package')} unlinked.
		</p>
	{:else if form?.message}
		<p class="notice error" role="alert">{form.message}</p>
	{:else if form?.updated}
		<p class="notice" role="status">
			Updated {form.updated.displayName} · {plural(form.updated.packagesLinked, 'package')} linked.
		</p>
	{:else if form?.reloadAll}
		<p class="notice" class:error={form.reloadAll.failures.length > 0} role="status">
			Reloaded {plural(form.reloadAll.reloaded, 'item')} of {form.reloadAll.total}.
			{#if form.reloadAll.failures.length}
				Failed: {form.reloadAll.failures.join('; ')}
			{/if}
		</p>
	{/if}

	<section class="sheet">
		<div class="bar" class:selecting={selectedItems.length > 0}>
			{#if selectedItems.length}
				<span class="sel-count">{plural(selectedItems.length, 'item')} selected</span>
				<button type="button" class="link" onclick={() => (selected = new Set())} disabled={busy}>Clear</button>
				<form
					method="POST"
					action="?/reloadSelected"
					use:enhance={({ cancel }) => {
						if (!selectedItems.length) return cancel();
						reloadingSelected = true;
						return async ({ result, update }) => {
							try {
								await update();
								if (result.type === 'success') selected = new Set();
							} finally {
								reloadingSelected = false;
							}
						};
					}}
				>
					{#each selectedItems as item (item.formularyItemId)}
						<input type="hidden" name="formularyItemId" value={item.formularyItemId} />
					{/each}
					<button class="solid" disabled={busy || pending.size > 0}>
						{reloadingSelected ? `Refreshing ${plural(selectedItems.length, 'item')}…` : 'Refresh selected'}
					</button>
				</form>
			{:else}
				<div class="tabs" role="tablist" aria-label="Load level">
					{#each levels as [key, label] (key)}
						<button
							type="button"
							role="tab"
							aria-selected={level === key}
							class:active={level === key}
							disabled={key !== 'all' && !counts[key]}
							onclick={() => (level = key)}>{label}<span class="count">{counts[key]}</span></button
						>
					{/each}
				</div>
				<label class="search">
					<span aria-hidden="true">⌕</span>
					<input type="search" bind:value={filter} placeholder="Name, RxCUI, or NDC" aria-label="Filter" />
				</label>
			{/if}
		</div>

		{#if !data.items.length}
			<p class="empty">Nothing is loaded yet. <a href="/">Search and load</a> concepts or packages.</p>
		{:else if !items.length}
			<p class="empty">No loaded items match.</p>
		{:else}
			<div class="head">
				<input
					type="checkbox"
					aria-label="Select all shown"
					checked={allShownSelected}
					indeterminate={!allShownSelected && items.some((item: LoadedItem) => selected.has(item.formularyItemId))}
					onchange={(event) => toggleShown(event.currentTarget.checked)}
					disabled={busy}
				/>
				<span>Item</span>
				<span class="num">Pkgs</span>
				<span>Loaded</span>
				<span></span>
			</div>
			<ul class="items">
				{#each items as item (item.formularyItemId)}
					{@const state = pending.get(item.formularyItemId)}
					<li
						class:selected={selected.has(item.formularyItemId)}
						class:working={!!state}
						data-kind={item.target.kind}
					>
						<input
							type="checkbox"
							aria-label="Select {item.displayName}"
							checked={selected.has(item.formularyItemId)}
							onchange={(event) => toggle(item.formularyItemId, event.currentTarget.checked)}
							disabled={busy}
						/>
						<span class="desc">
							<a href="/formulary/items/{item.formularyItemId}" data-nav-title={item.displayName}
								><BrandedName text={item.displayName} /></a
							>
							<span class="meta">
								<span class="level">{levelOf(item)}</span>
								<span class="mono"
									>{#if item.target.kind === 'concept'}<RxCui rxcui={item.target.rxcui} />{:else if item.target.kind === 'set'}openFDA set{:else}{formatNdc(item.target.ndc)}{/if}</span
								>
							</span>
						</span>
						<span class="num">
							{item.packages}{#if item.excludedPackages}<sup
									title="Linked by the load but excluded from the catalog (veterinary or ineligible), so never listed"
									>+{item.excludedPackages}</sup
								>{/if}
						</span>
						<time class="date" datetime={new Date(item.loadedAt).toISOString()}
							>{new Date(item.loadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}</time
						>
						<span class="actions">
							<form
								method="POST"
								action="?/update"
								use:enhance={() => {
									const id = item.formularyItemId;
									pending.set(id, 'update');
									return async ({ update }) => {
										try {
											await update();
										} finally {
											pending.delete(id);
										}
									};
								}}
							>
								<input type="hidden" name="formularyItemId" value={item.formularyItemId} />
								<input type="hidden" name="kind" value={item.target.kind} />
								<input type="hidden" name="target" value={targetValue(item.target)} />
								<button class="icon" title="Refresh" aria-label="Refresh {item.displayName}" disabled={busy || !!state}
									><span class:spin={state === 'update'}>↻</span></button
								>
							</form>
							<form
								method="POST"
								action="?/remove"
								use:enhance={({ cancel }) => {
									const scope =
										item.target.kind !== 'package'
											? `${levelOf(item)} "${item.displayName}" and its ${plural(item.packages + item.excludedPackages, 'package')}`
											: `NDC ${formatNdc(item.target.ndc)}`;
									if (data.settings.confirmRemove && !confirm(`Remove ${scope} from the formulary?`))
										return cancel();
									const id = item.formularyItemId;
									pending.set(id, 'remove');
									return async ({ update }) => {
										try {
											await update();
										} finally {
											pending.delete(id);
										}
									};
								}}
							>
								<input type="hidden" name="formularyItemId" value={item.formularyItemId} />
								<button class="icon danger" title="Remove" aria-label="Remove {item.displayName}" disabled={busy || !!state}
									>{state === 'remove' ? '…' : '×'}</button
								>
							</form>
						</span>
					</li>
				{/each}
			</ul>
			<p class="foot">{plural(items.length, 'item')} shown{#if items.length !== data.items.length}&nbsp;of {data.items.length}{/if}</p>
		{/if}
	</section>

	{#if availableSets.length}
		<aside class="sets">
			<h2>Curated sets</h2>
			<p>Products RxNorm doesn't link: every listed, approved package found in the openFDA NDC directory.</p>
			<div class="set-list">
				{#each availableSets as set (set.key)}
					<form method="POST" action="?/addSet" use:enhance>
						<input type="hidden" name="set" value={set.key} />
						<button class="ghost" disabled={busy}>+ {set.name}</button>
					</form>
				{/each}
			</div>
		</aside>
	{/if}
</main>

<style>
	main {
		--ink: #1b2430;
		--muted: #7a8594;
		--line: #e3e8ee;
		--accent: #3464a5;
		--accent-soft: #eef3fb;
		--concept: #3464a5;
		--package: #8a96a6;
		--set: #b07a1f;
		color: var(--ink);
	}

	.ledger {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		margin: 2rem 0 1.25rem;
		border-top: 2px solid var(--ink);
		border-bottom: 1px solid var(--line);
	}

	.ledger > div {
		padding: 0.75rem 1.5rem 0.75rem 0;
		margin-right: 1.5rem;
		border-right: 1px solid var(--line);
	}

	.ledger dt {
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.ledger dd {
		margin: 0.15rem 0 0;
		font-size: 1.6rem;
		font-weight: 300;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}

	.ledger .muted dd {
		color: #c2cad4;
	}

	.ledger .ledger-action {
		margin: 0 0 0 auto;
		padding-right: 0;
		border: 0;
		display: flex;
		align-items: center;
	}

	.sheet {
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: white;
		box-shadow: 0 1px 2px rgb(27 36 48 / 4%), 0 8px 24px -12px rgb(27 36 48 / 10%);
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 3.25rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--line);
		border-radius: 0.75rem 0.75rem 0 0;
		background: rgb(255 255 255 / 92%);
		backdrop-filter: blur(6px);
	}

	.bar.selecting {
		background: var(--ink);
		color: white;
	}

	.bar.selecting .link {
		color: #b9cbe6;
	}

	.bar.selecting form {
		margin-left: auto;
	}

	.sel-count {
		font-weight: 650;
		font-size: 0.9rem;
		padding-left: 0.25rem;
	}

	.tabs {
		display: flex;
		gap: 0.15rem;
		padding: 0.2rem;
		border-radius: 0.55rem;
		background: #f2f5f8;
	}

	.tabs button {
		border: 0;
		border-radius: 0.4rem;
		background: none;
		color: #5c6777;
		padding: 0.35rem 0.7rem;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
	}

	.tabs button.active {
		background: white;
		color: var(--ink);
		box-shadow: 0 1px 2px rgb(27 36 48 / 12%);
	}

	.tabs .count {
		margin-left: 0.4rem;
		color: var(--muted);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}

	.search {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--muted);
		padding-left: 0.5rem;
	}

	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: 0;
		background: none;
		font: inherit;
		padding: 0.4rem 0;
	}

	.head,
	.items li {
		display: grid;
		grid-template-columns: 1.25rem minmax(0, 1fr) 4rem 5.5rem 4.5rem;
		align-items: center;
		gap: 0.75rem;
		padding: 0 0.75rem;
	}

	.head {
		padding-top: 0.5rem;
		padding-bottom: 0.4rem;
		color: var(--muted);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border-bottom: 1px solid var(--line);
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.items {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.items li {
		position: relative;
		padding-top: 0.6rem;
		padding-bottom: 0.6rem;
		border-bottom: 1px solid #f0f3f6;
		font-size: 0.9rem;
		transition: background 120ms;
	}

	.items li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.5rem;
		bottom: 0.5rem;
		width: 3px;
		border-radius: 0 3px 3px 0;
		background: var(--concept);
	}

	.items li[data-kind='package']::before {
		background: var(--package);
	}

	.items li[data-kind='set']::before {
		background: var(--set);
	}

	.items li:hover {
		background: #fafbfd;
	}

	.items li.selected {
		background: var(--accent-soft);
	}

	.items li.working {
		opacity: 0.6;
	}

	.desc {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.desc a {
		color: var(--ink);
		font-weight: 600;
		text-decoration: none;
	}

	.desc a:hover {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.meta {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-top: 0.1rem;
		color: var(--muted);
		font-size: 0.75rem;
	}

	.level {
		font-size: 0.64rem;
		font-weight: 750;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--concept);
	}

	li[data-kind='package'] .level {
		color: #5c6777;
	}

	li[data-kind='set'] .level {
		color: var(--set);
	}

	.num sup {
		margin-left: 0.15rem;
		color: #b07a1f;
		font-size: 0.65rem;
		cursor: help;
	}

	.date {
		color: var(--muted);
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 120ms;
	}

	li:hover .actions,
	li:focus-within .actions,
	li.working .actions {
		opacity: 1;
	}

	@media (hover: none) {
		.actions {
			opacity: 1;
		}
	}

	button.icon {
		width: 1.9rem;
		height: 1.9rem;
		border: 1px solid var(--line);
		border-radius: 0.45rem;
		background: white;
		color: #5c6777;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}

	button.icon:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	button.icon.danger:hover:not(:disabled) {
		border-color: #e3b4b4;
		background: #fdecec;
		color: #9a2a2a;
	}

	button.ghost,
	button.solid {
		border: 1px solid var(--line);
		border-radius: 0.55rem;
		background: white;
		color: var(--ink);
		padding: 0.45rem 0.85rem;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 650;
		white-space: nowrap;
		cursor: pointer;
	}

	button.ghost:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	button.solid {
		border-color: white;
	}

	button.link {
		border: 0;
		background: none;
		color: var(--accent);
		padding: 0;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		text-decoration: underline;
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.spin {
		display: inline-block;
		animation: spin 0.9s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.foot {
		margin: 0;
		padding: 0.6rem 0.75rem;
		color: var(--muted);
		font-size: 0.75rem;
	}

	.sets {
		margin-top: 2.5rem;
		padding-top: 1rem;
		border-top: 1px dashed #cfd7e1;
	}

	.sets h2 {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--set);
	}

	.sets p {
		margin: 0.25rem 0 0.75rem;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.set-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.notice {
		border-radius: 0.55rem;
		background: #e9f6ee;
		color: #1f6b3a;
		padding: 0.6rem 0.85rem;
	}

	.notice.error {
		background: #fdecec;
		color: #9a2a2a;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.empty {
		margin: 0;
		padding: 2.5rem 1rem;
		text-align: center;
		color: #5c6777;
	}

	@media (max-width: 640px) {
		.ledger > div {
			padding-right: 0.9rem;
			margin-right: 0.9rem;
		}

		.ledger dd {
			font-size: 1.25rem;
		}

		.bar:not(.selecting) {
			flex-wrap: wrap;
		}

		.search {
			flex-basis: 100%;
		}

		.head,
		.items li {
			grid-template-columns: 1.25rem minmax(0, 1fr) 3rem 4.5rem;
		}

		.head > :nth-child(4),
		.date {
			display: none;
		}
	}
</style>
