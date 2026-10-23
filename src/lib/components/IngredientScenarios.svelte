<!--
@component
"Ingredient scenarios" for a formulary item: which ingredient profiles (active
ingredients and excipients) its packages fall into, as a matrix of profiles against
ingredients. Ticking ingredients to avoid shows which NDCs remain. Columns merge salts
into their moiety unless listed separately.
-->
<script lang="ts">
  import type { ItemSummary } from "$lib/formulary/item-summary";
  import { formatNdc } from "$lib/catalog/ndc";
  import { ingredientScenarios, profileNames, remainingNdcs } from "$lib/medication/ingredient-scenarios";

  let {
    summary
  }: {
    /** The item summary whose packages to profile. */
    summary: ItemSummary;
  } = $props();

  /** Moiety columns by default; listing them splits VANCOMYCIN from VANCOMYCIN HCL. */
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
   * Slanted labels get two lines. The header rises (from --rise's 6rem up to
   * 9rem) until every label fits in two; past that, labels clamp with an
   * ellipsis and carry their full name in the tooltip. Widths are estimated
   * from glyph classes so the header lays out the same on the server.
   */
  const RISES = [6, 6.5, 7, 7.5, 8, 8.5, 9];
  const glyph = (c: string) => (c === ' ' ? 0.28 : /[A-Z0-9]/.test(c) ? 0.68 : 0.55);
  const textEm = (text: string) => [...text].reduce((sum, c) => sum + glyph(c), 0);
  const labelText = (entry: { name: string; listed: string[] }) =>
    entry.listed.length > 1 ? `${entry.name} +${entry.listed.length - 1}` : entry.name;
  /** Lines a greedy wrap takes at `width` em, breaking words that overflow alone. */
  function lineCount(text: string, width: number): number {
    let lines = 1;
    let used = 0;
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const w = textEm(word);
      const gap = used ? glyph(' ') : 0;
      if (used + gap + w <= width) {
        used += gap + w;
        continue;
      }
      if (used) lines++;
      lines += Math.ceil(w / width) - 1;
      used = w % width || width;
    }
    return lines;
  }
  /**
   * .slant is rise·√2 − 0.6rem long, less its padding and the button's; in em of the 0.68rem label.
   */
  const labelEm = (rise: number) => (rise * Math.SQRT2 - 0.6 - 0.45 - 0.5) / 0.68;
  const fitsAt = (text: string, rise: number) => lineCount(text, labelEm(rise)) <= 2;
  const rise = $derived(
    RISES.find((r) => scenarios.columns.every((entry) => fitsAt(labelText(entry), r))) ?? RISES[RISES.length - 1]
  );
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
      <table style:--rise="{rise}rem">
        <thead>
          <tr>
            <th class="corner">NDCs</th>
            {#each scenarios.columns as entry (entry.key)}
              {@const left = remainingNdcs(scenarios, [entry.key]).length}
              <th class="ingredient" class:active={entry.kind === 'active'}>
                <div class="band" aria-hidden="true"></div>
                <div class="slant">
                  <button
                    type="button"
                    aria-pressed={avoid.includes(entry.key)}
                    title="{fitsAt(labelText(entry), rise) ? '' : `${labelText(entry)} · `}{entry.kind === 'active' ? 'Active' : 'Inactive'}{entry.listed.length > 1
                      ? ` (listed as ${entry.listed.join(', ')})`
                      : ''} · avoiding it alone leaves {plural(left, 'NDC')}"
                    onclick={() => toggle(entry.key)}
                  >
                    <span class="label">{entry.name}</span>{#if entry.listed.length > 1}<span class="forms"
                        >+{entry.listed.length - 1}</span
                      >{/if}
                  </button>
                </div>
                <span class="left" class:none={left === 0}>{left} left</span>
              </th>
            {/each}
            <th class="avoids">Avoids</th>
          </tr>
        </thead>
        <tbody>
          {#each scenarios.profiles as profile, p (profile.has.join('|'))}
            <tr class:dropped={!keeps(profile.has)}>
              <td class="ndcs">
                <details>
                  <summary title={groupNames[p]}><span class="group">{groupNames[p]}</span><span class="count">{profile.ndcs.length}</span></summary>
                  <span class="mono small">
                    {#each profile.ndcs as ndc, i (ndc)}{#if i}{', '}{/if}<a href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a
                      >{/each}
                  </span>
                </details>
              </td>
              {#each scenarios.columns as entry (entry.key)}
                {@const has = entry.ndcs.includes(profile.ndcs[0])}
                <td class="cell" class:has class:hit={has && avoid.includes(entry.key)}>
                  {has ? '●' : ''}
                </td>
              {/each}
              <td class="avoids" title={profile.avoids.map((key) => names.get(key)).join(', ')}>
                {#if profile.avoids.length}
                  <strong>{profile.avoids.length}</strong>
                  <span class="small">{profile.avoids.map((key) => names.get(key)).join(', ')}</span>
                {:else}<span class="muted">nothing</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
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
    border-collapse: collapse;
  }

  th,
  td {
    border-bottom: 1px solid #e3e7ee;
    padding: 0.3rem 0.45rem;
    vertical-align: bottom;
  }

  .corner,
  th.avoids {
    text-align: left;
    color: #5c6777;
    font-weight: 500;
  }

  /* Header geometry: a column is --col wide; its label sits above a --foot
     strip holding the "N left" count. */
  table {
    --col: 2.5rem;
    --foot: 1.2rem;
    --rise: 6rem;
    --rule: #dfe4eb;
    --stripe: #f4f6f9;
  }

  .ingredient {
    position: relative;
    width: var(--col);
    min-width: var(--col);
    height: calc(var(--foot) + var(--rise) + 0.5rem);
    padding: 0;
  }

  /* The column's band, sheared to 45°: its left edge carries the column
     divider up out of the body and along the label, and its fill carries the
     column's stripe. Shearing keeps the bottom edge flat, so it meets the
     vertical divider below without a seam. */
  .band {
    position: absolute;
    left: 0;
    bottom: var(--foot);
    width: var(--col);
    height: var(--rise);
    border-left: 1px solid var(--rule);
    box-sizing: border-box;
    transform: skewX(-45deg);
    transform-origin: bottom left;
  }

  .ingredient:has(+ th.avoids) .band {
    border-right: 1px solid var(--rule);
  }

  /* The label runs up the middle of its band. */
  .slant {
    position: absolute;
    left: calc(var(--col) / 2);
    bottom: calc(var(--foot) - 0.7rem);
    display: flex;
    align-items: center;
    width: calc(var(--rise) * 1.41 - 0.6rem);
    height: 1.4rem;
    padding-left: 0.45rem;
    box-sizing: border-box;
    transform: rotate(-45deg);
    transform-origin: 0 50%;
    text-align: left;
  }

  .ingredient button {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    padding: 0 0.2rem;
    font: inherit;
    font-size: 0.68rem;
    /* Tighter than the ~1.75rem between neighbouring slanted labels, so a
       wrapped label reads as one label, not two. */
    line-height: 1;
    overflow-wrap: anywhere;
    font-weight: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .ingredient button:hover {
    border-color: #c9d1dc;
  }

  .ingredient .slant button[aria-pressed='true'] {
    border-color: #e2a29c;
    background: #fdecea;
    color: #a12622;
    text-decoration: line-through;
  }

  /* Dividers and stripes run unbroken from the body, through the count
     strip, and up each band. */
  .cell,
  td.avoids,
  th.avoids,
  .left {
    border-left: 1px solid var(--rule);
  }

  .cell:nth-child(even),
  .ingredient:nth-child(even) .left,
  .ingredient:nth-child(even) .band {
    background: var(--stripe);
  }

  /* The group column stays put while the ingredients scroll under it; the
     inset shadow stands in for the divider, which scrolls away beneath it. */
  .corner,
  .ndcs {
    position: sticky;
    left: 0;
    z-index: 2;
    background: #fff;
    box-shadow: inset -1px 0 var(--rule);
  }

  tbody tr:nth-child(even) .ndcs,
  tbody tr:nth-child(even) td.avoids {
    background: #fafbfc;
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
    position: absolute;
    inset: auto 0 0 0;
    height: var(--foot);
    line-height: var(--foot);
    text-align: center;
    color: #5c6777;
    font-size: 0.62rem;
    font-weight: 400;
    white-space: nowrap;
  }

  .left.none {
    color: #a12622;
  }

  /* A hard width: long group names ellipsize (full name in the tooltip)
     instead of pushing under the sticky edge into the ingredient cells. */
  .ndcs {
    width: 14rem;
    min-width: 14rem;
    max-width: 14rem;
    overflow: hidden;
    vertical-align: top;
    font-size: 0.78rem;
  }

  .ndcs summary {
    display: flex;
    align-items: baseline;
    cursor: pointer;
    white-space: nowrap;
  }

  /* display: flex drops the disclosure marker; put it back. */
  .ndcs summary::before {
    content: '▸';
    flex: none;
    margin-right: 0.3rem;
    color: #8792a2;
    font-size: 0.7em;
  }

  .ndcs details[open] summary::before {
    content: '▾';
  }

  .ndcs summary::-webkit-details-marker {
    display: none;
  }

  .group {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .count {
    flex: none;
  }

  .ndcs details[open] summary {
    margin-bottom: 0.2rem;
  }

  .group {
    font-weight: 600;
  }

  .count {
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

  .ndcs a {
    white-space: nowrap;
  }

  td.avoids .small {
    display: inline-block;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }

  td.avoids {
    white-space: nowrap;
    vertical-align: top;
    color: #2c6b3f;
  }

  tr.dropped {
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
