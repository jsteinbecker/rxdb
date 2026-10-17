<script lang="ts">
      import RxCui from '$lib/components/RxCui.svelte';
      import BrandedName from '$lib/components/BrandedName.svelte';
      import {formatNdc} from '$lib/ndc';
      import PageHeader from '$lib/components/PageHeader.svelte';
      import {enhance} from '$app/forms';
      import {packageLayout, type PackageLine, runSpans} from '$lib/formulary-item';
      import ItemSummary from '$lib/components/ItemSummary.svelte';
      import IngredientScenarios from '$lib/components/IngredientScenarios.svelte';
      import PillMockup from '$lib/components/PillMockup.svelte';
      import RouteBadge from '$lib/components/RouteBadge.svelte';
      import {pillImageKey, pillPhotoUrl} from '$lib/pill-image-layout';
      import {abbreviatedRelease} from '$lib/time-release';
      import {strengthAsPercent} from '$lib/item-name';
      import {badgeText} from '$lib/local-concept-list';
      import MgPerMl from '$lib/components/helpers/MgPerMl.svelte';

      let {data, form} = $props();

      let draft = $state('');
      let editingBrands = $state(false);
      let editingRelease = $state(false);
      let editingName = $state(false);
      let nameDraft = $state('');
      let percentDraft = $state(false);
      let refreshing = $state(false);

      const item = $derived(data.item);
      const layout = $derived(packageLayout(data.packages));
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
      const columns = $derived(2 + Number(showAppearance) + Number(layout.showDoseForm) + Number(layout.showRoutes));
</script>

