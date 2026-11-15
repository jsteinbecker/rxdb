<script lang="ts">
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatNdc } from '#lib/catalog/ndc.ts';
	import { QUARANTINE_LABELS } from '#lib/catalog/quarantine.ts';

	let { data } = $props();
</script>

<svelte:head>
	<title>Quarantine · RxDB</title>
</svelte:head>

<main>
	<PageHeader title="Quarantine">
		<p>
			{data.packages.length} formulary {data.packages.length === 1 ? 'package is' : 'packages are'} missing
			facts needed to dispense them. They stay on the formulary. Open one to add the missing facts,
			accept it as is, or exclude it permanently.
		</p>
	</PageHeader>

	{#if !data.packages.length}
		<p class="empty">Nothing is quarantined.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>NDC</th>
					<th>Package</th>
					<th>Labeler</th>
					<th>Reason</th>
					<th>Formulary item</th>
				</tr>
			</thead>
			<tbody>
				{#each data.packages as pkg (pkg.ndc)}
					<tr>
						<td class="mono"><a href={resolve('/formulary/ndc/[ndc]', { ndc: pkg.ndc })}>{formatNdc(pkg.ndc)}</a></td>
						<td>{pkg.title ?? '—'}<div class="muted">{pkg.doseForm ?? ''}</div></td>
						<td>{pkg.labelerName ?? '—'}</td>
						<td>{QUARANTINE_LABELS[pkg.reason]}</td>
						<td>
							{#each pkg.items as item (item.id)}
								<div><a href={resolve('/formulary/items/[id]', { id: item.id })}>{item.displayName}</a></div>
							{/each}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>

<style>
	.empty,
	.muted {
		color: #5c6777;
	}

	.muted {
		font-size: 0.8rem;
	}

	.mono {
		font-family: ui-monospace, monospace;
		font-size: 0.82rem;
		white-space: nowrap;
	}

	table {
		width: 100%;
		margin-top: 1.5rem;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	th,
	td {
		padding: 0.55rem 0.6rem;
		border-bottom: 1px solid #e3e8ef;
		text-align: left;
		vertical-align: top;
	}

	th {
		color: #7a8594;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
</style>
