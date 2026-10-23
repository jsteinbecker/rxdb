<script lang="ts">
      import RxCui from '$lib/components/RxCui.svelte';
      import BrandedName from '$lib/components/BrandedName.svelte';
      import {formatNdc} from "$lib/catalog/ndc";
      import PageHeader from '$lib/components/PageHeader.svelte';
      import {enhance} from '$app/forms';
      import {packageLayout, type PackageLine, runSpans} from "$lib/formulary/item";
      import ItemSummary from '$lib/components/ItemSummary.svelte';
      import IngredientScenarios from '$lib/components/IngredientScenarios.svelte';
      import PillMockup from '$lib/components/PillMockup.svelte';
      import RouteBadge from '$lib/components/RouteBadge.svelte';
      import {pillImageKey, pillPhotoUrl} from "$lib/imprints/pill-image-layout";
      import {abbreviatedRelease} from "$lib/medication/time-release";
      import {itemName} from "$lib/formulary/item-name";
      import {ITEM_STRENGTH_STYLES} from "$lib/medication/strength-style";
      import {strengthRules} from "$lib/client/strength-display.svelte";
      import {badgeText} from "$lib/curation/local-concept-list";
      import MgPerMl from '$lib/components/helpers/MgPerMl.svelte';

      let {data, form} = $props();

      let draft = $state('');
      let editingBrands = $state(false);
      let editingRelease = $state(false);
      let editingName = $state(false);
      let nameDraft = $state('');
      let styleDraft = $state<string | null>(null);
      let refreshing = $state(false);

      const item = $derived(data.item);
      const layout = $derived(packageLayout(data.packages, strengthRules(item.strengthStyle)));
      const showAppearance = $derived(Object.keys(data.appearances).length > 0);
      // What a row's mockup draws, so adjacent identical pills share one merged cell.
      // The product code is identity, not appearance, and is left out of the key.
      const appearanceKey = (ndc: string) => {
            const entry = data.appearances[ndc];
            return entry
                  ? JSON.stringify([entry.doseForm, entry.list.map((look) => ({...look, productCode: null}))])
                  : null;
      };
      const appearanceSpans = (packages: PackageLine[]) =>
            runSpans(packages.map((pkg) => appearanceKey(pkg.ndc)));
      const level = $derived(item.target.kind === 'concept' ? (item.tty ?? 'Concept') : item.target.kind === 'set' ? 'Set' : 'NDC');
      const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
      // One sortable package table. Sorting on labeler (the default) groups rows under labeler and product
      // headings; any other column flattens them, with labeler and product as columns of their own.
      type SortKey = 'labeler' | 'product' | 'ndc' | 'pack' | 'doseForm';
      let sortKey = $state<SortKey>('labeler');
      let sortDir = $state<1 | -1>(1);
      const grouped = $derived(sortKey === 'labeler');
      const sortBy = (key: SortKey) => {
            if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1;
            else {
                  sortKey = key;
                  sortDir = 1;
            }
      };
      const ariaSort = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? 'ascending' : 'descending') : undefined);
      const sortedGroups = $derived(sortDir === 1 ? layout.groups : [...layout.groups].reverse());
      const flatRows = $derived.by(() => {
            const rows = layout.groups.flatMap((group) =>
                  group.products.flatMap((product) =>
                        product.packages.map((pkg) => ({pkg, labeler: group.labeler, product: product.product}))));
            const value = (row: (typeof rows)[number]) =>
                  sortKey === 'product' ? row.product
                        : sortKey === 'ndc' ? row.pkg.ndc
                        : sortKey === 'pack' ? (row.pkg.pack ?? '')
                        : sortKey === 'doseForm' ? (row.pkg.doseForm ?? '')
                        : row.labeler;
            return rows.sort((a, b) =>
                  sortDir * (value(a).localeCompare(value(b), undefined, {numeric: true}) || a.labeler.localeCompare(b.labeler)));
      });
      const columns = $derived(2 + 2 * Number(!grouped) + Number(showAppearance) + Number(layout.showDoseForm) + Number(layout.showRoutes));
</script>

