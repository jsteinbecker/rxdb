<!--
@component
"Ingredient scenarios" for a formulary item: which ingredient profiles (active
ingredients and excipients) its packages fall into, as a matrix of ingredients (rows)
against profiles (columns). Ticking ingredients to avoid shows which NDCs remain. Rows merge salts
into their moiety unless listed separately.
-->
<script lang="ts">
  import type { ItemSummary } from "#lib/formulary/item-summary.ts";
  import { formatNdc } from "#lib/catalog/ndc.ts";
  import { ingredientScenarios, profileNames, remainingNdcs } from "#lib/medication/ingredient-scenarios.ts";

  let {
    summary
  }: {
    /** The item summary whose packages to profile. */
    summary: ItemSummary;
  } = $props();

  /** Moiety rows by default; listing them splits VANCOMYCIN from VANCOMYCIN HCL. */
  let listed = $state(false);
  const scenarios = $derived(ingredientScenarios(summary, { byMoiety: !listed }));
  const mergesSalts = $derived(
    ingredientScenarios(summary).columns.some((entry) => entry.listed.length > 1)
  );
  const unknown = $derived(summary.packageCount - scenarios.ndcs.length - scenarios.incomplete.length);
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  let avoid = $state<string[]>([]);
  const toggle = (key: string) =>
    (avoid = avoid.includes(key) ? avoid.filter((known) => known !== key) : [...avoid, key]);
  const groupNames = $derived(profileNames(scenarios.profiles, summary.labelers));
  const kept = $derived(scenarios.profiles.flatMap((profile, i) => (keeps(profile.has) ? [groupNames[i]] : [])));
  const remaining = $derived(remainingNdcs(scenarios, avoid));
  const names = $derived(new Map(scenarios.columns.map((entry) => [entry.key, entry.name])));
  const keeps = (has: string[]) => !has.some((key) => avoid.includes(key));


  /**
   * Group labels sit above the table, stacked one per line with the first
   * column's on top, each joined to its column by a leader line. Columns stay
   * narrow, and the header is only as tall as the number of groups. Units are rem.
   */
  const COL = 2.25;
  const LINE = 1.15;
  const BEND = 0.45;
  const header = $derived.by(() => {
    const n = scenarios.profiles.length;
    const height = n * LINE + 0.7;
    const labelX = n * COL + 0.6;
    const leaders = scenarios.profiles.map((_, i) => {
      const x = (i + 0.5) * COL;
      const y = (i + 0.5) * LINE + 0.1;
      return { x, y, path: `M${x} ${height} V${y + BEND} L${x + BEND} ${y} H${labelX - 0.25}` };
    });
    return { height, labelX, leaders };
  });
  /** The group whose NDCs are listed under the table. */
  let openGroup = $state<number | null>(null);
</script>

