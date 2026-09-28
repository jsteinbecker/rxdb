<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import PackageDetail from '$lib/components/PackageDetail.svelte';
  import ReinterpretDialog from '$lib/components/ReinterpretDialog.svelte';
  import { packageDisplayTitle } from '$lib/package-title';

  let { data } = $props();

  // Going back through history restores the hierarchy exactly as it was
  // (levels, open nodes, filter, scroll). A direct visit falls back to the link.
  let fromFormulary = $state(false);
  let reinterpret: ReinterpretDialog;
  let overrideDialog: HTMLDialogElement;
  let overrideKey = $state('');
  let overrideValue = $state('');
  let sectionKey = $state('');
  let excerpt = $state('');
  let overrideMessage = $state('');
  let savingOverride = $state(false);
  const overrideFields = [
    { key: 'description', label: 'Package description' },
    { key: 'brandName', label: 'Brand name' },
    { key: 'genericName', label: 'Generic name' },
    { key: 'productCode', label: 'Product NDC' },
    { key: 'doseForm', label: 'Dose form' }
  ];
  function captureExcerpt() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    const anchor = selection.anchorNode?.parentElement?.closest('[data-spl-section]');
    const focus = selection.focusNode?.parentElement?.closest('[data-spl-section]');
    if (anchor && anchor === focus && text) {
      sectionKey = anchor.getAttribute('data-spl-section') ?? '';
      excerpt = text;
    }
  }
  async function saveOverride() {
    savingOverride = true;
    overrideMessage = '';
    const form = new FormData();
    form.set('key', overrideKey);
    form.set('value', overrideValue);
    form.set('sectionKey', sectionKey);
    form.set('excerpt', excerpt);
    try {
      const response = await fetch('?/override', { method: 'POST', body: form });
      const result = deserialize(await response.text());
      if (result.type === 'success') {
        overrideDialog.close();
        await invalidateAll();
      } else
        overrideMessage =
          result.type === 'failure'
            ? String(result.data?.message ?? 'Could not save override.')
            : 'Could not save override.';
    } catch {
      overrideMessage = 'Could not save override.';
    } finally {
      savingOverride = false;
    }
  }
  afterNavigate(({ from }) => (fromFormulary = from?.url.pathname === '/formulary'));

  function back(event: MouseEvent) {
    if (!fromFormulary) return;
    event.preventDefault();
    history.back();
  }

  const item = $derived(data.item);
  const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
  const displayTitle = $derived(
    packageDisplayTitle({
      rxNormName: item.details?.rxnav?.conceptName,
      packageDescription: item.description,
      splTitle: item.splTitle,
      isMultiDose: item.isMultiDose,
      labeler: item.labelerName
    })
  );
</script>

<svelte:head>
  <title>NDC {formatNdc(item.ndc)} · RxDB</title>
</svelte:head>

<main>
  <a class="back" href="/formulary" onclick={back}><span aria-hidden="true">←</span> Formulary</a>
  <header>
    <p class="eyebrow">NDC · <span class="mono">{formatNdc(item.ndc)}</span></p>
    <h1>
      {displayTitle ?? item.brandName ?? item.genericName ?? item.description ?? `NDC ${item.ndc}`}
    </h1>
    {#if item.labelerName}<p class="sub">{item.labelerName}</p>{/if}
    <button class="action" type="button" onclick={() => reinterpret.open()}>
      Reload &amp; Reinterpret Results
    </button>
    <button
      class="override-action"
      type="button"
      disabled={!item.splSetId || !item.details?.label?.sections.length}
      onclick={() => {
        overrideKey = '';
        overrideValue = '';
        overrideMessage = '';
        overrideDialog.showModal();
      }}>Override property</button
    >
  </header>
  <div onmouseup={captureExcerpt} role="presentation"><PackageDetail {item} /></div>
  <ReinterpretDialog bind:this={reinterpret} {item} />
  <dialog bind:this={overrideDialog} aria-labelledby="override-title">
    <h2 id="override-title">Override a property</h2>
    <p>
      Use this only when reinterpreting the sources cannot resolve the value. Highlight text in an
      expanded SPL label section before opening this dialog.
    </p>
    <label
      >Property
      <select bind:value={overrideKey}
        ><option value="">Choose a property</option>{#each overrideFields as field}<option
            value={field.key}>{field.label}</option
          >{/each}</select
      >
    </label>
    <label>Correct value <input bind:value={overrideValue} maxlength="500" /></label>
    <label
      >SPL excerpt <textarea
        value={excerpt}
        readonly
        rows="4"
        placeholder="Highlight text in an expanded label section"></textarea></label
    >
    {#if sectionKey}<p class="source-note">
        From {item.details?.label?.sections.find((section) => section.key === sectionKey)?.title} · SPL
        {item.splSetId}
      </p>{/if}
    {#if overrideMessage}<p class="error">{overrideMessage}</p>{/if}
    <div class="dialog-actions">
      <button type="button" onclick={() => overrideDialog.close()}>Cancel</button><button
        type="button"
        disabled={savingOverride ||
          !overrideKey ||
          !overrideValue.trim() ||
          !excerpt ||
          !sectionKey}
        onclick={saveOverride}>{savingOverride ? 'Saving…' : 'Save override'}</button
      >
    </div>
  </dialog>
</main>

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
  dialog {
    width: min(500px, calc(100vw - 2rem));
    border: 1px solid #d8dee8;
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 20px 60px #18212f40;
  }
  dialog::backdrop {
    background: #18212f55;
  }
  dialog h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  dialog p {
    color: #5c6777;
    font-size: 0.9rem;
  }
  dialog label {
    display: grid;
    gap: 0.3rem;
    margin: 1rem 0;
    font-weight: 600;
    font-size: 0.9rem;
  }
  dialog input,
  dialog select,
  dialog textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 0.55rem;
    border: 1px solid #bfc9d6;
    border-radius: 6px;
    font: inherit;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .dialog-actions button {
    padding: 0.5rem 0.9rem;
    cursor: pointer;
  }
  .error {
    color: #a32b2b;
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
