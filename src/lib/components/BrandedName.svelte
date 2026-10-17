<script lang="ts">
	import type { Snippet } from 'svelte';
	import { splitBrand } from '$lib/brand-name';

	/**
	 * A record's name where another view lists or links it, matching its page header: a trailing
	 * `[Brand]` reads as a label before the name. `name` renders the rest when a view restyles it.
	 */
	let { text, name }: { text: string; name?: Snippet<[string]> } = $props();

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
