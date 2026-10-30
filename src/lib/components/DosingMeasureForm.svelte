<!--
@component
A "⋯" popover for choosing a combination product's dosing measure — the sum of its
ingredients (or a chosen subset), or one ingredient. The choice is saved for the whole
SCD concept through the page's `?/setDosingMeasure` and `?/clearDosingMeasure`
actions.
-->
<script lang="ts">
      import {enhance} from '$app/forms';
      import type { StagedPackage } from '../catalog/types';
      import {type DosingMeasure, dosingMeasureText, ingredientGroups, isCombo} from "$lib/medication/dosing-measure";

      let {
            item,
            measure,
            message = null
      }: {
            /** The package whose concept the measure is saved for. */
            item: StagedPackage;
            /** The saved measure, or null for the default. */
            measure: DosingMeasure | null;
            /** An error from the last submission, shown in the popover. */
            message?: string | null;
      } = $props();

      const groups = $derived(ingredientGroups(item));
      const current = $derived(measure ? dosingMeasureText(item, measure) : null);
      /**
       * The radio value: `sum`, `single` (an ingredient not yet picked), or `ingredient:<group>`.
       */
      let open = $state(false);
      let root = $state<HTMLElement>();
      let choice = $state('');
      /** Groups checked for a sum; all of them unless a subset was saved. */
      let summed = $state<string[]>([]);
      $effect(() => {
            choice = !measure ? '' : measure.mode === 'sum' ? 'sum' : `ingredient:${measure.ingredient}`;
            summed = measure?.mode === 'sum' && measure.ingredients ? [...measure.ingredients] : [...groups];
      });
      const mode = $derived(choice.startsWith('ingredient:') ? 'ingredient' : choice);
      const ingredient = $derived(choice.startsWith('ingredient:') ? choice.slice(11) : '');
</script>

{#if isCombo(item)}
      <div class="dosing" bind:this={root}>
            <span class="label">Dosing measure</span>
            <span class="value" class:unset={!current}>{current ?? 'Not set'}</span>
            <button
                  class="trigger"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-label="Change dosing measure"
                  onclick={() => (open = !open)}>⋯
            </button
            >
            {#if open}
                  <div class="popover" role="dialog" aria-label="Dosing measure">
                        <p class="muted">
                              Saved for the whole SCD concept: every NDC sharing it uses this measure.
                        </p>
                        <form
                              method="POST"
                              action="?/setDosingMeasure"
                              use:enhance={() =>
            async ({ result, update }) => {
              await update({ reset: false });
              if (result.type === 'success') open = false;
            }}
                        >
                              <div class="modes">
                                    <label><input type="radio" bind:group={choice} value="sum"/> Sum of ingredients</label>
                                    <label
                                    ><input
                                          type="radio"
                                          checked={choice !== '' && choice !== 'sum'}
                                          onchange={() => (choice = 'single')}
                                    /> One ingredient</label
                                    >
                              </div>
                              <!-- One list: radios pick a single ingredient; with sum chosen they become the checkboxes of what is summed. -->
                              <div class="options">
                                    {#each groups as name (name)}
                                          <label>
                                                {#if choice === 'sum'}
                                                      <input type="checkbox" name="ingredients" value={name} bind:group={summed}/>
                                                {:else}
                                                      <input type="radio" bind:group={choice} value={`ingredient:${name}`}/>
                                                {/if}
                                                {name}
                                          </label>
                                    {/each}
                              </div>
                              <input type="hidden" name="mode" value={mode}/>
                              <input type="hidden" name="ingredient" value={ingredient}/>
                              <div class="actions">
                                    <button type="submit" disabled={!choice || choice === 'single' || (choice === 'sum' && summed.length < 2)}>Save</button>
                                    {#if measure}
                                          <button type="submit" formaction="?/clearDosingMeasure" class="quiet">Clear
                                          </button>
                                    {/if}
                              </div>
                              {#if message}<p class="error" role="alert">{message}</p>{/if}
                        </form>
                  </div>
            {/if}
      </div>
{/if}

<svelte:window
      onclick={(event) => {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }}
      onkeydown={(event) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      open = false;
    }
  }}
/>

<style>
      .dosing {
            position: relative;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin: 0 0 1rem;
      }

      .label {
            color: #5d6a7d;
            font-size: 0.9rem;
      }

      .value {
            font-weight: 600;
      }

      .value.unset {
            color: #5d6a7d;
            font-weight: 400;
      }

      .trigger {
            padding: 0 0.45rem;
            line-height: 1.3;
            background: none;
            border: 1px solid #c5cedb;
            border-radius: 0.4rem;
            cursor: pointer;
      }

      .popover {
            position: absolute;
            top: 100%;
            left: 0;
            z-index: 10;
            min-width: 17rem;
            margin-top: 0.3rem;
            padding: 0.8rem 1rem;
            background: #fff;
            border: 1px solid #dde3ec;
            border-radius: 0.6rem;
            box-shadow: 0 8px 24px rgb(24 33 47 / 0.14);
      }

      label {
            display: block;
            padding: 0.15rem 0;
            text-transform: capitalize;
      }

      .modes {
            display: flex;
            gap: 1rem;
            margin-bottom: 0.2rem;
      }

      .options {
            max-height: 16rem;
            overflow-y: auto;
      }

      .actions {
            display: flex;
            gap: 0.6rem;
            margin-top: 0.6rem;
      }

      .quiet {
            background: none;
            border: 1px solid #c5cedb;
      }

      .muted {
            color: #5d6a7d;
            font-size: 0.85rem;
            margin: 0 0 0.5rem;
      }

      .error {
            color: #b3261e;
      }
</style>
