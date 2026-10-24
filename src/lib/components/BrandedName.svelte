<!--
@component
A record's name where another view lists or links it, matching its page header: a
trailing `[Brand]` reads as a label before the name.

Usage:
```svelte
<BrandedName text={item.name} />
<BrandedName text={item.name}>{#snippet name(rest)}<em>{rest}</em>{/snippet}</BrandedName>
```
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { splitBrand } from "$lib/medication/brand-name";

	let {
		text,
		name
	}: {
		/** The full name, possibly ending in a `[Brand]` tag. */
		text: string;
		/** Renders the name after the brand is split off, when a view restyles it. */
		name?: Snippet<[string]>;
	} = $props();

	const parts = $derived(splitBrand(text));
</script>

{#if parts.brand}<span class="brand">{parts.brand}</span>{/if}
{#if name}{@render name(parts.name)}{:else}{parts.name}{/if}

<style>
	.brand {
		margin-right: 0.35em;
		color: #204f91;
		font-weight: 750;
	}
</style>
