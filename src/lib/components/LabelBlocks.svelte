<script lang="ts">
      import type {LabelBlock, LabelCell, LabelRun} from '$lib/spl-sections';
      import LabelBlocks from './LabelBlocks.svelte';

      let {blocks}: { blocks: LabelBlock[] } = $props();
</script>

{#snippet runs(list: LabelRun[])}
      {#each list as run, i (i)}
            {#if run.style === 'bold'}<strong>{run.text}</strong>
            {:else if run.style === 'italic'}<em>{run.text}</em>
            {:else if run.style === 'underline'}<u>{run.text}</u>
            {:else if run.style === 'sup'}<sup>{run.text}</sup>
            {:else if run.style === 'sub'}<sub>{run.text}</sub>
            {:else}{run.text}{/if}
      {/each}
{/snippet}

{#snippet row(cells: LabelCell[], header: boolean)}
      <tr>
            {#each cells as cell, i (i)}
                  {#if header || cell.header}
                        <th colspan={cell.colspan} rowspan={cell.rowspan}>{@render runs(cell.runs)}</th>
                  {:else}
                        <td colspan={cell.colspan} rowspan={cell.rowspan}>{@render runs(cell.runs)}</td>
                  {/if}
            {/each}
      </tr>
{/snippet}

<div class="label-blocks">
      {#each blocks as block, i (i)}
            {#if block.type === 'heading'}
                  <p class="heading level-{Math.min(block.level, 3)}">{block.text}</p>
            {:else if block.type === 'paragraph'}
                  <p>{@render runs(block.runs)}</p>
            {:else if block.type === 'list'}
                  <svelte:element this={block.ordered ? 'ol' : 'ul'}>
                        {#each block.items as item, j (j)}
                              <li>
                                    <LabelBlocks blocks={item}/>
                              </li>
                        {/each}
                  </svelte:element>
            {:else if block.type === 'table'}
                  <div class="table-wrap">
                        <table>
                              {#if block.caption}
                                    <caption>{block.caption}</caption>
                              {/if}
                              {#if block.head.length}
                                    <thead
                                    >
                                    {#each block.head as cells, j (j)}{@render row(cells, true)}{/each}
                                    </thead
                                    >
                              {/if}
                              <tbody
                              >
                              {#each block.body as cells, j (j)}{@render row(cells, false)}{/each}
                              </tbody
                              >
                              {#if block.foot.length}
                                    <tfoot
                                    >
                                    {#each block.foot as cells, j (j)}{@render row(cells, false)}{/each}
                                    </tfoot
                                    >
                              {/if}
                        </table>
                  </div>
            {/if}
      {/each}
</div>

<style>
      .label-blocks {
            color: #3c4757;
            line-height: 1.5;
            font-size: 0.875rem;
      }

      p {
            margin: 0.4rem 0;
            white-space: pre-line;
      }

      .heading {
            margin: 0.9rem 0 0.3rem;
            color: #1f2a37;
            font-weight: 650;
      }

      .level-1 {
            font-size: 0.95rem;
      }

      .level-2,
      .level-3 {
            font-size: 0.875rem;
            font-style: italic;
      }

      ul,
      ol {
            margin: 0.3rem 0;
            padding-left: 1.3rem;
      }

      li > :global(.label-blocks > p:first-child) {
            margin-top: 0;
      }

      li > :global(.label-blocks > p:last-child) {
            margin-bottom: 0.15rem;
      }

      .table-wrap {
            overflow-x: auto;
            max-width: 100%;
            margin: 0.8rem 0 1rem;
            border: 1px solid #dfe6ef;
            border-radius: 0.65rem;
            background: #fff;
            box-shadow: 0 2px 8px rgb(28 47 75 / 5%);
      }

      table {
            width: 100%;
            min-width: 34rem;
            border-collapse: separate;
            border-spacing: 0;
            font-size: 0.82rem;
      }

      caption {
            text-align: left;
            font-weight: 650;
            padding: 0.75rem 0.85rem;
            color: #284d7b;
            background: #f7f9fc;
            border-bottom: 1px solid #e4eaf2;
      }

      th,
      td {
            border-bottom: 1px solid #e8edf3;
            border-right: 1px solid #edf1f5;
            padding: 0.65rem 0.8rem;
            text-align: left;
            vertical-align: top;
            white-space: pre-line;
      }

      th {
            background: #edf3fb;
            color: #334863;
            font-weight: 650;
            line-height: 1.35;
      }

      td:last-child,
      th:last-child {
            border-right: 0;
      }

      tbody tr:nth-child(even) {
            background: #f8fafc;
      }

      tbody tr:hover {
            background: #eef5ff;
      }

      tfoot {
            background: #f7f9fc;
            font-weight: 600;
      }

      @media (max-width: 640px) {
            .table-wrap {
                  margin-left: -0.4rem;
                  margin-right: -0.4rem;
            }

            table {
                  min-width: 30rem;
            }
      }
</style>
