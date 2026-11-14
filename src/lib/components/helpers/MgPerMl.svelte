<!--
@component
A concentration in mg/mL, with the unit typeset as a stacked fraction and read aloud
as "milligrams per milliliter".
-->
<script lang="ts">
      let { value }: {
            /** The number of milligrams per milliliter, already formatted or raw. */
            value: string | number
      } = $props();
</script>

<span class="concentration">
  {value}<span class="unit" aria-label="milligrams per milliliter">
    <span>mg</span>
    <span class="denominator">mL</span>
  </span>
</span>

<style>
      .concentration {
            display: inline-block;
            white-space: nowrap;
      }

      .unit {
            display: inline-flex;
            flex-direction: column;
            margin-inline-start: 0.15em;
            vertical-align: text-top;
            font-size: 0.5em;
            line-height: 1;
            text-align: center;
      }

      .denominator {
            border-top: 0.06em solid currentColor;
            margin-top: 0.02em;
            padding-top: 0.02em;
      }
</style>