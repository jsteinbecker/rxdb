<!--
@component
The compound builder's "add a component" panel. Search finds generics: a drug
by its active ingredients ("Ampicillin"), restricted to the compound's route
when one is chosen. Picking a generic adds one line that may be filled from
any of its packages; the builder then proposes vial combinations for the
dose. A generic can be expanded to add one specific package instead.

The role is guessed per generic (base solutions are diluents) and can be
flipped before adding. After each add the search clears and keeps focus.
Keyboard: ↑/↓ move, Enter adds, → / ← open and close a generic's packages, Esc closes.
-->
<script lang="ts">
      import {enhance} from '$app/forms';
      import BrandedName from '#lib/components/BrandedName.svelte';
      import MixedFraction from './MixedFraction.svelte';
      import {formatNdc} from "#lib/catalog/ndc.ts";
      import {compare, parseRational, type Rational} from "#lib/medication/rational.ts";
      import type {Role} from '#lib/compounds/compound-builder.ts';
      import {readable} from '#lib/compounds/generic-components.ts';

      /** A formulary package that can be added to the compound. */
      type Candidate = {
            packageId: string;
            itemId: string;
            /** The formulary item's display name. */
            item: string;
            /** Rank within its item; lowest is preferred. */
            rank: number;
            ndc: string;
            /** Display title, possibly ending in a `[Brand]` tag. */
            title: string;
            conc: string | null;
            doseUnit: string | null;
            /** Active ingredients as one name ("Ampicillin"); null when unknown. */
            generic: string | null;
            /** Injection routes the listing names. */
            routes: string[];
            /** Content of one vial, for a single-ingredient dry fill. */
            vial: string | null;
            vialUnit: string | null;
      };

      type Generic = {
            key: string;
            name: string;
            packages: (Candidate & {amount: Rational | null})[];
            strengths: {amount: Rational; unit: string}[];
            inUse: boolean;
            role: Role;
      };

      let {candidates, used = [], route = null, onclose}: {
            candidates: Candidate[];
            /** Package ids already in the compound. */
            used?: string[];
            /** The compound's route; when set, only packages given by it (or naming none) are offered. */
            route?: string | null;
            onclose?: () => void;
      } = $props();

      let query = $state('');
      let cursor = $state(0);
      let expanded = $state<string | null>(null);
      let roleOverride = $state<Record<string, Role>>({});
      let input: HTMLInputElement | undefined = $state();
      let addForm: HTMLFormElement | undefined = $state();
      let pending = $state(false);
      let lastAdded = $state<string | null>(null);

      const DILUENT = /\b(sodium chloride|dextrose|sterile water|water for injection|lactated ringer|ringer'?s|bacteriostatic|plasma-lyte|normosol)\b/i;
      const guessRole = (name: string): Role => (!name.includes(' / ') && DILUENT.test(name) ? 'diluent' : 'active');

      const usedSet = $derived(new Set(used));
      const generics = $derived.by<Generic[]>(() => {
            const byKey = new Map<string, Generic['packages']>();
            for (const candidate of candidates) {
                  if (route && candidate.routes.length && !candidate.routes.includes(route)) continue;
                  // Diluents and unparsed products stay per item: their "generic" is the item itself.
                  const key = candidate.generic && !DILUENT.test(candidate.generic) ? candidate.generic : `item:${candidate.itemId}`;
                  const entry = {...candidate, amount: candidate.vial ? parseRational(candidate.vial) : null};
                  const list = byKey.get(key);
                  if (list) list.push(entry);
                  else byKey.set(key, [entry]);
            }
            return [...byKey.entries()].map(([key, packages]) => {
                  // Largest vial first, then the formulary's own preference.
                  packages.sort((a, b) =>
                        (a.amount && b.amount ? compare(b.amount, a.amount) : Number(!a.amount) - Number(!b.amount)) || a.rank - b.rank);
                  const name = key.startsWith('item:') ? packages[0].item : key;
                  const strengths: Generic['strengths'] = [];
                  for (const p of packages)
                        if (p.amount && p.vialUnit && !strengths.some((s) => compare(s.amount, p.amount!) === 0))
                              strengths.push({amount: p.amount, unit: p.vialUnit});
                  return {
                        key,
                        name,
                        packages,
                        strengths,
                        inUse: packages.some((p) => usedSet.has(p.packageId)),
                        role: roleOverride[key] ?? guessRole(name)
                  };
            });
      });

      const LIMIT = 25;
      const matches = $derived.by(() => {
            const words = query.toLowerCase().split(/\s+/).filter(Boolean);
            if (!words.length) return [];
            const digits = query.replace(/\D/g, '');
            const scored = generics
                  .map((generic) => {
                        const name = generic.name.toLowerCase();
                        const hits = (text: string) => words.every((word) => text.includes(word));
                        let score = -1;
                        if (hits(name)) score = name.startsWith(words[0]) ? 3 : 2;
                        else if (generic.packages.some((p) => hits(p.title.toLowerCase()) || hits(p.item.toLowerCase()))) score = 1;
                        else if (digits.length >= 4 && generic.packages.some((p) => p.ndc.includes(digits))) score = 1;
                        return {generic, score};
                  })
                  .filter(({score}) => score >= 0);
            scored.sort(
                  (a, b) =>
                        Number(a.generic.inUse) - Number(b.generic.inUse) ||
                        b.score - a.score ||
                        a.generic.name.length - b.generic.name.length ||
                        a.generic.name.localeCompare(b.generic.name)
            );
            return scored.slice(0, LIMIT).map(({generic}) => generic);
      });

      $effect(() => {
            void query;
            cursor = 0;
            expanded = null;
      });

      $effect(() => {
            input?.focus();
      });

      /** Add the whole generic, or one package of it. */
      function add(generic: Generic, only?: Candidate) {
            if (!addForm || pending) return;
            const packages = only ? [only] : generic.packages;
            const preferred = packages[0];
            const units = new Set(packages.map((p) => p.vialUnit));
            (addForm.elements.namedItem('role') as HTMLInputElement).value = generic.role;
            (addForm.elements.namedItem('candidate') as HTMLInputElement).value = JSON.stringify({
                  packageIds: packages.map((p) => p.packageId),
                  conc: packages.length === 1 ? preferred.conc : null,
                  doseUnit: units.size === 1 && preferred.vialUnit ? preferred.vialUnit : preferred.doseUnit
            });
            lastAdded = only ? only.title : `${generic.name}${route ? ` ${route}` : ''}`;
            addForm.requestSubmit();
      }

      function flipRole(generic: Generic) {
            roleOverride = {...roleOverride, [generic.key]: generic.role === 'active' ? 'diluent' : 'active'};
      }

      function onkeydown(event: KeyboardEvent) {
            const generic = matches[cursor];
            if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  cursor = Math.min(cursor + 1, matches.length - 1);
            } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  cursor = Math.max(cursor - 1, 0);
            } else if (event.key === 'Enter' && generic) {
                  event.preventDefault();
                  add(generic);
            } else if (event.key === 'ArrowRight' && generic && generic.packages.length > 1 && input?.selectionStart === query.length) {
                  expanded = generic.key;
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
            placeholder={route ? `Add a drug given ${route} — e.g. ampicillin, cefazolin…` : 'Add a drug — e.g. ampicillin, cefazolin…'}
            spellcheck="false"
            type="search"
            {onkeydown}
      />

      {#if !query.trim()}
            <p class="hint">
                  {#if lastAdded}<span class="added">✓ Added {lastAdded}.</span> {/if}
                  Pick the drug, then enter the dose — the builder works out which vials to pull.
                  {#if !route}<span class="warn">Choose a route above to see only the products given by it.</span>{/if}
            </p>
      {:else if !matches.length}
            <p class="hint">Nothing on the formulary matches “{query.trim()}”{route ? ` for ${route}` : ''}.</p>
      {:else}
            <ul id="component-results" role="listbox" aria-busy={pending}>
                  {#each matches as generic, index (generic.key)}
                        <li
                              role="option"
                              aria-selected={index === cursor}
                              class:current={index === cursor}
                              class:used={generic.inUse}
                              onmouseenter={() => (cursor = index)}
                        >
                              <div class="item">
                                    <button type="button" class="pick" disabled={pending} onclick={() => add(generic)}>
                                          <span class="name">{generic.name}{#if route}<span class="route">{route}</span>{/if}</span>
                                          <span class="sub">
                                                {#if generic.inUse}<span class="tag">In compound</span>{/if}
                                                {#if generic.strengths.length}
                                                      Vials:
                                                      {#each generic.strengths as strength, at}{#if at} · {/if}<MixedFraction {...readable(strength.amount, strength.unit)} />{/each}
                                                {:else if generic.packages.length === 1}
                                                      <BrandedName text={generic.packages[0].title}/> · {formatNdc(generic.packages[0].ndc)}
                                                {:else}
                                                      {generic.packages.length} products
                                                {/if}
                                          </span>
                                    </button>
                                    <button
                                          type="button"
                                          class="role"
                                          class:diluent={generic.role === 'diluent'}
                                          title="Add as {generic.role === 'active' ? 'diluent' : 'active'} instead"
                                          onclick={() => flipRole(generic)}
                                    >{generic.role === 'active' ? 'Active' : 'Diluent'}</button>
                                    {#if generic.packages.length > 1}
                                          <button
                                                type="button"
                                                class="more"
                                                aria-expanded={expanded === generic.key}
                                                title="Add one specific package instead"
                                                onclick={() => (expanded = expanded === generic.key ? null : generic.key)}
                                          >{generic.packages.length} pkgs {expanded === generic.key ? '▴' : '▾'}</button>
                                    {/if}
                              </div>
                              {#if expanded === generic.key}
                                    <ul class="packages">
                                          {#each generic.packages as candidate (candidate.packageId)}
                                                <li>
                                                      <button type="button" disabled={pending} onclick={() => add(generic, candidate)}>
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

      .warn {
            display: block;
            margin-top: 0.25rem;
            color: #9a5b00;
      }

      .route {
            margin-left: 0.4rem;
            padding: 0 0.4rem;
            border-radius: 4px;
            background: #ecebf8;
            color: #4b45a8;
            font-size: 0.75rem;
            font-weight: 700;
            vertical-align: middle;
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
