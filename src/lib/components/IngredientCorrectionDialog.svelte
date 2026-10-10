<script lang="ts">
      import {untrack} from 'svelte';
      import {deserialize} from '$app/forms';
      import {invalidateAll} from '$app/navigation';
      import type {StagedPackage} from '$lib/server/catalog-sync';
      import type {EquivalentPackage} from '$lib/property-override-fields';
      import type {StrengthBasis} from '$lib/spl-ingredients';
      import {
            describeCorrection,
            formatStrength,
            type IngredientCorrection,
            ingredientAsCorrection,
            ingredientCorrectionKey,
            parseIngredientCorrection,
            parseStrengthText,
            sameIngredientRow,
            serializeIngredientCorrection
      } from '$lib/ingredient-correction';
      import {conversionFactor, convertStrength, roundSignificant} from '$lib/strength-conversion';
      import {appendCitation, type CitationDraft, citationReady, emptyCitation} from '$lib/citation-form';
      import CitationPicker from './CitationPicker.svelte';

      type Answer =
            | { status: 'ok'; fetchedAt: string; substance: Substance }
            | { status: 'not-found' | 'unavailable' | 'loading' };
      type Substance = {
            unii: string;
            name: string | null;
            formula: string | null;
            mw: number | null;
            moiety: { unii: string; name: string } | null;
            moietyCount: number | null;
      };
      type Kind = 'substance' | 'basis' | 'unlisted';
      type Step = 'kind' | 'identify' | 'convert' | 'cite' | 'review';

      let {item, equivalents = []}: { item: StagedPackage; equivalents?: EquivalentPackage[] } = $props();

      const KINDS: { id: Kind; title: string; hint: string }[] = [
            {id: 'substance', title: 'The label names the wrong substance', hint: 'The strength number is right; the substance is not.'},
            {id: 'basis', title: 'The strength is stated as a different substance', hint: 'e.g. the number is the free base, not the salt.'},
            {id: 'unlisted', title: 'The strength is measured as a substance the label never lists', hint: 'Identify the basis substance by its UNII.'}
      ];
      const BASES: { id: StrengthBasis; label: string }[] = [
            {id: 'ingredient', label: 'The ingredient itself'},
            {id: 'moiety', label: 'Its active moiety'},
            {id: 'reference', label: 'A reference substance'}
      ];
      const UNII = /^[A-Z0-9]{10}$/;
      const cleanUnii = (value: string) => value.trim().toUpperCase();

      let dialog: HTMLDialogElement;
      let index = $state(-1);
      let step = $state<Step>('kind');
      let kind = $state<Kind | null>(null);
      let touched = $state(false);
      let busy = $state(false);
      let message = $state('');

      // What the user typed; null means "use the default derived from the row and GSRS".
      let ingUnii = $state('');
      let ingName = $state<string | null>(null);
      let basis = $state<StrengthBasis>('ingredient');
      let moietyUnii = $state<string | null>(null);
      let moietyName = $state<string | null>(null);
      let confirmIng = $state(false);
      let fromUnii = $state<string | null>(null);
      let mwFromInput = $state<string | null>(null);
      let mwToInput = $state<string | null>(null);
      let nInput = $state<string | null>(null);
      let valueInput = $state<string | null>(null);
      let relabelOnly = $state(false);
      let citation = $state<CitationDraft>(emptyCitation(false));

      const key = $derived(ingredientCorrectionKey(index));
      const row = $derived(index < 0 ? undefined : item.details?.spl?.ingredients[index]);
      const existing = $derived(
            parseIngredientCorrection(item.propertyOverrides?.[key]?.value ?? '') ?? null
      );
      // Only a lone moiety is a default; NS lists chloride ion and sodium cation.
      const rowMoiety = $derived(row?.moieties.length === 1 && row.moieties[0].unii ? row.moieties[0] : null);

      // ── GSRS ──────────────────────────────────────────────────────────────────
      let cards = $state<Record<string, Answer>>({});
      async function ensure(unii: string) {
            if (!UNII.test(unii) || cards[unii]) return;
            cards[unii] = {status: 'loading'};
            try {
                  const response = await fetch(`/api/unii/${unii}`);
                  cards[unii] = response.ok ? await response.json() : {status: 'unavailable'};
            } catch {
                  cards[unii] = {status: 'unavailable'};
            }
      }
      const card = (unii: string | null): Answer | null => (unii ? (cards[unii] ?? null) : null);
      const substanceOf = (unii: string | null) => {
            const answer = card(unii);
            return answer?.status === 'ok' ? answer.substance : null;
      };

      // ── Identify ──────────────────────────────────────────────────────────────
      const ingFinal = $derived(cleanUnii(ingUnii));
      const ingChanged = $derived(!!ingFinal && ingFinal !== (row?.unii ?? ''));
      const ingSubstance = $derived(substanceOf(ingFinal));
      const nameFinal = $derived(
            (ingName ?? '').trim() || ingSubstance?.name || (ingChanged ? '' : (row?.name ?? ''))
      );
      const mismatch = $derived(
            ingChanged && !!ingSubstance?.name && ingSubstance.name.toLowerCase() !== row?.name.toLowerCase()
      );
      const moietyDefault = $derived(
            ingChanged ? (ingSubstance?.moiety ?? null) : (rowMoiety ?? ingSubstance?.moiety ?? null)
      );
      const moietyFinalUnii = $derived(cleanUnii(moietyUnii ?? moietyDefault?.unii ?? ''));
      const moietySubstance = $derived(substanceOf(moietyFinalUnii));
      const moietyNameFinal = $derived(
            (moietyName ?? '').trim() ||
            (moietyFinalUnii === moietyDefault?.unii ? moietyDefault.name : '') ||
            moietySubstance?.name ||
            ''
      );
      const moietyListed = $derived(
            !!row?.moieties.some((moiety) => moiety.unii === moietyFinalUnii)
      );

      // ── Convert ───────────────────────────────────────────────────────────────
      const originalText = $derived(existing?.conversion?.original ?? row?.strength ?? null);
      const original = $derived(parseStrengthText(originalText));
      const measuredTo = $derived(basis === 'ingredient' ? ingFinal : moietyFinalUnii);
      const fromDefault = $derived(
            existing?.conversion?.from.unii ?? (rowMoiety && row?.basis !== 'ingredient' ? rowMoiety.unii : row?.unii) ?? ''
      );
      const fromFinal = $derived(cleanUnii(fromUnii ?? fromDefault ?? ''));
      const needsConversion = $derived(
            UNII.test(measuredTo) && UNII.test(fromFinal) && measuredTo !== fromFinal
      );
      const fromSubstance = $derived(substanceOf(fromFinal));
      const toSubstance = $derived(substanceOf(measuredTo));
      const mwFromText = $derived(mwFromInput ?? (fromSubstance?.mw != null ? String(fromSubstance.mw) : ''));
      const mwToText = $derived(mwToInput ?? (toSubstance?.mw != null ? String(toSubstance.mw) : ''));
      // Units of the measured-from substance per unit of the measured-to one.
      const nDefault = $derived.by(() => {
            if (toSubstance?.moiety?.unii === fromFinal && toSubstance.moietyCount) return toSubstance.moietyCount;
            if (fromSubstance?.moiety?.unii === measuredTo && fromSubstance.moietyCount)
                  return 1 / fromSubstance.moietyCount;
            return 1;
      });
      const nText = $derived(nInput ?? String(Number(nDefault.toPrecision(12))));
      const factor = $derived(conversionFactor(mwFromText, mwToText, nText));
      const converted = $derived(
            original && factor && !relabelOnly ? convertStrength(original.value, factor) : null
      );
      const valueFinal = $derived(
            !original
                  ? ''
                  : !needsConversion || relabelOnly
                        ? original.value
                        : (valueInput ?? (converted ? roundSignificant(converted) : ''))
      );
      const mwEdited = $derived(
            mwFromText !== String(fromSubstance?.mw ?? '') || mwToText !== String(toSubstance?.mw ?? '')
      );
      const gsrsStamp = $derived.by(() => {
            const stamps = [card(fromFinal), card(measuredTo)].flatMap((answer) =>
                  answer?.status === 'ok' ? [answer.fetchedAt] : []
            );
            return stamps.length ? stamps.sort()[0] : null;
      });
      const formula = $derived(
            original && needsConversion && !relabelOnly && converted
                  ? `${original.value} ${original.unit} × ${mwToText} / (${nText} × ${mwFromText}) = ${converted} ${original.unit}`
                  : ''
      );

      // ── The correction being built ────────────────────────────────────────────
      const built = $derived.by((): IngredientCorrection | null => {
            if (!original || !UNII.test(ingFinal) || !nameFinal || !valueFinal) return null;
            if (basis !== 'ingredient' && (!UNII.test(moietyFinalUnii) || !moietyNameFinal)) return null;
            const converting = needsConversion && !relabelOnly;
            const mwFrom = Number(mwFromText);
            const mwTo = Number(mwToText);
            if (converting && (!factor || !(mwFrom > 0) || !(mwTo > 0) || !(Number(nText) > 0))) return null;
            const correction: IngredientCorrection = {
                  ...(ingChanged && {substance: {name: nameFinal, unii: ingFinal}}),
                  basis,
                  ...(basis !== 'ingredient' && {moiety: {name: moietyNameFinal, unii: moietyFinalUnii}}),
                  strength: {...original, value: valueFinal},
                  ...(converting && {
                        conversion: {
                              from: {unii: fromFinal, mw: mwFrom},
                              to: {unii: measuredTo, mw: mwTo},
                              n: Number(nText),
                              factor: factor!,
                              original: originalText ?? '',
                              gsrsFetchedAt: mwEdited ? null : gsrsStamp,
                              mwEdited
                        }
                  })
            };
            return parseIngredientCorrection(serializeIngredientCorrection(correction)) ? correction : null;
      });
      const rowNow = $derived(row ? ingredientAsCorrection(row) : null);
      const changes = $derived(!!built && (!rowNow || !sameIngredientRow(built, rowNow)));
      const candidates = $derived(
            built
                  ? equivalents.filter((equivalent) => {
                        const theirs = parseIngredientCorrection(equivalent.values[key] ?? '');
                        return !!theirs && sameIngredientRow(theirs, built);
                  })
                  : []
      );

      const steps = $derived<Step[]>([
            'kind',
            'identify',
            ...(needsConversion ? (['convert'] as Step[]) : []),
            'cite',
            'review'
      ]);
      const position = $derived(steps.indexOf(step));
      const valid = $derived.by(() => {
            switch (step) {
                  case 'kind':
                        return !!kind && !!original;
                  case 'identify':
                        return (
                              UNII.test(ingFinal) &&
                              !!nameFinal &&
                              (!mismatch || confirmIng) &&
                              (basis === 'ingredient' || (UNII.test(moietyFinalUnii) && !!moietyNameFinal)) &&
                              (!needsConversion || !!built || relabelOnly) &&
                              (needsConversion ? true : changes)
                        );
                  case 'convert':
                        return !!built;
                  case 'cite':
                        return citationReady(citation) && (citation.source !== 'ndc' || candidates.length > 0);
                  default:
                        return !!built && changes;
            }
      });

      $effect(() => {
            for (const unii of [ingFinal, moietyFinalUnii, fromFinal, measuredTo]) untrack(() => ensure(unii));
      });
      $effect(() => {
            // A different substance is a different thing to confirm.
            void ingFinal;
            confirmIng = false;
      });

      export function open(at: number) {
            index = at;
            const target = item.details?.spl?.ingredients[at];
            const prior = parseIngredientCorrection(item.propertyOverrides?.[ingredientCorrectionKey(at)]?.value ?? '');
            ingUnii = prior?.substance?.unii ?? target?.unii ?? '';
            ingName = prior?.substance?.name ?? null;
            basis = prior?.basis ?? (target?.basis === 'moiety' || target?.basis === 'reference' ? target.basis : 'ingredient');
            moietyUnii = prior?.moiety?.unii ?? null;
            moietyName = prior?.moiety?.name ?? null;
            fromUnii = null;
            mwFromInput = prior?.conversion ? String(prior.conversion.from.mw) : null;
            mwToInput = prior?.conversion ? String(prior.conversion.to.mw) : null;
            nInput = prior?.conversion ? String(prior.conversion.n) : null;
            valueInput = prior?.conversion ? prior.strength.value : null;
            relabelOnly = false;
            kind = prior ? 'basis' : null;
            citation = emptyCitation(!!item.splSetId && !!item.details?.label?.sections.length);
            confirmIng = !!prior?.substance;
            touched = false;
            message = '';
            step = 'kind';
            dialog.showModal();
      }

      function choose(next: Kind) {
            kind = next;
            touched = true;
            relabelOnly = next === 'substance';
            if (next === 'unlisted' && basis === 'ingredient') basis = 'moiety';
      }

      const go = (delta: number) => (step = steps[Math.max(0, Math.min(steps.length - 1, position + delta))]);

      function close() {
            if (busy) return;
            if (touched && !confirm('Discard this correction?')) return;
            dialog.close();
      }

      async function save() {
            if (!built) return;
            busy = true;
            message = '';
            const form = new FormData();
            form.set('key', key);
            form.set('value', serializeIngredientCorrection(built));
            appendCitation(form, citation);
            try {
                  const response = await fetch('?/override', {method: 'POST', body: form});
                  const result = deserialize(await response.text());
                  if (result.type === 'success') {
                        touched = false;
                        await invalidateAll();
                        dialog.close();
                  } else
                        message =
                              result.type === 'failure'
                                    ? String(result.data?.message ?? 'Could not save the correction.')
                                    : 'Could not save the correction.';
            } catch {
                  message = 'Could not save the correction.';
            } finally {
                  busy = false;
            }
      }

      const STEP_TITLES: Record<Step, string> = {
            kind: 'What’s wrong?',
            identify: 'Identify the substances',
            convert: 'Convert the strength',
            cite: 'Cite',
            review: 'Review'
      };
      const rowText = (name: string, strength: string | null, basisText: string | null) =>
            `${name} · ${strength ?? '—'}${basisText ? ` · basis ${basisText}` : ''}`;
