<script lang="ts">
      import {resolve} from '$app/paths';
      import type {PropertyOverride} from '$lib/property-override-fields';

      let {override}: { override: PropertyOverride } = $props();

      const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
</script>

{#if override.source === 'url'}
      Source:
      <a href={override.url} target="_blank" rel="noreferrer"
      >{override.title ?? new URL(override.url).hostname}</a
      >
      — “{override.excerpt}”
{:else if override.source === 'none'}
      No source cited
{:else if override.source === 'ndc'}
      Copied from {override.relation === 'sibling' ? 'sibling package' : 'equivalent NDC'}
      <a class="mono" href={resolve('/formulary/ndc/[ndc]', { ndc: override.ndc })}
      >{formatNdc(override.ndc)}</a
      >{override.description ? ` (${override.description})` : ''}
{:else}
      Source: {override.sectionTitle}{override.subsectionTitle ? ` › ${override.subsectionTitle}` : ''},
      <a
            href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${override.splSetId}`}
            target="_blank"
            rel="noreferrer">SPL {override.splSetId}</a
      >
      — “{override.excerpt}”
{/if}

<style>
      .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
</style>
