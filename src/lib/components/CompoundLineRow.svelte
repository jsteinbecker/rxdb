<!--
@component
One component line of the compound builder: its concentration, amount and volume as
quantity fields, and a row menu to remove it. Diluent lines show only a volume.
`locked` shows the values read-only.
-->
<script lang="ts">
      import QuantityField from './QuantityField.svelte';
      import BrandedName from '#lib/components/BrandedName.svelte';
      import MixedFraction from './MixedFraction.svelte';
      import {formatRational, type Rational} from "#lib/medication/rational.ts";
      import {type Field, type Line, VOLUME_UNIT} from "#lib/compounds/compound-builder.ts";

      let {
            line,
            locked = false,
            menuOpen = false,
            oncommit,
            ontoggleMenu,
            onremove
      }: {
            /** The line to show and edit. */
            line: Line;
            /** Show values read-only, without the row menu. */
            locked?: boolean;
            /** Whether this row's menu is the one open. */
            menuOpen?: boolean;
            /** A field was committed; false means it was refused and the box should show the old value. */
            oncommit: (field: Field, value: Rational | null) => boolean;
            /** Open or close this row's menu. */
            ontoggleMenu: () => void;
            /** Remove the line from the compound. */
            onremove: () => void;
      } = $props();

      const show = (value: Rational | null) => (value ? formatRational(value) : '');

      /**
       * Each box shows its line value; it follows the line whenever the line
       * changes (a solved Vol, a reload) and is the user's own text while typing.
       */
      let concText = $state('');
      let doseText = $state('');
      let volumeText = $state('');
      $effect(() => {
            concText = show(line.conc);
      });
      $effect(() => {
            doseText = show(line.dose);
      });
      $effect(() => {
            volumeText = show(line.volume);
      });

      /**
       * An empty box clears the value; text that does not read as a positive
       * quantity is a half-finished or mistyped entry, so the last good value
       * comes back instead of wiping what was saved.
       */
      function commit(
            field: Field,
            quantity: { rational: Rational } | null,
            text: string,
            restore: () => void
      ) {
            if (!quantity && text.trim()) return restore();
            if (!oncommit(field, quantity?.rational ?? null)) restore();
      }

      const concUnit = $derived(`${line.doseUnit}/${VOLUME_UNIT}`);
      const isDiluent = $derived(line.role === 'diluent');
</script>

<div class="line" class:diluent={isDiluent} role="row">
      <div class="cell identity" role="cell">
            <span class="label"><BrandedName text={line.label} /></span>
            <span class="sub">{isDiluent ? 'Diluent' : `${line.doseUnit} per ${VOLUME_UNIT}`}</span>
      </div>

      {#snippet entry(field: Field, caption: string, value: Rational | null, unit: string, text: string, setText: (next: string) => void)}
            <div class="cell field" role="cell" data-caption={caption}>
                  {#if locked}
                        {#if value}
                              <strong><MixedFraction {value} {unit}/></strong>
                        {:else}<span class="blank">—</span>
                        {/if}
                  {:else}
                        <QuantityField
                              bind:value={() => text, setText}
                              {unit}
                              variant="field"
                              showUnit={false}
                              exclusiveMin
                              min={0}
                              ariaLabel="{caption}, {line.label}"
                              placeholder="—"
                              oncommit={(quantity) => commit(field, quantity, text, () => setText(show(value)))}
                        />
                        <span class="unit">{unit}</span>
                  {/if}
            </div>
      {/snippet}

      {#if isDiluent}
            <div class="cell field empty" role="cell" data-caption="Conc"><span class="blank">—</span></div>
            <div class="cell field empty" role="cell" data-caption="Dose"><span class="blank">—</span></div>
      {:else}
            {@render entry('conc', 'Conc', line.conc, concUnit, concText, (next) => (concText = next))}
            {@render entry('dose', 'Dose', line.dose, line.doseUnit, doseText, (next) => (doseText = next))}
      {/if}
      {@render entry('volume', 'Vol', line.volume, VOLUME_UNIT, volumeText, (next) => (volumeText = next))}

      <div class="cell menu-cell" role="cell">
            {#if !locked}
                  <div class="row-menu" class:open={menuOpen}>
                        <button
                              type="button"
                              class="menu-trigger"
                              aria-label="Options for {line.label}"
                              aria-haspopup="menu"
                              aria-expanded={menuOpen}
                              onclick={ontoggleMenu}>⋯
                        </button
                        >
                        {#if menuOpen}
                              <div class="menu" role="menu">
                                    <button type="button" role="menuitem" onclick={onremove}>Remove component</button>
                              </div>
                        {/if}
                  </div>
            {/if}
      </div>
</div>

<style>
      /* Columns come from the enclosing table (--compound-cols). */
      .line {
            display: grid;
            grid-template-columns: var(--compound-cols);
            border-top: 1px solid #e3e7ee;
      }

      .cell {
            display: flex;
            align-items: center;
            gap: 0.35rem;
            min-width: 0;
            padding: 0.7rem 1rem;
            border-left: 1px solid #e3e7ee;
      }

      .identity {
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 0.15rem;
            border-left: 0;
            font-weight: 600;
            font-size: 1.05rem;
      }

      .sub {
            color: #7a8494;
            font-size: 0.8rem;
            font-weight: 400;
            letter-spacing: 0.02em;
      }

      .diluent .identity .sub {
            color: #3464a5;
            font-weight: 650;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-size: 0.7rem;
      }

      .field strong {
            font-size: 1.05rem;
      }

      .empty,
      .diluent .cell:not(.identity) {
            background: #fafbfd;
      }

      .blank {
            color: #a3acb9;
      }

      .menu-cell {
            justify-content: center;
            padding: 0.4rem;
      }

      .field :global(.entry) {
            min-width: 4.5rem;
            height: 2.2rem;
      }

      .field :global(input) {
            text-align: right;
            border: 1px solid #d5dbe4;
            border-radius: 8px;
            background: #fff;
            padding: 0 0.5rem;
            font-variant-numeric: tabular-nums;
            font-size: 1rem;
      }

      .field :global(input:focus) {
            border-color: #4b45a8;
            outline: 2px solid rgb(75 69 168 / 0.15);
      }

      /* Narrow screens: each line stacks, cells name themselves. */
      @media (max-width: 720px) {
            .line {
                  grid-template-columns: 1fr 1fr 1fr auto;
            }
            .identity {
                  grid-column: 1 / 4;
            }
            .menu-cell {
                  grid-column: 4;
                  grid-row: 1;
            }
            .field {
                  flex-wrap: wrap;
                  border-top: 1px solid #eef1f5;
            }
            .field:nth-child(2) {
                  border-left: 0;
            }
            .field::before {
                  content: attr(data-caption);
                  flex-basis: 100%;
                  color: #5c6777;
                  font-size: 0.65rem;
                  font-weight: 700;
                  text-transform: uppercase;
                  letter-spacing: 0.1em;
            }
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
            font-size: 1.2rem;
            line-height: 1;
            padding: 0.2rem 0.5rem;
            border-radius: 6px;
            cursor: pointer;
      }

      .menu-trigger:hover,
      .open .menu-trigger {
            background: #eef2f8;
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