</script>

{#snippet substanceCard(unii: string)}
      {@const answer = card(unii)}
      {#if UNII.test(unii) && answer}
            <div class="gsrs" data-status={answer.status}>
                  {#if answer.status === 'loading'}
                        Looking up {unii} in GSRS…
                  {:else if answer.status === 'ok'}
                        <b>{answer.substance.name ?? unii}</b>
                        <span class="mono">{answer.substance.formula ?? 'no structure'}</span>
                        <span>MW {answer.substance.mw ?? '—'}</span>
                        {#if answer.substance.moiety}<span>moiety {answer.substance.moiety.name}</span>{/if}
                        {#if answer.substance.mw == null}
                              <p class="warn">GSRS has no structure for this substance (protein, mixture or polymer), so it has no molecular weight. You can enter one by hand when converting.</p>
                        {/if}
                  {:else if answer.status === 'not-found'}
                        <span class="warn">GSRS does not know {unii}. Check the UNII.</span>
                  {:else}
                        <span class="warn">GSRS did not answer. Enter names and molecular weights by hand.</span>
                  {/if}
            </div>
      {/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog aria-labelledby="correct-title" bind:this={dialog} oncancel={(event) => { if (touched || busy) { event.preventDefault(); close(); } }}>
      <header>
            <h2 id="correct-title">Correct ingredient{row ? ` · ${row.name}` : ''}</h2>
            <p>Step {position + 1} of {steps.length} · {STEP_TITLES[step]}</p>
            <button aria-label="Close" class="close" onclick={close} type="button">×</button>
      </header>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="body" oninput={() => (touched = true)}>
            {#if !row}
                  <p>No ingredient selected.</p>
            {:else if step === 'kind'}
                  <p class="current"><span>Current row</span> {rowText(row.name, row.strength, row.basis)}
                        {#if row.unii}<span class="mono"> · {row.unii}</span>{/if}</p>
                  {#if !original}
                        <p class="warn">This row’s strength ({row.strength ?? 'none'}) is not a number and unit, so it cannot be corrected here. Use the strength override.</p>
                  {/if}
                  <div class="kinds" role="radiogroup">
                        {#each KINDS as option (option.id)}
                              <label class="kind" class:picked={kind === option.id}>
                                    <input type="radio" name="kind" checked={kind === option.id} onchange={() => choose(option.id)}/>
                                    <span><b>{option.title}</b><small>{option.hint}</small></span>
                              </label>
                        {/each}
                  </div>
            {:else if step === 'identify'}
                  <label>Ingredient UNII
                        <input class="mono" bind:value={ingUnii} maxlength="10" spellcheck="false" placeholder="10 letters and digits"/>
                  </label>
                  {@render substanceCard(ingFinal)}
                  {#if ingChanged}
                        <label>Name <input bind:value={ingName} placeholder={ingSubstance?.name ?? ''} maxlength="300"/></label>
                  {/if}
                  {#if mismatch}
                        <label class="confirm">
                              <input type="checkbox" bind:checked={confirmIng}/>
                              <span class="warn">The label names “{row.name}”, but GSRS says {ingUnii.toUpperCase()} is “{ingSubstance?.name}”. I confirm this is the right substance.</span>
                        </label>
                  {/if}
                  <fieldset>
                        <legend>The strength number measures</legend>
                        {#each BASES as option (option.id)}
                              <label class="radio">
                                    <input type="radio" name="basis" checked={basis === option.id} onchange={() => (basis = option.id)}/>
                                    {option.label}
                              </label>
                        {/each}
                  </fieldset>
                  {#if basis !== 'ingredient'}
                        <label>{basis === 'moiety' ? 'Moiety' : 'Reference substance'} UNII
                              <input class="mono" value={moietyUnii ?? moietyDefault?.unii ?? ''} oninput={(event) => (moietyUnii = event.currentTarget.value)}
                                     maxlength="10" spellcheck="false"/>
                        </label>
                        {@render substanceCard(moietyFinalUnii)}
                        <label>Name <input bind:value={moietyName} placeholder={moietyDefault?.name ?? moietySubstance?.name ?? ''} maxlength="300"/></label>
                        {#if UNII.test(moietyFinalUnii) && !moietyListed}
                              <p class="hint">The label does not list this substance; it will be added to the row as its {basis}.</p>
                        {/if}
                  {/if}
                  {#if needsConversion}
                        <p class="hint">The measured substance changes, so the next step converts the strength.</p>
                  {/if}
            {:else if step === 'convert' && original}
                  <p class="current"><span>Label strength</span> {originalText}
                        measured as <span class="mono">{fromFinal}</span> → should be measured as
                        <span class="mono">{measuredTo}</span></p>
                  <label class="radio">
                        <input type="checkbox" bind:checked={relabelOnly}/>
                        Relabel only — keep {original.value} {original.unit} as it is
                  </label>
                  {#if !relabelOnly}
                        <label>Label’s number measures (UNII)
                              <input class="mono" value={fromFinal} oninput={(event) => (fromUnii = event.currentTarget.value)} maxlength="10"/>
                        </label>
                        {@render substanceCard(fromFinal)}
                        <div class="mws">
                              <label>MW of {fromFinal}
                                    <input inputmode="decimal" value={mwFromText} oninput={(event) => (mwFromInput = event.currentTarget.value)}/>
                                    {#if mwEdited && mwFromText !== String(fromSubstance?.mw ?? '')}<small class="badge">edited</small>{/if}
                              </label>
                              <label>MW of {measuredTo}
                                    <input inputmode="decimal" value={mwToText} oninput={(event) => (mwToInput = event.currentTarget.value)}/>
                                    {#if mwToText !== String(toSubstance?.mw ?? '')}<small class="badge">edited</small>{/if}
                              </label>
                              <label>n <small>(units of the first per one of the second)</small>
                                    <input inputmode="decimal" value={nText} oninput={(event) => (nInput = event.currentTarget.value)}/>
                                    {#if nText !== String(Number(nDefault.toPrecision(12)))}<small class="badge">edited</small>{/if}
                              </label>
                        </div>
                        {#if !factor}
                              <p class="warn">Molecular weights and n must be positive numbers.</p>
                        {:else}
                              <p class="formula mono">{formula}</p>
                              <label>Corrected strength ({original.unit})
                                    <input inputmode="decimal" value={valueFinal} oninput={(event) => (valueInput = event.currentTarget.value)}/>
                                    <small>Exact factor {factor} is kept with the correction.</small>
                              </label>
                        {/if}
                  {/if}
            {:else if step === 'cite'}
                  <CitationPicker {item} bind:draft={citation} {candidates}
                                  describe={(equivalent) => {
                                        const theirs = parseIngredientCorrection(equivalent.values[key] ?? '');
                                        return theirs ? describeCorrection(theirs, row.name) : '';
                                  }}/>
            {:else if built}
                  <table class="review">
                        <thead><tr><th></th><th>Before</th><th>After</th></tr></thead>
                        <tbody>
                        <tr><th>Substance</th><td>{row.name}</td><td>{built.substance?.name ?? row.name}</td></tr>
                        <tr><th>UNII</th><td class="mono">{row.unii ?? '—'}</td><td class="mono">{built.substance?.unii ?? row.unii ?? '—'}</td></tr>
                        <tr><th>Strength</th><td>{originalText ?? '—'}</td><td>{formatStrength(built.strength)}</td></tr>
                        <tr><th>Basis</th><td>{row.basis ?? '—'}</td><td>{built.basis}{built.moiety ? ` · ${built.moiety.name} (${built.moiety.unii})` : ''}</td></tr>
                        </tbody>
                  </table>
                  {#if built.conversion}<p class="formula mono">{formula || `× ${built.conversion.factor}`}</p>{/if}
                  <p class="hint">
                        This applies to every package of the same product (sibling NDCs), and corrected UNIIs
                        appear in UNII usage. Removing the correction restores any strength override on this row.
                  </p>
                  {#if item.propertyOverrides?.[`details.spl.ingredients.${index}.strength`]}
                        <p class="hint">This row’s strength override will be superseded by the correction.</p>
                  {/if}
            {/if}
      </div>

      <footer>
            {#if message}<p class="error">{message}</p>{/if}
            <button type="button" onclick={close}>Cancel</button>
            {#if position > 0}<button type="button" onclick={() => go(-1)}>← Back</button>{/if}
            {#if step === 'review'}
                  <button type="button" class="primary" disabled={busy || !valid} onclick={save}>
                        {busy ? 'Saving…' : 'Save correction'}
                  </button>
            {:else}
                  <button type="button" class="primary" disabled={!valid} onclick={() => go(1)}>Next →</button>
            {/if}
      </footer>
</dialog>

<style>
      dialog {
            width: min(720px, calc(100vw - 2rem));
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

      .body {
            display: grid;
            gap: 0.8rem;
            align-content: start;
            overflow: auto;
            padding: 1rem 1.25rem;
            font-size: 0.9rem;
      }

      label {
            display: grid;
            gap: 0.3rem;
            font-weight: 600;
      }

      label small {
            color: #7a8594;
            font-weight: 400;
      }

      input:not([type='radio']):not([type='checkbox']) {
            box-sizing: border-box;
            width: 100%;
            padding: 0.5rem;
            border: 1px solid #bfc9d6;
            border-radius: 6px;
            font: inherit;
            font-weight: 400;
      }

      .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.85rem;
      }

      .current span:first-child {
            color: #5c6777;
            font-size: 0.78rem;
            margin-right: 0.4rem;
      }

      .kinds {
            display: grid;
            gap: 0.5rem;
      }

      .kind,
      label.radio,
      label.confirm {
            display: flex;
            gap: 0.6rem;
            align-items: flex-start;
            font-weight: 400;
      }

      .kind {
            padding: 0.7rem 0.8rem;
            border: 1px solid #d8dee8;
            border-radius: 8px;
            cursor: pointer;
      }

      .kind.picked {
            border-color: #3464a5;
            background: #f5f8fd;
      }

      .kind span {
            display: grid;
            gap: 0.15rem;
      }

      fieldset {
            display: grid;
            gap: 0.3rem;
            margin: 0;
            padding: 0.5rem 0.8rem;
            border: 1px solid #d8dee8;
            border-radius: 8px;
      }

      legend {
            padding: 0 0.3rem;
            font-weight: 600;
      }

      .gsrs {
            display: flex;
            flex-wrap: wrap;
            gap: 0.3rem 0.8rem;
            padding: 0.5rem 0.7rem;
            border-radius: 8px;
            background: #f4f6f9;
            font-size: 0.85rem;
      }

      .gsrs p {
            flex-basis: 100%;
            margin: 0;
      }

      .mws {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.6rem;
      }

      .badge {
            justify-self: start;
            padding: 0 0.4rem;
            border-radius: 999px;
            background: #fff0a6;
            color: #6b5400 !important;
            font-weight: 600 !important;
      }

      .formula {
            margin: 0;
            padding: 0.5rem 0.7rem;
            border-radius: 8px;
            background: #f4f6f9;
            overflow-wrap: anywhere;
      }

      .hint {
            margin: 0;
            color: #5c6777;
            font-size: 0.82rem;
      }

      .warn {
            margin: 0;
            color: #8a5a00;
      }

      .error {
            margin: 0 auto 0 0;
            color: #a32b2b;
      }

      .review {
            width: 100%;
            border-collapse: collapse;
      }

      .review th,
      .review td {
            padding: 0.4rem 0.5rem;
            border-bottom: 1px solid #eef1f5;
            text-align: left;
            font-weight: 400;
      }

      .review th {
            color: #5c6777;
            font-weight: 600;
      }

      footer {
            display: flex;
            justify-content: flex-end;
            gap: 0.5rem;
            padding: 0.8rem 1.25rem;
            border-top: 1px solid #e6eaf0;
      }

      footer button {
            padding: 0.45rem 0.9rem;
            border: 1px solid #bfc9d6;
            border-radius: 7px;
            background: #fff;
            font: inherit;
            cursor: pointer;
      }

      footer .primary {
            border-color: #3464a5;
            background: #3464a5;
            color: #fff;
            font-weight: 650;
      }

      footer .primary:disabled {
            border-color: #bfc9d6;
            background: #e3e8ee;
            color: #8993a0;
            cursor: default;
      }
</style>
