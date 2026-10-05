<script lang="ts">
      import QuantityField from './QuantityField.svelte';
      import MixedFraction from './MixedFraction.svelte';
      import {formatRational, type Rational} from '$lib/rational';
      import {type Field, type Line, VOLUME_UNIT} from '$lib/compound-builder';

      let {
            line,
            locked = false,
            menuOpen = false,
            oncommit,
            ontoggleMenu,
            onremove
      }: {
            line: Line;
            locked?: boolean;
            menuOpen?: boolean;
            /** A field was committed; false means it was refused and the box should show the old value. */
            oncommit: (field: Field, value: Rational | null) => boolean;
            ontoggleMenu: () => void;
            onremove: () => void;
      } = $props();

      const show = (value: Rational | null) => (value ? formatRational(value) : '');

      // Each box shows its line value; it follows the line whenever the line
      // changes (a solved Vol, a reload) and is the user's own text while typing.
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

<div class="line" class:diluent={isDiluent}>
      <div class="identity">
            <span class="label">{line.label}</span>
            {#if isDiluent}<span class="tag">Diluent</span>{/if}
      </div>

      <div class="fields">
            {#if !isDiluent}
                  <div class="field">
                        <span class="caption">Conc</span>
                        {#if locked}
                              {#if line.conc}
                                    <MixedFraction value={line.conc} unit={concUnit}/>
                              {:else}—
                              {/if}
                        {:else}
                              <QuantityField
                                    bind:value={concText}
                                    unit={concUnit}
                                    variant="field"
                                    showUnit={false}
                                    exclusiveMin
                                    min={0}
                                    ariaLabel="Concentration, {line.label}"
                                    placeholder="—"
                                    oncommit={(quantity) => commit('conc', quantity, concText, () => (concText = show(line.conc)))}
                              />
                              <span class="unit">{concUnit}</span>
                        {/if}
                  </div>
                  <div class="field">
                        <span class="caption">Dose</span>
                        {#if locked}
                              {#if line.dose}
                                    <MixedFraction value={line.dose} unit={line.doseUnit}/>
                              {:else}—
                              {/if}
                        {:else}
                              <QuantityField
                                    bind:value={doseText}
                                    unit={line.doseUnit}
                                    variant="field"
                                    showUnit={false}
                                    exclusiveMin
                                    min={0}
                                    ariaLabel="Dose, {line.label}"
                                    placeholder="—"
                                    oncommit={(quantity) => commit('dose', quantity, doseText, () => (doseText = show(line.dose)))}
                              />
                              <span class="unit">{line.doseUnit}</span>
                        {/if}
                  </div>
            {/if}
            <div class="field">
                  <span class="caption">Vol</span>
                  {#if locked}
                        {#if line.volume}
                              <MixedFraction value={line.volume} unit={VOLUME_UNIT}/>
                        {:else}—
                        {/if}
                  {:else}
                        <QuantityField
                              bind:value={volumeText}
                              unit={VOLUME_UNIT}
                              variant="field"
                              showUnit={false}
                              exclusiveMin
                              min={0}
                              ariaLabel="Volume, {line.label}"
                              placeholder="—"
                              oncommit={(quantity) => commit('volume', quantity, volumeText, () => (volumeText = show(line.volume)))}
                        />
                        <span class="unit">{VOLUME_UNIT}</span>
                  {/if}
            </div>
      </div>

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

<style>
      .line {
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            gap: 0.4rem 1rem;
            padding: 0.7rem 0;
            border-bottom: 1px solid #e3e7ee;
      }

      .identity {
            grid-column: 1;
            min-width: 0;
            font-weight: 600;
      }

      .row-menu {
            grid-column: 2;
            grid-row: 1;
      }

      .tag {
            margin-left: 0.5rem;
            padding: 0.05rem 0.45rem;
            border-radius: 999px;
            background: #eef2f8;
            color: #3464a5;
            font-size: 0.7rem;
            font-weight: 700;
      }

      .fields {
            grid-column: 1 / -1;
            grid-row: 2;
            display: flex;
            flex-wrap: wrap;
            gap: 0;
      }

      .field {
            display: flex;
            align-items: center;
            gap: 0.3rem;
            min-width: 8.5rem;
            padding: 0 0.7rem;
            border-left: 1px solid #e3e7ee;
      }

      .field:first-child {
            border-left: 0;
      }

      .caption {
            color: #5c6777;
            font-size: 0.7rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
      }

      .field :global(.entry) {
            min-width: 4.5rem;
            height: 2rem;
      }

      .field :global(input) {
            text-align: right;
            border: 1px solid transparent;
            border-radius: 6px;
            background: #f6f8fb;
            padding: 0 0.4rem;
      }

      .field :global(input:focus) {
            border-color: #3464a5;
            background: #fff;
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
