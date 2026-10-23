<!--
@component
An RxCUI in monospace with its RxNorm name in a hover/focus tooltip. The name is looked
up lazily (and shared across instances) unless the caller already knows it. Renders
an em dash when there is no RxCUI.
-->
<script lang="ts">
	import { rxcuiNames } from "$lib/client/rxcui-names";

	let {
		rxcui,
		name: known = null
	}: {
		/** The concept to show; nullish renders "—". */
		rxcui: string | null | undefined;
		/** The concept's name when the caller has it, which skips the lookup. */
		name?: string | null;
	} = $props();
	const names = $derived(rxcuiNames(rxcui));
	const entry = $derived(rxcui ? $names[rxcui] : undefined);
	const name = $derived(known ?? entry?.name ?? null);
</script>

{#if rxcui}<span class="rxcui" tabindex="0" role="button" aria-label={name ? `RxCUI ${rxcui}: ${name}` : undefined}
		><span class="mono">{rxcui}</span><span class="overlay" role="tooltip"
			>{#if name}{name}{#if entry?.tty}<span class="tty">{entry.tty}</span>{/if}{:else if entry === undefined}Loading name…{:else}No RxNorm name found{/if}</span
		></span
	>{:else}—{/if}

<style>
	.rxcui {
		position: relative;
		cursor: help;
		text-decoration: underline dotted;
		text-underline-offset: 2px;
	}
	.overlay {
		display: none;
		position: absolute;
		left: 0;
		top: calc(100% + 4px);
		z-index: 50;
		width: max-content;
		max-width: 22rem;
		padding: 0.35rem 0.55rem;
		border-radius: 4px;
		background: #1f2328;
		color: #fff;
		font-family: system-ui, sans-serif;
		font-size: 0.8rem;
		font-weight: normal;
		line-height: 1.3;
		white-space: normal;
		text-align: left;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
		pointer-events: none;
	}
	.rxcui:hover .overlay,
	.rxcui:focus .overlay {
		display: block;
	}
	.tty {
		margin-left: 0.5em;
		opacity: 0.6;
		font-size: 0.85em;
	}
</style>
