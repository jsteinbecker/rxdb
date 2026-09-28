<script lang="ts">
  import type { StagedPackage } from '$lib/server/catalog-sync';
  import { appearanceText } from '$lib/spl-characteristics';
  import { resolve } from '$app/paths';
  import LabelBlocks from './LabelBlocks.svelte';

  let { item }: { item: StagedPackage } = $props();

  const d = $derived(item.details);
  const active = $derived(d?.spl?.ingredients.filter((i) => i.kind === 'active') ?? []);
  const inactive = $derived(d?.spl?.ingredients.filter((i) => i.kind === 'inactive') ?? []);
  const ionic = $derived(d?.spl?.ingredients.filter((i) => i.kind === 'ionic') ?? []);
  // Strength corrections, numbered by first appearance so identical notes on
  // several rows (a miscoded denominator shared by every excipient) share a mark.
  const strengthNotes = $derived([
    ...new Set([...active, ...inactive].flatMap((i) => i.strengthNotes ?? []))
  ]);
  const noteMark = (note: string) => '*'.repeat(strengthNotes.indexOf(note) + 1);
  const rxnavMarketingStatus = $derived(
    d?.rxnav?.properties.find((property) => property.name === 'MARKETING_STATUS')?.value ?? null
  );
  const flag = (value: boolean | null, yes: string, no: string) =>
    value === true ? yes : value === false ? no : 'Unknown';
  const date = (value: string | null | undefined) =>
    value && /^\d{8}$/.test(value)
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
      : (value ?? null);
  const volume = $derived(item.resolvedVolume);
  const overrideFields = [
    ['description', 'Description'],
    ['brandName', 'Brand name'],
    ['genericName', 'Generic name'],
    ['productCode', 'Product NDC'],
    ['doseForm', 'Dose form']
  ] as const;
</script>

