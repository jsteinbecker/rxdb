<script lang="ts">
	import type { ConceptIngredient, IngredientDiff } from '$lib/local-concept';

	let { diff }: { diff: IngredientDiff } = $props();

	const strength = (c: ConceptIngredient | null) => (c ? `${c.value} ${c.unit}` : '—');
	const counts = $derived({
		removed: diff.filter((d) => d.change === 'removed').length,
		changed: diff.filter((d) => d.change === 'changed').length,
		added: diff.filter((d) => d.change === 'added').length
	});
</script>

<div class="table-wrap">
	<table class="diff">
		<caption>
			Against RxNorm: {counts.removed} removed, {counts.changed} changed, {counts.added} added
		</caption>
		<thead>
			<tr>
				<th>Ingredient</th>
				<th>RxNorm</th>
				<th>Local</th>
			</tr>
		</thead>
		<tbody>
			{#each diff as row, i (i)}
				<tr class={row.change}>
					<td>
						{row.local?.name ?? row.name}
						{#if row.change !== 'same'}<span class="tag">{row.change}</span>{/if}
					</td>
					<td class="num">
						{#if row.change === 'removed'}<s>{strength(row.rxnorm)}</s>{:else}{strength(row.rxnorm)}{/if}
					</td>
					<td class="num">{strength(row.local)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.table-wrap {
		overflow-x: auto;
	}

	.diff {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}

	caption {
		padding: 0.25rem 0;
		color: #5c6777;
		text-align: left;
	}

	th,
	td {
		padding: 0.2rem 0.5rem;
		border-bottom: 1px solid #e3e9f2;
		text-align: left;
	}

	th {
		color: #5c6777;
		font-weight: 650;
	}

	.num {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.removed td:first-child {
		color: #a4461a;
		text-decoration: line-through;
	}

	.changed .num {
		color: #8a5a00;
		font-weight: 650;
	}

	.added td {
		color: #1f6f43;
	}

	.tag {
		margin-left: 0.35rem;
		padding: 0 0.3rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		font-size: 0.68rem;
		text-decoration: none;
		display: inline-block;
	}
</style>
