<script lang="ts">
      import {resolve} from '$app/paths';
      import {afterNavigate} from '$app/navigation';
      import {enhance} from '$app/forms';
      import PackageDetail from '$lib/components/PackageDetail.svelte';
      import ReinterpretDialog from '$lib/components/ReinterpretDialog.svelte';
      import DosingMeasureForm from '$lib/components/DosingMeasureForm.svelte';
      import PharmClassRuleDialog from '$lib/components/PharmClassRuleDialog.svelte';
      import PropertyOverridePanel from '$lib/components/PropertyOverridePanel.svelte';
      import {packageDisplayTitle} from '$lib/package-title';

      let {data, form} = $props();

      let fromFormulary = $state(false);
      let reinterpret: ReinterpretDialog;
      let pharmClassRule: PharmClassRuleDialog;
      let editKeys = $state<string[]>([]);
      let excludeDialog: HTMLDialogElement;

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
            {#if item.labelerName}<p class="sub"><a href={resolve('/formulary/labeler/[code]', {code: item.ndc.slice(0, 5)})}>{item.labelerName}</a></p>{/if}
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
            {#if item.manualExclusion}
                  <form class="sub exclusion" method="POST" action="?/include" use:enhance>
                        <span class="excluded">Excluded from formulary:</span> {item.manualExclusion}
                        <button class="link" type="submit">Include again</button>
                  </form>
            {:else}
                  <button class="link exclude" onclick={() => excludeDialog.showModal()} type="button">
                        Exclude from formulary…
                  </button>
            {/if}
            <button class="action" onclick={() => reinterpret.open()} type="button">
                  Reload &amp; Reinterpret Results
            </button>
      </header>
      <dialog bind:this={excludeDialog}>
            <form
                  method="POST"
                  action="?/exclude"
                  use:enhance={() =>
                        async ({update}) => {
                              await update();
                              if (!form?.message) excludeDialog.close();
                        }}
            >
                  <h2>Exclude {formatNdc(item.ndc)}</h2>
                  <p>It is unlinked from any formulary item and skipped by future loads.</p>
                  <label>
                        Reason
                        <textarea name="reason" maxlength="500" required rows="3"></textarea>
                  </label>
                  {#if form?.message}<p class="error">{form.message}</p>{/if}
                  <div class="dialog-actions">
                        <button class="link" type="button" onclick={() => excludeDialog.close()}>Cancel</button>
                        <button class="action-inline" type="submit">Exclude</button>
                  </div>
            </form>
      </dialog>
      <DosingMeasureForm {item} measure={data.dosingMeasure} message={form?.message ?? null}/>
      <div class="body" class:with-panel={editKeys.length}>
            <PackageDetail {editKeys} editing {item} pillMedia={data.pillMedia} onassignclass={() => pharmClassRule.open()} onedit={(keys) => (editKeys = keys)}/>
            {#if editKeys.length}
                  {#key editKeys}
                        <div class="panel-slot">
                              <PropertyOverridePanel
                                    {item}
                                    keys={editKeys}
                                    equivalents={data.equivalents}
                                    pillMedia={data.pillMedia}
                                    onclose={() => (editKeys = [])}
                              />
                        </div>
                  {/key}
            {/if}
      </div>
      <PharmClassRuleDialog bind:this={pharmClassRule} rules={data.pharmClassRules} message={form?.message ?? null}/>
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

      .link {
            padding: 0;
            border: 0;
            background: none;
            color: #3464a5;
            font: inherit;
            font-size: 0.85rem;
            cursor: pointer;
      }

      .link:hover {
            text-decoration: underline;
      }

      .exclude {
            margin-top: 0.4rem;
            color: #a4461a;
      }

      .exclusion .link {
            margin-left: 0.5rem;
      }

      .excluded {
            color: #a4461a;
            font-weight: 650;
      }

      dialog {
            width: min(28rem, calc(100vw - 2rem));
            border: 1px solid #c9d6e8;
            border-radius: 0.65rem;
            padding: 1.1rem 1.25rem;
      }

      dialog h2 {
            margin: 0 0 0.4rem;
            font-size: 1.05rem;
      }

      dialog p {
            margin: 0 0 0.75rem;
            color: #5c6777;
            font-size: 0.85rem;
      }

      dialog label {
            display: grid;
            gap: 0.3rem;
            font-size: 0.85rem;
      }

      dialog textarea {
            font: inherit;
      }

      dialog .error {
            margin: 0.6rem 0 0;
            color: #a4461a;
      }

      .dialog-actions {
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
            margin-top: 0.9rem;
      }

      .action-inline {
            padding: 0.4rem 0.9rem;
            border: 0;
            border-radius: 7px;
            background: #a4461a;
            color: #fff;
            font: inherit;
            font-size: 0.85rem;
            font-weight: 650;
            cursor: pointer;
      }

      .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            letter-spacing: 0;
      }
</style>
