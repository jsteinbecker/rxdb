<script lang="ts">
  import { enhance } from '$app/forms';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import AddComponentPanel from '$lib/components/AddComponentPanel.svelte';
  import CompoundLineRow from '$lib/components/CompoundLineRow.svelte';
  import FinalConcentrations from '$lib/components/FinalConcentrations.svelte';
  import QuantityField from '$lib/components/QuantityField.svelte';
  import {
    applyEdit,
    effectiveTotalVolume,
    finalConcentrations,
    isSafeRational,
    VOLUME_UNIT,
    type Field,
    type Line
  } from '$lib/compound-builder';
  import { formatRational, serializeRational, type Rational } from '$lib/rational';

  let { data, form } = $props();

  const compound = $derived(data.compound);
  const locked = $derived(compound.locked);

  // Editable copies; they restart from the server's whenever it sends new data.
  let lines = $derived<Line[]>(compound.lines);
  let total = $derived<Rational | null>(compound.total);
  let totalText = $derived(compound.total ? formatRational(compound.total) : '');

  let pickerOpen = $state(false);
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
  onkeydown={(event) => event.key === 'Escape' && (menuFor = null)}
/>

<main>
  <PageHeader compact>
    {#snippet eyebrow()}
      <a href={resolve('/')}>RxDB</a> / <a href={resolve('/compounds')}>Compounds</a> /
      {data.scope.name}
    {/snippet}
    {#snippet title()}
      <div class="titlebar">
        <h1 title="Named automatically from its components">{compound.name}</h1>
        <span class="count">{plural(compound.lines.length, 'component')}</span>
        {#if locked}<span class="badge">Saved</span>{/if}

        <div class="actions">
          {#if locked}
            <form method="POST" action="?/setSaved" use:enhance>
              <input type="hidden" name="saved" value="false" />
              <button>Edit</button>
            </form>
          {:else}
            <button type="button" onclick={() => (pickerOpen = !pickerOpen)}>
              {pickerOpen ? '× Close' : '+ Component'}
            </button>
            <form method="POST" action="?/setSaved" use:enhance>
              <input type="hidden" name="saved" value="true" />
              <button class="primary" disabled={!compound.lines.length}>Save</button>
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
    <AddComponentPanel candidates={data.candidates} />
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
      No components yet — use <b>+ Component</b> to search the formulary and add the exact package.
    </p>
  {:else}
    <section aria-label="Components">
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
    </section>

    <div class="totals">
      <span class="caption">Total volume</span>
      {#if locked}
        <strong>{total ? formatRational(total) : sum ? formatRational(sum) : '—'} {VOLUME_UNIT}</strong>
      {:else}
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
      {/if}
    </div>

    <FinalConcentrations {rows} />
  {/if}
</main>

<style>
  main {
    max-width: 880px;
    margin: 0 auto;
    padding: 3rem 1.5rem 5rem;
  }
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
  .totals {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.9rem 0;
    border-bottom: 1px solid #e3e7ee;
  }
  .totals :global(.entry) {
    min-width: 5rem;
    height: 2rem;
  }
  .totals :global(input) {
    text-align: right;
    border: 1px solid #c9d1dc;
    border-radius: 6px;
    padding: 0 0.4rem;
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
