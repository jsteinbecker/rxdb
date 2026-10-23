<!--
@component
Every page's header: an eyebrow (breadcrumbs, or a record's kind and code), the title,
and the description lines under it, muted and stacked. A title ending in `[Brand]`
(RxNorm's form) shows the brand as a superheading over the rest. `compact` sizes the
title for a record page (a package, an ingredient, a compound); `actions` sit to the
right, wrapping below on narrow screens.

Usage:
```svelte
<PageHeader title={item.name} compact>
	{#snippet eyebrow()}Package · {formatNdc(item.ndc)}{/snippet}
	{#snippet actions()}<button>Edit</button>{/snippet}
	<p>{item.labeler}</p>
</PageHeader>
```
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { splitBrand } from "$lib/medication/brand-name";

	let {
		eyebrow,
		title,
		compact = false,
		actions,
		name: renderName,
		children
	}: {
		/** The line above the title: breadcrumbs, or a record's kind and code. */
		eyebrow: Snippet;
		/** A string becomes the `<h1>`; a snippet renders its own (an editable name, a placeholder). */
		title: string | Snippet;
		/** Sizes the title for a record page rather than a list page. */
		compact?: boolean;
		/** Buttons or links to the right of the title; they wrap below on narrow screens. */
		actions?: Snippet;
		/** Renders a string title's name (after its brand is split off) when a page restyles it. */
		name?: Snippet<[string]>;
		/** Description lines under the title, muted and stacked. */
		children?: Snippet;
	} = $props();
</script>

<header class:compact>
	<div class="text">
		<p class="eyebrow">{@render eyebrow()}</p>
		{#if typeof title === 'string'}
			{@const { name, brand } = splitBrand(title)}
			{#if brand}<p class="brand">{brand}</p>{/if}
			<h1>{#if renderName}{@render renderName(name)}{:else}{name}{/if}</h1>
		{:else}
			{@render title()}
		{/if}
		{#if children}<div class="details">{@render children()}</div>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.8rem 1.5rem;
		margin-bottom: 1.5rem;
	}

	.text {
		flex: 1 1 24rem;
	}

	.eyebrow {
		margin: 0 0 0.5rem;
		color: #3464a5;
		font-size: 0.8rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.eyebrow :global(a) {
		color: inherit;
	}

	.brand {
		margin: 0 0 0.2rem;
		color: #204f91;
		font-size: 1.2rem;
		font-weight: 750;
		letter-spacing: -0.01em;
	}

	.compact .brand {
		font-size: 1.05rem;
	}

	.text :global(h1) {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
		line-height: 1.15;
		letter-spacing: -0.045em;
	}

	.compact :global(h1) {
		font-size: 1.6rem;
		line-height: 1.25;
		letter-spacing: -0.01em;
	}

	/* Muted by inheritance, so any class a page puts on a line (a notice, a badge) wins. */
	.details {
		display: grid;
		justify-items: start;
		gap: 0.4rem;
		max-width: 46rem;
		margin-top: 0.6rem;
		color: #5c6777;
		line-height: 1.55;
	}

	.details > :global(p) {
		margin: 0;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}
</style>