<div class="detail">
  <section>
    <h4>Package</h4>
    <dl>
      <dt>NDC</dt>
      <dd class="mono">{item.ndc}</dd>
      <dt>Product NDC</dt>
      <dd class="mono">{item.productCode ?? '—'}</dd>
      <dt>Description</dt>
      <dd>{item.description ?? '—'}</dd>
      <dt>Brand / generic</dt>
      <dd>{[item.brandName, item.genericName].filter(Boolean).join(' / ') || '—'}</dd>
      <dt>Labeler</dt>
      <dd>{item.labelerName ?? '—'} <span class="mono">({item.labelerCode ?? '?'})</span></dd>
      <dt>Dose form</dt>
      <dd>
        {item.doseForm ?? '—'}
        {#if item.doseFormCorrection}
          <span class="corrected">corrected from {item.doseFormCorrection.from}</span>
          <ul class="evidence">
            {#each item.doseFormCorrection.evidence as ev, i (i)}
              <li><b>{ev.kind}</b> ({ev.source}): {ev.excerpt}</li>
            {/each}
          </ul>
        {/if}
      </dd>
      <dt>Routes</dt>
      <dd>{d?.product?.routes.join(', ') || '—'}</dd>
      {#if item.size}
        <dt>Unit of use</dt>
        <dd>
          {item.size.packQty > 1 ? `${item.size.packQty} × ` : ''}{item.size.value}
          {item.size.unit ?? ''}
          {item.size.container.toLowerCase()}
        </dd>
      {/if}
      <dt>Multi-dose</dt>
      <dd>{flag(item.isMultiDose, 'Multi-dose', 'Single-dose')}</dd>
      <dt>Dry fill</dt>
      <dd>{item.isDryFill ? 'Yes — reconstitute before use' : 'No'}</dd>
      {#if d?.packaging?.siblings.length}
        <dt>Sibling packages</dt>
        <dd>
          <ul>
            {#each d.packaging.siblings as sibling (sibling.ndc)}
              <li><span class="mono">{sibling.ndc}</span> {sibling.description ?? ''}</li>
            {/each}
          </ul>
        </dd>
      {/if}
    </dl>
    {#if item.propertyOverrides && Object.keys(item.propertyOverrides).length}
      <h5>Manual property overrides</h5>
      <ul class="evidence">
        {#each Object.entries(item.propertyOverrides) as [key, override] (key)}
          <li>
            <b>{overrideFields.find(([field]) => field === key)?.[1] ?? key}:</b>
            {override.value}
            <br /><span
              >Source: {override.sectionTitle},
              <a
                href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${override.splSetId}`}
                target="_blank"
                rel="noreferrer">SPL {override.splSetId}</a
              >
              — “{override.excerpt}”</span
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h4>Status and regulatory</h4>
    <dl>
      <dt>FDA NDC directory</dt>
      <dd>
        {item.listed === true
          ? 'Exact NDC found'
          : item.listed === false
            ? 'No exact NDC entry found'
            : 'Unknown'}
      </dd>
      <dt>DailyMed SPL</dt>
      <dd>{flag(item.splPresent, 'Found', 'Not found')}</dd>
      <dt>Catalog eligibility</dt>
      <dd class:bad={item.exclusionReason}>{item.exclusionReason ?? 'Eligible'}</dd>
      <dt>RxNav NDC status</dt>
      <dd>{item.rxcuiStatus ?? '—'}</dd>
      <dt>RxNav marketing status</dt>
      <dd>{rxnavMarketingStatus ?? '—'}</dd>
      <dt>Species</dt>
      <dd>{flag(item.isVeterinary, 'Veterinary', 'Human')}</dd>
      <dt>Product type</dt>
      <dd>{d?.product?.productType ?? '—'}</dd>
      <dt>Marketing category</dt>
      <dd>{d?.product?.marketingCategory ?? '—'}</dd>
      <dt>Application</dt>
      <dd class="mono">{d?.product?.applicationNumber ?? '—'}</dd>
      <dt>DEA schedule</dt>
      <dd>{d?.product?.deaSchedule ?? 'None'}</dd>
      <dt>Marketing</dt>
      <dd>
        {date(d?.packaging?.marketingStartDate ?? d?.product?.marketingStartDate) ?? '?'} →
        {date(item.marketingEndDate) ?? 'present'}
      </dd>
      <dt>Listing expires</dt>
      <dd>{date(d?.product?.listingExpirationDate) ?? '—'}</dd>
      <dt>Sample</dt>
      <dd>{d?.packaging?.sample === true ? 'Yes' : d?.packaging?.sample === false ? 'No' : '—'}</dd>
      {#if d?.product?.pharmClasses.length}
        <dt>Pharmacologic class</dt>
        <dd class="pharm-classes">
          {#each d.product.pharmClasses as pharmClass, i (i)}
            {@const classType = /\[.*]$/.exec(pharmClass)?.[0] ?? ''}
            <div class="pharm-class">
              {#if classType}<span class="class-type mono">{classType}</span>{/if}
              <span>{pharmClass.replace(/\s*\[.*]$/, '')}</span>
            </div>
          {/each}
        </dd>
      {/if}
      {#if d?.product?.rxcuis.length}
        <dt>openFDA RxCUIs</dt>
        <dd class="mono">{d.product.rxcuis.join(', ')}</dd>
      {/if}
      {#if d?.product?.uniis.length}
        <dt>UNIIs</dt>
        <dd class="mono">
          {#each d.product.uniis as unii, i (unii)}{i ? ', ' : ''}<a
              href={resolve('/formulary/unii/[unii]', { unii })}>{unii}</a
            >{/each}
        </dd>
      {/if}
    </dl>
  </section>

  {#if volume || item.reconstitution.length}
    <section class="wide">
      <h4>Reconstitution, concentration and volume</h4>
      {#if volume}
        <p class="resolved-summary">
          <strong>Resolved volume:</strong>
          {volume.finalVolumeMl === null ? 'Unresolved' : `${volume.finalVolumeMl} mL final`}
          {#if volume.concentrationMgPerMl !== null}
            · <strong>Resolved concentration:</strong> {volume.concentrationMgPerMl} mg/mL{/if}
          {#if volume.diluentMl !== null}
            · <strong>Diluent added:</strong> {volume.diluentMl} mL{/if}
        </p>
        <p class="muted">Package volume meaning: {volume.meaning}.</p>
      {/if}
      {#if item.reconstitution.length}
        <div class="table-wrap">
          <table class="data-table">
            <thead
              ><tr
                ><th>Vial content</th><th>Diluent to add</th><th>Stated final volume</th><th
                  >Stated concentration</th
                ></tr
              ></thead
            >
            <tbody>
              {#each item.reconstitution as step, i (i)}
                <tr>
                  <td>{step.vialMassMg === null ? 'Not stated' : `${step.vialMassMg} mg`}</td>
                  <td>{step.diluentMl} mL</td>
                  <td>{step.finalVolumeMl == null ? 'Not stated' : `${step.finalVolumeMl} mL`}</td>
                  <td
                    >{#each step.concentrations as concentration, c (c)}<div>
                        {concentration.mgPerMl} mg/mL{concentration.name
                          ? ` ${concentration.name.toLowerCase()}`
                          : ''}
                      </div>{:else}Not stated{/each}</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}

  <section class="wide">
    <h4>Ingredients</h4>
    {#if active.length || inactive.length || ionic.length}
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr
              ><th>Kind</th><th>Substance</th><th>UNII</th><th>Strength</th><th>Basis</th><th
                >Moieties / sources</th
              ></tr
            >
          </thead>
          <tbody>
            {#each [...active, ...inactive, ...ionic] as ingredient, i (i)}
              <tr class:muted={ingredient.kind !== 'active'}>
                <td>{ingredient.kind}</td>
                <td>{ingredient.name}</td>
                <td class="mono">
                  {#if ingredient.unii}<a
                      href={resolve('/formulary/unii/[unii]', { unii: ingredient.unii })}
                      >{ingredient.unii}</a
                    >{:else}—{/if}
                </td>
                <td
                  >{ingredient.strength ?? '—'}{#if ingredient.strengthNotes?.length}<sup
                      title={ingredient.strengthNotes.join('\n')}
                      >{ingredient.strengthNotes.map(noteMark).join(',')}</sup
                    >{/if}</td
                >
                <td>{ingredient.basis ?? '—'}</td>
                <td>
                  {ingredient.ionicContent?.sourceIngredients.join(', ') ?? ''}
                  {#if !ingredient.ionicContent?.sourceIngredients.length}
                    {#each ingredient.moieties as moiety, m (m)}{m ? ', ' : ''}{#if moiety.unii}<a
                          href={resolve('/formulary/unii/[unii]', { unii: moiety.unii })}
                          >{moiety.name}</a
                        >{:else}{moiety.name}{/if}{:else}—{/each}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if strengthNotes.length}
        <ul class="muted footnotes">
          {#each strengthNotes as note (note)}
            <li>{noteMark(note)} — {note}</li>
          {/each}
        </ul>
      {/if}
      {#if ionic.length}
        <p class="muted">
          Ionic totals are label-declared counterion content from the listed salt ingredients; they
          are not additional active ingredients.
        </p>
      {/if}
    {:else if item.ingredients.length}
      <ul>
        {#each item.ingredients as ingredient (ingredient.name)}
          <li>{ingredient.name}{ingredient.strength ? ` — ${ingredient.strength}` : ''}</li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No ingredient data returned.</p>
    {/if}
    {#if d?.spl?.appearances.length}
      <p>
        <strong>Appearance:</strong>
        {d.spl.appearances.map(appearanceText).join(' · ')}
      </p>
    {/if}
  </section>

  <section class="wide">
    <h4>Label (DailyMed / openFDA)</h4>
    <dl>
      <dt>SPL</dt>
      <dd>
        {#if item.splSetId}
          <a
            href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${item.splSetId}`}
            rel="noreferrer"
            target="_blank">{item.splTitle ?? item.splSetId}</a
          >
          {#if d?.spl?.version}· v{d.spl.version}{/if}
          {#if d?.spl?.publishedDate}· published {d.spl.publishedDate}{/if}
        {:else}
          {flag(item.splPresent, 'Present', 'None found')}
        {/if}
      </dd>
      {#if d?.label}
        <dt>openFDA label</dt>
        <dd>
          effective {date(d.label.effectiveTime) ?? '?'}{d.label.version
            ? ` · v${d.label.version}`
            : ''}
        </dd>
      {/if}
      {#if d?.spl?.otherLabels.length}
        <dt>Other labels</dt>
        <dd>{d.spl.otherLabels.map((l) => l.title ?? l.setId).join('; ')}</dd>
      {/if}
    </dl>
    {#each d?.label?.sections ?? [] as section (section.key)}
      <details data-spl-section={section.key}>
        <summary>{section.title}</summary>
        {#if section.blocks?.length}
          <LabelBlocks blocks={section.blocks} />
        {:else}
          <p class="prose">{section.text}</p>
        {/if}
      </details>
    {/each}
  </section>

  {#if d?.rxnav}
    <section class="wide">
      <h4>RxNav</h4>
      <dl>
        <dt>Concept</dt>
        <dd>
          {d.rxnav.conceptName ?? '—'}
          {#if d.rxnav.rxcui}<span class="mono">({d.rxnav.rxcui})</span>{/if}
          {d.rxnav.conceptStatus ?? ''}
        </dd>
        {#if d.rxnav.packaging.length}
          <dt>Packaging</dt>
          <dd>{d.rxnav.packaging.join('; ')}</dd>
        {/if}
        {#each d.rxnav.properties as prop, i (i)}
          <dt>{prop.name}</dt>
          <dd>{prop.value}</dd>
        {/each}
      </dl>
      {#if d.rxnav.history.length}
        <div class="table-wrap">
          <table class="data-table">
            <thead
              ><tr><th>Active RxCUI</th><th>Original RxCUI</th><th>From</th><th>To</th></tr></thead
            >
            <tbody>
              {#each d.rxnav.history as row, i (i)}
                <tr>
                  <td class="mono">{row.activeRxcui ?? '—'}</td>
                  <td class="mono">{row.originalRxcui ?? '—'}</td>
                  <td>{row.start ?? '—'}</td>
                  <td>{row.end ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
  {#if !item.complete}
    <p class="muted wide">Some providers did not answer; values may be incomplete.</p>
  {/if}
</div>

<style>
  .resolved-summary {
    font-size: 0.85rem;
    line-height: 1.6;
  }
  .footnotes {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    font-size: 0.85em;
  }
  .detail {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem 1.5rem;
    margin-top: 0.75rem;
    border-top: 1px solid #e3e8ee;
    padding-top: 0.75rem;
  }
  .wide {
    grid-column: 1 / -1;
  }
  h4 {
    margin: 0 0 0.4rem;
    color: #3464a5;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(6.25rem, max-content) minmax(0, 1fr);
    column-gap: 0.65rem;
    row-gap: 0.12rem;
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.35;
  }
  dt {
    color: #5c6777;
    font-size: 0.75rem;
    line-height: 1.45;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .pharm-classes {
    display: grid;
    gap: 0.3rem;
  }
  .pharm-class {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    min-width: 0;
  }
  .class-type {
    flex: 0 0 auto;
    color: #5c6777;
  }
  @media (max-width: 420px) {
    dl {
      grid-template-columns: minmax(5.25rem, max-content) minmax(0, 1fr);
      column-gap: 0.45rem;
    }
  }
  dd ul,
  section > ul {
    margin: 0;
    padding-left: 1.1rem;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.82rem;
  }
  .bad {
    color: #8a3e1d;
    font-weight: 650;
  }
  .muted {
    color: #7a8594;
  }
  .table-wrap {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid #e0e7f0;
    border-radius: 0.65rem;
    background: #fff;
    box-shadow: 0 2px 8px rgb(28 47 75 / 5%);
  }
  .data-table {
    width: 100%;
    min-width: 36rem;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.82rem;
  }
  th,
  td {
    border-bottom: 1px solid #edf0f4;
    padding: 0.65rem 0.75rem;
    text-align: left;
    vertical-align: top;
  }
  th {
    position: sticky;
    top: 0;
    background: #f1f5fb;
    color: #34445c;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.045em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  tbody tr:nth-child(even) {
    background: #f8fafc;
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  tbody tr:hover {
    background: #eef5ff;
  }
  .corrected {
    margin-left: 0.4em;
    font-size: 0.85em;
    color: #9a5b00;
  }
  .evidence {
    margin: 0.25em 0 0;
    padding-left: 1.1em;
    font-size: 0.8em;
    opacity: 0.8;
  }
  details {
    margin-top: 0.4rem;
    font-size: 0.875rem;
  }
  summary {
    cursor: pointer;
    font-weight: 650;
  }
  .prose {
    white-space: pre-wrap;
    color: #3c4757;
    line-height: 1.5;
  }
</style>
