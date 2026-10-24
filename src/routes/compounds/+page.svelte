<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { resolve } from '$app/paths';

	let { data, form } = $props();
	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
</script>

<svelte:head>
	<title>Compounds · RxDB</title>
</svelte:head>

<main>
	<PageHeader title="Compounds">
		{#snippet eyebrow()}
			<a href={resolve('/')}>RxDB</a> / <a href={resolve('/formulary')}>Formulary</a> / Compounds
		{/snippet}
		<p>{data.scope.name}</p>
	</PageHeader>

	<form method="POST" action="?/create" class="new" use:enhance>
		<input name="name" placeholder="New compound name…" aria-label="New compound name" required />
		<button>+ Compound</button>
	</form>
	{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}

	{#if data.compounds.length}
		<ul class="list">
			{#each data.compounds as compound (compound.id)}
				<li>
					<a href={resolve('/compounds/[id]', { id: compound.id })}>{compound.name}</a>
					<span class="count">{plural(compound.components, 'component')}</span>
					{#if compound.status !== 'draft'}<span class="badge">Saved</span>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">
			No compounds yet. Name one above, then add components from
			<a href={resolve('/formulary')}>the formulary</a>.
		</p>
	{/if}
</main>

<style>
	main {
		--page-width: 760px;
	}
	.new {
		display: flex;
		gap: 0.5rem;
		margin: 1.5rem 0 0.5rem;
	}
	.new input {
		flex: 1;
		padding: 0.55rem 0.7rem;
		border: 1px solid #c9d1dc;
		border-radius: 8px;
		font: inherit;
	}
	.new button {
		padding: 0.55rem 0.9rem;
		border: 0;
		border-radius: 8px;
		background: #3464a5;
		color: #fff;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}
	.notice {
		color: #a3282a;
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
		gap: 0.75rem;
		padding: 0.7rem 0;
		border-bottom: 1px solid #e3e7ee;
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
		background: #e6f2ea;
		color: #1f6b3a;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.empty {
		margin-top: 1.5rem;
		color: #5c6777;
	}
</style>
