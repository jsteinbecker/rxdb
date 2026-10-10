<script lang="ts">
	import RxCui from '$lib/components/RxCui.svelte';
      import {enhance} from '$app/forms';
      import {naturalCompare} from '$lib/natural-sort';
      import type {LoadedItem} from '$lib/server/catalog-formulary';

      let { data, form } = $props();

	let filter = $state('');
	let level = $state<'all' | 'concept' | 'package'>('all');
	let pending = $state<{ id: string; action: 'update' | 'remove' } | null>(null);
	let reloadingAll = $state(false);

	// Keep the filter when returning from an item's page.
	export const snapshot = {
		capture: () => ({ filter, level }),
		restore: (value: { filter: string; level: typeof level }) => {
			filter = value.filter;
			level = value.level;
		}
	};

	const levelOf = (item: LoadedItem) =>
		item.target.kind === 'concept' ? (item.tty ?? 'Concept') : 'NDC';

	const items = $derived.by(() => {
		const term = filter.trim().toLowerCase();
		return data.items
			.filter((item: LoadedItem) => level === 'all' || item.target.kind === level)
			.filter(
				(item: LoadedItem) =>
					!term ||
					[
						item.displayName,
						item.target.kind === 'concept' ? item.target.rxcui : item.target.ndc
					].some((value) => value.toLowerCase().includes(term))
			)
			.sort((a: LoadedItem, b: LoadedItem) => naturalCompare(a.displayName, b.displayName));
	});

	const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
</script>

<svelte:head>
	<title>Loaded items · RxDB</title>
</svelte:head>

