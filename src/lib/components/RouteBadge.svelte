<!--
@component
A route of administration as its short code (e.g. "IV" for "INTRAVENOUS"), with the
full route as the tooltip.
-->
<script lang="ts">
      import {routeCode} from "$lib/labels/route-code";

      let {route}: {
            /** The route as a source names it, e.g. "INTRAVENOUS". */
            route: string
      } = $props();
</script>

<abbr class="route" title={route}>{routeCode(route)}</abbr>

<style>
      /* Circle stroke matches the glyph stroke of the monospace face at this weight. */
      .route {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            width: 1.8em;
            aspect-ratio: 1;
            border: 0.085em solid currentColor;
            border-radius: 50%;
            font-family: var(--font-sans), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
            font-size: 1em;
            font-weight: 300;
            line-height: 1;
            letter-spacing: 0;
            text-decoration: none;
            vertical-align: middle;
            cursor: help;
      }

      .route + :global(.route) {
            margin-left: 0.3em;
      }
</style>
