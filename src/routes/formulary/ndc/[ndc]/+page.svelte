<script lang="ts">
      import {resolve} from '$app/paths';
      import {afterNavigate} from '$app/navigation';
      import {enhance} from '$app/forms';
      import PackageDetail from '$lib/components/PackageDetail.svelte';
      import ReinterpretDialog from '$lib/components/ReinterpretDialog.svelte';
      import IngredientCorrectionDialog from '$lib/components/IngredientCorrectionDialog.svelte';
      import DosingMeasureForm from '$lib/components/DosingMeasureForm.svelte';
      import PharmClassRuleDialog from '$lib/components/PharmClassRuleDialog.svelte';
      import PropertyOverridePanel from '$lib/components/PropertyOverridePanel.svelte';
      import {labelProductName, rxNormPackageTitle} from '$lib/package-title';

      let {data, form} = $props();

      let fromFormulary = $state(false);
      let reinterpret: ReinterpretDialog;
      let correction: IngredientCorrectionDialog;
      let pharmClassRule: PharmClassRuleDialog;
      let editKeys = $state<string[]>([]);
      let excludeDialog: HTMLDialogElement;
      let actionsMenu: HTMLElement;

      afterNavigate(({from}) => (fromFormulary = from?.url.pathname === '/formulary'));

      function back(event: MouseEvent) {
            if (!fromFormulary) return;
            event.preventDefault();
            history.back();
      }

      const item = $derived(data.item);
      const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
      const displayTitle = $derived(rxNormPackageTitle(item));
      const labelName = $derived(labelProductName(item));
      // The header is usually the formulary item's own RxNorm name; it isn't repeated.
      const sameName = (name: string) => !!displayTitle && displayTitle.toLowerCase().startsWith(name.trim().toLowerCase());
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
            {#if labelName}<p class="sub label-name">Labeled as {labelName}</p>{/if}
            {#if item.labelerName}<p class="sub"><a href={resolve('/formulary/labeler/[code]', {code: item.ndc.slice(0, 5)})}>{item.labelerName}</a></p>{/if}
            {#if data.formularyItems.length}
                  <p class="sub">
                        On formulary as
                        {#each data.formularyItems as formularyItem, index (formularyItem.id)}
                              {index ? ', ' : ''}
                              <a href={resolve('/formulary/items/[id]', {id: formularyItem.id})}>
                                    {sameName(formularyItem.displayName) ? 'this item' : formularyItem.displayName}
                              </a>
                        {/each}
                  </p>
            {/if}
            {#if item.manualExclusion}
                  <form class="sub exclusion" method="POST" action="?/include" use:enhance>
                        <span class="excluded">Excluded from formulary:</span> {item.manualExclusion}
                        <button class="link" type="submit">Include again</button>
                  </form>
            {/if}
            <div class="menu">
                  <button class="ellipsis" popovertarget="ndc-actions" type="button" aria-label="More actions" title="More actions">⋯</button>
                  <div id="ndc-actions" class="menu-popover" popover bind:this={actionsMenu} role="menu">
                        <button role="menuitem" type="button" onclick={() => { actionsMenu.hidePopover(); reinterpret.open(); }}>
                              Reload &amp; Reinterpret Results
                        </button>
                        {#if !item.manualExclusion}
                              <button class="danger" role="menuitem" type="button" onclick={() => { actionsMenu.hidePopover(); excludeDialog.showModal(); }}>
                                    Exclude from formulary…
                              </button>
                        {/if}
                  </div>
            </div>
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
            <PackageDetail {editKeys} editing {item} pillMedia={data.pillMedia} formularyItems={data.formularyItems} onretry={() => reinterpret.open()} onassignclass={() => pharmClassRule.open()} onedit={(keys) => (editKeys = keys)} oncorrect={(index) => { editKeys = []; correction.open(index); }}/>
            {#if editKeys.length}
                  {#key editKeys}
                        <div class="panel-slot">
                              <PropertyOverridePanel
                                    {item}
                                    keys={editKeys}
                                    equivalents={data.equivalents}
                                    pillMedia={data.pillMedia}
                                    oncorrect={(index) => { editKeys = []; correction.open(index); }}
                                    onclose={() => (editKeys = [])}
                              />
                        </div>
                  {/key}
            {/if}
      </div>
      <PharmClassRuleDialog bind:this={pharmClassRule} rules={data.pharmClassRules} confirmRemove={data.confirmRemove} message={form?.action === 'pharmClassRule' || form?.action === 'pharmClassRuleDelete' ? form.message : null}/>
      <ReinterpretDialog bind:this={reinterpret} {item}/>
      <IngredientCorrectionDialog bind:this={correction} {item} equivalents={data.equivalents}/>
</main>

<svelte:window
      onkeydown={(event) => {
    if (event.key === 'Escape' && editKeys.length) editKeys = [];
  }}
/>

<style>
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
            padding-right: 3rem;
      }

      .menu {
            position: absolute;
            top: 0;
            right: 0;
      }

      .ellipsis {
            anchor-name: --ndc-actions;
            width: 2.2rem;
            height: 2.2rem;
            border: 1px solid #c9d6e8;
            border-radius: 7px;
            background: #fff;
            color: #3464a5;
            font: inherit;
            font-size: 1.2rem;
            line-height: 1;
            cursor: pointer;
      }

      .ellipsis:hover {
            background: #eef3fa;
      }

      .menu-popover {
            position-anchor: --ndc-actions;
            inset: auto;
            top: anchor(bottom);
            right: anchor(right);
            margin: 0.3rem 0 0;
            padding: 0.3rem;
            min-width: 14rem;
            border: 1px solid #c9d6e8;
            border-radius: 0.55rem;
            background: #fff;
            box-shadow: 0 8px 24px rgb(24 33 47 / 0.12);
      }

      .menu-popover button {
            display: block;
            width: 100%;
            padding: 0.5rem 0.7rem;
            border: 0;
            border-radius: 5px;
            background: none;
            color: #18212f;
            font: inherit;
            font-size: 0.85rem;
            text-align: left;
            cursor: pointer;
      }

      .menu-popover button:hover {
            background: #eef3fa;
      }

      .menu-popover .danger {
            color: #a4461a;
      }

      main:has(.with-panel) {
            max-width: 1440px;
      }

      .with-panel {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(17rem, 22rem);
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

            /* Stays in view above the details so their label text can be highlighted. */
            .panel-slot {
                  z-index: 5;
                  top: 0;
                  order: -1;
            }

            .panel-slot :global(aside) {
                  max-height: 45vh;
            }
      }

      @media (max-width: 640px) {

            .menu {
                  top: 0;
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
