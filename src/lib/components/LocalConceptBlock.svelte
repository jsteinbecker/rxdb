<!--
@component
The local superseding concept shown on a package: the RxCUI it supersedes, its own
name and code, what RxNorm says instead, an ingredient diff against RxNorm when they
differ, and any ionic content the label states.
-->
<script lang="ts">
	import type { LocalConceptView } from "$lib/curation/local-concept-view";
	import type { IonicRow } from "$lib/curation/local-concept-input";
	import { asConceptIngredient, diffIngredients, parseScdName } from "$lib/curation/local-concept";
	import RxCui from './RxCui.svelte';
	import LocalConceptDiff from './LocalConceptDiff.svelte';

	let {
		localConcept,
		rxnormName,
		scdRxcui = null
	}: {
		/** The resolved local concept for this package. */
		localConcept: LocalConceptView;
		/** RxNorm's name for this NDC's own concept ("RxNorm says"). */
		rxnormName: string | null;
		/** The superseded SCD, for a derived SBD whose own RxCUI is not the one mapped. */
		scdRxcui?: string | null;
	} = $props();

	const supersededRxcui = $derived(
		localConcept.derived ? (scdRxcui ?? localConcept.supersedes.rxcui) : localConcept.supersedes.rxcui
	);
	const diff = $derived(
		diffIngredients(
			(rxnormName && parseScdName(rxnormName)?.ingredients) || [],
			localConcept.ingredients.map(asConceptIngredient)
		)
	);
	const ionic = $derived(
		Array.isArray(localConcept.ionicContent) ? (localConcept.ionicContent as IonicRow[]) : []
	);
</script>

<div class="local-concept">
	<p class="badge">
		Local concept · supersedes RxCUI <RxCui rxcui={supersededRxcui} />
		{#if localConcept.derived}· derived from <span class="mono">{localConcept.code}</span> SCD{/if}
	</p>
	<p class="name">
		{localConcept.name}
		{#if !localConcept.derived}<span class="mono code">{localConcept.code}</span>{/if}
	</p>
	<p class="rxnorm-says"><span class="muted">RxNorm says</span> {rxnormName ?? '—'}</p>
	{#if diff.length}
		<LocalConceptDiff {diff} />
	{/if}
	{#if ionic.length}
		<p class="ionic">
			<span class="muted">Ionic content (label)</span>
			{#each ionic as row, i (i)}
				{i ? '; ' : ''}{row.element}
				{row.comparator === '~' ? 'about ' : row.comparator === '<' ? '< ' : ''}{row.mEqPerL} mEq/L{#if row.source}
					({row.source}){/if}
			{/each}
		</p>
	{/if}
</div>

<style>
	.local-concept {
		margin: 0 0 1rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid #c9d6e8;
		border-left: 3px solid #3464a5;
		border-radius: 6px;
		background: #f7f9fc;
	}

	.badge {
		margin: 0 0 0.35rem;
		color: #3464a5;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.name {
		margin: 0 0 0.35rem;
		font-weight: 650;
	}

	.code {
		margin-left: 0.4rem;
		color: #5c6777;
		font-weight: 400;
	}

	.rxnorm-says,
	.ionic {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
	}

	.muted {
		color: #5c6777;
		margin-right: 0.3rem;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
</style>
