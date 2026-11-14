<script lang="ts">
  import { enhance } from '$app/forms';
  import PageHeader from '#lib/components/PageHeader.svelte';
  import { invalidateAll } from '$app/navigation';
  import AddComponentPanel from '#lib/components/AddComponentPanel.svelte';
  import CompoundLineRow from '#lib/components/CompoundLineRow.svelte';
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
  const rows = $derived(finalConcentrations(lines, total));
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  // Saves go one at a time: a commit made while one is in flight is sent, as
  // the latest snapshot, when that one lands — so the server always ends on the
  // newest state, whatever order the requests would have arrived in.
  let saving = false;
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

  /** Whether the edit was taken; false when it cannot be held exactly, so the box restores. */
  function commit(slotId: string, field: Field, value: Rational | null): boolean {
    const at = lines.findIndex((line) => line.slotId === slotId);
    if (at < 0 || locked) return false;
    const next = applyEdit(lines[at], field, value);
    if (!next) return false;
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
        {#if locked}<span class="badge">Saved</span>{/if}
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
              <button>Edit</button>
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
                title={compound.route ? undefined : 'Choose a route first'}>Save</button
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
      used={compound.lines.map((line) => line.packageId)}
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
  <form bind:this={removeForm} method="POST" action="?/remove" use:enhance hidden>
    <input bind:this={removeSlot} type="hidden" name="slotId" />
  </form>

  {#if !compound.lines.length}
    <p class="empty">
      No components yet — search above for a formulary item; its preferred package is added.
    </p>
  {:else}
    <section class="card" aria-labelledby="components-heading">
      <header class="card-head">
        <h2 id="components-heading">Components</h2>
        <span>{plural(lines.length, 'line')} · {locked ? 'saved' : 'editing'}</span>
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
          />
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
              <span class="total-entry">
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
                <span class="unit">{VOLUME_UNIT}</span>
              </span>
            {/if}
          </span>
        </div>
      </div>
    </section>

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
