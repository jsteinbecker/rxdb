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
            {#each scenarios.profiles as profile, p (profile.has.join('|'))}
              <th class="profile" class:dropped={!keeps(profile.has)}>
                <details>
                  <summary title={groupNames[p]}><span class="group">{groupNames[p]}</span><span class="count">{profile.ndcs.length}</span></summary>
                  <span class="mono small">
                    {#each profile.ndcs as ndc, i (ndc)}{#if i}{', '}{/if}<a href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a
                      >{/each}
                  </span>
                </details>
              </th>
            {/each}
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
        <tfoot>
          <tr>
            <th class="corner avoids-label" scope="row">Avoids</th>
            {#each scenarios.profiles as profile (profile.has.join('|'))}
              <td class="avoids" class:dropped={!keeps(profile.has)} title={profile.avoids.map((key) => names.get(key)).join(', ')}>
                {#if profile.avoids.length}
                  <strong>{profile.avoids.length}</strong>
                  <span class="small">{profile.avoids.map((key) => names.get(key)).join(', ')}</span>
                {:else}<span class="muted">nothing</span>{/if}
              </td>
            {/each}
          </tr>
        </tfoot>
      </table>
    </div>

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

  /* One column per profile; long group names ellipsize (full name in the tooltip). */
  .profile {
    width: 9rem;
    min-width: 9rem;
    max-width: 9rem;
    overflow: hidden;
    vertical-align: bottom;
    text-align: left;
    font-size: 0.78rem;
    font-weight: 400;
  }

  .profile,
  .cell,
  td.avoids {
    border-left: 1px solid var(--rule);
  }

  .profile:nth-child(even),
  .cell:nth-child(even),
  td.avoids:nth-child(even) {
    background: var(--stripe);
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

  .profile summary {
    display: flex;
    align-items: baseline;
    cursor: pointer;
    white-space: nowrap;
  }

  /* display: flex drops the disclosure marker; put it back. */
  .profile summary::before {
    content: '▸';
    flex: none;
    margin-right: 0.3rem;
    color: #8792a2;
    font-size: 0.7em;
  }

  .profile details[open] summary::before {
    content: '▾';
  }

  .profile summary::-webkit-details-marker {
    display: none;
  }

  .profile details[open] summary {
    margin-bottom: 0.2rem;
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

  .profile a {
    white-space: nowrap;
  }

  td.avoids {
    max-width: 9rem;
    vertical-align: top;
    color: #2c6b3f;
  }

  td.avoids .small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
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
