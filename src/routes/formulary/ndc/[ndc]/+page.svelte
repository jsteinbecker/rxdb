<script lang="ts">
      import {resolve} from '$app/paths';
      import {afterNavigate} from '$app/navigation';
      import PackageDetail from '$lib/components/PackageDetail.svelte';
      import ReinterpretDialog from '$lib/components/ReinterpretDialog.svelte';
      import DosingMeasureForm from '$lib/components/DosingMeasureForm.svelte';
      import PropertyOverridePanel from '$lib/components/PropertyOverridePanel.svelte';
      import {packageDisplayTitle} from '$lib/package-title';

      let {data, form} = $props();

      let fromFormulary = $state(false);
      let reinterpret: ReinterpretDialog;
      let editing = $state(false);
      let editKeys = $state<string[]>([]);

      afterNavigate(({from}) => (fromFormulary = from?.url.pathname === '/formulary'));

      function back(event: MouseEvent) {
            if (!fromFormulary) return;
            event.preventDefault();
            history.back();
      }

      const item = $derived(data.item);
      const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
      const displayTitle = $derived(packageDisplayTitle(item));
</script>

<svelte:head>
      <title>NDC {formatNdc(item.ndc)} · RxDB</title>
</svelte:head>

<main>
      <a class="back" href={resolve('/formulary')} onclick={back}>
            <span aria-hidden="true">←</span> Formulary
      </a>
      <header>
            <p class="eyebrow">NDC · <span class="mono">{formatNdc(item.ndc)}</span></p>
            <h1>
                  {displayTitle ?? item.brandName ?? item.genericName ?? item.description ?? `NDC ${item.ndc}`}
            </h1>
            {#if item.labelerName}<p class="sub">{item.labelerName}</p>{/if}
            {#if data.formularyItems.length}
                  <p class="sub">
                        On formulary as
                        {#each data.formularyItems as formularyItem, index (formularyItem.id)}
                              {index ? ', ' : ''}<a href={resolve('/formulary/items/[id]', {id: formularyItem.id})}
                                    >{formularyItem.displayName}</a
                              >
                        {/each}
                  </p>
            {/if}
            <button class="action" onclick={() => reinterpret.open()} type="button">
                  Reload &amp; Reinterpret Results
            </button>
            <button
                  aria-pressed={editing}
                  class="override-action"
                  onclick={() => {
        editing = !editing;
        editKeys = [];
      }}
                  type="button">{editing ? 'Done overriding' : 'Override properties'}</button
            >
      </header>
      <DosingMeasureForm {item} measure={data.dosingMeasure} message={form?.message ?? null}/>
      <div class="body" class:with-panel={editKeys.length}>
            <PackageDetail {editKeys} {editing} {item} onedit={(keys) => (editKeys = keys)}/>
            {#if editKeys.length}
                  {#key editKeys}
                        <div class="panel-slot">
                              <PropertyOverridePanel
                                    {item}
                                    keys={editKeys}
                                    equivalents={data.equivalents}
                                    onclose={() => (editKeys = [])}
                              />
                        </div>
                  {/key}
            {/if}
      </div>
      <ReinterpretDialog bind:this={reinterpret} {item}/>
</main>

<svelte:window
      onkeydown={(event) => {
    if (event.key === 'Escape' && editKeys.length) editKeys = [];
  }}
/>

<style>
      :global(body) {
            margin: 0;
            background: #f7f8fa;
            color: #18212f;
            font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }

      main {
            max-width: 1040px;
            margin: 0 auto;
            padding: 2.5rem 1.5rem 4rem;
      }

      .back {
            display: inline-flex;
            gap: 0.4rem;
            color: #3464a5;
            font-weight: 650;
            text-decoration: none;
      }

      .back:hover {
            text-decoration: underline;
      }

      header {
            position: relative;
            margin: 1.5rem 0 1.25rem;
            padding-right: 15rem;
      }

      .action {
            position: absolute;
            top: 0;
            right: 0;
            padding: 0.45rem 0.9rem;
            border: 1px solid #3464a5;
            border-radius: 7px;
            background: #fff;
            color: #3464a5;
            font: inherit;
            font-size: 0.85rem;
            font-weight: 650;
            cursor: pointer;
      }

      .action:hover {
            background: #eef3fa;
      }

      .override-action {
            margin-top: 0.65rem;
            border: 0;
            background: none;
            color: #3464a5;
            font: inherit;
            font-size: 0.85rem;
            font-weight: 650;
            cursor: pointer;
      }

      .override-action:disabled {
            color: #8993a0;
            cursor: default;
      }

      .override-action[aria-pressed='true'] {
            padding: 0.2rem 0.6rem;
            border-radius: 999px;
            background: #eef3fa;
      }

      main:has(.with-panel) {
            max-width: 1440px;
      }

      .with-panel {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(22rem, 30rem);
            gap: 1.5rem;
            align-items: start;
      }

      .panel-slot {
            position: sticky;
            top: 1rem;
            margin-top: 0.75rem;
      }

      @media (max-width: 900px) {
            .with-panel {
                  grid-template-columns: minmax(0, 1fr);
            }

            .panel-slot {
                  position: static;
                  order: -1;
            }
      }

      @media (max-width: 640px) {
            header {
                  padding-right: 0;
            }

            .action {
                  position: static;
                  margin-top: 0.8rem;
            }
      }

      h1 {
            margin: 0;
            font-size: 1.6rem;
            line-height: 1.25;
      }

      .eyebrow {
            margin: 0 0 0.5rem;
            color: #3464a5;
            font-size: 0.8rem;
            font-weight: 750;
            letter-spacing: 0.12em;
            text-transform: uppercase;
      }

      .sub {
            margin: 0.4rem 0 0;
            color: #5c6777;
      }

      .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            letter-spacing: 0;
      }
</style>
