<script lang="ts">
	import { isIonName } from '$lib/ions';
	import {formatNdc} from '$lib/ndc';
	import PageHeader from '$lib/components/PageHeader.svelte';
import {resolve} from '$app/paths';

let { data } = $props();


const counts = $derived({
      active: data.usages.filter((u) => u.roles.some((r) => r.kind === 'active')).length,
      inactive: data.usages.filter((u) => u.roles.some((r) => r.kind === 'inactive')).length,
      moiety: data.usages.filter((u) => u.roles.some((r) => r.kind === 'moiety')).length
});
</script>

<svelte:head>
	<title>UNII {data.unii} · RxDB</title>
</svelte:head>

<main>
	<a class="back" href={resolve('/formulary')}><span aria-hidden="true">←</span> Formulary</a>
	<PageHeader title={data.names[0] ?? `UNII ${data.unii}`} compact>
		{#snippet eyebrow()}Ingredient · UNII · <span class="mono">{data.unii}</span>{/snippet}
		{#if data.names.length > 1}<p>Also labeled as {data.names.slice(1).join(', ')}</p>{/if}
		<p>
			<a
				href="https://precision.fda.gov/uniisearch/srs/unii/{data.unii}"
				target="_blank"
				rel="noreferrer">FDA GSRS record ↗</a
			>
		</p>
	</PageHeader>

	<dl class="stats">
		<div><dt>Packages</dt><dd>{data.usages.length}</dd></div>
		<div><dt>As active</dt><dd>{counts.active}</dd></div>
		<div><dt>As excipient</dt><dd>{counts.inactive}</dd></div>
		<div><dt>As moiety</dt><dd>{counts.moiety}</dd></div>
	</dl>

	{#if data.usages.length}
		<table>
			<thead><tr><th>NDC</th><th>Package</th><th>Labeler</th><th>Appears as</th></tr></thead>
			<tbody>
				{#each data.usages as usage (usage.ndc)}
                        <tr>
                              <td class="mono">
                                    <a href={resolve('/formulary/ndc/[ndc]', { ndc: usage.ndc })} data-nav-title={usage.title}>{formatNdc(usage.ndc)}</a>
                              </td>
                              <td>
                                    <div class="product-name">
                                          {usage.brandName ?? usage.genericName ?? 'Unknown product'}
                                          {#each usage.roles as role, i (i)}
                                                {#if 'strength' in role && role.strength}
                                                      <span class="muted"> · {role.strength}</span>
                                                {/if}
                                          {/each}
                                    </div>
                                    <div class="package-detail">
                                          {usage.description ?? usage.doseForm ?? 'Package details unavailable'}
                                          {#if usage.description && usage.doseForm && !usage.description.toUpperCase().includes(usage.doseForm.toUpperCase())}
                                                <span class="muted"> · {usage.doseForm}</span>
                                          {/if}
                                    </div>
                              </td>
                              <td>
                              {#if usage.labelerName}
                              <a href={resolve('/formulary/labeler/[code]', { code: usage.ndc.slice(0, 5) })}>
                                    {usage.labelerName}
                              </a>{:else}—{/if}
                              </td>
                              <td>
                              {#each usage.roles as role, i (i)}
                                    <span class="role {role.kind}">
                                          {#if role.kind === 'moiety'}{isIonName(role.name) ? 'ion constituent' : 'moiety'} of {role.of}
                                          {:else if role.kind === 'openfda'}openFDA UNII
                                          {:else}
                                                {#if role.kind == 'inactive'} Excipient
                                                {:else if role.kind === 'ionic'} Ion constituent (label total)
                                                {:else} {role.kind}
                                                {/if}
                                                {role.strength ? ` · ${role.strength}` : ''}
                                          {/if}
                                    </span>
                              {/each}
                              </td>
                        </tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="muted">
			No cached package references this UNII yet. Packages appear here once they are synced.
		</p>
	{/if}
</main>

<style>
	main {max-width: 1040px;margin: 0 auto;padding: 2.5rem 1.5rem 4rem;}
	a {color: #3464a5;}
	.back {display: inline-flex;gap: 0.4rem;margin-bottom: 1.5rem;font-weight: 650;text-decoration: none;}
	.muted {color: #5c6777;}
	.stats {display: flex;flex-wrap: wrap;gap: 0.75rem;margin: 0 0 1.25rem;}
	.stats div {background: #fff;border: 1px solid #e3e8ee;border-radius: 8px;padding: 0.5rem 0.9rem;}
	.stats dt {color: #5c6777;font-size: 0.75rem;}
	.stats dd {margin: 0;font-size: 1.2rem;font-weight: 700;}
	table {width: 100%;border-collapse: collapse;background: #fff;font-size: 0.875rem;}
	th, td {border-bottom: 1px solid #e3e8ee;padding: 0.45rem 0.6rem;text-align: left;vertical-align: top;}
	th {color: #5c6777;font-weight: 650;}
	.mono {font-family: ui-monospace, SFMono-Regular, Menlo, monospace;white-space: nowrap;}
	.product-name {font-weight: 650;}
	.package-detail {margin-top: 0.15rem;color: #5c6777;}
	.role {display: inline-block;margin: 0 0.25rem 0.15rem 0;border-radius: 999px;padding: 0.05rem 0.5rem;font-size: 0.75rem;background: #eef1f5;color: #3a4556;}
	.role.active {background: #e4ecf8;color: #26508a;}
	@media (max-width: 640px) {
		main {padding: 1.5rem 1rem 3rem;}
		table {display: block;overflow-x: auto;}
	}
</style>
