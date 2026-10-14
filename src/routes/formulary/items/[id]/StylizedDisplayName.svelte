<script lang="ts">
      // Splits a display name into "mixed" runs: the text leading up to each
      // "<unit>/<volumeUnit>" plus that unit as a numerator/denominator pair, e.g.
      // "Alanine 2 mg/mL" -> <span class="mixed">Alanine 2 <span class="numerator">mg</span><span class="denominator">mL</span></span>
      let {name}: {name: string} = $props();

      type Run = {text: string; numerator?: string; denominator?: string};

      // [1] strength, [2] unit, [3] volume amount, [4] volume unit
      const RATIO = /(?:(\d+(?:\.\d+)?)\s*)?([A-Za-zµμ%]+)\/(?:(\d+(?:\.\d+)?)\s*)?([A-Za-z]+)/g;

      // Reduce to a per-one-unit strength: "250 mg/5 mL" -> "50 mg/mL".
      const format = (n: number) => String(Number(n.toPrecision(4)));

      const runs = $derived.by((): Run[] => {
            const out: Run[] = [];
            let last = 0;
            for (const m of name.matchAll(RATIO)) {
                  const i = m.index ?? 0;
                  const [, strength, unit, volume, volumeUnit] = m;
                  const perOne = strength && volume ? format(Number(strength) / Number(volume)) : strength;
                  // A volume with no strength to divide stays in the denominator.
                  const denominator = !strength && volume ? `${volume} ${volumeUnit}` : volumeUnit;
                  out.push({
                        text: name.slice(last, i) + (perOne ? `${perOne} ` : ''),
                        numerator: unit,
                        denominator,
                  });
                  last = i + m[0].length;
            }
            if (last < name.length) out.push({text: name.slice(last)});
            return out;
      });
</script>

{#each runs as run, i (i)}{#if run.numerator}<span class="mixed">{run.text}<span class="numerator">{run.numerator}</span><span class="denominator">{run.denominator}</span></span>{:else}{run.text}{/if}{/each}

<style>
      .numerator,
      .denominator {
            display: inline-block;
            font-size: 0.6em;
            line-height: 1;
            white-space: nowrap;
      }

      /* Zero width lets the denominator start at the same x, so the two stack. */
      .numerator {
            width: 0;
            vertical-align: 0.55em;
      }

      .denominator {
            vertical-align: -0.15em;
            border-top: 1px solid currentColor;
      }
</style>
