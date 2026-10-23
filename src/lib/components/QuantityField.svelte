<!--
@component
One field for every typed quantity.

A plain number, a mixed number ("131 11/19"), a percent ("0.9%"), an amount
with a unit ("1.5 g"), or a ratio of units ("2500/19 mg/mL", "20,000
UNT/vial", "250 mg/5 mL").

At rest the field *is* the typeset value: the typed characters go invisible
and the mixed number is drawn over them, its remainder stacked. While the
caret is in it the characters come back — a stacked fraction is not the
width of the text it is set from, so drawing it over a focused input would
put the caret somewhere other than the digits — and the reading floats
above the field as a preview that follows each keystroke.

`unit` locks what the field produces: a bare number is taken to be in it,
and anything convertible is converted ("1.5 g" → 1500 mg, "0.9%" → 9 mg/mL),
with the conversion shown in the preview. `quantity` binds the result.

Usage:
```svelte
<QuantityField bind:value bind:quantity unit="mg/mL" placeholder="e.g. 250 mg/5 mL" />
```
-->
<script lang="ts">
      import {untrack} from 'svelte';
      import MixedFraction from './MixedFraction.svelte';
      import {
            canonicalUnitLabel,
            convertQuantity,
            formatQuantity,
            parseQuantity,
            type Quantity,
            quantityDecimal,
            type QuantityKind
      } from "$lib/medication/quantity";

      let {
            value = $bindable(''),
            // Written for the parent through the binding, never read here.
            // eslint-disable-next-line no-useless-assignment
            quantity = $bindable(null),
            unit = null,
            accept = 'any',
            integer = false,
            min = null,
            exclusiveMin = false,
            max = null,
            weightInVolume = true,
            variant = 'form',
            showUnit = true,
            placeholder,
            id,
            name,
            ariaLabel,
            title,
            readonly = false,
            required = false,
            onchange,
            onenter,
            onedit,
            oncommit
      }: {
            /** The text as typed. */
            value?: string;
            /** What the text says, in `unit` when one is set; null while unusable. */
            quantity?: Quantity | null;
            /** Produce the value in this unit label ("mL", "mg/mL", "%", "unit/vial"). */
            unit?: string | null;
            /** Which kinds a unit-free field takes. Ignored for the kind once `unit` is set. */
            accept?: 'any' | QuantityKind | QuantityKind[];
            integer?: boolean;
            min?: number | null;
            /** `min` itself is out of range ("greater than" rather than "at least"). */
            exclusiveMin?: boolean;
            max?: number | null;
            /** Read a percent against mass/volume as w/v (0.9% = 9 mg/mL). */
            weightInVolume?: boolean;
            /** `form`: a bordered input. `field`: a bare, right-aligned table cell. */
            variant?: 'form' | 'field';
            /** False where the caller renders the unit itself, beside the box. */
            showUnit?: boolean;
            placeholder?: string;
            id?: string;
            /** Also submit the value, as a decimal in `unit`, under this form name. */
            name?: string;
            ariaLabel?: string;
            title?: string;
            readonly?: boolean;
            required?: boolean;
            /** Each new reading, including the one the initial value gives. */
            onchange?: (quantity: Quantity | null) => void;
            onenter?: () => void;
            /** The caret entered the field — the value is being typed. */
            onedit?: () => void;
            oncommit?: (quantity: Quantity | null) => void;
      } = $props();

      const lockedUnit = $derived(canonicalUnitLabel(unit));
      const kinds = $derived(accept === 'any' ? null : Array.isArray(accept) ? accept : [accept]);

      /** What the text says right now, or null while it is still being typed. */
      const typed = $derived(parseQuantity(value));

      const reading = $derived.by((): { quantity: Quantity | null; problem: string | null } => {
            if (!typed) return {quantity: null, problem: value.trim() ? 'Enter a number.' : null};
            const converted = lockedUnit ? convertQuantity(typed, lockedUnit, {weightInVolume}) : typed;
            if (!converted) return {quantity: null, problem: `Enter a value in ${lockedUnit}.`};
            if (!lockedUnit && kinds && !kinds.includes(converted.kind))
                  return {quantity: null, problem: `Enter ${kinds.map(describeKind).join(' or ')}.`};
            if (integer && converted.rational.d !== 1)
                  return {quantity: null, problem: 'Enter a whole number.'};
            if (min != null && (exclusiveMin ? converted.value <= min : converted.value < min))
                  return {
                        quantity: null,
                        problem: `Enter a value ${exclusiveMin ? 'greater than' : 'of at least'} ${min}.`
                  };
            if (max != null && converted.value > max)
                  return {quantity: null, problem: `Enter a value of at most ${max}.`};
            return {quantity: converted, problem: null};
      });

      function describeKind(kind: QuantityKind): string {
            return {
                  number: 'a number',
                  percent: 'a percent',
                  amount: 'an amount with its unit',
                  volume: 'a volume',
                  ratio: 'a ratio such as mg/mL'
            }[kind];
      }

      // Every change of reading reaches the binding and `onchange`, whether it
      // came from typing or from the parent replacing `value`.
      $effect(() => {
            const current = reading.quantity;
            quantity = current;
            untrack(() => onchange?.(current));
      });

      /** Editing means the caret is in here, and the caret belongs to the text. */
      let editing = $state(false);

      /** The unit the typeset value is read in: as typed, else the locked one. */
      const shownUnit = $derived(typed?.unit ?? lockedUnit);
      /** A conversion worth showing: "0.9%" = 9 mg/mL. */
      const conversion = $derived(
            reading.quantity && typed?.unit && reading.quantity.unit !== typed.unit
                  ? formatQuantity(reading.quantity)
                  : null
      );
      const invalid = $derived(!editing && !!reading.problem);
</script>

<span class="entry {variant}" class:readonly>
  <input
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        autocomplete="off"
        bind:value
        class:invalid
        class:typeset={!!reading.quantity && !editing}
        {id}
        inputmode="text"
        onblur={() => {
      editing = false;
      oncommit?.(reading.quantity);
    }}
        onfocus={() => {
      editing = true;
      onedit?.();
    }}
        onkeydown={(event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.currentTarget.blur();
      onenter?.();
    }}
        {placeholder}
        {readonly}
        {required}
        title={invalid ? (reading.problem ?? undefined) : title}
        type="text"
  />
      {#if name}<input
            type="hidden"
            {name}
            value={reading.quantity ? quantityDecimal(reading.quantity) : ''}
      />{/if}
      {#if typed && reading.quantity && !editing}
    <span class="overlay" aria-hidden="true">
      <MixedFraction value={typed.rational} unit={showUnit ? shownUnit : null}/>
    </span>
  {/if}
      {#if typed && reading.quantity && editing}
    <span class="preview" aria-hidden="true">
      <MixedFraction value={typed.rational} unit={shownUnit}/>
          {#if conversion}<span class="conversion">= {conversion}</span>{/if}
    </span>
  {/if}
      {#if variant === 'form' && invalid}<span class="problem" role="alert">{reading.problem}</span
      >{/if}
</span>

<style>
      .entry {
            position: relative;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            min-width: 0;
            /* Fill the box the field sits in: the overlay is drawn to these bounds,
               and a stacked fraction is taller than the line of text it replaces. */
            align-self: stretch;
      }

      input {
            box-sizing: border-box;
            width: 100%;
            min-width: 0;
            font: inherit;
            font-weight: 400;
            outline: none;
      }

      /* Typed text goes invisible once it says a usable number — the fraction
         over it is the same value, better set — but the caret stays. */
      input.typeset {
            color: transparent;
            caret-color: currentColor;
      }

      .overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            pointer-events: none;
            overflow: hidden;
            white-space: nowrap;
      }

      /* The live reading, floated clear of the text being typed. */
      .preview {
            position: absolute;
            bottom: calc(100% + 4px);
            right: 0;
            z-index: 20;
            display: flex;
            align-items: center;
            gap: 0.5em;
            padding: 3px 6px;
            border: 1px solid #c9d6e8;
            border-radius: 6px;
            background: #fff;
            box-shadow: 0 2px 6px rgb(28 47 75 / 14%);
            color: #18212f;
            font-size: 0.85rem;
            white-space: nowrap;
            pointer-events: none;
      }

      .conversion {
            color: #5c6777;
            font-size: 0.9em;
      }

      .problem {
            flex-basis: 100%;
            margin-top: 0.25rem;
            color: #a32b2b;
            font-size: 0.78rem;
            font-weight: 400;
      }

      /* The bordered input the app's forms use. */
      .form input {
            padding: 0.5rem;
            border: 1px solid #bfc9d6;
            border-radius: 6px;
            background: #fff;
      }

      .form input:focus {
            border-color: #3464a5;
      }

      .form input.invalid {
            border-color: #a32b2b;
      }

      .form.readonly input {
            background: #f4f6f9;
            color: #34445c;
      }

      .form .overlay {
            /* The input's padding plus its border. */
            bottom: auto;
            height: calc(1lh + 1rem + 2px);
            padding: 0 calc(0.5rem + 1px);
            color: #18212f;
      }

      .form.readonly .overlay {
            color: #34445c;
      }

      /* A bare cell in a table row: right-aligned, monospace, wide enough for a
         mixed number. */
      .field {
            flex: 1;
            min-width: 66px;
      }

      .field input {
            height: 100%;
            padding: 0 2px;
            border: none;
            background: transparent;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.8rem;
            text-align: right;
      }

      .field input.invalid {
            text-decoration: underline wavy #a32b2b;
      }

      .field .overlay {
            justify-content: flex-end;
            padding: 0 2px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.8rem;
            color: #34445c;
      }
</style>
