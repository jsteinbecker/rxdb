<script lang="ts">
  import { enhance } from '$app/forms';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { invalidateAll } from '$app/navigation';
  import AddComponentPanel from '#lib/components/AddComponentPanel.svelte';
  import CompoundLineRow from '#lib/components/CompoundLineRow.svelte';
  import ConstituentPin from '#lib/components/ConstituentPin.svelte';
  import FinalConcentrations from '#lib/components/FinalConcentrations.svelte';
  import QuantityField from '#lib/components/QuantityField.svelte';
  import VialPreparation from '#lib/components/VialPreparation.svelte';
  import {
    applyEdit,
    effectiveTotalVolume,
    finalConcentrations,
    isSafeRational,
    VOLUME_UNIT,
    type Field,
    type Line
  } from "#lib/compounds/compound-builder.ts";
  import { formatRational, serializeRational, type Rational } from "#lib/medication/rational.ts";
  import { INJECTION_ROUTES } from '#lib/labels/reconstitution-terms.ts';
  import MixedFraction from '#lib/components/MixedFraction.svelte';
  import BrandedName from '#lib/components/BrandedName.svelte';
  import { formatNdc } from '#lib/catalog/ndc.ts';
  import { parseRational } from '#lib/medication/rational.ts';
  import { readable, vialCombinations, type Combination } from '#lib/compounds/generic-components.ts';

  let { data, form } = $props();

  const compound = $derived(data.compound);
  const locked = $derived(compound.locked);

  // Editable copies; they restart from the server's whenever it sends new data.
  let lines = $derived<Line[]>(compound.lines);
  let total = $derived<Rational | null>(compound.total);
  let totalText = $derived(compound.total ? formatRational(compound.total) : '');

  // An empty compound opens straight into the search.
  let pickerOpen = $state(!data.compound.lines.length && !data.compound.locked);
  let menuFor = $state<string | null>(null); // 'header' or a slotId
  let saveForm: HTMLFormElement | undefined = $state();
  let payloadInput: HTMLInputElement | undefined = $state();
  let removeForm: HTMLFormElement | undefined = $state();
  let removeSlot: HTMLInputElement | undefined = $state();

  const sum = $derived(effectiveTotalVolume(lines, null));

  // Vials each line can draw on, and the ways its dose can be pulled from them.
  const vialsBySlot = $derived(
    new Map(
      compound.lines.map((line) => [
        line.slotId,
        line.vials.flatMap((vial) => {
          const amount = parseRational(vial.amount);
          return amount ? [{ ...vial, amount }] : [];
        })
      ])
    )
  );
  const proposals = $derived(
    new Map<string, Combination[]>(
      lines.map((line) => {
        const vials = vialsBySlot.get(line.slotId) ?? [];
        return [line.slotId, line.dose && vials.length ? vialCombinations(line.dose, line.doseUnit, vials) : []];
      })
    )
  );
  /** The proposal picked per line; the best one until someone picks another. */
  let chosen = $state<Record<string, number>>({});
  const sameCombination = (proposal: Combination, saved: { packageId: string; count: number }[]) =>
    proposal.picks.length === saved.length &&
    proposal.picks.every((pick) => saved.some((entry) => entry.packageId === pick.packageId && entry.count === pick.count));
  /** The index in use: the one just picked, else the saved pick while it still fits the dose, else the best. */
  const chosenIndex = (slotId: string) => {
    const list = proposals.get(slotId) ?? [];
    if (chosen[slotId] != null && chosen[slotId] < list.length) return chosen[slotId];
    const saved = compound.lines.find((line) => line.slotId === slotId)?.vialCounts ?? [];
    const at = saved.length ? list.findIndex((proposal) => sameCombination(proposal, saved)) : -1;
    return at >= 0 ? at : 0;
  };
  const pickedFor = (slotId: string) => (proposals.get(slotId) ?? [])[chosenIndex(slotId)] ?? null;

  let vialsForm: HTMLFormElement | undefined = $state();
  let vialsSlot: HTMLInputElement | undefined = $state();
  let vialsPicks: HTMLInputElement | undefined = $state();
  let vialsSaving = $state(false);
  /** Defaults already sent, so a refused one is not resent in a loop. */
  const sentDefaults = new Set<string>();
  function sendVials(slotId: string, proposal: Combination) {
    if (!vialsForm || !vialsSlot || !vialsPicks) return;
    vialsSlot.value = slotId;
    vialsPicks.value = JSON.stringify(proposal.picks.map(({ packageId, count }) => ({ packageId, count })));
    vialsSaving = true;
    vialsForm.requestSubmit();
  }
  function choose(slotId: string, index: number) {
    const proposal = proposals.get(slotId)?.[index];
    if (locked || !proposal || vialsSaving) return;
    chosen = { ...chosen, [slotId]: index };
    sendVials(slotId, proposal);
  }
  // The combination shown is the one stored: when a line's saved pick is
  // missing or no longer fits its dose, store the one in use, one line at a
  // time and never while the lines themselves are still saving.
  $effect(() => {
    if (locked || vialsSaving || saving) return;
    for (const line of compound.lines) {
      const pick = pickedFor(line.slotId);
      if (!pick || sameCombination(pick, line.vialCounts ?? [])) continue;
      const key = `${line.slotId}:${JSON.stringify(pick.picks.map(({ packageId, count }) => [packageId, count]))}`;
      if (sentDefaults.has(key)) continue;
      sentDefaults.add(key);
      sendVials(line.slotId, pick);
      return;
    }
  });
  /** Everything to pull from stock, line by line. */
  const pullList = $derived(
    lines.flatMap((line) => {
      const pick = pickedFor(line.slotId);
      const vials = vialsBySlot.get(line.slotId) ?? [];
      return pick
        ? pick.picks.map((entry) => ({
            line,
            count: entry.count,
            amount: entry.amount,
            vial: vials.find((vial) => vial.packageId === entry.packageId)
          }))
        : [];
    })
  );
  const rows = $derived(finalConcentrations(lines, total));
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  // Saves go one at a time: a commit made while one is in flight is sent, as
  // the latest snapshot, when that one lands — so the server always ends on the
  // newest state, whatever order the requests would have arrived in.
  let saving = $state(false);
  let dirty = false;

  function save() {
    if (saving) {
      dirty = true;
      return;
    }
    if (!saveForm || !payloadInput) return;
    const text = (value: Rational | null) => (value ? serializeRational(value) : null);
    payloadInput.value = JSON.stringify({
      total: text(total),
      lines: lines.map((line) => ({
        slotId: line.slotId,
        conc: text(line.conc),
        dose: text(line.dose),
        volume: text(line.volume)
      }))
    });
    saving = true;
    dirty = false;
    saveForm.requestSubmit();
  }

  const serial = (value: Rational | null) => (value ? serializeRational(value) : '');
  /** Per line, the field the builder last solved; null when every value was typed. */
  let calculated = $state<Record<string, Field | null>>({});
  /** Before any edit this visit, a line with all three values reads as conc and dose typed, volume worked out. */
  const calculatedFor = (line: Line): Field | null =>
    line.slotId in calculated
      ? calculated[line.slotId]
      : line.role === 'active' && line.conc && line.dose && line.volume
        ? 'volume'
        : null;
  /** Whether the edit was taken; false when it cannot be held exactly, so the box restores. */
  function commit(slotId: string, field: Field, value: Rational | null): boolean {
    const at = lines.findIndex((line) => line.slotId === slotId);
    if (at < 0 || locked) return false;
    const prev = lines[at];
    const next = applyEdit(prev, field, value);
    if (!next) return false;
    // The field just typed is the user's; the one that moved with it is calculated.
    const solved = (['conc', 'dose', 'volume'] as const).find(
      (key) => key !== field && serial(prev[key]) !== serial(next[key])
    );
    if (solved) calculated = { ...calculated, [slotId]: solved };
    else if (calculatedFor(prev) === field) calculated = { ...calculated, [slotId]: null };
    lines = lines.map((line, index) => (index === at ? next : line));
    save();
    return true;
  }

  function commitTotal(value: Rational | null): boolean {
    if (locked || (value && !isSafeRational(value))) return false;
    total = value;
    save();
    return true;
  }

  function remove(slotId: string) {
    menuFor = null;
    if (!removeForm || !removeSlot) return;
    removeSlot.value = slotId;
    removeForm.requestSubmit();
  }
