<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatNdc } from '$lib/ndc';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import FormularyIcon from '$lib/components/FormularyIcon.svelte';
	import { doseFormAbbreviation, packageDescriptionCase, productNameCase } from '$lib/package-text';

	let { data } = $props();

	const titleCase = (value: string) =>
		value.toLowerCase().replace(/(^|[\s,/(-])([a-z])/g, (_, lead, char) => lead + char.toUpperCase());
	const counts = $derived({
		products: new Set(data.packages.map((p) => p.ndc.slice(5, 9))).size,
		onFormulary: data.packages.filter((p) => p.onFormulary).length
	});

	type Pkg = (typeof data.packages)[number];
	const GROUPINGS = {
		none: { label: 'None', key: () => '' },
		drug: {
			label: 'Drug',
			key: (p: Pkg) => (p.genericName ?? p.brandName ?? 'Unknown drug').toUpperCase()
		},
		product: {
			label: 'NDC product',
			key: (p: Pkg) =>
				`${data.code}-${p.ndc.slice(5, 9)} · ${p.brandName ?? p.genericName ?? 'Unknown product'}`
		},
		brand: { label: 'Brand', key: (p: Pkg) => p.brandName ?? 'No brand name' },
		doseForm: { label: 'Dose form', key: (p: Pkg) => p.doseForm ?? 'Unknown dose form' },
		formulary: {
			label: 'Formulary',
			key: (p: Pkg) => (p.onFormulary ? 'On formulary' : 'Not on formulary')
		}
	};
	let grouping = $state<keyof typeof GROUPINGS>('drug');

	// Keep the chosen grouping when returning from a package's page.
	export const snapshot = {
		capture: () => grouping,
		restore: (value: keyof typeof GROUPINGS) => {
			if (value in GROUPINGS) grouping = value;
		}
	};
	const groups = $derived.by(() => {
		const byKey = new Map<string, Pkg[]>();
		for (const p of data.packages) {
			const key = GROUPINGS[grouping].key(p);
			byKey.set(key, [...(byKey.get(key) ?? []), p]);
		}
		return [...byKey].sort(([a], [b]) => a.localeCompare(b));
	});

	const SEGMENT_FORMAT = { first: '4-4-2', second: '5-3-2', third: '5-4-1' } as const;
	/** The labeled 10-digit form: drop the leading zero of the padded segment. */
	const tenDigit = (ndc: string, segment: Pkg['zeroSegment']) => {
		const parts = [ndc.slice(0, 5), ndc.slice(5, 9), ndc.slice(9)];
		const index = segment === 'first' ? 0 : segment === 'second' ? 1 : segment === 'third' ? 2 : -1;
		if (index < 0) return null;
		parts[index] = parts[index].slice(1);
		return parts.join('-');
	};
	const zeroSummary = $derived(
		data.zero.segment === 'mixed'
			? 'Mixed'
			: data.zero.segment
				? SEGMENT_FORMAT[data.zero.segment]
				: 'Undetermined'
	);
</script>

<svelte:head>
	<title>{data.names[0] ?? `Labeler ${data.code}`} · RxDB</title>
</svelte:head>

<main>
	<a class="back" href={resolve('/formulary')}><span aria-hidden="true">←</span> Formulary</a>
	<PageHeader title={data.names[0] ?? `Labeler ${data.code}`} compact>
		{#snippet eyebrow()}Labeler · <span class="mono">{data.code}</span>{/snippet}
		{#if data.names.length > 1}<p>Also labeled as {data.names.slice(1).join(', ')}</p>{/if}
		<p>
			<a
				href="https://api.fda.gov/drug/ndc.json?search=product_ndc:{data.code}-*&limit=100"
				target="_blank"
				rel="noreferrer">openFDA NDC products ↗</a
			>
		</p>
	</PageHeader>

	<dl class="stats">
		<div>
			<dt>Packages</dt>
			<dd>{data.packages.length}</dd>
		</div>
		<div>
			<dt>Products</dt>
			<dd>{counts.products}</dd>
		</div>
		<div>
			<dt>On formulary</dt>
			<dd>{counts.onFormulary}</dd>
		</div>
		<div
			title="Labeled formats — 4-4-2: {data.zero.counts['4-4-2']}, 5-3-2: {data.zero.counts[
				'5-3-2'
			]}, 5-4-1: {data.zero.counts['5-4-1']}, undetermined: {data.zero.counts.unknown}"
		>
			<dt>NDC10 format</dt>
			<dd>
				{zeroSummary}
				{#if data.zero.segment}<span class="basis">{data.zero.basis}</span>{/if}
			</dd>
		</div>
	</dl>

	<label class="grouping">
		Group by
		<select bind:value={grouping}>
			{#each Object.entries(GROUPINGS) as [value, { label }] (value)}
				<option {value}>{label}</option>
			{/each}
		</select>
	</label>

	{#if data.packages.length}
		<table>
			<thead>
				<tr><th>NDC</th><th>Package</th><th>Dose form</th></tr>
			</thead>
			{#each groups as [key, packages] (key)}
				<tbody>
					{#if grouping !== 'none'}
						<tr class="group"
							><th colspan="3">{key} <span class="muted">· {packages.length}</span></th></tr
						>
					{/if}
					{#each packages as pkg (pkg.ndc)}
						<tr>
							<td class="mono ndc">
								<FormularyIcon status={pkg.formularyStatus} />
								<a
									href={resolve('/formulary/ndc/[ndc]', { ndc: pkg.ndc })}
									data-nav-title={pkg.title}
									title="NDC11 {formatNdc(pkg.ndc)}">{tenDigit(pkg.ndc, pkg.zeroSegment) ?? formatNdc(pkg.ndc)}</a
								>
								{#if pkg.zeroBasis && pkg.zeroBasis !== 'labeled'}<span
										class="basis"
										title={pkg.zeroBasis === 'labeler'
											? 'From the labeler’s other NDCs'
											: 'Only one segment has a zero to drop'}>{pkg.zeroBasis}</span
									>{:else if !pkg.zeroSegment}<span
										class="basis"
										title="The labeled 10-digit form is undetermined; showing the 11-digit NDC"
										>NDC11</span
									>{/if}
							</td>
							<td>
								<div class="product-name">
									{productNameCase(pkg.brandName ?? pkg.genericName ?? 'Unknown product')}
									{#if pkg.strength}<span class="strength">{pkg.strength}</span>{/if}
								</div>
								<div class="package-detail">
									{pkg.description ? packageDescriptionCase(pkg.description) : 'Package details unavailable'}
								</div>
							</td>
							<td>
								{#if pkg.doseForm}<abbr class="dose-form" title={titleCase(pkg.doseForm)}
										>{doseFormAbbreviation(pkg.doseForm)}</abbr
									>{:else}—{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			{/each}
		</table>
	{:else}
		<p class="muted">
			No cached package carries this labeler code yet. Packages appear here once they are synced.
		</p>
	{/if}
</main>

<style>
	main {
		max-width: 1040px;
		margin: 0 auto;
		padding: 2.5rem 1.5rem 4rem;
	}
	a {
		color: #3464a5;
	}
	.back {
		display: inline-flex;
		gap: 0.4rem;
		margin-bottom: 1.5rem;
		font-weight: 650;
		text-decoration: none;
	}
	.muted {
		color: #5c6777;
	}
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 0 0 1.25rem;
	}
	.stats div {
		background: #fff;
		border: 1px solid #e3e8ee;
		border-radius: 8px;
		padding: 0.5rem 0.9rem;
	}
	.stats dt {
		color: #5c6777;
		font-size: 0.75rem;
	}
	.stats dd {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 700;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		background: #fff;
		font-size: 0.875rem;
	}
	th,
	td {
		border-bottom: 1px solid #e3e8ee;
		padding: 0.45rem 0.6rem;
		text-align: left;
		vertical-align: top;
	}
	th {
		color: #5c6777;
		font-weight: 650;
	}
	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		white-space: nowrap;
	}
	.product-name {
		font-weight: 650;
	}
	.strength {
		margin-left: 0.35rem;
		font-weight: 500;
		color: #3a4556;
	}
	.package-detail {
		margin-top: 0.15rem;
		color: #5c6777;
	}
	.basis {
		margin-left: 0.35rem;
		color: #8a5a00;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		font-weight: 600;
	}
	.grouping {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.75rem;
		color: #5c6777;
		font-size: 0.875rem;
	}
	tr.group th {
		background: #f0f3f7;
		color: #18212f;
	}
	.ndc a {
		margin-left: 0.3rem;
	}
	.dose-form {
		font-size: 0.75rem;
		font-weight: 750;
		letter-spacing: 0.03em;
		color: #3a4556;
		text-decoration: none;
		white-space: nowrap;
		cursor: help;
	}
	@media (max-width: 640px) {
		main {
			padding: 1.5rem 1rem 3rem;
		}
		table {
			display: block;
			overflow-x: auto;
		}
	}
</style>
