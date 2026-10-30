<!--
@component
Routes of administration as short-code badges, joined in text by " · " so they read,
copy and title as "IM · IV", never "IMIV". The separator is drawn as the badges' gap.
-->
<script lang="ts">
      import RouteBadge from "./RouteBadge.svelte";

      let {routes}: {
            /** The routes as a source names them, e.g. "INTRAVENOUS". */
            routes: string[]
      } = $props();
</script>

{#each routes as route, i (route)}{#if i}<span class="separator">{' · '}</span>{/if}<RouteBadge {route}/>{/each}

<style>
      /* In the text, not on screen: the badges' own gap separates them visually. */
      .separator {
            display: inline-block;
            width: 0.3em;
            overflow: hidden;
            color: transparent;
            white-space: pre;
            vertical-align: middle;
      }
</style>
