<script lang="ts">
	import { isIonName } from "$lib/medication/ions";
	import {formatNdc, productCode} from "$lib/catalog/ndc";
	import {productTitle} from "$lib/catalog/package-title";
	import PageHeader from '$lib/components/PageHeader.svelte';
import {resolve} from '$app/paths';
	import {styledName, styledStrength} from "$lib/client/strength-display.svelte";

let { data } = $props();
	type Usage = (typeof data.usages)[number];

	/** An active ingredient's strength as the display rules show it; other roles stay as stored. */
	const roleStrength = (
		role: {kind: string; name: string; strength: string | null},
		usage: {strengthForm: string; actives: string[]}
	) =>
		(role.kind === 'active'
			? styledStrength(role, usage.strengthForm, usage.actives.filter((name) => name !== role.name))
			: null) ?? role.strength;


	/** The labeled name, only when it differs from the name this page goes by. */
	const labeledAs = (name: string) =>
		name.toUpperCase() === (data.names[0] ?? '').toUpperCase() ? null : `Labeled “${name}”`;
	const joined = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ') || null;

	/** Plain-language account of how this UNII shows up in a package. */
	function roleSummary(role: Usage['roles'][number], usage: Usage): {label: string; detail: string | null} {
		switch (role.kind) {
			case 'active':
				return {label: `Active${role.strength ? ` · ${roleStrength(role, usage)}` : ''}`, detail: labeledAs(role.name)};
			case 'inactive':
				return {label: 'Inactive ingredient', detail: joined('Excipient, not part of the strength', labeledAs(role.name))};
			case 'ionic':
				return {
					label: `Ion, counted in the label total${role.strength ? ` · ${roleStrength(role, usage)}` : ''}`,
					detail: labeledAs(role.name)
				};
			case 'moiety':
				return {
					label: isIonName(role.name) ? 'Ion within an active' : 'Active moiety',
					detail: `Part of ${role.of}, the labeled active`
				};
			case 'openfda':
				return {label: 'openFDA UNII only', detail: "Not on the label's ingredient list"};
		}
	}

const counts = $derived({
      active: data.usages.filter((u) => u.roles.some((r) => r.kind === 'active')).length,
      inactive: data.usages.filter((u) => u.roles.some((r) => r.kind === 'inactive')).length,
      moiety: data.usages.filter((u) => u.roles.some((r) => r.kind === 'moiety')).length
});

	type RoleKind = Usage['roles'][number]['kind'];
	const groupOrder: {kind: RoleKind; label: string}[] = [
		{kind: 'active', label: 'Active ingredient'},
		{kind: 'ionic', label: 'Ion constituent (label total)'},
		{kind: 'moiety', label: 'Moiety'},
		{kind: 'inactive', label: 'Excipient'},
		{kind: 'openfda', label: 'openFDA UNII'}
	];

	/**
	 * One row per product (labeler + product code) under each way the UNII appears; its packages
	 * differ only in NDC and packaging. A product with several kinds sits in each group, showing
	 * only that kind's roles.
	 */
	const groups = $derived(
		groupOrder
			.map(({kind, label}) => {
				const products = new Map<string, {code: string; title: string; first: Usage; packages: Usage[]}>();
				for (const usage of data.usages) {
					if (!usage.roles.some((r) => r.kind === kind)) continue;
					const code = productCode(usage.ndc) ?? usage.ndc;
					const product = products.get(code);
					if (product) product.packages.push(usage);
					else products.set(code, {code, title: productTitle(usage.title), first: usage, packages: [usage]});
				}
				const rows = [...products.values()].map((product) => ({
					...product,
					roles: product.first.roles.filter((r) => r.kind === kind)
				}));
				return {kind, label, rows, packageCount: rows.reduce((n, row) => n + row.packages.length, 0)};
			})
			.filter((group) => group.rows.length)
	);
	const productCount = $derived(new Set(data.usages.map((u) => productCode(u.ndc) ?? u.ndc)).size);
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
		<div><dt>Products</dt><dd>{productCount}</dd></div>
		<div><dt>Packages</dt><dd>{data.usages.length}</dd></div>
		<div><dt>As active</dt><dd>{counts.active}</dd></div>
		<div><dt>As excipient</dt><dd>{counts.inactive}</dd></div>
		<div><dt>As moiety</dt><dd>{counts.moiety}</dd></div>
	</dl>

	{#if data.usages.length}
		<table>
			<thead><tr><th>Product</th><th>Packages (NDC)</th><th>Labeler</th><th>Appears as</th></tr></thead>
			{#each groups as group (group.kind)}
			<tbody>
				<tr class="group"><th colspan="4">{group.label} <span class="muted">· {group.rows.length} products, {group.packageCount} packages</span></th></tr>
				{#each group.rows as {code, title, first, packages, roles} (code)}
                        <tr>
                              <td>
                                    <div class="product-name">{styledName(title)}</div>
                                    {#if first.brandName && first.brandName.toUpperCase() !== first.genericName?.toUpperCase() && !title.toUpperCase().includes(first.brandName.toUpperCase())}
                                          <div class="package-detail">Brand: {first.brandName}</div>
                                    {/if}
                              </td>
                              <td>
                              {#each packages as usage (usage.ndc)}
                                    <div class="package">
                                          <a class="mono" href={resolve('/formulary/ndc/[ndc]', { ndc: usage.ndc })} data-nav-title={styledName(usage.title)}>{formatNdc(usage.ndc)}</a>
                                          {#if usage.description}<div class="package-detail">{usage.description}</div>{/if}
                                    </div>
                              {/each}
                              </td>
                              <td>
                              {#if first.labelerName}
                              <a href={resolve('/formulary/labeler/[code]', { code: first.ndc.slice(0, 5) })}>
                                    {first.labelerName}
                              </a>{:else}—{/if}
                              </td>
                              <td>
                              {#each roles as role, i (i)}
                                    {@const summary = roleSummary(role, first)}
                                    <div class="appears">
                                          <span class="role {role.kind}">{summary.label}</span>
                                          {#if summary.detail}<div class="role-detail">{summary.detail}</div>{/if}
                                    </div>
                              {/each}
                              </td>
                        </tr>
				{/each}
			</tbody>
			{/each}
		</table>
	{:else}
		<p class="muted">
			No cached package references this UNII yet. Packages appear here once they are synced.
		</p>
	{/if}
</main>

<style>
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
	tr.group th {background: #f5f7fa;color: #3a4556;padding-top: 0.6rem;}
	.mono {font-family: ui-monospace, SFMono-Regular, Menlo, monospace;white-space: nowrap;}
	.product-name {font-weight: 650;}
	.package + .package {margin-top: 0.4rem;}
	.package .package-detail {font-size: 0.8rem;}
	.appears + .appears {margin-top: 0.35rem;}
	.role-detail {margin-top: 0.15rem;color: #5c6777;font-size: 0.8rem;}
	.package-detail {margin-top: 0.15rem;color: #5c6777;}
	.role {display: inline-block;margin: 0 0.25rem 0.15rem 0;border-radius: 999px;padding: 0.05rem 0.5rem;font-size: 0.75rem;background: #eef1f5;color: #3a4556;}
	.role.active {background: #e4ecf8;color: #26508a;}
	.role.inactive {background: #f3efe6;color: #6b5426;}
	.role.moiety, .role.ionic {background: #eaf4ee;color: #2c6644;}
	@media (max-width: 640px) {
		table {display: block;overflow-x: auto;}
	}
</style>
