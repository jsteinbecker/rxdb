<script lang="ts">
      import {resolve} from '$app/paths';
      import {formatNdc} from '$lib/ndc';
      import type {PropertyOverride} from '$lib/property-override-fields';

      let {override}: { override: PropertyOverride } = $props();

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
{:else if override.passages?.length}
      Source:
      <a
            href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${override.splSetId}`}
            target="_blank"
            rel="noreferrer">SPL {override.splSetId}</a
      >
      <ul class="passages">
            {#each override.passages as passage, index (index)}
                  <li>{passage.sectionTitle}{passage.subsectionTitle ? ` › ${passage.subsectionTitle}` : ''} — “{passage.excerpt}”</li>
            {/each}
      </ul>
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
      .passages {
            margin: 0.2rem 0 0;
            padding-left: 1.1rem;
      }

      .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
</style>
