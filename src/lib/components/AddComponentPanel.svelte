<!--
@component
The compound builder's "add a component" panel. Search finds formulary items (by
item name, package title or NDC); picking an item adds its preferred package, and
an item's packages can be expanded to pick a different one. The role is guessed
per item (base solutions are diluents) and can be flipped before adding.

After each add the search clears and keeps focus, so the next component can be
typed straight away; items already in the compound are marked and sink to the end.
Keyboard: ↑/↓ move, Enter adds, → / ← open and close an item's packages, Esc closes.
-->
<script lang="ts">
      import {enhance} from '$app/forms';
      import BrandedName from '#lib/components/BrandedName.svelte';
      import {formatNdc} from "#lib/catalog/ndc.ts";
      import type {Role} from '#lib/compounds/compound-builder.ts';

      /** A formulary package that can be added to the compound. */
      type Candidate = {
            packageId: string;
            /** The formulary item the package is linked under. */
            itemId: string;
            /** The item's display name. */
            item: string;
            /** The package's rank within its item; lowest is preferred. */
            rank: number;
            ndc: string;
            /** Display title, possibly ending in a `[Brand]` tag. */
            title: string;
            /** Concentration, posted with the choice. */
            conc: string | null;
            /** Unit a dose of the package is measured in, posted with the choice. */
            doseUnit: string | null;
      };

      type Group = { itemId: string; item: string; packages: Candidate[]; inUse: boolean; role: Role };

      let {candidates, used = [], onclose}: {
            /** Every package the search may offer. */
            candidates: Candidate[];
            /** Package ids already in the compound. */
            used?: string[];
            /** Called on Escape. */
            onclose?: () => void;
      } = $props();

      let query = $state('');
      let cursor = $state(0);
      let expanded = $state<string | null>(null);
      /** Per-item role the user flipped to; otherwise the guess holds. */
      let roleOverride = $state<Record<string, Role>>({});
      let input: HTMLInputElement | undefined = $state();
      let addForm: HTMLFormElement | undefined = $state();
      let pending = $state(false);
      let lastAdded = $state<string | null>(null);

      const DILUENT = /\b(sodium chloride|dextrose|sterile water|water for injection|lactated ringer|ringer'?s|bacteriostatic|plasma-lyte|normosol)\b/i;
      // Only a single-ingredient base solution is a diluent; a mixture that contains one is not.
      const guessRole = (item: string): Role => (!item.includes(' / ') && DILUENT.test(item) ? 'diluent' : 'active');

      const usedSet = $derived(new Set(used));
      const groups = $derived.by<Group[]>(() => {
            const byItem = new Map<string, Candidate[]>();
            for (const candidate of candidates) {
                  const list = byItem.get(candidate.itemId);
                  if (list) list.push(candidate);
                  else byItem.set(candidate.itemId, [candidate]);
            }
            return [...byItem.values()].map((packages) => {
                  packages.sort((a, b) => a.rank - b.rank);
                  const item = packages[0].item;
                  return {
                        itemId: packages[0].itemId,
                        item,
                        packages,
                        inUse: packages.some((p) => usedSet.has(p.packageId)),
                        role: roleOverride[packages[0].itemId] ?? guessRole(item)
                  };
            });
      });

      const LIMIT = 25;
      const matches = $derived.by(() => {
            const words = query.toLowerCase().split(/\s+/).filter(Boolean);
            if (!words.length) return [];
            const digits = query.replace(/\D/g, '');
            const scored = groups
                  .map((group) => {
                        const name = group.item.toLowerCase();
                        const hits = (text: string) => words.every((word) => text.includes(word));
                        let score = -1;
                        if (hits(name)) score = name.startsWith(words[0]) ? 3 : 2;
                        else if (group.packages.some((p) => hits(p.title.toLowerCase()))) score = 1;
                        else if (digits.length >= 4 && group.packages.some((p) => p.ndc.includes(digits))) score = 1;
                        return {group, score};
                  })
                  .filter(({score}) => score >= 0);
            scored.sort(
                  (a, b) =>
                        Number(a.group.inUse) - Number(b.group.inUse) ||
                        b.score - a.score ||
                        a.group.item.length - b.group.item.length ||
                        a.group.item.localeCompare(b.group.item)
            );
            return scored.slice(0, LIMIT).map(({group}) => group);
      });

      // A new query starts from the top with nothing expanded.
      $effect(() => {
            void query;
            cursor = 0;
            expanded = null;
      });

      $effect(() => {
            input?.focus();
      });

      function add(group: Group, candidate: Candidate = group.packages[0]) {
            if (!addForm || pending) return;
            (addForm.elements.namedItem('role') as HTMLInputElement).value = group.role;
            (addForm.elements.namedItem('candidate') as HTMLInputElement).value = JSON.stringify({
                  packageId: candidate.packageId,
                  conc: candidate.conc,
                  doseUnit: candidate.doseUnit
            });
            lastAdded = group.item;
            addForm.requestSubmit();
      }

      function flipRole(group: Group) {
            roleOverride = {...roleOverride, [group.itemId]: group.role === 'active' ? 'diluent' : 'active'};
      }

      function onkeydown(event: KeyboardEvent) {
            const group = matches[cursor];
            if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  cursor = Math.min(cursor + 1, matches.length - 1);
            } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  cursor = Math.max(cursor - 1, 0);
            } else if (event.key === 'Enter' && group) {
                  event.preventDefault();
                  add(group);
            } else if (event.key === 'ArrowRight' && group && group.packages.length > 1 && input?.selectionStart === query.length) {
                  expanded = group.itemId;
            } else if (event.key === 'ArrowLeft' && expanded) {
                  expanded = null;
            } else if (event.key === 'Escape') {
                  if (query) query = '';
                  else onclose?.();
            }
      }
