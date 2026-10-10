<script module lang="ts">
	export type SkeletonKind =
		| 'formulary'
		| 'items'
		| 'item'
		| 'package'
		| 'usage'
		| 'compounds'
		| 'compound'
		| 'settings';
</script>

<script lang="ts">
	import Bone from './Bone.svelte';

	/**
	 * The header is the real thing wherever the destination is already known: static copy, the URL's
	 * own params, and the formulary name carried over from the page being left. Only names that need
	 * the load (an item, a compound, a labeler) stay as bones, along with everything below the header.
	 */
	let {
		kind,
		params = {},
		scopeName = '',
		tempTitle = ''
	} = $props<{
		kind: SkeletonKind;
		params?: Record<string, string>;
		scopeName?: string;
		/** The clicked link's text, standing in for a title only the load can supply. */
		tempTitle?: string;
	}>();

	const formatNdc = (ndc: string) =>
		ndc.length === 11 ? `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}` : ndc;
	const ndc = $derived(formatNdc(params.ndc ?? ''));

	const rows = (n: number) => Array.from({ length: n }, (_, i) => i);
	const widths = ['72%', '58%', '84%', '64%', '76%', '52%', '68%'];
</script>

{#snippet title(text: string, bone: string)}
	{#if text}<h1>{text}</h1>{:else}<Bone w={bone} h="2.6rem" class="title" />{/if}
{/snippet}

{#snippet header()}
	<header>
		{#if kind === 'formulary'}
			<p class="eyebrow">
				<a href="/">RxDB</a> / Formulary · <a href="/formulary/items">Manage loaded items →</a> ·
				<a href="/compounds">Compounds</a> · <a href="/settings">Settings</a>
			</p>
			{@render title(scopeName, '46%')}
			<p>Drag attributes into the hierarchy to decide how the formulary splits; each one nests under the one before it.</p>
		{:else if kind === 'items'}
			<p class="eyebrow">
				<a href="/">RxDB</a> / <a href="/formulary">Formulary</a> / Loaded items ·
				<a href="/settings">Settings</a>
			</p>
			{@render title(scopeName, '34%')}
			<p>
				Each row is one load, at the level it was loaded. Removing a concept (SCD, SBD, pack…)
				takes off every package it brought in; removing an NDC takes off just that package.
			</p>
		{:else if kind === 'item'}
			<p class="eyebrow">
				<a href="/">RxDB</a> / <a href="/formulary">Formulary</a> /
				<a href="/formulary/items">Loaded items</a>
			</p>
			{@render title(tempTitle, '52%')}
			<Bone w="60%" h="0.9rem" class="line" />
		{:else if kind === 'package'}
			<p class="eyebrow">NDC · <span class="mono">{ndc}</span></p>
			{@render title(tempTitle, '58%')}
			<Bone w="30%" h="0.9rem" class="line" />
		{:else if kind === 'usage'}
			<p class="eyebrow">
				{params.unii ? 'Ingredient · UNII' : 'Labeler'} ·
				<span class="mono">{params.unii ?? params.code}</span>
			</p>
			{@render title(tempTitle, '42%')}
		{:else if kind === 'compounds'}
			<p class="eyebrow">
				<a href="/">RxDB</a> / <a href="/formulary">Formulary</a> / Compounds
			</p>
			<h1>Compounds</h1>
			{#if scopeName}<p class="meta">{scopeName}</p>{/if}
		{:else if kind === 'compound'}
			<p class="eyebrow">
				<a href="/">RxDB</a> / <a href="/compounds">Compounds</a>{scopeName ? ` / ${scopeName}` : ''}
			</p>
			{@render title(tempTitle, '44%')}
		{:else}
			<p class="eyebrow">
				<a href="/">RxDB</a> / <a href="/formulary">Formulary</a> / Settings
			</p>
			<h1>Settings</h1>
			{#if scopeName}<p>Preferences for {scopeName}.</p>{/if}
		{/if}
	</header>
{/snippet}

{#snippet list(count: number)}
	<ul class="list">
		{#each rows(count) as i (i)}
			<li>
				<Bone w="7.5rem" h="0.9rem" />
				<Bone w={widths[i % widths.length]} h="0.9rem" />
				<Bone w="3.5rem" h="1.3rem" round />
			</li>
		{/each}
	</ul>
{/snippet}

<main class="skeleton kind-{kind}" aria-busy="true" aria-label="Loading content">
	{#if kind === 'formulary'}
		{@render header()}
		<div class="toolbar">
			<Bone w="min(22rem, 100%)" h="2.4rem" />
			<Bone w="6rem" h="2.4rem" />
			<Bone w="6rem" h="2.4rem" />
		</div>
		{#each rows(3) as g (g)}
			<section class="card">
				<div class="card-head">
					<Bone w="1.2rem" h="1.2rem" />
					<Bone w={widths[g * 2]} h="1.1rem" />
					<Bone w="4rem" h="1.1rem" round class="push" />
				</div>
				{@render list(g === 0 ? 4 : 2)}
			</section>
		{/each}
	{:else if kind === 'items'}
		{@render header()}
		<section class="card">
			{#each rows(7) as i (i)}
				<div class="item-row">
					<Bone w="2.2rem" h="1.3rem" round />
					<div class="stack">
						<Bone w={widths[i % widths.length]} h="1rem" />
						<Bone w="9rem" h="0.75rem" />
					</div>
					<Bone w="4.5rem" h="2rem" class="push" />
				</div>
			{/each}
		</section>
	{:else if kind === 'item'}
		{@render header()}
		<div class="chips">
			{#each rows(4) as i (i)}<Bone w="7rem" h="1.8rem" round />{/each}
		</div>
		<section class="card">
			<div class="card-head"><Bone w="9rem" h="1.1rem" /></div>
			{@render list(6)}
		</section>
	{:else if kind === 'package'}
		<a class="back" href="/formulary"><span aria-hidden="true">←</span> Formulary</a>
		{@render header()}
		<div class="split">
			<section class="card">
				<div class="card-head"><Bone w="8rem" h="1.1rem" /></div>
				<div class="media">
					<Bone w="9rem" h="9rem" round />
					<div class="stack grow">
						{#each rows(5) as i (i)}<Bone w={widths[i]} h="0.9rem" />{/each}
					</div>
				</div>
			</section>
			<section class="card">
				<div class="card-head"><Bone w="10rem" h="1.1rem" /></div>
				<div class="stack pad">
					{#each rows(9) as i (i)}<Bone w={widths[i % widths.length]} h="0.85rem" />{/each}
				</div>
			</section>
		</div>
	{:else if kind === 'usage'}
		<a class="back" href="/formulary"><span aria-hidden="true">←</span> Formulary</a>
		{@render header()}
		<div class="stats">
			{#each rows(4) as i (i)}
				<div class="stat"><Bone w="5rem" h="0.75rem" /><Bone w="3rem" h="1.8rem" /></div>
			{/each}
		</div>
		<section class="card">{@render list(8)}</section>
	{:else if kind === 'compounds'}
		{@render header()}
		<div class="toolbar">
			<input placeholder="New compound name…" aria-label="New compound name" disabled />
			<button disabled>+ Compound</button>
		</div>
		<section class="card">
			{#each rows(5) as i (i)}
				<div class="item-row">
					<Bone w={widths[i % widths.length]} h="1rem" />
					<Bone w="6rem" h="0.8rem" class="push" />
				</div>
			{/each}
		</section>
	{:else if kind === 'compound'}
		{@render header()}
		<section class="card">
			<div class="card-head">
				<Bone w="8rem" h="1.1rem" />
				<Bone w="6rem" h="2rem" class="push" />
			</div>
			{#each rows(3) as i (i)}
				<div class="item-row">
					<div class="stack">
						<Bone w={widths[i]} h="1rem" />
						<Bone w="10rem" h="0.75rem" />
					</div>
					<Bone w="5.5rem" h="2.2rem" class="push" />
					<Bone w="4rem" h="2.2rem" />
				</div>
			{/each}
		</section>
		<section class="card">
			<div class="card-head"><Bone w="10rem" h="1.1rem" /></div>
			<div class="stack pad">
				{#each rows(4) as i (i)}<Bone w={widths[i + 1]} h="0.9rem" />{/each}
			</div>
		</section>
	{:else}
		{@render header()}
		<section class="card">
			<div class="stack pad">
				{#each rows(4) as i (i)}
					<Bone w="9rem" h="0.8rem" />
					<Bone w="min(26rem, 100%)" h="2.4rem" />
				{/each}
			</div>
		</section>
	{/if}
</main>

<style>
	main {
		margin: 0 auto;
		max-width: 1040px;
		padding: 4rem 1.5rem;
		animation: arrive 0.25s ease both;
	}

	.kind-compounds {
		max-width: 760px;
	}

	.kind-compound {
		max-width: 880px;
	}

	header {
		display: grid;
		gap: 0.7rem;
		margin-bottom: 1.6rem;
	}

	header p {
		margin: 0;
		color: #5c6777;
		line-height: 1.55;
		max-width: 46rem;
	}

	header .eyebrow {
		color: #3464a5;
		font-size: 0.8rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	header .eyebrow a {
		color: inherit;
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
		letter-spacing: -0.045em;
		color: #18212f;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.02em;
	}

	.back {
		display: inline-block;
		margin-bottom: 1.4rem;
		color: #3464a5;
		font-size: 0.9rem;
		text-decoration: none;
	}

	.toolbar input {
		flex: 1;
		max-width: 24rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid #d5dce7;
		border-radius: 0.55rem;
		font: inherit;
	}

	.toolbar button {
		border: 0;
		border-radius: 0.55rem;
		background: #204f91;
		color: #fff;
		padding: 0.6rem 0.9rem;
		font: inherit;
		font-weight: 650;
		opacity: 0.6;
	}

	.card {
		background: #fff;
		border: 1px solid #e3e8f0;
		border-radius: 0.8rem;
		margin-bottom: 1rem;
		overflow: hidden;
	}

	.card-head,
	.list li,
	.item-row {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.9rem 1.1rem;
	}

	.card-head {
		border-bottom: 1px solid #eef2f7;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.list li + li,
	.item-row + .item-row {
		border-top: 1px solid #eef2f7;
	}

	.list li :global(.bone:nth-child(2)) {
		flex: 1;
	}

	.toolbar,
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		margin-bottom: 1.2rem;
	}

	.stack {
		display: grid;
		gap: 0.6rem;
	}

	.stack.grow {
		flex: 1;
	}

	.stack.pad {
		padding: 1.1rem;
	}

	.media {
		display: flex;
		gap: 1.2rem;
		padding: 1.1rem;
	}

	.split {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		align-items: start;
	}

	.split .card {
		margin: 0;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.8rem;
		margin-bottom: 1.2rem;
	}

	.stat {
		display: grid;
		gap: 0.6rem;
		padding: 1rem;
		background: #fff;
		border: 1px solid #e3e8f0;
		border-radius: 0.8rem;
	}

	:global(.push) {
		margin-left: auto;
	}

		@keyframes arrive {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}

	@media (max-width: 900px) {
		.split {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		main {
			padding: 2.5rem 1rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		main {
			animation: none;
		}
	}
</style>
