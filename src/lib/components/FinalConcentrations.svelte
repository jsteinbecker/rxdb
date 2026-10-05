<script lang="ts">
      import MixedFraction from './MixedFraction.svelte';
      import type {FinalRow} from '$lib/compound-builder';

      let {rows}: { rows: FinalRow[] } = $props();
</script>

<section aria-labelledby="final-heading" class="final">
      <h2 id="final-heading">Final concentrations</h2>
      <table>
            <tbody>
            {#each rows as row (row.slotId)}
                  <tr>
                        <th scope="row">{row.label}</th>
                        <td>
                              {#if row.amount}
                                    <strong>
                                          <MixedFraction value={row.amount} unit={row.unit}/>
                                    </strong>
                              {:else}
                                    <span class="blank" aria-label="not enough information">—</span>
                              {/if}
                        </td>
                  </tr>
            {/each}
            </tbody>
      </table>
</section>

<style>
      h2 {
            margin: 0 0 0.5rem;
            font-size: 0.8rem;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #3464a5;
      }

      table {
            width: 100%;
            border-collapse: collapse;
      }

      th,
      td {
            padding: 0.45rem 0;
            border-bottom: 1px solid #e3e7ee;
            text-align: left;
            font-weight: 500;
      }

      td {
            text-align: right;
      }

      .blank {
            color: #8b95a5;
      }
</style>
