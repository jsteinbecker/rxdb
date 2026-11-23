<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { resolve } from '$app/paths';

	let { data } = $props();
	let query = $state('');
	let route = $state('');
	let showRetired = $state(false);

	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
	const routes = $derived([...new Set(data.dosables.map((d) => d.route))].sort());
	const shown = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return data.dosables.filter(
			(d) =>
				(showRetired || !d.retired) &&
				(!route || d.route === route) &&
				words.every((word) => d.label.toLowerCase().includes(word))
		);
	});
	const retiredCount = $derived(data.dosables.filter((d) => d.retired).length);
</script>

<svelte:head>
	<title>Dosable components · RxDB</title>
</svelte:head>

<main>
	<PageHeader title="Dosable components">
		<p>
			{data.scope.name} · each drug and route the formulary's items can be given by. Compound lines are
			chosen from these.
		</p>
	</PageHeader>

	<div class="filters">
		<input
			type="search"
			placeholder="Filter by drug…"
			aria-label="Filter by drug"
			bind:value={query}
		/>
		<select bind:value={route} aria-label="Route">
			<option value="">All routes</option>
			{#each routes as r (r)}<option value={r}>{r}</option>{/each}
		</select>
		{#if retiredCount}
			<label class="toggle"
				><input type="checkbox" bind:checked={showRetired} /> Show {retiredCount} retired</label
			>
		{/if}
	</div>

	{#if shown.length}
		<ul class="list">
			{#each shown as dosable (dosable.id)}
				<li class:retired={dosable.retired}>
					<a href={resolve('/formulary/dosables/[id]', { id: dosable.id })}>{dosable.label}</a>
					<span class="count">{plural(dosable.items, 'formulary item')}</span>
					{#if dosable.compounds}<span class="count">· {plural(dosable.compounds, 'compound')}</span
						>{/if}
					{#if dosable.source === 'manual'}<span class="badge">Manual</span>{/if}
					{#if dosable.retired}<span class="badge muted">Retired</span>{/if}
				</li>
			{/each}
		</ul>
	{:else if data.dosables.length}
		<p class="empty">Nothing matches those filters.</p>
	{:else}
		<p class="empty">
			No dosable components yet. They're built from the formulary's product forms when the formulary
			is loaded.
		</p>
	{/if}
</main>

<style>
	main {
		--page-width: 760px;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 1.5rem 0 0.5rem;
	}
	.filters input[type='search'],
	.filters select {
		padding: 0.45rem 0.6rem;
		border: 1px solid #c9d1dc;
		border-radius: 8px;
		font: inherit;
	}
	.filters input[type='search'] {
		flex: 1;
		min-width: 12rem;
	}
	.toggle {
		color: #5c6777;
		font-size: 0.85rem;
	}
	.list {
		margin: 1.25rem 0 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid #e3e7ee;
	}
	.list li {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.7rem 0;
		border-bottom: 1px solid #e3e7ee;
	}
	.list li.retired a {
		color: #7a8494;
	}
	.list a {
		font-weight: 650;
	}
	.count {
		color: #5c6777;
		font-size: 0.85rem;
	}
	.badge {
		margin-left: auto;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #e8eef8;
		color: #2c4f80;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.badge.muted {
		background: #eef0f3;
		color: #5c6777;
	}
	.badge + .badge {
		margin-left: 0;
	}
	.empty {
		margin-top: 1.5rem;
		color: #5c6777;
	}
</style>