{#snippet displayName(item: {displayName: string})}
      {@const parts = item.displayName.split(/(\d+(?:[.,]\d+)*)\s*mg\/ml/gi)}

      {#each parts as part, i}
            {#if i % 2 === 1} <MgPerMl value={part} />
            {:else} {part}
            {/if}
      {/each}
{/snippet}

<!-- A quiet pencil until hovered; while editing it turns into the way out (× cancels, ✓ finishes). -->
{#snippet editToggle(pressed: boolean, label: string, toggle: () => void, done: 'cancel' | 'finish' = 'cancel')}
      {@const action = pressed ? (done === 'finish' ? `Done editing ${label}` : `Cancel editing ${label}`) : `Edit ${label}`}
      <button type="button" class="edit-toggle" aria-pressed={pressed} aria-label={action} title={action} onclick={toggle}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  {#if !pressed}
                        <path d="M11.3 2.2a1.6 1.6 0 0 1 2.3 2.3l-8.2 8.2-3 .8.8-3z"/>
                        <path d="M10.1 3.4l2.5 2.5"/>
                  {:else if done === 'finish'}
                        <path d="M3 8.5l3.2 3.1L13 4.5"/>
                  {:else}
                        <path d="M4 4l8 8M12 4l-8 8"/>
                  {/if}
            </svg>
      </button>
{/snippet}

<svelte:head>
      <title>{item.displayName} · RxDB</title>
</svelte:head>

<main>
      <PageHeader compact>
            {#snippet eyebrow()}
                  <a href="/">RxDB</a> / <a href="/formulary">Formulary</a> /
                  <a href="/formulary/items">Loaded items</a> / {level}
            {/snippet}
            {#snippet title()}
                  <h1 class="title-row">{@render displayName(item)}
                        {@render editToggle(editingName, 'display name', () => {
                              editingName = !editingName;
                              nameDraft = item.nameOverride ?? item.sourceName;
                              styleDraft = item.strengthStyle;
                        })}</h1>
            {/snippet}
            {#if editingName}
                  <form
                        class="add name-form"
                        method="POST"
                        action="?/setName"
                        use:enhance={() =>
          async ({ update }) => {
            await update({ reset: false });
            if (!form?.nameMessage) editingName = false;
          }}
                  >
                        <input
                              name="name"
                              bind:value={nameDraft}
                              placeholder={item.sourceName}
                              aria-label="Display name"
                        />
                        <label class="percent">
                              Strengths shown as
                              <select name="strengthStyle" bind:value={styleDraft}>
                                    {#each ITEM_STRENGTH_STYLES as option (option.label)}
                                          <option value={option.value}>{option.label}</option>
                                    {/each}
                              </select>
                        </label>
                        <p class="none">
                              Preview: {itemName(item.sourceName, {nameOverride: nameDraft && nameDraft !== item.sourceName ? nameDraft : null, strengthStyle: styleDraft}, data.strengthStyles)}
                        </p>
                        <div class="name-actions">
                              <button class="ghost">Save</button>
                              <button type="button" class="ghost" onclick={() => (nameDraft = item.sourceName)}>Reset to sourced
                                                                                                  name
                              </button>
                        </div>
                  </form>
                  {#if form?.nameMessage}<p class="error" role="alert">{form.nameMessage}</p>{/if}
            {:else if item.nameOverride || item.strengthStyle || item.displayName !== item.sourceName}
                  <p class="none">Sourced as {item.sourceName}</p>
            {/if}
      </PageHeader>

      <div class="ledger">
            <dl>
                  <div class="lead">
                        <dt>Level</dt>
                        <dd>
                              <span class="level">{level}</span>
                              {#if item.localConcept}
                                    <span class="level local" title={item.localConcept.name}>{badgeText(item.localConcept)}</span>
                              {/if}
                        </dd>
                  </div>
                  <div>
                        <dt>{item.target.kind === 'concept' ? 'RxCUI' : item.target.kind === 'set' ? 'Source' : 'NDC'}</dt>
                        <dd class="mono">{#if item.target.kind === 'concept'}<RxCui rxcui={item.target.rxcui}/>{:else if item.target.kind === 'set'}openFDA set{:else}{formatNdc(item.target.ndc)}{/if}</dd>
                  </div>
                  <div>
                        <dt>Packages</dt>
                        <dd class="big">{item.packages}{#if item.excludedPackages}<sup
                              title="Linked by the load but excluded from the catalog (veterinary or ineligible), so not listed below"
                        >+{item.excludedPackages} excl.</sup>{/if}</dd>
                  </div>
                  <div>
                        <dt>Loaded</dt>
                        <dd>{new Date(item.loadedAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</dd>
                  </div>
                  <div>
                        <dt>Formulary</dt>
                        <dd>{data.scope.name}</dd>
                  </div>
            </dl>
            <form
                  method="POST"
                  action="?/refresh"
                  class="refresh"
                  use:enhance={() => {
                        refreshing = true;
                        return async ({update}) => {
                              try { await update(); } finally { refreshing = false; }
                        };
                  }}
            >
                  <button class="ghost" disabled={refreshing}>
                        <span aria-hidden="true" class:spin={refreshing}>↻</span>
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                  </button>
            </form>
      </div>
      {#if form?.refreshMessage}
            <p class="notice error" role="alert">{form.refreshMessage}</p>
      {:else if form?.refreshed}
            <p class="notice" role="status">Refreshed · {plural(form.refreshed.packagesLinked, 'package')} linked.</p>
      {/if}

      <div class="layout">
      <aside class="identity">
      <section aria-labelledby="brands-heading" class="field brands">
            <div class="field-head">
                  <h2 id="brands-heading">Brand names</h2>
                  {@render editToggle(editingBrands, 'brand names', () => {
                        editingBrands = !editingBrands;
                        draft = '';
                  }, 'finish')}
            </div>
            <ul class="brand-list">
                  {#each data.brands.active as brand (brand.nameKey)}
                        <li class="brand" class:manual={brand.source !== 'rxnorm'}>
                              <span title={brand.source === 'rxnorm' ? 'From RxNorm' : 'Added manually'}>{brand.name}</span>
                              {#if editingBrands}
                                    <form method="POST" action="?/removeBrand" use:enhance>
                                          <input type="hidden" name="key" value={brand.nameKey}/>
                                          <button aria-label="Remove {brand.name}">×</button>
                                    </form>
                              {/if}
                        </li>
                  {:else}
                        {#if !editingBrands}
                              <li class="none">No brand names.</li>
                        {/if}
                  {/each}
            </ul>
            {#if editingBrands}
                  <form
                        class="add"
                        method="POST"
                        action="?/addBrand"
                        use:enhance={() =>
          async ({ update }) => {
            await update({ reset: false });
            if (!form?.brandMessage) draft = '';
          }}
                  >
                        <input
                              name="name"
                              bind:value={draft}
                              placeholder="Add a brand name and press Enter"
                              aria-label="Add a brand name"
                              maxlength="120"
                        />
                  </form>
                  {#if form?.brandMessage}<p class="error" role="alert">{form.brandMessage}</p>{/if}
            {/if}
            {#if editingBrands && data.brands.dismissed.length}
                  <details>
                        <summary>Dismissed ({data.brands.dismissed.length})</summary>
                        <ul class="dismissed">
                              {#each data.brands.dismissed as brand (brand.nameKey)}
                                    <li>
                                          {brand.name}
                                          <form method="POST" action="?/restoreBrand" use:enhance>
                                                <input type="hidden" name="key" value={brand.nameKey}/>
                                                <button>Restore</button>
                                          </form>
                                    </li>
                              {/each}
                        </ul>
                  </details>
            {/if}
      </section>

      {#if item.releasePeriod}
            <section class="field" aria-labelledby="release-heading">
                  <div class="field-head">
                        <h2 id="release-heading">Release abbreviation</h2>
                        {@render editToggle(editingRelease, 'release abbreviation', () => (editingRelease = !editingRelease))}
                  </div>
                  {#if editingRelease}
                        <form
                              class="add"
                              method="POST"
                              action="?/setReleaseAbbreviation"
                              use:enhance={() =>
            async ({ update }) => {
              await update({ reset: false });
              if (!form?.releaseMessage) editingRelease = false;
            }}
                        >
                              <input
                                    name="abbreviation"
                                    value={item.releaseAbbreviation ?? ''}
                                    placeholder="e.g. SR or XR for {item.releasePeriod}; blank to clear"
                                    aria-label="Release abbreviation for {item.releasePeriod}"
                                    maxlength="8"
                              />
                        </form>
                        {#if form?.releaseMessage}<p class="error" role="alert">{form.releaseMessage}</p>{/if}
                  {:else if item.releaseAbbreviation}
                        <p class="none">
                              <span class="tag">{item.releaseAbbreviation}</span>
                              {abbreviatedRelease(item.displayName, item.releaseAbbreviation)}
                        </p>
                  {:else}
                        <p class="none">None set for {item.releasePeriod}.</p>
                  {/if}
            </section>
      {/if}

                  {#if data.related}
                  <nav class="related field" aria-label="Related formulary items">
        <span class="related-label"
        >{data.related.basis === 'ingredient+doseForm'
              ? 'Same ingredient & dose form'
              : 'Same ingredient'}</span
        >
                        <ul>
                              {#each data.related.items as related (related.id)}
                                    <li>
                                          <a href="/formulary/items/{related.id}" data-nav-title={related.name}
                                          ><BrandedName text={related.name} />
                                                {#if data.related.basis === 'ingredient' && related.doseForm}
                                                      <small>{related.doseForm}</small>{/if}
                                          </a
                                          >
                                    </li>
                              {/each}
                        </ul>
                  </nav>
            {/if}
      </aside>

      <div class="content">
      {#if data.packages.length}
            <ItemSummary summary={data.summary} title={item.nameOverride ?? item.sourceName} itemStyle={item.strengthStyle}/>
            <IngredientScenarios summary={data.summary}/>
      {/if}

      {#if !data.packages.length}
            <p class="empty">This item has no packages linked.</p>
      {:else}
            <div class="section-head"><h2 class="packages-heading">Packages</h2><span class="count">{plural(data.packages.length, 'package')}</span></div>
            <p class="shared">
                  {layout.shared.join(' · ')}
                  {#if layout.sharedRoutes.length}
                        {#if layout.shared.length}{' · '}{/if}
                        {#each layout.sharedRoutes as route (route)}
                              <RouteBadge {route}/>
                        {/each}
                  {/if}
            </p>
            {#snippet sortHeader(key: SortKey, label: string)}
                  <th aria-sort={ariaSort(key)}>
                        <button type="button" class="sort" class:active={sortKey === key} onclick={() => sortBy(key)}>
                              {label}<span class="arrow">{sortKey === key ? (sortDir === 1 ? '▲' : '▼') : '↕'}</span>
                        </button>
                  </th>
            {/snippet}
            {#snippet headerRow()}
                  <tr>
                        {@render sortHeader('labeler', 'Labeler')}
                        {#if !grouped}
                              {@render sortHeader('product', 'Product')}
                        {/if}
                        {@render sortHeader('ndc', 'NDC')}
                        {@render sortHeader('pack', 'Pack')}
                        {#if showAppearance}
                              <th>Appearance</th>
                        {/if}
                        {#if layout.showDoseForm}
                              {@render sortHeader('doseForm', 'Dose form')}
                        {/if}
                        {#if layout.showRoutes}
                              <th>Routes</th>
                        {/if}
                  </tr>
            {/snippet}
            {#snippet packageRows(packages: PackageLine[], owners: {labeler: string; product: string}[] = [])}
                  {@const spans = showAppearance ? appearanceSpans(packages) : []}
                  {#each packages as pkg, row (pkg.packageId)}
                        <tr>
                              {#if owners.length}
                                    <td>{owners[row].labeler}</td>
                                    <td>{owners[row].product}</td>
                              {:else}
                                    <td></td>
                              {/if}
                              <td class="mono"><a
                                    href="/formulary/ndc/{pkg.ndc}" data-nav-title={pkg.title}>{formatNdc(pkg.ndc)}</a></td>
                              <td>
                                    {pkg.pack ?? '—'}
                                    {#if pkg.multiDose}<span class="tag">multi-dose</span>{/if}
                              </td>
                              {#if showAppearance && spans[row] > 0}
                                    <td class="appearance" class:merged={spans[row] > 1}
                                        rowspan={spans[row]}>
                                          {#each data.appearances[pkg.ndc]?.list ?? [] as appearance, i (appearance.productCode ?? i)}
                                                {@const entry = data.appearances[pkg.ndc]}
                                                {@const photo = entry.photos[i]}
                                                <PillMockup
                                                      {appearance}
                                                      doseForm={entry.doseForm}
                                                      layout={photo ? (data.layouts[pillImageKey(photo.setId, photo.image)] ?? null) : null}
                                                      photoUrl={photo ? pillPhotoUrl(photo) : null}
                                                      size={46}
                                                      compact
                                                />
                                          {:else}—
                                          {/each}
                                    </td>
                              {/if}
                              {#if layout.showDoseForm}
                                    <td
                                          class:inferred={pkg.inferred?.doseForm}
                                          title={pkg.inferred?.doseForm ? 'From the RxNorm concept and sibling labels; this package has not been enriched' : undefined}
                                    >{pkg.doseForm ?? '—'}</td>
                              {/if}
                              {#if layout.showRoutes}
                                    <td>
                                          {#each pkg.routes as route (route)}
                                                <RouteBadge {route}/>
                                          {:else}—
                                          {/each}
                                    </td>
                              {/if}
                        </tr>
                  {/each}
            {/snippet}
            {#if layout.groups.length}
                  <table class="unified">
                        <thead>{@render headerRow()}</thead>
                        {#if grouped}
                              {#each sortedGroups as group (group.labeler)}
                                    <tbody>
                                    <tr class="labeler-row">
                                          <th colspan={columns}>{group.labeler} <span class="count">{plural(group.count, 'package')}</span></th>
                                    </tr>
                                    </tbody>
                                    {#each group.products as product (product.product)}
                                          <tbody>
                                          <tr class="product-row">
                                                <th colspan={columns}>{product.product}</th>
                                          </tr>
                                          {@render packageRows(product.packages)}
                                          </tbody>
                                    {/each}
                              {/each}
                        {:else}
                              <tbody>{@render packageRows(flatRows.map((r) => r.pkg), flatRows)}</tbody>
                        {/if}
                  </table>
            {/if}
            {#if layout.pendingCount}
                  <!-- Open by default only when nothing above has detail to show. -->
                  <details class="pending" open={!layout.groups.length}>
                        <summary>
                              {plural(layout.pendingCount, 'package')} not yet enriched
                              <span class="count">{plural(layout.pending.length, 'labeler')}</span>
                        </summary>
                        <p class="note">
                              Only their NDCs are known so far. Opening an NDC fetches its label and listing detail.
                        </p>
                        <ul>
                              {#each layout.pending as entry (entry.labeler)}
                                    <li>
                                          <span class="pending-labeler">{entry.labeler} <span
                                                class="count">{entry.ndcs.length}</span></span>
                                          <span class="ndcs mono"
                                          >{#each entry.ndcs as ndc (ndc)}<a
                                                href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a>{/each}</span
                                          >
                                    </li>
                              {/each}
                        </ul>
                  </details>
            {/if}
      {/if}

      {#if data.packages.length}
            {@const billed = data.packages.flatMap((pkg) => (data.cmsBilling[pkg.ndc] ?? []).map((bill) => ({pkg, bill})))}
            <section aria-labelledby="cms-heading" class="cms card">
                  <h2 id="cms-heading">CMS billing (Medicare Part B)</h2>
                  {#if billed.length}
                        <table>
                              <thead>
                              <tr>
                                    <th>NDC</th>
                                    <th>HCPCS</th>
                                    <th>Code dosage</th>
                                    <th>Billing units / pkg</th>
                                    <th>NDC qty</th>
                                    <th>N4 segment</th>
                              </tr>
                              </thead>
                              <tbody>
                              {#each billed as {pkg, bill} (pkg.ndc + bill.hcpcs)}
                                    <tr>
                                          <td><a href="/formulary/ndc/{pkg.ndc}">{bill.ndc}</a></td>
                                          <td title={bill.descriptor ?? ''}><strong>{bill.hcpcs}</strong>
                                                {#if bill.descriptor}<span class="muted">{bill.descriptor}</span>{/if}
                                                {#if bill.file !== 'ASP'}<span class="muted">({bill.file})</span>{/if}</td>
                                          <td>{bill.hcpcsDosage ?? '—'}</td>
                                          <td>{bill.billUnitsPerPackage ?? '—'}</td>
                                          <td>{bill.ndcQuantity ?? '—'} {bill.unitQualifier}</td>
                                          <td>{#if bill.n4}<code>{bill.n4}</code>{:else}—{/if}</td>
                                    </tr>
                              {/each}
                              </tbody>
                        </table>
                        <p class="muted">CMS ASP NDC–HCPCS crosswalk, {billed[0].bill.quarter}. The N4 quantity is one whole
                              package; bill the amount given.</p>
                  {:else}
                        <p class="none">No package of this item is in the current CMS NDC–HCPCS crosswalk (Part B drugs only).</p>
                  {/if}
            </section>
      {/if}
      </div>
      </div>
</main>

<style>
      .name-form {
            display: grid;
            gap: 0.4rem;
            width: min(36rem, 100%);
            color: var(--ink);
      }

      .name-form input[name='name'] {
            width: 100%;
            box-sizing: border-box;
      }

      .name-form .percent select {
            width: auto;
      }

      .name-form .percent {
            display: flex;
            gap: 0.4rem;
            align-items: center;
      }

      .name-actions {
            display: flex;
            gap: 0.5rem;
      }


      .count {
            margin-left: 0.35rem;
            color: #5c6777;
            font-size: 0.8rem;
            font-weight: 500;
      }

      .pending {
            margin-top: 2rem;
            border: 1px solid #e3e8ee;
            border-radius: 0.6rem;
            background: white;
            padding: 0.75rem 1rem;
            color: #18212f;
            font-size: 0.9rem;
      }

      .pending summary {
            font-weight: 650;
            cursor: pointer;
      }

      .pending .note {
            margin: 0.5rem 0 0.75rem;
            color: #5c6777;
            font-size: 0.85rem;
      }

      .pending ul {
            margin: 0;
            padding: 0;
            list-style: none;
      }

      .pending li {
            display: grid;
            grid-template-columns: minmax(10rem, 16rem) 1fr;
            gap: 0.75rem;
            border-top: 1px solid #eef1f5;
            padding: 0.5rem 0;
      }

      .pending-labeler {
            font-weight: 600;
      }

      .ndcs {
            display: flex;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            flex-wrap: wrap;
            gap: 0.2rem 0.75rem;
            font-size: 0.8rem;
      }

      .ndcs a {
            color: #3464a5;
      }

      @media (max-width: 600px) {
            .pending li {
                  grid-template-columns: 1fr;
                  gap: 0.25rem;
            }
      }

      td.mono a {
            color: var(--accent);
            text-decoration: none;
            font-variant-numeric: tabular-nums;
      }

      td.mono a:hover {
            text-decoration: underline;
      }

      .unified .labeler-row th {
            box-shadow: inset 3px 0 0 var(--accent);
            padding-left: 0.75rem;
      }

      td.inferred {
            color: #5c6777;
            font-style: italic;
      }

      main {
            --page-width: 1180px;
            --ink: #1b2430;
            --muted: #7a8594;
            --line: #e3e8ee;
            --accent: #3464a5;
            color: var(--ink);
      }

      .ledger {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin: 1.75rem 0 1rem;
            border-top: 2px solid var(--ink);
            border-bottom: 1px solid var(--line);
      }

      .ledger dl {
            display: flex;
            flex-wrap: wrap;
            margin: 0;
            flex: 1;
            min-width: 0;
      }

      .ledger dl > div {
            padding: 0.7rem 1.25rem 0.7rem 0;
            margin-right: 1.25rem;
            border-right: 1px solid var(--line);
      }

      .ledger dl > div:last-child {
            border-right: 0;
      }

      .ledger dt {
            color: var(--muted);
            font-size: 0.66rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
      }

      .ledger dd {
            margin: 0.25rem 0 0;
            font-size: 0.95rem;
            font-variant-numeric: tabular-nums;
      }

      .ledger dd.big {
            margin-top: 0;
            font-size: 1.5rem;
            font-weight: 300;
            line-height: 1.2;
      }

      .ledger sup {
            margin-left: 0.3rem;
            color: #b07a1f;
            font-size: 0.65rem;
            font-weight: 600;
            cursor: help;
      }

      button.ghost {
            border: 1px solid var(--line);
            border-radius: 0.55rem;
            background: white;
            color: var(--ink);
            padding: 0.45rem 0.85rem;
            font: inherit;
            font-size: 0.85rem;
            font-weight: 650;
            white-space: nowrap;
            cursor: pointer;
      }

      button.ghost:hover:not(:disabled) {
            border-color: var(--accent);
            color: var(--accent);
      }

      button:disabled {
            opacity: 0.45;
            cursor: default;
      }

      .spin {
            display: inline-block;
            animation: spin 0.9s linear infinite;
      }

      @keyframes spin {
            to {
                  transform: rotate(360deg);
            }
      }

      .notice {
            border-radius: 0.55rem;
            background: #e9f6ee;
            color: #1f6b3a;
            padding: 0.6rem 0.85rem;
            font-size: 0.9rem;
      }

      .notice.error {
            background: #fdecec;
            color: #9a2a2a;
      }

      .layout {
            display: grid;
            grid-template-columns: 17rem minmax(0, 1fr);
            gap: 2.5rem;
            align-items: start;
            margin-top: 1.5rem;
      }

      .identity {
            position: sticky;
            top: 1rem;
            overflow: hidden;
            border: 1px solid var(--line);
            border-radius: 0.75rem;
            background: white;
            box-shadow: 0 1px 2px rgb(27 36 48 / 4%), 0 8px 24px -12px rgb(27 36 48 / 10%);
      }

      .field {
            padding: 0.9rem 1rem;
            border-bottom: 1px solid #f0f3f6;
      }

      .field:last-child {
            border-bottom: 0;
      }

      .field .none,
      .field p {
            margin: 0;
      }

      .identity .add input {
            width: 100%;
            box-sizing: border-box;
      }

      .content > :global(*:first-child) {
            margin-top: 0;
      }

      .section-head {
            display: flex;
            align-items: baseline;
            gap: 0.25rem;
            margin: 2.5rem 0 0;
            padding-bottom: 0.4rem;
            border-bottom: 2px solid var(--ink);
      }

      .section-head h2 {
            margin: 0;
            color: var(--ink);
      }

      .card {
            margin-top: 2.5rem;
            border: 1px solid var(--line);
            border-radius: 0.75rem;
            background: white;
            padding: 0.9rem 1rem;
      }

      @media (max-width: 860px) {
            .layout {
                  grid-template-columns: minmax(0, 1fr);
                  gap: 1.5rem;
            }

            .identity {
                  position: static;
            }
      }

      .related {
            display: grid;
            gap: 0.5rem;
      }

      .related-label {
            color: #5c6777;
            font-size: 0.75rem;
            font-weight: 750;
            letter-spacing: 0.08em;
            text-transform: uppercase;
      }

      .related ul {
            display: flex;
            flex-wrap: wrap;
            gap: 0.4rem;
            margin: 0;
            padding: 0;
            list-style: none;
      }

      .related a {
            display: inline-block;
            border-radius: 999px;
            background: #e8f0fb;
            color: #204f91;
            padding: 0.2rem 0.65rem;
            font-size: 0.8rem;
            text-decoration: none;
      }

      .related a:hover {
            background: #d4e4f8;
      }

      .related small {
            margin-left: 0.35rem;
            color: #5c6777;
      }

      .level {
            border-radius: 999px;
            background: #e8f0fb;
            color: #204f91;
            padding: 0.15rem 0.5rem;
            font-size: 0.7rem;
            font-weight: 700;
      }

      .level.local {
            background: #fdf1e0;
            color: #8a4b0b;
      }

      .shared {
            margin: 0.6rem 0 0;
            color: #5c6777;
            font-size: 0.9rem;
      }

      .unified {
            margin-top: 1rem;
      }

      .unified .labeler-row th {
            padding-top: 1rem;
            border-bottom: 1px solid #c9d2dd;
            color: #18212f;
            font-size: 1.05rem;
            letter-spacing: 0;
            text-transform: none;
      }

      .unified .product-row th {
            background: #f5f7fa;
            color: #3b4656;
            font-size: 0.9rem;
            letter-spacing: 0;
            text-transform: none;
      }

      button.sort {
            all: unset;
            cursor: pointer;
            white-space: nowrap;
      }

      button.sort:focus-visible {
            outline: 2px solid var(--accent);
      }

      button.sort .arrow {
            margin-left: 0.3rem;
            opacity: 0.4;
            font-size: 0.75em;
      }

      button.sort.active .arrow {
            opacity: 1;
      }

      .tag {
            margin-left: 0.4rem;
            border-radius: 999px;
            background: #eef1f5;
            padding: 0.05rem 0.5rem;
            font-size: 0.72rem;
            color: #5c6777;
      }

      .tag.warn {
            background: #fdecea;
            color: #a12622;
      }

      table {
            width: 100%;
            margin-top: 0.4rem;
            border-collapse: collapse;
            font-size: 0.9rem;
      }

      th,
      td {
            border-bottom: 1px solid #f0f3f6;
            padding: 0.4rem 0.6rem;
            text-align: left;
            vertical-align: top;
      }

      th {
            color: #5c6777;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.06em;
      }

      .cms table {
            border-collapse: collapse;
            font-size: 0.85rem;
      }

      .cms th,
      .cms td {
            padding: 0.25rem 0.6rem 0.25rem 0;
            text-align: left;
            vertical-align: top;
      }

      .cms .muted {
            color: #5c6777;
            font-size: 0.8rem;
            margin-left: 0.3rem;
      }

      .cms p.muted {
            margin: 0.4rem 0 0;
      }

      h2 {
            margin: 0 0 0.5rem;
            font-size: 0.8rem;
            color: #5c6777;
            text-transform: uppercase;
            letter-spacing: 0.06em;
      }

      .field-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.75rem;
            margin-bottom: 0.5rem;
      }

      .field-head h2 {
            margin: 0;
      }

      /* Inline after the title's last word, so it follows a wrapped title rather than the far edge. */
      .title-row .edit-toggle {
            vertical-align: middle;
            margin-left: 0.15rem;
            letter-spacing: 0;
      }

      /* Faint until its block is hovered or it has focus; full strength while editing. */
      .edit-toggle {
            display: inline-grid;
            place-items: center;
            flex: none;
            width: 1.8rem;
            height: 1.8rem;
            border: 0;
            border-radius: 0.45rem;
            background: none;
            color: var(--muted);
            opacity: 0.35;
            padding: 0;
            cursor: pointer;
            transition: opacity 120ms, background-color 120ms, color 120ms;
      }

      .title-row .edit-toggle {
            width: 2.2rem;
            height: 2.2rem;
      }

      .title-row .edit-toggle svg {
            width: 19px;
            height: 19px;
      }

      .field:hover .edit-toggle,
      .title-row:hover .edit-toggle,
      .edit-toggle:focus-visible {
            opacity: 1;
      }

      .edit-toggle:hover,
      .edit-toggle[aria-pressed='true'] {
            opacity: 1;
            background: #e8f0fb;
            color: var(--accent);
      }

      .edit-toggle:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
      }

      @media (hover: none) {
            .edit-toggle {
                  opacity: 0.8;
            }
      }

      /* Brand names: a dark band edge to edge across the panel, the names set large. */
      .brands {
            border-bottom: 0;
            background:
                  radial-gradient(120% 140% at 0% 0%, rgb(84 128 196 / 28%), transparent 60%),
                  linear-gradient(160deg, #142033, #0b111b);
            color: #f4f7fb;
            padding: 1.1rem 1rem 1.25rem;
      }

      .brands h2 {
            color: #8ea3c0;
            font-size: 0.68rem;
            letter-spacing: 0.14em;
      }

      .brands .edit-toggle {
            color: #b7c6da;
      }

      .brands .edit-toggle:hover,
      .brands .edit-toggle[aria-pressed='true'] {
            background: rgb(255 255 255 / 12%);
            color: white;
      }

      .brand-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.3rem 0.85rem;
            margin: 0;
            padding: 0;
            list-style: none;
      }

      .brand {
            display: inline-flex;
            align-items: center;
            gap: 0.15rem;
            font-size: 1.1rem;
            font-weight: 800;
            line-height: 1.12;
            letter-spacing: -0.025em;
            overflow-wrap: anywhere;
      }

      .brand.manual {
            color: #f3d9a4;
      }

      .brand form {
            display: inline;
      }

      .brand button {
            border: 0;
            border-radius: 0.35rem;
            background: none;
            color: #8ea3c0;
            cursor: pointer;
            padding: 0 0.3rem;
            font-size: 1.1rem;
            line-height: 1.2;
      }

      .brand button:hover {
            background: rgb(255 255 255 / 12%);
            color: white;
      }

      .brands .none {
            color: #8ea3c0;
            font-size: 0.9rem;
            font-weight: 500;
            letter-spacing: 0;
      }

      .brands .add {
            margin-top: 0.85rem;
      }

      .brands .add input {
            border-color: rgb(255 255 255 / 22%);
            background: rgb(255 255 255 / 7%);
            color: white;
      }

      .brands .add input::placeholder {
            color: #8ea3c0;
      }

      .brands .error {
            color: #ffb4b4;
      }

      .brands details {
            color: #b7c6da;
      }

      .brands .dismissed {
            margin-top: 0.4rem;
      }

      .none {
            color: #5c6777;
            font-size: 0.85rem;
      }

      .dismissed {
            display: flex;
            flex-wrap: wrap;
            gap: 0.4rem;
            margin: 0 0 0.5rem;
            padding: 0;
            list-style: none;
      }

      .tag {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            border: 1px solid #b9c3d0;
            border-radius: 999px;
            background: white;
            padding: 0.15rem 0.7rem;
            font-size: 0.85rem;
      }

      .dismissed form {
            display: inline;
      }

      .add input {
            width: min(24rem, 100%);
            border: 1px solid #b9c3d0;
            border-radius: 0.55rem;
            padding: 0.5rem 0.75rem;
            font: inherit;
      }

      .error {
            margin: 0.4rem 0 0;
            color: #8a1f1f;
            font-size: 0.85rem;
      }

      details {
            margin-top: 0.5rem;
            font-size: 0.85rem;
            color: #5c6777;
      }

      .dismissed li {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
      }

      .empty {
            margin-top: 2rem;
            color: #5c6777;
      }

      td.appearance {
            white-space: nowrap;
      }

      td.appearance.merged {
            vertical-align: middle;
            box-shadow: inset 2px 0 0 #d5dde8;
      }

      td.appearance :global(.pill) {
            vertical-align: middle;
            margin-right: 0.5rem;
      }
</style>
