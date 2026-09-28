<script lang="ts">
  import { untrack } from 'svelte';
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { StagedPackage } from '$lib/server/catalog-sync';
  import SplLabelSections from './SplLabelSections.svelte';
  import OverrideCitation from './OverrideCitation.svelte';
  import QuantityField from './QuantityField.svelte';
  import { quantityDecimal, type Quantity } from '$lib/quantity';
  import {
    overrideChoices,
    overrideCurrentValue,
    overrideQuantity,
    overrideTargets,
    type EquivalentPackage
  } from '$lib/property-override-fields';

  let {
    item,
    keys,
    equivalents = [],
    onclose
  }: {
    item: StagedPackage;
    keys: string[];
    /** Packages whose values may stand in for this one's. */
    equivalents?: EquivalentPackage[];
    onclose: () => void;
  } = $props();

  let panel: HTMLElement;
  // The editing row fixes `keys` for this panel's lifetime (the page re-keys it).
  // svelte-ignore state_referenced_locally
  let overrideKey = $state(keys[0]);
  let overrideValue = $state('');
  let sectionKey = $state('');
  let excerpt = $state('');
  let subsectionTitle = $state('');
  let startOffset = $state(0);
  let endOffset = $state(0);
  const hasSpl = $derived(!!item.splSetId && !!item.details?.label?.sections.length);
  // svelte-ignore state_referenced_locally
  let source = $state<'spl' | 'url' | 'ndc'>(hasSpl ? 'spl' : 'url');
  let url = $state('');
  let urlTitle = $state('');
  let urlExcerpt = $state('');
  let equivalentNdc = $state('');
  let overrideMessage = $state('');
  let savingOverride = $state(false);

  const fields = $derived(overrideTargets(item).filter((field) => keys.includes(field.key)));
  const field = $derived(fields.find((candidate) => candidate.key === overrideKey));
  const existing = $derived(item.propertyOverrides?.[overrideKey]);
  const current = $derived(overrideCurrentValue(item, overrideKey));
  const choices = $derived(overrideChoices(overrideKey));
  const quantitySpec = $derived(overrideQuantity(overrideKey, item));
  let quantity = $state<Quantity | null>(null);
  // Numbers are stored as decimals in the field's unit, however they were typed.
  const submittedValue = $derived(
    quantitySpec && quantity ? quantityDecimal(quantity) : overrideValue
  );
  const sections = $derived(item.details?.label?.sections ?? []);
  const candidates = $derived(
    equivalents.filter((equivalent) => equivalent.values[overrideKey] != null)
  );
  const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
  const ready = $derived(
    !!overrideValue.trim() &&
      (!quantitySpec || !!quantity) &&
      (source === 'spl'
        ? !!excerpt && !!sectionKey
        : source === 'url'
          ? !!url.trim() && !!urlExcerpt.trim()
          : !!equivalentNdc)
  );

  $effect(() => {
    // Start from what the page shows whenever the property changes.
    const key = overrideKey;
    overrideValue = untrack(() => overrideCurrentValue(item, key)) ?? '';
    equivalentNdc = '';
    overrideMessage = '';
  });

  // Beside the details it stays in view; stacked above them (narrow screens)
  // it may open off-screen from the pencil that opened it.
  $effect(() => {
    const { top } = panel.getBoundingClientRect();
    if (top < 0 || top > window.innerHeight - 120) panel.scrollIntoView({ block: 'start' });
  });

  function captureExcerpt() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    const anchor = selection.anchorNode?.parentElement?.closest('[data-spl-section]');
    const focus = selection.focusNode?.parentElement?.closest('[data-spl-section]');
    if (anchor && anchor === focus && panel.contains(anchor) && text) {
      sectionKey = anchor.getAttribute('data-spl-section') ?? '';
      excerpt = text;
      const before = range.cloneRange();
      before.selectNodeContents(anchor);
      before.setEnd(range.startContainer, range.startOffset);
      startOffset = before.toString().length;
      endOffset = startOffset + range.toString().length;
      subsectionTitle = '';
      for (const heading of anchor.querySelectorAll('.heading')) {
        if (range.comparePoint(heading, 0) === -1)
          subsectionTitle = heading.textContent?.trim() ?? '';
      }
    }
  }

  async function saveOverride() {
    savingOverride = true;
    overrideMessage = '';
    const form = new FormData();
    form.set('key', overrideKey);
    form.set('value', submittedValue);
    form.set('source', source);
    if (source === 'spl') {
      form.set('sectionKey', sectionKey);
      form.set('excerpt', excerpt);
      form.set('subsectionTitle', subsectionTitle);
      form.set('startOffset', String(startOffset));
      form.set('endOffset', String(endOffset));
    } else if (source === 'url') {
      form.set('url', url);
      form.set('title', urlTitle);
      form.set('excerpt', urlExcerpt);
    } else form.set('ndc', equivalentNdc);
    try {
      const response = await fetch('?/override', { method: 'POST', body: form });
      const result = deserialize(await response.text());
      if (result.type === 'success') {
        await invalidateAll();
        onclose();
      } else
        overrideMessage =
          result.type === 'failure'
            ? String(result.data?.message ?? 'Could not save override.')
            : 'Could not save override.';
    } catch {
      overrideMessage = 'Could not save override.';
    } finally {
      savingOverride = false;
    }
  }
