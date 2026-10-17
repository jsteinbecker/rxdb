<!-- MgPerMl.svelte -->
<script lang="ts">
      let { value }: { value: string | number } = $props();
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