<!-- A single combination leaves nothing to choose between, so there is no table to show. -->
{#if scenarios.profiles.length > 1}
  <section class="scenarios" aria-labelledby="scenarios-heading">
    <h2 id="scenarios-heading">Ingredient scenarios</h2>
    <p class="lede">
      {plural(scenarios.profiles.length, 'combination')} across {plural(scenarios.ndcs.length, 'NDC')}.
      Click an ingredient to avoid it and see which NDCs are left.
      {#if unknown > 0 || scenarios.incomplete.length}<span class="muted"
          >Not shown: {[
            unknown > 0 ? `${plural(unknown, 'NDC')} without ingredient data` : '',
            scenarios.incomplete.length
              ? `${plural(scenarios.incomplete.length, 'NDC')} whose label lists no inactive ingredients`
              : ''
          ]
            .filter(Boolean)
            .join(', ')}.</span
        >{/if}
    </p>
    {#if mergesSalts}
      <label class="listed">
        <input type="checkbox" bind:checked={listed} onchange={() => (avoid = [])} />
        Split actives into listed forms (salts, hydrates)
      </label>
    {/if}
    {#if scenarios.fixed.length}
      <p class="fixed">
        <strong>Excipients always present:</strong>
        {#each scenarios.fixed as entry, i (entry.key)}{#if i}{', '}{/if}<span class:active={entry.kind === 'active'}
            >{entry.name}</span
          >{/each}
      </p>
    {/if}

    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="corner">Ingredient</th>
            <th class="groups" colspan={scenarios.profiles.length} style:height="{header.height}rem">
              <svg
                class="leaders"
                aria-hidden="true"
                width="{header.labelX}rem"
                height="{header.height}rem"
                viewBox="0 0 {header.labelX} {header.height}"
              >
                {#each header.leaders as leader, p (p)}
                  <path d={leader.path} class:dropped={!keeps(scenarios.profiles[p].has)} />
                {/each}
              </svg>
              {#each scenarios.profiles as profile, p (profile.has.join('|'))}
                <button
                  type="button"
                  class="group-label"
                  class:dropped={!keeps(profile.has)}
                  aria-expanded={openGroup === p}
                  style:left="{header.labelX}rem"
                  style:top="{header.leaders[p].y - LINE / 2}rem"
                  style:height="{LINE}rem"
                  title="{groupNames[p]} · {plural(profile.ndcs.length, 'NDC')} (click to list)"
                  onclick={() => (openGroup = openGroup === p ? null : p)}
                ><span class="group">{groupNames[p]}</span><span class="count">{profile.ndcs.length}</span></button>
              {/each}
            </th>
          </tr>
        </thead>
        <tbody>
          {#each scenarios.columns as entry (entry.key)}
            {@const left = remainingNdcs(scenarios, [entry.key]).length}
            <tr>
              <th class="ingredient" class:active={entry.kind === 'active'} scope="row">
                <div class="row-label">
                <button
                  type="button"
                  aria-pressed={avoid.includes(entry.key)}
                  title="{entry.kind === 'active' ? 'Active' : 'Inactive'}{entry.listed.length > 1
                    ? ` (listed as ${entry.listed.join(', ')})`
                    : ''} · avoiding it alone leaves {plural(left, 'NDC')}"
                  onclick={() => toggle(entry.key)}
                >
                  <span class="label">{entry.name}</span>{#if entry.listed.length > 1}<span class="forms"
                      >+{entry.listed.length - 1}</span
                    >{/if}
                </button>
                <span class="left" class:none={left === 0}>{left} left</span>
                </div>
              </th>
              {#each scenarios.profiles as profile (profile.has.join('|'))}
                {@const has = entry.ndcs.includes(profile.ndcs[0])}
                <td class="cell" class:has class:hit={has && avoid.includes(entry.key)} class:dropped={!keeps(profile.has)}>
                  {has ? '●' : ''}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if openGroup !== null && scenarios.profiles[openGroup]}
      <p class="ndc-list">
        <strong>{groupNames[openGroup]}:</strong>
        <span class="mono small">
          {#each scenarios.profiles[openGroup].ndcs as ndc, i (ndc)}{#if i}{', '}{/if}<a href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a
            >{/each}
        </span>
      </p>
    {/if}

    {#if avoid.length}
      <p class="result" class:empty={!remaining.length}>
        Avoiding <strong>{avoid.map((key) => names.get(key)).join(', ')}</strong>
        {#if remaining.length}
          leaves {plural(remaining.length, 'NDC')} of {scenarios.ndcs.length} in
          <strong>{kept.join(', ')}</strong>
        {:else}
          leaves no NDCs.
        {/if}
        <button type="button" class="clear" onclick={() => (avoid = [])}>Clear</button>
      </p>
    {/if}
  </section>
{/if}

<style>
  .scenarios {
    margin-top: 2rem;
    font-size: 0.88rem;
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    color: #5c6777;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  p {
    margin: 0 0 0.5rem;
  }

  .muted,
  .lede {
    color: #5c6777;
  }

  .active {
    font-weight: 650;
  }

  .scroll {
    overflow-x: auto;
  }

  table {
    --rule: #dfe4eb;
    --stripe: #f4f6f9;
    border-collapse: collapse;
  }

  th,
  td {
    border-bottom: 1px solid #e3e7ee;
    padding: 0.3rem 0.45rem;
  }

  .corner {
    text-align: left;
    vertical-align: bottom;
    color: #5c6777;
    font-weight: 500;
  }

  .groups {
    position: relative;
    padding: 0;
    border-bottom: none;
  }

  .leaders {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
  }

  .leaders path {
    fill: none;
    stroke: #9aa4b2;
    stroke-width: 0.06;
  }

  .group-label {
    position: absolute;
    display: flex;
    align-items: center;
    max-width: 18rem;
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-size: 0.78rem;
    color: inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  .group-label:hover .group,
  .group-label[aria-expanded='true'] .group {
    text-decoration: underline;
  }

  /* Less the 1px divider, so columns land exactly COL apart under their leaders. */
  .cell {
    width: calc(2.25rem - 1px);
    min-width: calc(2.25rem - 1px);
    max-width: calc(2.25rem - 1px);
    box-sizing: content-box;
    padding: 0.3rem 0;
    border-left: 1px solid var(--rule);
  }

  .cell:last-child {
    border-right: 1px solid var(--rule);
  }

  .cell:nth-child(even) {
    background: var(--stripe);
  }

  .ndc-list {
    margin-top: 0.5rem;
  }

  /* The ingredient column stays put while the profiles scroll under it; the
     inset shadow stands in for the divider, which scrolls away beneath it. */
  .corner,
  .ingredient {
    position: sticky;
    left: 0;
    z-index: 2;
    background: #fff;
    box-shadow: inset -1px 0 var(--rule);
  }

  .ingredient {
    min-width: 14rem;
    text-align: left;
    font-weight: 400;
  }

  .row-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .ingredient.active {
    font-weight: 650;
  }

  .ingredient button {
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    padding: 0 0.2rem;
    font: inherit;
    font-size: 0.78rem;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .ingredient button:hover {
    border-color: #c9d1dc;
  }

  .ingredient button[aria-pressed='true'] {
    border-color: #e2a29c;
    background: #fdecea;
    color: #a12622;
    text-decoration: line-through;
  }

  .forms {
    margin-left: 0.25rem;
    color: #5c6777;
    font-weight: 400;
  }

  .listed {
    display: block;
    margin: 0 0 0.5rem;
    color: #5c6777;
  }

  .left {
    flex: none;
    color: #5c6777;
    font-size: 0.62rem;
    font-weight: 400;
    white-space: nowrap;
  }

  .left.none {
    color: #a12622;
  }

  .group {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }

  .count {
    flex: none;
    margin-left: 0.35rem;
    border-radius: 999px;
    background: #eef1f5;
    padding: 0 0.4rem;
    color: #5c6777;
    font-size: 0.72rem;
  }

  .cell {
    text-align: center;
    vertical-align: middle;
    color: #9aa4b2;
  }

  .cell.has {
    background: #eef3fb;
    color: #204f91;
  }

  .cell.hit {
    background: #fdecea;
    color: #a12622;
  }

  .ndc-list a {
    white-space: nowrap;
  }

  .dropped {
    opacity: 0.38;
  }

  .result {
    margin-top: 0.75rem;
  }

  .result.empty {
    color: #a12622;
  }

  .clear {
    margin-left: 0.5rem;
    font: inherit;
    font-size: 0.8rem;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .small {
    font-size: 0.8rem;
  }

  a {
    color: #204f91;
  }
</style>