</script>

<aside bind:this={panel} aria-labelledby="override-title">
  <div class="panel-head">
    <h2 id="override-title">{field?.label ?? overrideKey}</h2>
    <button class="close" type="button" aria-label="Close" onclick={onclose}>×</button>
  </div>
  {#if fields.length > 1}
    <div class="field-tabs" role="tablist">
      {#each fields as candidate (candidate.key)}
        <button
          type="button"
          role="tab"
          aria-selected={candidate.key === overrideKey}
          onclick={() => (overrideKey = candidate.key)}>{candidate.label}</button
        >
      {/each}
    </div>
  {/if}
  <dl class="field-details">
    <dt>Field</dt>
    <dd class="mono">{overrideKey}</dd>
    <dt>Current value</dt>
    <dd>{current ?? '—'}</dd>
    {#if existing}
      <dt>Overridden</dt>
      <dd>
        {existing.value}
        <span class="quote"><OverrideCitation override={existing} /></span>
      </dd>
    {/if}
  </dl>
  <label
    >Correct value
    {#if choices}
      <select bind:value={overrideValue} disabled={source === 'ndc'}
        ><option value="">Choose…</option>{#each choices as choice (choice)}<option value={choice}
            >{choice}</option
          >{/each}</select
      >
    {:else if quantitySpec}
      <QuantityField
        bind:value={overrideValue}
        bind:quantity
        unit={quantitySpec.unit}
        integer={quantitySpec.integer}
        min={quantitySpec.min}
        exclusiveMin={quantitySpec.exclusiveMin}
        readonly={source === 'ndc'}
        placeholder={quantitySpec.unit
          ? `In ${quantitySpec.unit}, or another unit (e.g. 131 11/19, 1.5 g)`
          : quantitySpec.integer
            ? 'Enter a whole number'
            : 'Enter a number'}
      />
    {:else}
      <input bind:value={overrideValue} readonly={source === 'ndc'} maxlength="500" />
    {/if}
  </label>
  <div class="source-tabs" role="tablist" aria-label="Cite">
    <span>Cite</span>
    <button
      type="button"
      role="tab"
      aria-selected={source === 'spl'}
      disabled={!hasSpl}
      title={hasSpl ? undefined : 'No SPL label for this package.'}
      onclick={() => (source = 'spl')}>This SPL</button
    ><button
      type="button"
      role="tab"
      aria-selected={source === 'url'}
      onclick={() => (source = 'url')}>Outside source</button
    ><button
      type="button"
      role="tab"
      aria-selected={source === 'ndc'}
      onclick={() => (source = 'ndc')}>Equivalent NDC ({candidates.length})</button
    >
  </div>
  {#if source === 'spl'}
    <p class="hint">Expand a section and highlight the SPL text that supports the correction.</p>
    <div class="label-picker" onmouseup={captureExcerpt} role="presentation">
      <SplLabelSections {sections} />
    </div>
    {#if excerpt}<p class="selected-excerpt">
        <b>Selected excerpt:</b> <mark>{excerpt}</mark>
      </p>{/if}
    {#if sectionKey}<p class="source-note">
        From {sections.find((section) => section.key === sectionKey)?.title}{subsectionTitle
          ? ` › ${subsectionTitle}`
          : ''} · SPL {item.splSetId}
      </p>{/if}
  {:else if source === 'url'}
    <p class="hint">
      Cite a manufacturer page, package insert PDF, compendium entry, or other document.
    </p>
    <label
      >Address <input type="url" bind:value={url} placeholder="https://…" maxlength="2000" /></label
    >
    <label
      >Title <span class="optional">(optional)</span>
      <input
        bind:value={urlTitle}
        maxlength="200"
        placeholder="e.g. Civica vancomycin PI, rev. 03/2025"
      /></label
    >
    <label
      >Quoted passage
      <textarea
        bind:value={urlExcerpt}
        rows="4"
        maxlength="1000"
        placeholder="Paste the text that supports the correction"></textarea></label
    >
  {:else if candidates.length}
    <p class="hint">
      Use the value an equivalent package lists for this field: another package of the same product,
      or one sharing its RxNorm concept.
    </p>
    <ul class="equivalents">
      {#each candidates as equivalent (equivalent.ndc)}
        <li>
          <label class="equivalent" class:picked={equivalentNdc === equivalent.ndc}>
            <input
              type="radio"
              name="equivalent"
              value={equivalent.ndc}
              checked={equivalentNdc === equivalent.ndc}
              onchange={() => {
                equivalentNdc = equivalent.ndc;
                overrideValue = equivalent.values[overrideKey];
              }}
            />
            <span class="equivalent-body">
              <span class="equivalent-head">
                <span class="mono">{formatNdc(equivalent.ndc)}</span>
                <span class="relation"
                  >{equivalent.relation === 'sibling'
                    ? 'Same product'
                    : 'Same RxNorm concept'}</span
                >
              </span>
              <span class="equivalent-desc"
                >{[equivalent.labelerName, equivalent.description]
                  .filter(Boolean)
                  .join(' · ')}</span
              >
              <span class="equivalent-value"
                >{equivalent.values[overrideKey]}{#if equivalent.values[overrideKey] === current}
                  <span class="same">same as current</span>{/if}</span
              >
            </span>
          </label>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">
      No cached equivalent package lists this field. Packages of the same product or RxNorm concept
      appear here once they have been loaded.
    </p>
  {/if}
  {#if overrideMessage}<p class="error">{overrideMessage}</p>{/if}
  <div class="actions">
    <button type="button" onclick={onclose}>Cancel</button><button
      class="primary"
      type="button"
      disabled={savingOverride || !ready}
      onclick={saveOverride}>{savingOverride ? 'Saving…' : 'Save override'}</button
    >
  </div>
</aside>

<style>
  aside {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: calc(100vh - 2rem);
    overflow: auto;
    padding: 1rem 1.1rem;
    border: 1px solid #d8dee8;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 4px 16px rgb(28 47 75 / 8%);
    font-size: 0.88rem;
  }
  .panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.3;
  }
  .close {
    border: 0;
    background: none;
    color: #5c6777;
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
  }
  .field-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .field-tabs button {
    padding: 0.25rem 0.6rem;
    border: 1px solid #bfc9d6;
    border-radius: 999px;
    background: #fff;
    color: #34445c;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .field-tabs button[aria-selected='true'] {
    border-color: #3464a5;
    background: #eef3fa;
    color: #3464a5;
    font-weight: 650;
  }
  .field-details {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.2rem 0.65rem;
    margin: 0;
  }
  .field-details dt {
    color: #5c6777;
    font-size: 0.78rem;
  }
  .field-details dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .quote {
    display: block;
    color: #5c6777;
    font-size: 0.8rem;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
  }
  label {
    display: grid;
    gap: 0.3rem;
    font-weight: 600;
  }
  .optional {
    color: #7a8594;
    font-weight: 400;
  }
  input,
  select,
  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #bfc9d6;
    border-radius: 6px;
    font: inherit;
    font-weight: 400;
  }
  input[readonly],
  select:disabled {
    background: #f4f6f9;
    color: #34445c;
  }
  textarea {
    resize: vertical;
  }
  .source-tabs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .source-tabs span {
    margin-right: 0.2rem;
    font-weight: 600;
  }
  .source-tabs button {
    padding: 0.3rem 0.65rem;
    border: 1px solid #bfc9d6;
    border-radius: 7px;
    background: #fff;
    color: #34445c;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .source-tabs button[aria-selected='true'] {
    border-color: #3464a5;
    background: #eef3fa;
    color: #3464a5;
    font-weight: 650;
  }
  .source-tabs button:disabled {
    color: #a3acb8;
    cursor: default;
  }
  .equivalents {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: auto;
  }
  .equivalent {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    padding: 0.55rem 0.65rem;
    border: 1px solid #e0e7f0;
    border-radius: 8px;
    font-weight: 400;
    cursor: pointer;
  }
  .equivalent.picked {
    border-color: #3464a5;
    background: #f5f8fd;
  }
  .equivalent input {
    width: auto;
    margin: 0.2rem 0 0;
  }
  .equivalent-body {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }
  .equivalent-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
  }
  .relation {
    color: #3464a5;
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .equivalent-desc {
    color: #5c6777;
    font-size: 0.8rem;
  }
  .equivalent-value {
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .same {
    margin-left: 0.3rem;
    color: #7a8594;
    font-size: 0.75rem;
    font-weight: 400;
  }
  .hint,
  .source-note {
    margin: 0;
    color: #5c6777;
    font-size: 0.82rem;
  }
  .label-picker {
    flex: 1 1 auto;
    min-height: 12rem;
    overflow: auto;
    padding: 0.25rem 0.6rem 0.6rem;
    border: 1px solid #e0e7f0;
    border-radius: 8px;
  }
  .selected-excerpt {
    max-height: 6rem;
    margin: 0;
    overflow: auto;
  }
  .selected-excerpt mark {
    background: #fff0a6;
    white-space: pre-wrap;
  }
  .error {
    margin: 0;
    color: #a32b2b;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .actions button {
    padding: 0.45rem 0.9rem;
    border: 1px solid #bfc9d6;
    border-radius: 7px;
    background: #fff;
    font: inherit;
    cursor: pointer;
  }
  .actions .primary {
    border-color: #3464a5;
    background: #3464a5;
    color: #fff;
    font-weight: 650;
  }
  .actions .primary:disabled {
    border-color: #bfc9d6;
    background: #e3e8ee;
    color: #8993a0;
    cursor: default;
  }
</style>