</script>

<div class="panel">
      <form
            bind:this={addForm}
            method="POST"
            action="?/add"
            hidden
            use:enhance={() => {
                  pending = true;
                  return async ({result, update}) => {
                        await update({reset: false});
                        pending = false;
                        if (result.type === 'success') {
                              query = '';
                              input?.focus();
                        } else lastAdded = null;
                  };
            }}
      >
            <input type="hidden" name="role"/>
            <input type="hidden" name="candidate"/>
      </form>

      <input
            bind:this={input}
            aria-label="Search the formulary"
            aria-controls="component-results"
            autocomplete="off"
            bind:value={query}
            placeholder="Add a component — formulary item, package or NDC…"
            spellcheck="false"
            type="search"
            {onkeydown}
      />

      {#if !query.trim()}
            <p class="hint">
                  {#if lastAdded}<span class="added">✓ Added {lastAdded}.</span> {/if}
                  Type to find a formulary item; <kbd>Enter</kbd> adds its preferred package.
            </p>
      {:else if !matches.length}
            <p class="hint">No formulary items match “{query.trim()}”.</p>
      {:else}
            <ul id="component-results" role="listbox" aria-busy={pending}>
                  {#each matches as group, index (group.itemId)}
                        {@const preferred = group.packages[0]}
                        <li
                              role="option"
                              aria-selected={index === cursor}
                              class:current={index === cursor}
                              class:used={group.inUse}
                              onmouseenter={() => (cursor = index)}
                        >
                              <div class="item">
                                    <button type="button" class="pick" disabled={pending} onclick={() => add(group)}>
                                          <span class="name">{group.item}</span>
                                          <span class="sub">
                                                {#if group.inUse}<span class="tag">In compound</span>{/if}
                                                <BrandedName text={preferred.title}/> · {formatNdc(preferred.ndc)}
                                          </span>
                                    </button>
                                    <button
                                          type="button"
                                          class="role"
                                          class:diluent={group.role === 'diluent'}
                                          title="Add as {group.role === 'active' ? 'diluent' : 'active'} instead"
                                          onclick={() => flipRole(group)}
                                    >{group.role === 'active' ? 'Active' : 'Diluent'}</button>
                                    {#if group.packages.length > 1}
                                          <button
                                                type="button"
                                                class="more"
                                                aria-expanded={expanded === group.itemId}
                                                onclick={() => (expanded = expanded === group.itemId ? null : group.itemId)}
                                          >{group.packages.length} pkgs {expanded === group.itemId ? '▴' : '▾'}</button>
                                    {/if}
                              </div>
                              {#if expanded === group.itemId}
                                    <ul class="packages">
                                          {#each group.packages as candidate (candidate.packageId)}
                                                <li>
                                                      <button type="button" disabled={pending} onclick={() => add(group, candidate)}>
                                                            <span class="title"><BrandedName text={candidate.title}/></span>
                                                            {#if usedSet.has(candidate.packageId)}<span class="tag">In compound</span>{/if}
                                                            <span class="ndc">{formatNdc(candidate.ndc)}</span>
                                                      </button>
                                                </li>
                                          {/each}
                                    </ul>
                              {/if}
                        </li>
                  {/each}
            </ul>
      {/if}
</div>

<style>
      .panel {
            margin: 0.75rem 0;
            padding: 0.75rem;
            border: 1px solid #d5dcea;
            border-radius: 10px;
            background: #f8faff;
      }

      .panel > input {
            width: 100%;
            box-sizing: border-box;
            padding: 0.55rem 0.75rem;
            border: 1px solid #c9d1dc;
            border-radius: 8px;
            font: inherit;
      }

      .hint {
            margin: 0.6rem 0 0;
            color: #5c6777;
            font-size: 0.9rem;
      }

      .added {
            color: #1f6b3a;
            font-weight: 600;
      }

      kbd {
            padding: 0 0.3rem;
            border: 1px solid #c9d1dc;
            border-radius: 4px;
            background: #fff;
            font-size: 0.8rem;
      }

      ul {
            margin: 0.6rem 0 0;
            padding: 0;
            list-style: none;
            max-height: 22rem;
            overflow: auto;
      }

      li {
            border-bottom: 1px solid #e3e7ee;
      }

      li.current > .item {
            background: #eef2f8;
      }

      li.used .name {
            color: #5c6777;
      }

      .item {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            padding-right: 0.4rem;
      }

      button {
            font: inherit;
            cursor: pointer;
      }

      button:disabled {
            cursor: progress;
      }

      .pick {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 0.1rem;
            min-width: 0;
            padding: 0.45rem 0.5rem;
            border: 0;
            background: transparent;
            text-align: left;
      }

      .name {
            font-weight: 600;
      }

      .sub {
            color: #5c6777;
            font-size: 0.8rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
      }

      .tag {
            margin-right: 0.35rem;
            padding: 0 0.4rem;
            border-radius: 999px;
            background: #e6f2ea;
            color: #1f6b3a;
            font-size: 0.7rem;
            font-weight: 700;
      }

      .role,
      .more {
            flex: none;
            padding: 0.15rem 0.5rem;
            border: 1px solid #c9d1dc;
            border-radius: 999px;
            background: #fff;
            color: #3464a5;
            font-size: 0.75rem;
      }

      .role.diluent {
            border-color: #8fb3d9;
            background: #e8f1fb;
      }

      .more {
            color: #5c6777;
      }

      .packages {
            margin: 0 0 0.4rem 1rem;
            max-height: none;
            border-left: 2px solid #d5dcea;
      }

      .packages li:last-child {
            border-bottom: 0;
      }

      .packages button {
            display: flex;
            align-items: baseline;
            gap: 0.6rem;
            width: 100%;
            padding: 0.35rem 0.5rem;
            border: 0;
            background: transparent;
            text-align: left;
            font-size: 0.9rem;
      }

      .packages button:hover {
            background: #eef2f8;
      }

      .title {
            flex: 1;
      }

      .ndc {
            color: #5c6777;
            font-size: 0.8rem;
            font-variant-numeric: tabular-nums;
      }
</style>
