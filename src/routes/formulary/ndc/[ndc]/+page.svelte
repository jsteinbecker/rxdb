<script lang="ts">
      import {resolve} from '$app/paths';
      import {tick} from 'svelte';
      import {afterNavigate, replaceState} from '$app/navigation';
      import {page} from '$app/state';
      import BrandedName from '$lib/components/BrandedName.svelte';
      import {formatNdc} from '$lib/ndc';
      import PageHeader from '$lib/components/PageHeader.svelte';
      import MgPerMl from '$lib/components/helpers/MgPerMl.svelte';
      import {enhance} from '$app/forms';
      import PackageDetail from '$lib/components/PackageDetail.svelte';
      import ReinterpretDialog from '$lib/components/ReinterpretDialog.svelte';
      import IngredientCorrectionDialog from '$lib/components/IngredientCorrectionDialog.svelte';
      import DosingMeasureForm from '$lib/components/DosingMeasureForm.svelte';
      import PharmClassRuleDialog from '$lib/components/PharmClassRuleDialog.svelte';
      import LocalConceptDialog from '$lib/components/LocalConceptDialog.svelte';
      import PropertyOverridePanel from '$lib/components/PropertyOverridePanel.svelte';
      import {labelProductName, packageTitle, rxNormPackageTitle} from '$lib/package-title';

      let {data, form} = $props();

      let fromFormulary = $state(false);
      let reinterpret: ReinterpretDialog;
      let correction: IngredientCorrectionDialog;
      let pharmClassRule: PharmClassRuleDialog;
      let localConcept: LocalConceptDialog | undefined = $state();
      // Streamed from the load; the dialog renders once it arrives. The last good value
      // is kept while a reload's new promise is pending, so an open dialog doesn't vanish.
      let localConceptEditor = $state<Awaited<typeof data.localConceptEditor>>(null);
      $effect(() => {
            let current = true;
            data.localConceptEditor.then((editor) => {
                  if (current && editor) localConceptEditor = editor;
            });
            return () => {
                  current = false;
            };
      });

      /** Waits for the streamed editor data, then opens the local concept dialog. */
      async function withLocalConceptDialog(run: (dialog: LocalConceptDialog) => void) {
            const editor = await data.localConceptEditor;
            if (!editor) {
                  alert('Could not load the local concept editor. Reload the page to try again.');
                  return;
            }
            localConceptEditor = editor;
            await tick();
            if (localConcept) run(localConcept);
      }
      let editKeys = $state<string[]>([]);
      let excludeDialog: HTMLDialogElement;
      let actionsMenu: HTMLElement;

      // The local concepts list links here with ?localConcept=edit to open the editor directly.
      // On a hard load afterNavigate fires during hydration, before the router has started, and
      // replaceState throws until then; so the URL cleanup is deferred to a macrotask.
      afterNavigate(({from, to}) => {
            fromFormulary = from?.url.pathname === '/formulary';
            const local = data.item.localConcept;
            if (to?.url.searchParams.get('localConcept') === 'edit' && local) {
                  void withLocalConceptDialog((dialog) => dialog.open('edit'));
                  // Drop the param so a reload or a non-JS post doesn't reopen the dialog.
                  const url = new URL(to.url);
                  url.searchParams.delete('localConcept');
                  setTimeout(() => {
                        try {
                              replaceState(url, page.state);
                        } catch {
                              /* router not ready; leaving the param is harmless */
                        }
                  }, 0);
            }
      });

      function back(event: MouseEvent) {
            if (!fromFormulary) return;
            event.preventDefault();
            history.back();
      }

      const item = $derived(data.item);
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
      <PageHeader title={packageTitle(item)} compact>
            {#snippet name(text: string)}
                  {#each text.split(/(\d+(?:[.,]\d+)*)\s*mg\/ml/gi) as part, i (i)}{#if i % 2 === 1}<MgPerMl value={part}/>{:else}{part}{/if}{/each}
            {/snippet}
            {#snippet eyebrow()}NDC · <span class="mono">{formatNdc(item.ndc)}</span>{/snippet}
            {#snippet actions()}
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
            {/snippet}
            {#if labelName}<p class="label-name">Labeled as {labelName}</p>{/if}
            {#if item.labelerName}<p><a href={resolve('/formulary/labeler/[code]', {code: item.ndc.slice(0, 5)})}>{item.labelerName}</a></p>{/if}
            {#if data.formularyItems.length}
                  <p>
                        On formulary as
                        {#each data.formularyItems as formularyItem, index (formularyItem.id)}
                              {index ? ', ' : ''}
                              <a href={resolve('/formulary/items/[id]', {id: formularyItem.id})} data-nav-title={formularyItem.displayName}>
                                    {#if sameName(formularyItem.displayName)}this item{:else}<BrandedName text={formularyItem.displayName} />{/if}
                              </a>
                        {/each}
                  </p>
            {/if}
            {#if item.manualExclusion}
                  <form class="exclusion" method="POST" action="?/include" use:enhance>
                        <span class="excluded">Excluded from formulary:</span> {item.manualExclusion}
                        <button class="link" type="submit">Include again</button>
                  </form>
            {/if}
      </PageHeader>
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
      <DosingMeasureForm {item} measure={data.dosingMeasure} message={form?.action === 'dosingMeasure' ? form.message : null}/>
      <div class="body" class:with-panel={editKeys.length}>
            <PackageDetail {editKeys} editing {item} pillMedia={data.pillMedia} formularyItems={data.formularyItems} onretry={() => reinterpret.open()} onassignclass={() => pharmClassRule.open()} onedit={(keys) => (editKeys = keys)} oncorrect={(index) => { editKeys = []; correction.open(index); }} localConceptScd={localConceptEditor?.target.scd?.rxcui ?? null} onlocalconcept={(mode) => withLocalConceptDialog((dialog) => dialog.open(mode))} onstoplocalconcept={() => withLocalConceptDialog((dialog) => dialog.confirmStop())}/>
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
      {#if localConceptEditor}
            <LocalConceptDialog bind:this={localConcept} editor={localConceptEditor} localConcept={item.localConcept} rxnormName={item.details?.rxnav?.conceptName ?? null} message={form?.action === 'localConceptSave' || form?.action === 'localConceptStop' ? form.message : null}/>
      {/if}
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
            margin-bottom: 1.5rem;
            color: #3464a5;
            font-weight: 650;
            text-decoration: none;
      }

      .back:hover {
            text-decoration: underline;
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
