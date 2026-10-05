<script lang="ts">
      import {fade, fly, slide} from 'svelte/transition';
      import {cubicInOut, cubicOut} from 'svelte/easing';
      import type {PackageDetails} from '$lib/server/catalog-providers';
      import LabelBlocks from './LabelBlocks.svelte';

      let {sections}: { sections: NonNullable<PackageDetails['label']>['sections'] } = $props();

      let expanded = $state<Record<string, boolean>>({});
      let closing = $state<Record<string, boolean>>({});

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

{#each sections as section (section.key)}
      <details
            data-spl-section={section.key}
            open={expanded[section.key] || closing[section.key]}
            class:expanded={expanded[section.key]}
      >
            <summary onclick={(e) => toggle(e, section.key)}>{section.title}</summary>
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
                              {#if section.blocks?.length}
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
