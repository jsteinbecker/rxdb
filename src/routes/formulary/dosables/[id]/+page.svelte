<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import BrandedName from '#lib/components/BrandedName.svelte';
	import { resolve } from '$app/paths';
	import { formatNdc } from '#lib/catalog/ndc.ts';

	let { data } = $props();
	const dosable = $derived(data.dosable);
	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
	const ndcCount = $derived(
		dosable.formularyItems.reduce((sum, item) => sum + item.packages.length, 0)
	);
	const pinText = (line: {
		pinnedItem: string | null;
		ndcSubset: number | null;
		reason: string | null;
	}) =>
		!line.pinnedItem
			? 'any item'
			: line.ndcSubset
				? `${line.pinnedItem}, ${plural(line.ndcSubset, 'NDC')}${line.reason ? ` (${line.reason})` : ''}`
				: `only ${line.pinnedItem}`;
</script>

<svelte:head>
	<title>{dosable.label} · Dosable components · RxDB</title>
</svelte:head>

<main>
	<p class="crumbs"><a href={resolve('/formulary/dosables')}>Dosable components</a> /</p>
	<PageHeader title={dosable.label}>
		<p>
			{dosable.ingredients.join(' / ')} · route {dosable.route}
			{#if dosable.source === 'manual'}
				· added by hand{/if}
			{#if dosable.retired}
				· <strong>retired</strong>: no current formulary package carries it{/if}
		</p>
	</PageHeader>

	<section aria-labelledby="items-heading">
		<h2 id="items-heading">
			Formulary items <span class="count"
				>{plural(dosable.formularyItems.length, 'item')} · {plural(ndcCount, 'NDC')}</span
			>
		</h2>
		{#if dosable.formularyItems.length}
			<ul class="items">
				{#each dosable.formularyItems as item (item.id)}
					<li class:retired={item.retired}>
						<div class="item-head">
							<a href={resolve('/formulary/items/[id]', { id: item.id })}
								><BrandedName text={item.name} /></a
							>
							{#if item.source === 'manual'}<span class="badge">Manual</span>{/if}
							{#if item.retired}<span class="badge muted">Unlinked</span>{/if}
						</div>
						{#if item.packages.length}
							<ul class="packages">
								{#each item.packages as pkg (pkg.packageId)}
									<li>
										<a class="mono" href={resolve('/formulary/ndc/[ndc]', { ndc: pkg.ndc })}
											>{formatNdc(pkg.ndc)}</a
										>
										<span><BrandedName text={pkg.title} /></span>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="hint">No current packages.</p>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint">No formulary items are linked.</p>
		{/if}
	</section>

	<section aria-labelledby="compounds-heading">
		<h2 id="compounds-heading">
			Used in compounds <span class="count">{dosable.compoundList.length}</span>
		</h2>
		{#if dosable.compoundList.length}
			<ul class="compounds">
				{#each dosable.compoundList as compound (compound.id)}
					<li>
						<a href={resolve('/compounds/[id]', { id: compound.id })}>{compound.name}</a>
						{#if compound.status !== 'draft'}<span class="badge done">Finalized</span>{/if}
						<span class="hint">
							{#each compound.lines as line, index}{index ? '; ' : ''}{line.role}: {pinText(
									line
								)}{/each}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint">No compound uses this yet.</p>
		{/if}
	</section>
</main>

<style>
	main {
		--page-width: 860px;
	}
	.crumbs {
		margin: 0 0 0.25rem;
		font-size: 0.85rem;
		color: #5c6777;
	}
	section {
		margin-top: 1.75rem;
	}
	h2 {
		font-size: 1rem;
		margin: 0 0 0.6rem;
	}
	.count {
		color: #5c6777;
		font-weight: 400;
		font-size: 0.85rem;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.items > li {
		padding: 0.7rem 0;
		border-top: 1px solid #e3e7ee;
	}
	.items > li.retired {
		opacity: 0.65;
	}
	.item-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-weight: 650;
	}
	.packages {
		margin: 0.35rem 0 0 1rem;
		display: grid;
		gap: 0.2rem;
		font-size: 0.88rem;
	}
	.packages li {
		display: flex;
		gap: 0.6rem;
	}
	.mono {
		font-family: ui-monospace, monospace;
		white-space: nowrap;
	}
	.compounds li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.6rem 0;
		border-top: 1px solid #e3e7ee;
	}
	.compounds a {
		font-weight: 650;
	}
	.hint {
		color: #5c6777;
		font-size: 0.85rem;
	}
	.badge {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #e8eef8;
		color: #2c4f80;
		font-size: 0.72rem;
		font-weight: 700;
	}
	.badge.muted {
		background: #eef0f3;
		color: #5c6777;
	}
	.badge.done {
		background: #e6f2ea;
		color: #1f6b3a;
	}
</style>
