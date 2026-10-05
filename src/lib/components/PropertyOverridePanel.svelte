<script lang="ts">
      import {untrack} from 'svelte';
      import {deserialize} from '$app/forms';
      import {invalidateAll} from '$app/navigation';
      import type {StagedPackage} from '$lib/server/catalog-sync';
      import SplLabelSections from './SplLabelSections.svelte';
      import OverrideCitation from './OverrideCitation.svelte';
      import QuantityField from './QuantityField.svelte';
      import PillMockup from './PillMockup.svelte';
      import {explainIln, validateIln} from '$lib/imprints/iln-parse';
      import {guessIln} from '$lib/imprints/spl-to-iln';
      import {toSplAppearance} from '$lib/imprints/iln-render';
      import type {PillMedia} from '$lib/pill-image-layout';
      import {type Quantity, quantityDecimal} from '$lib/quantity';
      import {AMBIGUITY_KINDS, type AmbiguityKind, ambiguityKindsFor} from '$lib/labeler-ambiguity';
      import {
            type EquivalentPackage,
            overrideChoices,
            overrideCurrentValue,
            overrideQuantity,
            overrideSeparator,
            overrideTargets,
            PILL_ILN_KEY,
            splitMulti
      } from '$lib/property-override-fields';

      let {
            item,
            keys,
            equivalents = [],
            pillMedia = null,
            onclose
      }: {
            /** The photos' measured layouts, offered as a starting point for a pill's ILN. */
            pillMedia?: Promise<PillMedia> | PillMedia | null;
            item: StagedPackage;
            keys: string[];
            /** Packages whose values may stand in for this one's. */
            equivalents?: EquivalentPackage[];
            onclose: () => void;
      } = $props();

      let panel: HTMLElement;
      // The editing row fixes `keys` for this panel's lifetime (the page re-keys it).
      // svelte-ignore state_referenced_locally
      let overrideKey = $state(keys[0] ?? '');
      let overrideValue = $state('');
      let sectionKey = $state('');
      let excerpt = $state('');
      let subsectionTitle = $state('');
      let startOffset = $state(0);
      let endOffset = $state(0);
      const hasSpl = $derived(!!item.splSetId && !!item.details?.label?.sections.length);
      // svelte-ignore state_referenced_locally
      let source = $state<'spl' | 'url' | 'ndc' | 'none'>(hasSpl ? 'spl' : 'url');
      let url = $state('');
      let urlTitle = $state('');
      let urlExcerpt = $state('');
      let equivalentNdc = $state('');
      let overrideMessage = $state('');
      let savingOverride = $state(false);
      // Why the labeler's value was wrong, when it is a known pattern for this field.
      let kind = $state<AmbiguityKind | ''>('');
      let kindNote = $state('');

      const fields = $derived(overrideTargets(item).filter((field) => keys.includes(field.key)));
      const field = $derived(fields.find((candidate) => candidate.key === overrideKey));
      const existing = $derived(item.propertyOverrides?.[overrideKey]);
      const current = $derived(overrideCurrentValue(item, overrideKey));
      const kinds = $derived(ambiguityKindsFor(overrideKey));
      const choices = $derived(overrideChoices(overrideKey));
      const separator = $derived(overrideSeparator(overrideKey));
      // A value may already hold entries the fixed choices lack; keep them pickable.
      const picked = $derived(separator ? splitMulti(overrideValue, separator) : []);
      const options = $derived(
            choices ? [...choices, ...picked.filter((p) => !choices.includes(p))] : []
      );
      // "INJECTION, SOLUTION" nests under "INJECTION" when both are options.
      const tree = $derived(
            options.map((option) => {
                  const parents = options.filter((other) => option.startsWith(`${other}, `));
                  const parent = parents.sort((a, b) => b.length - a.length)[0];
                  return {
                        option,
                        depth: parents.length,
                        label: parent ? option.slice(parent.length + 2) : option
                  };
            })
      );

      function toggle(option: string, on: boolean) {
            const next = new Set(picked);
            if (on) next.add(option);
            else next.delete(option);
            overrideValue = options.filter((o) => next.has(o)).join(separator ?? '');
      }

      // A pill's imprint layout is ILN: checked as it is typed and previewed as a mockup.
      const pillIndex = $derived(PILL_ILN_KEY.exec(overrideKey)?.[1]);
      const pillAppearance = $derived(
            pillIndex === undefined ? null : (item.details?.spl?.appearances[Number(pillIndex)] ?? null)
      );
      const ilnCheck = $derived(pillAppearance && overrideValue.trim() ? validateIln(overrideValue) : null);
      const ilnReading = $derived.by(() => {
            if (!ilnCheck?.ok) return '';
            try {
                  return explainIln(overrideValue);
            } catch {
                  return '';
            }
      });
      const ilnGuess = $derived(
            pillAppearance ? guessIln(toSplAppearance({...pillAppearance, iln: null}, item.doseForm)) : null
      );
      let measuredIln = $state<string | null>(null);
      $effect(() => {
            const index = pillIndex;
            measuredIln = null;
            if (index === undefined || !pillMedia) return;
            Promise.resolve(pillMedia).then(
                  (media) => {
                        if (pillIndex === index) measuredIln = media.ilns?.[Number(index)] ?? null;
                  },
                  () => {
                  }
            );
      });
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
            (!pillAppearance || !!ilnCheck?.ok) &&
            (source === 'spl'
                  ? !!excerpt && !!sectionKey
                  : source === 'url'
                        ? !!url.trim() && !!urlExcerpt.trim()
                        : source === 'none' || !!equivalentNdc)
      );

      $effect(() => {
            // Start from what the page shows whenever the property changes.
            const key = overrideKey;
            overrideValue = untrack(() => overrideCurrentValue(item, key)) ?? '';
            equivalentNdc = '';
            overrideMessage = '';
            kind = '';
            kindNote = '';
      });

      // Beside the details it stays in view; stacked above them (narrow screens)
      // it may open off-screen from the pencil that opened it.
      $effect(() => {
            const {top} = panel.getBoundingClientRect();
            if (top < 0 || top > window.innerHeight - 120) panel.scrollIntoView({block: 'start'});
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

      let removing = $state(false);

      async function removeOverride() {
            removing = true;
            overrideMessage = '';
            const form = new FormData();
            form.set('key', overrideKey);
            try {
                  const response = await fetch('?/removeOverride', {method: 'POST', body: form});
                  const result = deserialize(await response.text());
                  if (result.type === 'success') {
                        await invalidateAll();
                        onclose();
                  } else
                        overrideMessage =
                              result.type === 'failure'
                                    ? String(result.data?.message ?? 'Could not remove override.')
                                    : 'Could not remove override.';
            } catch {
                  overrideMessage = 'Could not remove override.';
            } finally {
                  removing = false;
            }
      }

      async function saveOverride() {
            savingOverride = true;
            overrideMessage = '';
            const form = new FormData();
            form.set('key', overrideKey);
            form.set('value', submittedValue);
            if (kind) {
                  form.set('ambiguity', kind);
                  form.set('note', kindNote);
            }
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
            } else if (source === 'ndc') form.set('ndc', equivalentNdc);
            try {
                  const response = await fetch('?/override', {method: 'POST', body: form});
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

<aside aria-labelledby="override-title" bind:this={panel}>
      <div class="panel-head">
            <h2 id="override-title">{field?.label ?? overrideKey}</h2>
            <button aria-label="Close" class="close" onclick={onclose} type="button">×</button>
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
                        <span class="quote"><OverrideCitation override={existing}/></span>
                  </dd>
            {/if}
      </dl>
      {#if separator && choices}
            <fieldset class="multi" disabled={source === 'ndc'}>
                  <legend>Correct value <span class="optional">(choose any)</span></legend>
                  {#each tree as {option, depth, label} (option)}
                        <label class="check" style:padding-left="{0.4 + depth * 1.4}rem"
                        ><input
                              type="checkbox"
                              checked={picked.includes(option)}
                              onchange={(event) => toggle(option, event.currentTarget.checked)}
                        />{label}</label
                        >
                  {/each}
            </fieldset>
      {:else}
            <label
            >Correct value
                  {#if choices}
                        <select bind:value={overrideValue} disabled={source === 'ndc'}
                        >
                              <option value="">Choose…</option>
                              {#each choices as choice (choice)}
                                    <option value={choice}
                                    >{choice}</option
                                    >
                              {/each}
                        </select
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
                  {:else if pillAppearance}
        <textarea
              class="mono"
              rows="3"
              bind:value={overrideValue}
              readonly={source === 'ndc'}
              maxlength="500"
              spellcheck="false"
              placeholder={'F: "50" + "ACME"[RIM:W>N>E] ; B: "5" | "10"'}
        ></textarea>
                  {:else}
                        <input bind:value={overrideValue} readonly={source === 'ndc'} maxlength="500"/>
                  {/if}
            </label>
      {/if}
      {#if pillAppearance}
            <div class="iln">
                  <div class="iln-starts">
                        <span>Start from</span>
                        {#if measuredIln}
                              <button type="button" disabled={source === 'ndc'}
                                      onclick={() => (overrideValue = measuredIln ?? '')}
                              >Photo layout
                              </button
                              >
                        {/if}
                        {#if ilnGuess}
                              <button type="button" disabled={source === 'ndc'}
                                      onclick={() => (overrideValue = ilnGuess.iln)}
                              >SPL guess ({ilnGuess.confidence})
                              </button
                              >
                        {/if}
                  </div>
                  {#if ilnCheck}
                        {#each ilnCheck.issues as issue, i (i)}
                              <p class="iln-issue" data-level={issue.level}>
                                    {issue.level === 'error' ? 'Error' : 'Warning'}{issue.surface ? ` (${issue.surface})` : ''}
                                    : {issue.message}
                              </p>
                        {/each}
                  {/if}
                  {#if ilnReading}
                        <p class="hint iln-reading">{ilnReading}</p>
                  {/if}
                  <div class="iln-preview">
                        <PillMockup
                              appearance={{...pillAppearance, iln: ilnCheck?.ok ? overrideValue : null}}
                              doseForm={item.doseForm}
                              size={96}
                              compact
                        />
                  </div>
            </div>
      {/if}
      {#if kinds.length}
            <label
            >Why the labeled value was wrong <span class="optional">(optional)</span>
                  <select
                        bind:value={kind}
                        onchange={() => {
          // An equivalent NDC lists values, not reasons.
          if (kind && (source === 'ndc' || source === 'none')) source = hasSpl ? 'spl' : 'url';
        }}
                  >
                        <option value="">Not a known labeler ambiguity
                        </option
                        >
                        {#each kinds as option (option)}
                              <option value={option}
                              >{AMBIGUITY_KINDS[option].label}</option
                              >
                        {/each}
                  </select
                  ></label
            >
            {#if kind}
                  <p class="hint">{AMBIGUITY_KINDS[kind].explanation}</p>
                  <label
                  >Note <span class="optional">(optional)</span>
                        <input
                              bind:value={kindNote}
                              maxlength="500"
                              placeholder="Anything worth remembering"
                        /></label
                  >
            {/if}
      {/if}
      <div aria-label="Cite" class="source-tabs" role="tablist">
            <span>Cite</span>
            <button
                  aria-selected={source === 'spl'}
                  disabled={!hasSpl}
                  onclick={() => (source = 'spl')}
                  role="tab"
                  title={hasSpl ? undefined : 'No SPL label for this package.'}
                  type="button">This SPL
            </button
            >
            <button
                  aria-selected={source === 'url'}
                  onclick={() => (source = 'url')}
                  role="tab"
                  type="button">Outside source
            </button
            >
            <button
                  aria-selected={source === 'ndc'}
                  disabled={!!kind}
                  onclick={() => (source = 'ndc')}
                  role="tab"
                  title={kind ? 'A labeler ambiguity must cite this SPL or an outside source.' : undefined}
                  type="button">Equivalent NDC ({candidates.length})
            </button
            >
            <button
                  aria-selected={source === 'none'}
                  disabled={!!kind}
                  onclick={() => (source = 'none')}
                  role="tab"
                  title={kind ? 'A labeler ambiguity must cite this SPL or an outside source.' : undefined}
                  type="button">No citation
            </button
            >
      </div>
      {#if source === 'spl'}
            <p class="hint">Expand a section and highlight the SPL text that supports the correction.</p>
            <div class="label-picker" onmouseup={captureExcerpt} role="presentation">
                  <SplLabelSections {sections}/>
            </div>
            {#if excerpt}
                  <p class="selected-excerpt">
                        <b>Selected excerpt:</b>
                        <mark>{excerpt}</mark>
                  </p>
            {/if}
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
            >Address <input type="url" bind:value={url} placeholder="https://…" maxlength="2000"/></label
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
      {:else if source === 'none'}
            <p class="hint">Save the corrected value without citing a source.</p>
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
              >{equivalent.values[overrideKey]}
                    {#if equivalent.values[overrideKey] === current}
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
            {#if existing}
                  <button
                        class="remove"
                        type="button"
                        disabled={removing || savingOverride}
                        title="Discard this override and restore the value from the providers"
                        onclick={removeOverride}>{removing ? 'Removing…' : 'Remove override'}</button
                  >
            {/if}
            <button onclick={onclose} type="button">Cancel</button>
            <button
                  class="primary"
                  disabled={savingOverride || !ready}
                  onclick={saveOverride}
                  type="button">{savingOverride ? 'Saving…' : 'Save override'}</button
            >
      </div>
</aside>

<style>
      .multi {
            display: grid;
            gap: 0;
            max-height: 14rem;
            overflow: auto;
            margin: 0;
            padding: 0.25rem;
            border: 1px solid #bfc9d6;
            border-radius: 6px;
            min-width: 0;
      }

      .multi legend {
            padding: 0 0.3rem;
            font-weight: 600;
      }

      .multi .check {
            display: flex;
            align-items: flex-start;
            gap: 0.5rem;
            padding: 0.3rem 0.4rem;
            border-radius: 4px;
            font-weight: 400;
            line-height: 1.3;
            cursor: pointer;
      }

      .multi .check:hover {
            background: #f4f6f9;
      }

      .multi .check input {
            flex: none;
            width: auto;
            margin: 0.15rem 0 0;
            padding: 0;
      }

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

      .iln {
            display: grid;
            gap: 0.4rem;
      }

      .iln-starts {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.4rem;
            color: #5c6777;
            font-size: 0.8rem;
      }

      .iln-starts button {
            padding: 0.2rem 0.55rem;
            border: 1px solid #bfc9d6;
            border-radius: 999px;
            background: #fff;
            color: #3464a5;
            font: inherit;
            font-weight: 600;
            cursor: pointer;
      }

      .iln-starts button:disabled {
            color: #8993a0;
            cursor: default;
      }

      .iln-issue {
            margin: 0;
            font-size: 0.8rem;
            color: #8a5a00;
      }

      .iln-issue[data-level='error'] {
            color: #b42318;
      }

      .iln-reading {
            margin: 0;
            white-space: pre-line;
      }

      .iln-preview {
            display: flex;
            justify-content: center;
            padding: 0.6rem;
            border-radius: 8px;
            background: #f4f6f9;
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

      .was {
            color: #7a8594;
            font-size: 0.78rem;
            font-weight: 400;
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

      .actions .remove {
            margin-right: auto;
            border-color: #d9b3b3;
            color: #a32b2b;
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
