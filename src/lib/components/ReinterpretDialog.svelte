<script lang="ts">
      import {deserialize} from '$app/forms';
      import {invalidateAll} from '$app/navigation';
      import type {StagedPackage} from '$lib/server/catalog-sync';
      import type {ExternalPackage} from '$lib/server/catalog-providers';
      import {
            defaultMark,
            type FieldMark,
            fieldValue,
            listAccess,
            MARKS,
            type PreviewRow,
            REVIEW_FIELDS,
            type ReviewField,
            summarize
      } from '$lib/reinterpret';

      let {item}: { item: StagedPackage } = $props();

      type Preview = {
            token: string;
            rows: PreviewRow[];
            splSetId: { before: string | null; after: string | null };
            providerErrors: NonNullable<StagedPackage['providerErrors']>;
      };

      let dialog: HTMLDialogElement;
      let step = $state<'review' | 'preview'>('review');
      let busy = $state(false);
      let message = $state<string | null>(null);
      let marks = $state<Record<string, FieldMark>>({});
      let notes = $state<Record<string, string>>({});
      let overrides = $state<Record<string, string>>({});
      let keepRows = $state<Record<string, number[]>>({});
      let preferredSetId = $state('');
      let note = $state('');
      let menuFor = $state<string | null>(null);
      let editing = $state<string | null>(null);
      let preview = $state<Preview | null>(null);
      let showUnchanged = $state(false);

      const asPackage = $derived(item as unknown as ExternalPackage);
      const groups = $derived(
            [...new Set(REVIEW_FIELDS.map((f) => f.group))].map((group) => ({
                  group,
                  fields: REVIEW_FIELDS.filter((f) => f.group === group)
            }))
      );
      const unlockedCount = $derived(Object.values(marks).filter((m) => m !== 'locked').length);
      const overrideCount = $derived(Object.values(overrides).filter((v) => v.trim()).length);

      export function open() {
            marks = Object.fromEntries(REVIEW_FIELDS.map((f) => [f.key, defaultMark(asPackage, f)]));
            notes = {};
            overrides = {};
            keepRows = {};
            preferredSetId = '';
            note = '';
            preview = null;
            message = null;
            step = 'review';
            dialog.showModal();
      }

      function setAll(mark: FieldMark) {
            marks = Object.fromEntries(REVIEW_FIELDS.map((f) => [f.key, mark]));
      }

      function choose(field: ReviewField, mark: FieldMark) {
            marks[field.key] = mark;
            menuFor = null;
            const list = listAccess(field.key);
            if (mark === 'broad' && list && !keepRows[field.key])
                  keepRows[field.key] = list.rows(asPackage).map((_, i) => i);
            // Flagging a value as wrong is the moment to say what is wrong with it.
            if (mark === 'incorrect' || mark === 'incomplete' || mark === 'broad') editing = field.key;
      }

      function toggleRow(key: string, index: number, on: boolean) {
            const kept = new Set(keepRows[key] ?? []);
            if (on) kept.add(index);
            else kept.delete(index);
            keepRows[key] = [...kept].sort((a, b) => a - b);
      }

      async function post(action: string, body: Record<string, string>) {
            const form = new FormData();
            for (const [k, v] of Object.entries(body)) form.set(k, v);
            const response = await fetch(`?/${action}`, {method: 'POST', body: form});
            return deserialize(await response.text());
      }

      async function runPreview() {
            busy = true;
            message = null;
            const review = {marks, notes, overrides, keepRows, preferredSetId, note};
            const result = await post('preview', {review: JSON.stringify(review)});
            busy = false;
            if (result.type === 'success' && result.data?.preview) {
                  preview = result.data.preview as Preview;
                  step = 'preview';
            } else {
                  message =
                        (result.type === 'failure' && (result.data?.message as string)) ||
                        'The reload failed. Try again.';
            }
      }

      async function confirm() {
            if (!preview) return;
            busy = true;
            const result = await post('apply', {token: preview.token});
            busy = false;
            if (result.type === 'success') {
                  dialog.close();
                  await invalidateAll();
            } else {
                  message =
                        (result.type === 'failure' && (result.data?.message as string)) || 'Could not save.';
            }
      }

      function outside(event: MouseEvent) {
            if (menuFor && !(event.target as Element).closest('.mark-menu, .mark')) menuFor = null;
      }

      function keydown(event: KeyboardEvent) {
            if (event.key === 'Escape' && menuFor) {
                  event.preventDefault();
                  menuFor = null;
            }
      }

      const visibleRows = $derived(
            preview?.rows.filter((r) => showUnchanged || r.changed || r.warning) ?? []
      );
      const changedCount = $derived(preview?.rows.filter((r) => r.changed).length ?? 0);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog aria-labelledby="reinterpret-title" bind:this={dialog} onclick={outside} onkeydown={keydown}>
      <header>
            <h2 id="reinterpret-title">Reload &amp; reinterpret</h2>
            <p>
                  {#if step === 'review'}
                        Locked values are kept. Anything unlocked is re-scraped from openFDA, DailyMed and RxNav
                        and reparsed. Nothing is saved until you confirm.
                  {:else}
                        Review the reinterpreted data. {changedCount} field{changedCount === 1 ? '' : 's'} would
                        change.
                  {/if}
            </p>
            <button aria-label="Close" class="close" onclick={() => dialog.close()} type="button">×</button>
      </header>

      {#if step === 'review'}
            <div class="toolbar">
                  <span>{unlockedCount} of {REVIEW_FIELDS.length} fields will be re-scraped</span>
                  <span class="spacer"></span>
                  <button type="button" class="link" onclick={() => setAll('locked')}>Lock all</button>
                  <button type="button" class="link" onclick={() => setAll('refresh')}>Unlock all</button>
            </div>

            <div class="body">
                  {#each groups as {group, fields} (group)}
                        <h3>{group}</h3>
                        <ul class="fields">
                              {#each fields as field (field.key)}
                                    {@const mark = marks[field.key]}
                                    <li class:unlocked={mark !== 'locked'}>
                                          <div class="row">
                                                <span class="label">{field.label}</span>
                                                <span class="value" title={summarize(fieldValue(asPackage, field))}>
									{summarize(fieldValue(asPackage, field))}
								</span>
                                                {#if notes[field.key] || overrides[field.key]}
                                                      <span class="has-note" title="Has a note or correction">✎</span>
                                                {/if}
                                                <div class="mark-wrap">
                                                      <button
                                                            type="button"
                                                            class="mark {mark}"
                                                            aria-haspopup="menu"
                                                            aria-expanded={menuFor === field.key}
                                                            onclick={() => (menuFor = menuFor === field.key ? null : field.key)}
                                                      >
                                                            {MARKS.find((m) => m.value === mark)?.label} ▾
                                                      </button>
                                                      {#if menuFor === field.key}
                                                            <div class="mark-menu" role="menu">
                                                                  {#each MARKS.filter((m) => m.value !== 'broad' || listAccess(field.key)) as option (option.value)}
                                                                        <button
                                                                              type="button"
                                                                              role="menuitemradio"
                                                                              aria-checked={mark === option.value}
                                                                              onclick={() => choose(field, option.value)}
                                                                        >
                                                                              <span class="check">{mark === option.value ? '✓' : ''}</span>
                                                                              <span>
														<b>{option.label}</b>
														<small>{option.hint}</small>
													</span>
                                                                        </button>
                                                                  {/each}
                                                                  <hr/>
                                                                  <button
                                                                        type="button"
                                                                        role="menuitem"
                                                                        onclick={() => {
													editing = field.key;
													menuFor = null;
												}}
                                                                  >
                                                                        <span class="check"></span>
                                                                        <span><b>Note{field.editable ? ' / correct by hand' : ''}
                                                                                 …</b></span>
                                                                  </button>
                                                            </div>
                                                      {/if}
                                                </div>
                                          </div>
                                          {#if editing === field.key}
                                                <div class="editor">
                                                      <label>
                                                            What's wrong or expected?
                                                            <input
                                                                  bind:value={notes[field.key]}
                                                                  placeholder="e.g. should be 10 mL single-dose vial"
                                                            />
                                                      </label>
                                                      {#if mark === 'broad' && listAccess(field.key)}
                                                            {@const list = listAccess(field.key)!}
                                                            {@const rows = list.rows(asPackage)}
                                                            <fieldset class="rows">
                                                                  <legend>Keep only the rows that apply to this
                                                                          package
                                                                  </legend>
                                                                  {#if list.facets}
                                                                        <div class="facets">
                                                                              {#each list.facets(rows) as facet (facet.label)}
                                                                                    <button
                                                                                          type="button"
                                                                                          class="chip"
                                                                                          onclick={() => (keepRows[field.key] = facet.keep)}>{facet.label}</button
                                                                                    >
                                                                              {/each}
                                                                              <button
                                                                                    type="button"
                                                                                    class="chip"
                                                                                    onclick={() => (keepRows[field.key] = rows.map((_, i) => i))}>
                                                                                    All
                                                                              </button
                                                                              >
                                                                        </div>
                                                                  {/if}
                                                                  {#each rows as row, i (i)}
                                                                        <label class="row-pick">
                                                                              <input
                                                                                    type="checkbox"
                                                                                    checked={keepRows[field.key]?.includes(i)}
                                                                                    onchange={(e) => toggleRow(field.key, i, e.currentTarget.checked)}
                                                                              />
                                                                              {list.describe(row)}
                                                                        </label>
                                                                  {:else}
                                                                        <p class="muted">No rows on the current
                                                                                         data.</p>
                                                                  {/each}
                                                            </fieldset>
                                                      {/if}
                                                      {#if field.editable}
                                                            <label>
                                                                  Correct value (overrides the scrape)
                                                                  <input bind:value={overrides[field.key]}
                                                                         placeholder="Leave blank to use the scrape"/>
                                                            </label>
                                                      {/if}
                                                      <button type="button" class="link"
                                                              onclick={() => (editing = null)}>Done
                                                      </button>
                                                </div>
                                          {/if}
                                    </li>
                              {/each}
                        </ul>
                  {/each}

                  <h3>Direct the scrape</h3>
                  <div class="extras">
                        <label>
                              Use this DailyMed SPL set ID
                              <input
                                    bind:value={preferredSetId}
                                    class="mono"
                                    placeholder={item.splSetId ?? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
                              />
                              <small>
                                    Current: <span class="mono">{item.splSetId ?? 'none'}</span>. Marking the SPL
                                    document,
                                    its ingredients or label sections incorrect tries a different listing automatically.
                              </small>
                        </label>
                        <label>
                              Reviewer note
                              <textarea bind:value={note} rows="2"
                                        placeholder="Context kept with this review's provenance"
                              ></textarea>
                        </label>
                  </div>
            </div>

            <footer>
                  {#if message}<p class="error">{message}</p>{/if}
                  <button type="button" onclick={() => dialog.close()}>Cancel</button>
                  <button
                        type="button"
                        class="primary"
                        disabled={busy || (!unlockedCount && !overrideCount && !preferredSetId.trim())}
                        onclick={runPreview}
                  >
                        {busy ? 'Scraping…' : 'Reload & preview'}
                  </button>
            </footer>
      {:else if preview}
            <div class="toolbar">
                  {#if preview.splSetId.before !== preview.splSetId.after}
				<span>SPL: <span class="mono">{preview.splSetId.before ?? 'none'}</span> →
					<span class="mono">{preview.splSetId.after ?? 'none'}</span></span>
                  {/if}
                  <span class="spacer"></span>
                  <label class="inline"><input type="checkbox" bind:checked={showUnchanged}/> Show unchanged</label>
            </div>
            <div class="body">
                  {#if preview.providerErrors.length}
                        <p class="warn">
                              This scrape is partial:
                              {preview.providerErrors.map((f) => `${f.source} ${f.message}`).join('; ')}.
                              Fields it couldn't reach keep their current values.
                        </p>
                  {/if}
                  {#if !visibleRows.length}
                        <p class="empty">The new scrape didn't change anything.</p>
                  {:else}
                        <table>
                              <thead>
                              <tr>
                                    <th>Field</th>
                                    <th>Current</th>
                                    <th>Reinterpreted</th>
                              </tr>
                              </thead>
                              <tbody>
                              {#each visibleRows as row (row.key)}
                                    <tr class:changed={row.changed}>
                                          <td>
                                                {row.label}
                                                <span class="tag {row.source}">{row.source}</span>
                                          </td>
                                          <td>{row.before}</td>
                                          <td>
                                                {row.after}
                                                {#if row.warning}<small class="warn">{row.warning}</small>{/if}
                                          </td>
                                    </tr>
                              {/each}
                              </tbody>
                        </table>
                  {/if}
            </div>
            <footer>
                  {#if message}<p class="error">{message}</p>{/if}
                  <button type="button" onclick={() => (step = 'review')}>← Adjust</button>
                  <button type="button" class="primary" disabled={busy || !changedCount} onclick={confirm}>
                        {busy ? 'Saving…' : 'Confirm & save'}
                  </button>
            </footer>
      {/if}
</dialog>

<style>
      dialog {
            width: min(880px, calc(100vw - 2rem));
            max-height: calc(100vh - 3rem);
            padding: 0;
            border: 1px solid #d8dee8;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgb(20 30 50 / 25%);
            color: #18212f;
            flex-direction: column;
      }

      dialog[open] {
            display: flex;
      }

      dialog::backdrop {
            background: rgb(20 30 50 / 35%);
      }

      header {
            position: relative;
            padding: 1.1rem 3rem 0.8rem 1.25rem;
            border-bottom: 1px solid #e6eaf0;
      }

      h2 {
            margin: 0;
            font-size: 1.15rem;
      }

      header p {
            margin: 0.35rem 0 0;
            color: #5c6777;
            font-size: 0.88rem;
      }

      .close {
            position: absolute;
            top: 0.7rem;
            right: 0.8rem;
            border: 0;
            background: none;
            font-size: 1.4rem;
            color: #5c6777;
            cursor: pointer;
      }

      .toolbar {
            display: flex;
            gap: 0.75rem;
            align-items: center;
            padding: 0.55rem 1.25rem;
            background: #f7f8fa;
            border-bottom: 1px solid #e6eaf0;
            font-size: 0.82rem;
            color: #5c6777;
      }

      .spacer {
            flex: 1;
      }

      .body {
            overflow: auto;
            padding: 0.25rem 1.25rem 1rem;
      }

      h3 {
            margin: 1rem 0 0.35rem;
            font-size: 0.72rem;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #3464a5;
      }

      .fields {
            list-style: none;
            margin: 0;
            padding: 0;
      }

      .fields li {
            border-bottom: 1px solid #eef1f5;
      }

      .fields li.unlocked {
            background: #fbfcfe;
      }

      .row {
            display: grid;
            grid-template-columns: 13rem 1fr auto auto;
            gap: 0.75rem;
            align-items: center;
            padding: 0.4rem 0.25rem;
            font-size: 0.86rem;
      }

      .label {
            font-weight: 600;
      }

      .value {
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            color: #3b4555;
      }

      .has-note {
            color: #3464a5;
      }

      .mark-wrap {
            position: relative;
      }

      .mark {
            min-width: 6.5rem;
            padding: 0.2rem 0.55rem;
            border: 1px solid #d8dee8;
            border-radius: 999px;
            background: #fff;
            font-size: 0.78rem;
            font-weight: 650;
            cursor: pointer;
      }

      .mark.locked {
            color: #5c6777;
      }

      .mark.refresh {
            color: #1f6f43;
            border-color: #a9d8bd;
            background: #eef8f2;
      }

      .mark.incorrect {
            color: #a3281c;
            border-color: #ebb4ad;
            background: #fcefed;
      }

      .mark.broad {
            color: #5b3aa3;
            border-color: #c9b8ec;
            background: #f4f0fc;
      }

      .rows {
            flex: 1 1 100%;
            margin: 0;
            padding: 0.5rem 0.6rem;
            border: 1px solid #e6eaf0;
            border-radius: 8px;
      }

      .rows legend {
            padding: 0 0.3rem;
            font-size: 0.78rem;
            font-weight: 600;
            color: #3b4555;
      }

      .facets {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
            margin-bottom: 0.4rem;
      }

      .chip {
            padding: 0.15rem 0.6rem;
            border: 1px solid #d8dee8;
            border-radius: 999px;
            background: #fff;
            font-size: 0.76rem;
            cursor: pointer;
      }

      .chip:hover {
            background: #f0f4fa;
      }

      .editor .row-pick {
            display: flex;
            flex: 1 1 100%;
            gap: 0.45rem;
            align-items: baseline;
            font-weight: 400;
            font-size: 0.84rem;
      }

      .muted {
            margin: 0;
            color: #5c6777;
            font-size: 0.84rem;
      }

      .mark.incomplete {
            color: #8a5a00;
            border-color: #ecd29a;
            background: #fdf6e6;
      }

      .mark-menu {
            position: absolute;
            right: 0;
            top: calc(100% + 4px);
            z-index: 5;
            width: 18rem;
            padding: 0.3rem;
            background: #fff;
            border: 1px solid #d8dee8;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgb(20 30 50 / 15%);
      }

      .mark-menu button {
            display: flex;
            gap: 0.4rem;
            width: 100%;
            padding: 0.4rem;
            border: 0;
            border-radius: 6px;
            background: none;
            text-align: left;
            cursor: pointer;
            font-size: 0.84rem;
      }

      .mark-menu button:hover,
      .mark-menu button:focus-visible {
            background: #f0f4fa;
      }

      .mark-menu small {
            display: block;
            color: #5c6777;
      }

      .mark-menu hr {
            margin: 0.25rem 0;
            border: 0;
            border-top: 1px solid #eef1f5;
      }

      .check {
            width: 1rem;
            color: #3464a5;
      }

      .editor {
            display: flex;
            flex-wrap: wrap;
            gap: 0.6rem;
            align-items: end;
            padding: 0.2rem 0.25rem 0.7rem;
      }

      .editor label,
      .extras label {
            display: grid;
            gap: 0.25rem;
            flex: 1 1 16rem;
            font-size: 0.78rem;
            font-weight: 600;
            color: #3b4555;
      }

      .extras {
            display: grid;
            gap: 0.8rem;
      }

      .extras small {
            font-weight: 400;
            color: #5c6777;
      }

      input:not([type='checkbox']),
      textarea {
            padding: 0.4rem 0.55rem;
            border: 1px solid #d8dee8;
            border-radius: 6px;
            font: inherit;
            font-weight: 400;
            font-size: 0.86rem;
      }

      .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      footer {
            display: flex;
            gap: 0.6rem;
            justify-content: flex-end;
            align-items: center;
            padding: 0.8rem 1.25rem;
            border-top: 1px solid #e6eaf0;
      }

      footer button {
            padding: 0.45rem 0.95rem;
            border: 1px solid #d8dee8;
            border-radius: 7px;
            background: #fff;
            font: inherit;
            font-weight: 600;
            cursor: pointer;
      }

      footer .primary {
            background: #3464a5;
            border-color: #3464a5;
            color: #fff;
      }

      footer button:disabled {
            opacity: 0.5;
            cursor: default;
      }

      .error {
            margin: 0 auto 0 0;
            color: #a3281c;
            font-size: 0.85rem;
      }

      .link {
            border: 0;
            background: none;
            color: #3464a5;
            font-weight: 650;
            cursor: pointer;
            font-size: 0.82rem;
      }

      .inline {
            display: inline-flex;
            gap: 0.3rem;
            align-items: center;
      }

      table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.85rem;
      }

      th {
            text-align: left;
            padding: 0.5rem 0.4rem;
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #5c6777;
      }

      td {
            padding: 0.45rem 0.4rem;
            border-top: 1px solid #eef1f5;
            vertical-align: top;
      }

      tr.changed td:last-child {
            background: #eef8f2;
      }

      .tag {
            margin-left: 0.3rem;
            padding: 0 0.35rem;
            border-radius: 4px;
            font-size: 0.68rem;
            font-weight: 700;
            text-transform: uppercase;
            background: #eef1f5;
            color: #5c6777;
      }

      .tag.scrape {
            background: #e3edfa;
            color: #3464a5;
      }

      .tag.manual {
            background: #fdf6e6;
            color: #8a5a00;
      }

      .warn {
            display: block;
            color: #8a5a00;
      }

      .empty {
            color: #5c6777;
            padding: 1rem 0;
      }

      @media (max-width: 640px) {
            .row {
                  grid-template-columns: 1fr auto;
            }

            .value {
                  grid-column: 1 / -1;
                  grid-row: 2;
            }
      }
</style>
