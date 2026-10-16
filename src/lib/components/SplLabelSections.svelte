<script lang="ts">
      import {fade, fly, slide} from 'svelte/transition';
      import {cubicInOut, cubicOut} from 'svelte/easing';
      import type {PackageDetails} from '$lib/server/catalog-providers';
      import LabelBlocks from './LabelBlocks.svelte';
      import {filterLabelBlocks, type LabelScope, omissionNote} from '$lib/label-relevance';

      type Label = NonNullable<PackageDetails['label']>;
      let {sections, scope = null}: { sections: Label['sections']; scope?: LabelScope | null } = $props();

      // Only this NDC's passages, when the label is shared with other forms or
      // strengths. The display panel is this carton's own art, already per package.
      const shown = $derived(
            sections.map((section) => {
                  const filtered =
                        scope && section.blocks && section.key !== 'package_label_principal_display_panel'
                              ? filterLabelBlocks(section.blocks, scope)
                              : null;
                  return filtered?.omissions.length
                        ? {...section, blocks: filtered.blocks, fullBlocks: section.blocks, omissions: filtered.omissions}
                        : {...section, fullBlocks: section.blocks, omissions: []};
            })
      );

      let expanded = $state<Record<string, boolean>>({});
      let closing = $state<Record<string, boolean>>({});
      let showAll = $state<Record<string, boolean>>({});

      const reduced =
            typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const ms = (n: number) => (reduced ? 0 : n);

      function toggle(e: MouseEvent, key: string) {
            e.preventDefault();
            if (expanded[key]) {
                  expanded[key] = false;
                  closing[key] = true;
            } else {
                  closing[key] = false;
                  expanded[key] = true;
            }
      }
</script>

{#each shown as section (section.key)}
      <details
            data-spl-section={section.key}
            open={expanded[section.key] || closing[section.key]}
            class:expanded={expanded[section.key]}
      >
            <summary onclick={(e) => toggle(e, section.key)}>
                  <span>{section.title}{#if section.omissions.length}<span class="filtered"> · filtered</span>{/if}</span>
            </summary>
            {#if expanded[section.key]}
                  <div
                        class="body"
                        transition:slide={{ duration: ms(300), easing: cubicInOut }}
                        onoutroend={() => (closing[section.key] = false)}
                  >
                        <div
                              in:fly={{ y: -6, duration: ms(260), delay: ms(90), easing: cubicOut }}
                              out:fade={{ duration: ms(120) }}
                        >
                              {#if section.omissions.length}
                                    <p class="omitted">
                                          {#if showAll[section.key]}
                                                Showing the full label text, including passages for other products on this label.
                                          {:else}
                                                {section.omissions.map(omissionNote).join(' ')}
                                          {/if}
                                          <button type="button" class="link" onclick={() => (showAll[section.key] = !showAll[section.key])}>
                                                {showAll[section.key] ? 'Show only this NDC' : 'Show full label text'}
                                          </button>
                                    </p>
                                    <LabelBlocks blocks={(showAll[section.key] ? section.fullBlocks : section.blocks) ?? []}/>
                              {:else if section.blocks?.length}
                                    <LabelBlocks blocks={section.blocks}/>
                              {:else}
                                    <p class="prose">{section.text}</p>
                              {/if}
                        </div>
                  </div>
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

      details {
            transition: box-shadow 0.3s ease,
            background-color 0.3s ease;
      }

      details.expanded {
            background: rgb(28 47 75 / 2.5%);
            box-shadow: 0 1px 2px rgb(28 47 75 / 6%),
            0 6px 18px -4px rgb(28 47 75 / 12%);
      }

      summary {
            cursor: pointer;
            color: #3464a5;
            font-weight: 650;
      }

      summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.5rem;
            list-style: none;
      }

      summary::-webkit-details-marker {
            display: none;
      }

      summary::after {
            content: '';
            flex: none;
            width: 0.4rem;
            height: 0.4rem;
            border-right: 2px solid currentColor;
            border-bottom: 2px solid currentColor;
            opacity: 0.55;
            transform: translateY(-15%) rotate(45deg);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      details.expanded > summary::after {
            transform: translateY(15%) rotate(-135deg);
      }

      .body {
            overflow: hidden;
      }

      @media (prefers-reduced-motion: reduce) {
            details,
            summary::after {
                  transition: none;
            }
      }

      .filtered {
            color: #6b7686;
            font-weight: 400;
            font-size: 0.72rem;
      }

      .omitted {
            margin: 0.35rem 0 0.5rem;
            font-size: 0.7rem;
            font-style: italic;
            color: #6b7686;
      }

      .omitted .link {
            margin-left: 0.25rem;
            padding: 0;
            border: 0;
            background: none;
            font: inherit;
            font-style: normal;
            color: #3464a5;
            text-decoration: underline;
            cursor: pointer;
      }

      .prose {
            white-space: pre-line;
            line-height: 1.5;
            color: #3c4757;
            font-size: 0.78rem;
      }

      details :global(.label-blocks) {
            font-size: 0.78rem;
      }

      details :global(.label-blocks .level-1) {
            font-size: 0.84rem;
      }

      details :global(.label-blocks .level-2),
      details :global(.label-blocks .level-3) {
            font-size: 0.78rem;
      }

      details :global(.label-blocks table) {
            font-size: 0.74rem;
      }
</style>
