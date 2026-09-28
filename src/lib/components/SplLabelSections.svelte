<script lang="ts">
  import type { PackageDetails } from '$lib/server/catalog-providers';
  import LabelBlocks from './LabelBlocks.svelte';

  let { sections }: { sections: NonNullable<PackageDetails['label']>['sections'] } = $props();
</script>

{#each sections as section (section.key)}
  <details data-spl-section={section.key}>
    <summary>{section.title}</summary>
    {#if section.blocks?.length}
      <LabelBlocks blocks={section.blocks} />
    {:else}
      <p class="prose">{section.text}</p>
    {/if}
  </details>
{/each}

<style>
  details {
    margin-top: 0.4rem;
    border: 1px solid #e0e7f0;
    border-radius: 0.5rem;
    padding: 0.55rem 0.75rem;
  }
  summary {
    cursor: pointer;
    color: #3464a5;
    font-weight: 650;
  }
  .prose {
    white-space: pre-line;
    line-height: 1.5;
    color: #3c4757;
  }
</style>