{#snippet displayName(item: {displayName: string})}
      {@const parts = item.displayName.split(/(\d+(?:[.,]\d+)*)\s*mg\/ml/gi)}

      {#each parts as part, i}
            {#if i % 2 === 1} <MgPerMl value={part} />
            {:else} {part}
            {/if}
      {/each}
{/snippet}


<svelte:head>
      <title>{item.displayName} · RxDB</title>
</svelte:head>

<main>
      <PageHeader>
            {#snippet eyebrow()}
                  <a href="/">RxDB</a> / <a href="/formulary">Formulary</a> /
                  <a href="/formulary/items">Loaded items</a> / {level}
            {/snippet}
            {#snippet title()}<h1>{@render displayName(item)}</h1>{/snippet}
            <p>
                  <span class="level">{level}</span>
                  {#if item.localConcept}
                        <span class="level local" title={item.localConcept.name}>{badgeText(item.localConcept)}</span>
                  {/if}
                  <span class="mono">
        {#if item.target.kind === 'concept'}RxCUI <RxCui
              rxcui={item.target.rxcui}/>{:else if item.target.kind === 'set'}Curated set · openFDA{:else}NDC {formatNdc(item.target.ndc)}{/if}
      </span>
                  · {plural(item.packages, 'package')}
                  {#if item.excludedPackages}<span
                        title="Linked by the load but excluded from the catalog (veterinary or ineligible), so not listed below"
                  >{" "}(+{item.excludedPackages} excluded)</span>{/if}
                  · loaded {new Date(item.loadedAt).toLocaleDateString()}
                  · {data.scope.name}
            </p>
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
                  <button disabled={refreshing}>
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                  </button>
                  {#if form?.refreshMessage}
                        <span class="error" role="alert">{form.refreshMessage}</span>
                  {:else if form?.refreshed}
                        <span role="status">Refreshed · {plural(form.refreshed.packagesLinked, 'package')} linked.</span>
                  {/if}
            </form>
            {#if data.related}
                  <nav class="related" aria-label="Related formulary items">
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
      </PageHeader>

      <section aria-labelledby="name-heading" class="brands">
            <div class="brands-head">
                  <h2 id="name-heading">Display name</h2>
                  <button
                        aria-pressed={editingName}
                        class="edit-toggle"
                        onclick={() => {
          editingName = !editingName;
          nameDraft = item.nameOverride ?? item.sourceName;
          percentDraft = item.strengthAsPercent;
        }}
                        type="button">{editingName ? 'Cancel' : 'Edit'}</button
                  >
            </div>
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
                              <input type="checkbox" name="percent" bind:checked={percentDraft}/>
                              Show strength as a percentage
                        </label>
                        <p class="none">
                              Preview: {percentDraft ? strengthAsPercent(nameDraft || item.sourceName) : nameDraft || item.sourceName}
                        </p>
                        <div class="name-actions">
                              <button>Save</button>
                              <button type="button" onclick={() => (nameDraft = item.sourceName)}>Reset to sourced
                                                                                                  name
                              </button>
                        </div>
                  </form>
                  {#if form?.nameMessage}<p class="error" role="alert">{form.nameMessage}</p>{/if}
            {:else if item.nameOverride || item.strengthAsPercent}
                  <p class="none">Sourced as {item.sourceName}</p>
            {:else}
                  <p class="none">Sourced name, unchanged.</p>
            {/if}
      </section>

      {#if item.releasePeriod}
            <section class="brands" aria-labelledby="release-heading">
                  <div class="brands-head">
                        <h2 id="release-heading">Release abbreviation</h2>
                        <button
                              type="button"
                              class="edit-toggle"
                              aria-pressed={editingRelease}
                              onclick={() => (editingRelease = !editingRelease)}
                        >{editingRelease ? 'Cancel' : 'Edit'}</button
                        >
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

      <section aria-labelledby="brands-heading" class="brands">
            <div class="brands-head">
                  <h2 id="brands-heading">Brand names</h2>
                  <button
                        aria-pressed={editingBrands}
                        class="edit-toggle"
                        onclick={() => {
          editingBrands = !editingBrands;
          draft = '';
        }}
                        type="button">{editingBrands ? 'Done editing' : 'Edit'}</button
                  >
            </div>
            <ul class="tags">
                  {#each data.brands.active as brand (brand.nameKey)}
                        <li class="tag" class:rxnorm={brand.source === 'rxnorm'}>
          <span title={brand.source === 'rxnorm' ? 'From RxNorm' : 'Added manually'}
          >{brand.name}</span
          >
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

      {#if data.packages.length}
            {@const billed = data.packages.flatMap((pkg) => (data.cmsBilling[pkg.ndc] ?? []).map((bill) => ({pkg, bill})))}
            <section aria-labelledby="cms-heading" class="brands cms">
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
                                          <td><code>{bill.n4}</code></td>
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
            <ItemSummary summary={data.summary}/>
            <IngredientScenarios summary={data.summary}/>
      {/if}

      {#if !data.packages.length}
            <p class="empty">This item has no packages linked.</p>
      {:else}
            <h2 class="packages-heading">Packages</h2>
            <p class="shared">
                  {layout.shared.join(' · ')}
                  {#if layout.sharedRoutes.length}
                        {#if layout.shared.length}{' · '}{/if}
                        {#each layout.sharedRoutes as route (route)}
                              <RouteBadge {route}/>
                        {/each}
                  {/if}
            </p>
            {#snippet headerRow()}
                  <tr>
                        <th>NDC</th>
                        <th>Pack</th>
                        {#if showAppearance}
                              <th>Appearance</th>
                        {/if}
                        {#if layout.showDoseForm}
                              <th>Dose form</th>
                        {/if}
                        {#if layout.showRoutes}
                              <th>Routes</th>
                        {/if}
                  </tr>
            {/snippet}
            {#snippet packageRows(packages: PackageLine[])}
                  {@const spans = showAppearance ? appearanceSpans(packages) : []}
                  {#each packages as pkg, row (pkg.packageId)}
                        <tr>
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
            {#if layout.groups.length > 1}
                  <!-- Several labelers read best side by side: one table, grouped by labeler then product. -->
                  <table class="unified">
                        <thead>{@render headerRow()}</thead>
                        {#each layout.groups as group (group.labeler)}
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
                  </table>
            {:else}
                  {#each layout.groups as group (group.labeler)}
                        <section class="labeler">
                              <h3>{group.labeler} <span class="count">{plural(group.count, 'package')}</span></h3>
                              {#each group.products as product (product.product)}
                                    <h4>{product.product}</h4>
                                    <table>
                                          <thead>{@render headerRow()}</thead>
                                          <tbody>{@render packageRows(product.packages)}</tbody>
                                    </table>
                              {/each}
                        </section>
                  {/each}
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
</main>

<style>
      .name-form {
            display: grid;
            gap: 0.4rem;
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

      .packages-heading {
            margin: 2.5rem 0 0;
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

      td.inferred {
            color: #5c6777;
            font-style: italic;
      }

      main {
            max-width: 1040px;
            margin: 0 auto;
            padding: 4rem 1.5rem;
      }

      .related {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 0.5rem 0.75rem;
            margin-top: 0.75rem;
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
            margin: 2rem 0 0;
            color: #5c6777;
            font-size: 0.9rem;
      }

      .labeler h3 {
            margin: 1.5rem 0 0;
            font-size: 1.05rem;
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

      .labeler h4 {
            margin: 0.75rem 0 0;
            font-size: 0.9rem;
            color: #3b4656;
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
            border-bottom: 1px solid #e3e8ee;
            padding: 0.55rem 0.6rem;
            text-align: left;
            vertical-align: top;
      }

      th {
            color: #5c6777;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.06em;
      }

      .brands {
            margin-top: 1.5rem;
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

      .brands-head {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 0.5rem;
      }

      .brands-head h2 {
            margin: 0;
      }

      .edit-toggle {
            border: 1px solid #b9c3d0;
            border-radius: 0.45rem;
            background: white;
            padding: 0.15rem 0.6rem;
            font: inherit;
            font-size: 0.8rem;
            cursor: pointer;
      }

      .edit-toggle[aria-pressed='true'] {
            border-color: #3464a5;
            background: #3464a5;
            color: white;
      }

      .none {
            color: #5c6777;
            font-size: 0.85rem;
      }

      .tags,
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

      .tag.rxnorm {
            border-color: #b7d3f2;
            background: #e8f0fb;
            color: #204f91;
      }

      .tag form,
      .dismissed form {
            display: inline;
      }

      .tag:has(form) {
            padding-right: 0.2rem;
      }

      .tag button {
            border: 0;
            background: none;
            color: inherit;
            cursor: pointer;
            padding: 0 0.4rem;
            font-size: 1rem;
            line-height: 1;
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