<main>
	<header>
		<p class="eyebrow">
			<a href="/">RxDB</a> / <a href="/formulary">Formulary</a> / Loaded items ·
			<a href="/settings">Settings</a>
		</p>
		<h1>{data.scope.name}</h1>
		<p>
			Each row is one load, at the level it was loaded. Removing a concept (SCD, SBD, pack…) takes
			off every package it brought in; removing an NDC takes off just that package.
		</p>
	</header>

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

	<div class="toolbar">
		<input type="search" bind:value={filter} placeholder="Filter by name, RxCUI, or NDC" />
		<select bind:value={level} aria-label="Load level">
			<option value="all">All levels</option>
			<option value="concept">Concepts</option>
			<option value="package">Packages</option>
		</select>
		<form
			method="POST"
			action="?/reloadAll"
			use:enhance={({ cancel }) => {
				// Every package is fetched again from every provider: slow, and thousands of requests.
				const packages = data.items.reduce((sum, item) => sum + item.packages, 0);
				if (
					!confirm(
						`Refresh all ${data.items.length} items? This fetches all ${packages} packages again from every source and can take a long time.`
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
			<button class="reload-all" disabled={!data.items.length || reloadingAll || pending !== null}>
				{reloadingAll ? 'Refreshing all…' : 'Refresh all'}
			</button>
		</form>
	</div>

	{#if !data.items.length}
		<p class="empty">
			Nothing is loaded yet. <a href="/">Search and load</a> concepts or packages.
		</p>
	{:else if !items.length}
		<p class="empty">No loaded items match.</p>
	{:else}
		<ul class="items">
			{#each items as item (item.formularyItemId)}
				<li>
					<span class="level" class:package={item.target.kind === 'package'}>{levelOf(item)}</span>
					<span class="desc">
						<a href="/formulary/items/{item.formularyItemId}">{item.displayName}</a>
						<span class="small mono">
							{#if item.target.kind === 'concept'}RxCUI <RxCui rxcui={item.target.rxcui} />{:else}NDC {formatNdc(item.target.ndc)}{/if}· {plural(item.packages, 'package')}{#if item.excludedPackages}<span
								title="Linked by the load but excluded from the catalog (veterinary or ineligible), so never listed"
							>{" "}(+{item.excludedPackages} excluded)</span
							>{/if} · loaded
							{new Date(item.loadedAt).toLocaleDateString()}
						</span>
					</span>
					<form
						method="POST"
						action="?/update"
						use:enhance={() => {
							pending = { id: item.formularyItemId, action: 'update' };
							return async ({ update }) => {
								await update();
								pending = null;
							};
						}}
					>
						<input type="hidden" name="formularyItemId" value={item.formularyItemId} />
						<input type="hidden" name="kind" value={item.target.kind} />
						<input
							type="hidden"
							name="target"
							value={item.target.kind === 'concept' ? item.target.rxcui : item.target.ndc}
						/>
						<button disabled={reloadingAll || pending?.id === item.formularyItemId}>
							{pending?.id === item.formularyItemId && pending.action === 'update'
								? 'Refreshing…'
								: 'Refresh'}
						</button>
					</form>
					<form
						method="POST"
						action="?/remove"
						use:enhance={({ cancel }) => {
							const scope =
								item.target.kind === 'concept'
									? `${levelOf(item)} "${item.displayName}" and its ${plural(item.packages + item.excludedPackages, 'package')}`
									: `NDC ${formatNdc(item.target.ndc)}`;
							if (data.settings.confirmRemove && !confirm(`Remove ${scope} from the formulary?`))
								return cancel();
							pending = { id: item.formularyItemId, action: 'remove' };
							return async ({ update }) => {
								await update();
								pending = null;
							};
						}}
					>
						<input type="hidden" name="formularyItemId" value={item.formularyItemId} />
						<button class="danger" disabled={reloadingAll || pending?.id === item.formularyItemId}
							>{pending?.id === item.formularyItemId && pending.action === 'remove' ? 'Removing…' : 'Remove'}</button
						>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		max-width: 1040px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}

	header p:last-child {
		color: #5c6777;
		line-height: 1.55;
		max-width: 46rem;
	}

	.eyebrow {
		margin: 0 0 0.5rem;
		color: #3464a5;
		font-size: 0.8rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.eyebrow a {
		color: inherit;
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
		letter-spacing: -0.045em;
	}

	.toolbar {
		display: flex;
		gap: 0.5rem;
		margin: 2rem 0 1rem;
	}

	.toolbar input,
	.toolbar select {
		border: 1px solid #b9c3d0;
		border-radius: 0.55rem;
		padding: 0.6rem 0.85rem;
		font: inherit;
		background: white;
	}

	.toolbar input {
		flex: 1;
		min-width: 0;
	}

	button.reload-all {
		border: 1px solid #3464a5;
		border-radius: 0.55rem;
		background: #3464a5;
		color: white;
		padding: 0.6rem 0.85rem;
		font: inherit;
		font-weight: 650;
		white-space: nowrap;
		cursor: pointer;
	}

	.items {
		display: grid;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.items li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		border: 1px solid #e3e8ee;
		border-radius: 0.55rem;
		background: white;
		padding: 0.6rem 0.75rem;
		font-size: 0.9rem;
	}

	.level {
		flex: none;
		min-width: 3.5rem;
		text-align: center;
		border-radius: 999px;
		background: #e8f0fb;
		color: #204f91;
		padding: 0.15rem 0.5rem;
		font-size: 0.7rem;
		font-weight: 750;
	}

	.level.package {
		background: #eef2f7;
		color: #5c6777;
	}

	.desc {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.desc .small {
		display: block;
		font-weight: 400;
	}

	button.danger {
		border: 1px solid #e3b4b4;
		border-radius: 0.55rem;
		background: white;
		color: #9a2a2a;
		padding: 0.4rem 0.75rem;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 650;
		cursor: pointer;
	}

	button.danger:hover:not(:disabled) {
		background: #fdecec;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
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

	.small {
		color: #7a8594;
		font-size: 0.75rem;
	}

	.empty {
		color: #5c6777;
	}

	@media (max-width: 640px) {
		main {
			padding: 2.5rem 1rem;
		}

		.items li {
			flex-wrap: wrap;
		}
	}
</style>
