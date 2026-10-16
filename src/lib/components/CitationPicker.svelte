<script lang="ts">
      import SplPassagePicker from './SplPassagePicker.svelte';
      import type {CitationDraft} from '$lib/citation-form';
      import type {EquivalentPackage} from '$lib/property-override-fields';
      import type {StagedPackage} from '$lib/server/catalog-sync';

      let {
            item,
            draft = $bindable(),
            candidates = [],
            describe
      }: {
            item: StagedPackage;
            draft: CitationDraft;
            /** Equivalent NDCs whose value already matches what is being saved. */
            candidates?: EquivalentPackage[];
            /** How to word an equivalent's value. */
            describe: (equivalent: EquivalentPackage) => string;
      } = $props();

      const sections = $derived(item.details?.label?.sections ?? []);
      const hasSpl = $derived(!!item.splSetId && sections.length > 0);
      const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
</script>

<div class="cite">
      <div aria-label="Cite" class="source-tabs" role="tablist">
            <span>Cite</span>
            <button aria-selected={draft.source === 'spl'} disabled={!hasSpl} onclick={() => (draft.source = 'spl')}
                    role="tab" title={hasSpl ? undefined : 'No SPL label for this package.'} type="button">This SPL
            </button>
            <button aria-selected={draft.source === 'url'} onclick={() => (draft.source = 'url')} role="tab"
                    type="button">Outside source
            </button>
            <button aria-selected={draft.source === 'ndc'} onclick={() => (draft.source = 'ndc')} role="tab"
                    type="button">Equivalent NDC ({candidates.length})
            </button>
            <button aria-selected={draft.source === 'none'} onclick={() => (draft.source = 'none')} role="tab"
                    type="button">No citation
            </button>
      </div>
      {#if draft.source === 'spl'}
            <SplPassagePicker bind:passages={draft.passages} {sections} splSetId={item.splSetId}/>
      {:else if draft.source === 'url'}
            <p class="hint">Cite a manufacturer page, package insert PDF, compendium entry, or other document.</p>
            <label>Address <input type="url" bind:value={draft.url} placeholder="https://…" maxlength="2000"/></label>
            <label>Title <span class="optional">(optional)</span>
                  <input bind:value={draft.urlTitle} maxlength="200"/></label>
            <label>Quoted passage
                  <textarea bind:value={draft.urlExcerpt} rows="4" maxlength="1000"
                            placeholder="Paste the text that supports the correction"></textarea></label>
      {:else if draft.source === 'none'}
            <p class="hint">Save the correction without citing a source.</p>
      {:else if candidates.length}
            <p class="hint">
                  Another package that already lists this same ingredient row: of the same product, or
                  sharing its RxNorm concept.
            </p>
            <ul class="equivalents">
                  {#each candidates as equivalent (equivalent.ndc)}
                        <li>
                              <label class="equivalent" class:picked={draft.ndc === equivalent.ndc}>
                                    <input type="radio" name="equivalent" value={equivalent.ndc}
                                           checked={draft.ndc === equivalent.ndc}
                                           onchange={() => (draft.ndc = equivalent.ndc)}/>
                                    <span class="equivalent-body">
                                          <span class="mono">{formatNdc(equivalent.ndc)}
                                                <span class="relation">{equivalent.relation === 'sibling'
                                                      ? 'Same product'
                                                      : 'Same RxNorm concept'}</span></span>
                                          <span class="muted">{[equivalent.labelerName, equivalent.description]
                                                .filter(Boolean)
                                                .join(' · ')}</span>
                                          <span class="value">{describe(equivalent)}</span>
                                    </span>
                              </label>
                        </li>
                  {/each}
            </ul>
      {:else}
            <p class="hint">
                  No cached equivalent package lists this same ingredient row.
            </p>
      {/if}
</div>

<style>
      .cite {
            display: grid;
            gap: 0.6rem;
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

      label {
            display: grid;
            gap: 0.3rem;
            font-weight: 600;
      }

      .optional {
            color: #7a8594;
            font-weight: 400;
      }

      input:not([type='radio']),
      textarea {
            box-sizing: border-box;
            width: 100%;
            padding: 0.5rem;
            border: 1px solid #bfc9d6;
            border-radius: 6px;
            font: inherit;
            font-weight: 400;
      }

      .hint {
            margin: 0;
            color: #5c6777;
            font-size: 0.82rem;
      }




      .equivalents {
            display: grid;
            gap: 0.4rem;
            margin: 0;
            padding: 0;
            list-style: none;
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

      .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.8rem;
      }

      .relation {
            margin-left: 0.4rem;
            color: #3464a5;
            font-family: inherit;
            font-size: 0.72rem;
            font-weight: 650;
            letter-spacing: 0.04em;
            text-transform: uppercase;
      }

      .muted {
            color: #5c6777;
            font-size: 0.8rem;
      }

      .value {
            font-weight: 650;
            overflow-wrap: anywhere;
      }
</style>
