<script lang="ts">
  import { mixedParts } from '$lib/quantity';
  import type { Rational } from '$lib/rational';

  // A value set as a mixed number: the whole part at full size, the remainder
  // stacked over its denominator. "131 11/19 mg/mL" says the vial holds 2500 mg
  // in nineteen millilitres; "131.5789473684" says nothing checkable.
  let { value, unit = null }: { value: Rational; unit?: string | null } = $props();

  const parts = $derived(mixedParts(value));
</script>

<span class="mixed">
  {#if parts.whole}<span class="whole">{parts.whole}</span>{/if}
  {#if parts.numerator}
    <span class="frac" aria-label="{parts.numerator} over {parts.denominator}">
      <span class="num">{parts.numerator}</span>
      <span class="den">{parts.denominator}</span>
    </span>
  {/if}
  {#if unit}<span class="unit" class:percent={unit === '%'}>{unit}</span>{/if}
</span>

<style>
  .mixed {
    display: inline-flex;
    align-items: center;
    gap: 0.18em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    line-height: 1;
  }
  /* Set smaller than the whole part and centred on it, so the stack fits a
     one-line field. */
  .frac {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    font-size: 0.7em;
    line-height: 1;
  }
  .num {
    border-bottom: 1px solid currentColor;
    padding: 0 0.18em;
  }
  .den {
    padding: 0 0.18em;
  }
  .unit {
    margin-left: 0.15em;
    opacity: 0.75;
  }
  .unit.percent {
    margin-left: 0;
  }
</style>