</script>

<svelte:head>
  <title>{compound.name} · Compounds · RxDB</title>
</svelte:head>

<svelte:window
  onclick={(event) => {
    if (menuFor && !(event.target as Element).closest('.row-menu')) menuFor = null;
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape') menuFor = null;
    // "/" opens the search from anywhere outside a text box.
    const target = event.target;
    const typing = target instanceof Element && target.closest('input, textarea, select, [contenteditable]');
    if (event.key === '/' && !locked && !typing) {
      event.preventDefault();
      pickerOpen = true;
    }
  }}
/>

<main>
  <PageHeader compact>
    {#snippet title()}
      <div class="titlebar">
        <h1 title="Named automatically from its components">{compound.name}</h1>
        <span class="count">{plural(compound.lines.length, 'component')}</span>
        {#if locked}<span class="badge">Finalized</span>{/if}
        {#if locked}
          <span class="route">Route <strong>{compound.route ?? '—'}</strong></span>
        {:else}
          <form method="POST" action="?/setRoute" use:enhance class="route">
            <label>
              Route
              <select
                name="route"
                required
                class:unset={!compound.route}
                value={compound.route ?? ''}
                onchange={(event) => event.currentTarget.form?.requestSubmit()}
              >
                <option value="" disabled>Choose…</option>
                {#each INJECTION_ROUTES as route}<option value={route}>{route}</option>{/each}
              </select>
            </label>
          </form>
        {/if}

        <div class="actions">
          {#if locked}
            <form method="POST" action="?/setSaved" use:enhance>
              <input type="hidden" name="saved" value="false" />
              <button title="Reopen this compound so it can be changed">Unlock to edit</button>
            </form>
          {:else}
            <button type="button" onclick={() => (pickerOpen = !pickerOpen)}>
              {pickerOpen ? '× Done adding' : '+ Component'}
            </button>
            <form method="POST" action="?/setSaved" use:enhance>
              <input type="hidden" name="saved" value="true" />
              <button
                class="primary"
                disabled={!compound.lines.length || !compound.route}
                title={compound.route ? 'Lock this compound as finished; edits already save automatically' : 'Choose a route first'}>Finalize</button
              >
            </form>
            <div class="row-menu" class:open={menuFor === 'header'}>
              <button
                type="button"
                class="menu-trigger"
                aria-label="Compound options"
                aria-haspopup="menu"
                aria-expanded={menuFor === 'header'}
                onclick={() => (menuFor = menuFor === 'header' ? null : 'header')}>⋯</button
              >
              {#if menuFor === 'header'}
                <div class="menu" role="menu">
                  <form
                    method="POST"
                    action="?/delete"
                    use:enhance={({ cancel }) => {
                      if (!confirm(`Delete "${compound.name}" and its components?`)) cancel();
                    }}
                  >
                    <button role="menuitem">Delete compound</button>
                  </form>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/snippet}
    {#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
  </PageHeader>

  {#if pickerOpen && !locked}
    <AddComponentPanel
      candidates={data.candidates}
      used={compound.lines.flatMap((line) => line.packageIds)}
      route={compound.route}
      unplaced={data.unplaced}
      onclose={() => (pickerOpen = false)}
    />
  {/if}

  <!-- Hidden helpers: one form saves every line, one removes a component. -->
  <form
    bind:this={saveForm}
    method="POST"
    action="?/saveLines"
    use:enhance={() =>
      async ({ result, update }) => {
        await update({ reset: false, invalidateAll: false });
        saving = false;
        // A refused save (locked or deleted elsewhere) means the page is stale: reload it.
        if (result.type !== 'success') await invalidateAll();
        else if (dirty) save();
      }}
    hidden
  >
    <input bind:this={payloadInput} type="hidden" name="payload" />
  </form>
  <form bind:this={vialsForm} method="POST" action="?/setVials" use:enhance={() => async ({ update }) => {
      await update({ reset: false });
      vialsSaving = false;
    }} hidden>
    <input bind:this={vialsSlot} type="hidden" name="slotId" />
    <input bind:this={vialsPicks} type="hidden" name="picks" />
  </form>
  <form bind:this={removeForm} method="POST" action="?/remove" use:enhance hidden>
    <input bind:this={removeSlot} type="hidden" name="slotId" />
  </form>

  {#if !compound.lines.length}
    <p class="empty">
      No components yet. Search above for a drug, then enter its dose; the builder proposes which vials to pull.
    </p>
  {:else}
    <section class="card" aria-labelledby="components-heading">
      <header class="card-head">
        <h2 id="components-heading">Components</h2>
        <span>{plural(lines.length, 'line')} · {locked ? 'finalized, read-only' : 'changes save automatically'}</span>
      </header>
      <div class="table" role="table" aria-labelledby="components-heading">
        <div class="cols" role="row">
          <span role="columnheader">Component</span>
          <span role="columnheader">Concentration</span>
          <span role="columnheader">Dose</span>
          <span role="columnheader">Volume</span>
          <span role="columnheader"><span class="sr-only">Options</span></span>
        </div>
        {#each lines as line (line.slotId)}
          <CompoundLineRow
            {line}
            {locked}
            menuOpen={menuFor === line.slotId}
            oncommit={(field, value) => commit(line.slotId, field, value)}
            ontoggleMenu={() => (menuFor = menuFor === line.slotId ? null : line.slotId)}
            onremove={() => remove(line.slotId)}
            vialCount={new Set((vialsBySlot.get(line.slotId) ?? []).map((vial) => `${vial.amount.n}/${vial.amount.d}`)).size}
            proposals={proposals.get(line.slotId) ?? []}
            chosen={chosenIndex(line.slotId)}
            calculated={calculatedFor(line)}
            onchoose={(index) => choose(line.slotId, index)}
          />
          {@const stored = compound.lines.find((entry) => entry.slotId === line.slotId)}
          {#if stored?.component && stored.pinOptions.length}
            <ConstituentPin
              slotId={line.slotId}
              label={stored.label}
              options={stored.pinOptions}
              formularyItemId={stored.formularyItemId}
              restriction={stored.restriction}
              {locked}
            />
          {/if}
        {/each}
        <div class="totals" role="row">
          <span class="summary" role="cell">
            {sum ? `${formatRational(sum)} ${VOLUME_UNIT} from components` : 'Enter volumes to total them'}
          </span>
          <span class="total-cell" role="cell">
            <span class="caption">Total volume</span>
            {#if locked}
              <strong>{total ? formatRational(total) : sum ? formatRational(sum) : '—'} {VOLUME_UNIT}</strong>
            {:else}
              <span class="total-entry affix">
                <QuantityField
                  bind:value={totalText}
                  unit={VOLUME_UNIT}
                  variant="field"
                  showUnit={false}
                  exclusiveMin
                  min={0}
                  ariaLabel="Total volume"
                  placeholder={sum ? formatRational(sum) : '0'}
                  oncommit={(quantity) =>
                    !quantity && totalText.trim()
                      ? (totalText = total ? formatRational(total) : '')
                      : commitTotal(quantity?.rational ?? null) ||
                        (totalText = total ? formatRational(total) : '')}
                />
                <span class="unit" aria-hidden="true">{VOLUME_UNIT}</span>
              </span>
            {/if}
          </span>
        </div>
      </div>
    </section>

    {#if pullList.length}
      <section class="card pull" aria-labelledby="pull-heading">
        <header class="card-head">
          <h2 id="pull-heading">Pull from stock</h2>
          <span>{plural(pullList.reduce((count, entry) => count + entry.count, 0), 'vial')}</span>
        </header>
        <ul>
          {#each pullList as entry}
            <li>
              <strong class="qty">{entry.count} ×</strong>
              <span class="what">
                <MixedFraction {...readable(entry.amount, entry.line.doseUnit)} />
                {#if entry.vial}<span class="muted"><BrandedName text={entry.vial.title} /> · {formatNdc(entry.vial.ndc)}</span>{/if}
              </span>
              <span class="for">for {entry.line.label}</span>
            </li>
          {/each}
        </ul>
        <p class="footnote">Any equivalent vial of the same strength on the formulary may be used.</p>
      </section>
    {/if}

    <VialPreparation items={data.vialPrep} {locked} route={compound.route} />

    <FinalConcentrations {rows} />
  {/if}
</main>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .count {
    color: #5c6777;
    font-size: 0.9rem;
  }
  .badge {
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    background: #e6f2ea;
    color: #1f6b3a;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-left: auto;
  }
  .actions button:not(.menu-trigger) {
    padding: 0.45rem 0.85rem;
    border: 1px solid #c9d1dc;
    border-radius: 8px;
    background: #fff;
    font: inherit;
    cursor: pointer;
  }
  .actions button.primary {
    border-color: #3464a5;
    background: #3464a5;
    color: #fff;
    font-weight: 650;
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .notice {
    color: #a3282a;
  }
  .empty {
    margin: 2rem 0;
    color: #5c6777;
  }
  .card {
    --compound-cols: minmax(14rem, 1.6fr) minmax(10rem, 1fr) minmax(9rem, 1fr) minmax(9rem, 1fr) 3rem;
    margin: 1rem 0;
    border: 1px solid #dfe3ec;
    border-left: 4px solid #4b45a8;
    border-radius: 10px;
    background: #fff;
    overflow: visible;
  }
  .route {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: #6b7585;
    font-size: 0.85rem;
  }
  .pull ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pull li {
    display: grid;
    grid-template-columns: 3.5rem 1fr auto;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.55rem 1rem;
    border-top: 1px solid #eef1f5;
  }
  .pull .qty {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .pull .what {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    font-weight: 600;
  }
  .pull .muted,
  .pull .for,
  .footnote {
    color: #7a8494;
    font-size: 0.82rem;
    font-weight: 400;
  }
  .footnote {
    margin: 0;
    padding: 0.5rem 1rem 0.7rem;
  }
  .affix {
    position: relative;
  }
  .affix :global(input) {
    padding-right: 2.6rem !important;
  }
  .affix .unit {
    position: absolute;
    right: 0.6rem;
    pointer-events: none;
  }
  .route select.unset {
    border-color: #c0392b;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    gap: 0.9rem;
    padding: 0.75rem 1rem;
    background: #f7f7fc;
    border-bottom: 1px solid #e3e7ee;
    border-radius: 6px 10px 0 0;
  }
  .card-head h2 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 750;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #2a2f3a;
  }
  .card-head span {
    color: #7a8494;
    font-size: 0.9rem;
  }
  .cols {
    display: grid;
    grid-template-columns: var(--compound-cols);
  }
  .cols > span {
    padding: 0.55rem 1rem;
    border-left: 1px solid #e3e7ee;
    color: #6b7585;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .cols > span:first-child {
    border-left: 0;
  }
  .totals {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.8rem 1rem;
    border-top: 1px solid #e3e7ee;
    background: #f1f1f8;
    border-radius: 0 0 10px 6px;
  }
  .summary {
    color: #6b7585;
    font-size: 0.85rem;
  }
  .total-cell {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .total-cell .caption {
    color: #4b45a8;
  }
  .total-entry {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .totals :global(.entry) {
    min-width: 6rem;
    height: 2.4rem;
  }
  .totals :global(input) {
    text-align: right;
    border: 1px solid #c9d1dc;
    border-radius: 8px;
    background: #fff;
    padding: 0 0.6rem;
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  @media (max-width: 720px) {
    .cols {
      display: none;
    }
  }
  .caption {
    color: #5c6777;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .unit {
    color: #5c6777;
    font-size: 0.8rem;
  }
  .row-menu {
    position: relative;
  }
  .menu-trigger {
    border: 0;
    background: transparent;
    font-size: 1.3rem;
    line-height: 1;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    cursor: pointer;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 5;
    min-width: 11rem;
    padding: 0.25rem;
    border: 1px solid #c9d1dc;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: 0;
    background: transparent;
    text-align: left;
    font: inherit;
    color: #a3282a;
    cursor: pointer;
    border-radius: 6px;
  }
  .menu button:hover {
    background: #fbeeee;
  }
</style>
