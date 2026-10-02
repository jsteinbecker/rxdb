<script lang="ts">
      import type {StagedPackage} from '$lib/server/catalog-sync';
      import type {LabelIngredient} from '$lib/server/catalog-providers';
      import {appearanceText} from '$lib/spl-characteristics';
      import {resolve} from '$app/paths';
      import SplLabelSections from './SplLabelSections.svelte';
      import OverrideCitation from './OverrideCitation.svelte';
      import {nextAddedRowId, overrideTargets} from '$lib/property-override-fields';
      import {AMBIGUITY_KINDS} from '$lib/labeler-ambiguity';
      import {pseudoScdFor} from '$lib/pseudo-scd';
      import {withBiosimilarSuffix} from '$lib/biosimilar';

      let {
    item,
    editing = false,
    editKeys = [],
    onedit
  }: {
    item: StagedPackage;
    /** Show a pencil beside each overridable property. */
    editing?: boolean;
    /** Keys open in the override panel, to mark their pencil. */
    editKeys?: string[];
    onedit?: (keys: string[]) => void;
  } = $props();

  const d = $derived(item.details);
  const pseudoScd = $derived(pseudoScdFor(item));
  // A biosimilar's ingredient carries its FDA suffix even when the source names only the reference.
  const substance = (name: string) =>
    withBiosimilarSuffix(name, [item.genericName, item.splTitle, d?.rxnav?.conceptName]);
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
  // RxNav's NDC properties mix RxNorm identifiers with package facts (labeler,
  // marketing, SPL ids) that RxNorm doesn't own; only the former belong in the
  // RxNorm section.
  const RXNORM_PROP = /^(RXCUI|RXAUI|TTY|SAB|CODE|RXNORM_NAME)$/i;
  const rxnormProps = $derived(d?.rxnav?.properties.filter((p) => RXNORM_PROP.test(p.name)) ?? []);
  const otherRxnavProps = $derived(
    d?.rxnav?.properties.filter((p) => !RXNORM_PROP.test(p.name)) ?? []
  );
  const flag = (value: boolean | null, yes: string, no: string) =>
    value === true ? yes : value === false ? no : 'Unknown';
  const date = (value: string | null | undefined) =>
    value && /^\d{8}$/.test(value)
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
      : (value ?? null);
  const volume = $derived(item.resolvedVolume);
  // Fills an unstated final volume or concentration from the row's other stated
  // values (mass ÷ concentration, mass ÷ volume). Only with a single stated
  // concentration: a combination vial's mass can't be split between ingredients.
  const round = (value: number) => Math.round(value * 100) / 100;
  const calculated = (step: StagedPackage['reconstitution'][number]) => {
    const mass = step.vialMassMg;
    const stated = step.concentrations.length === 1 ? step.concentrations[0].mgPerMl : null;
    return {
      finalVolumeMl:
        step.finalVolumeMl == null && mass != null && stated ? round(mass / stated) : null,
      mgPerMl:
        !step.concentrations.length && mass != null && step.finalVolumeMl
          ? round(mass / step.finalVolumeMl)
          : null
    };
  };
  // Corrections are cited like footnotes too: a mark beside the corrected value,
  // with the original and the evidence in a footer.
  const corrections = $derived(
    [
      item.unitOfUseCorrection && {
        id: 'uou',
        mark: '†',
        text: item.unitOfUseCorrection.note,
        original: item.unitOfUseCorrection.from,
        evidence: []
      },
      item.doseFormCorrection && {
        id: 'dose-form',
        mark: '‡',
        text: `Dose form corrected from stated value of ${item.doseFormCorrection.from}`,
        original: null,
        evidence: item.doseFormCorrection.evidence
      }
    ].filter((c) => !!c)
  );
  const correction = (id: string) => corrections.find((c) => c.id === id);
  const overrideFields = $derived(overrideTargets(item));
  // Manual overrides are cited like footnotes: a numbered mark beside each
  // overridden value, with the sourcing listed in a footer at the end.
  const uid = $props.id();
  const overrides = $derived(Object.entries(item.propertyOverrides ?? {}));
  const citeNumber = (key: string) => overrides.findIndex(([k]) => k === key) + 1;
  const splIndex = (ingredient: LabelIngredient) => d?.spl?.ingredients.indexOf(ingredient) ?? -1;
  // One reconstitution row's actions menu open at a time.
  let rowMenu = $state<string | null>(null);
  const openFromMenu = (keys: string[]) => {
    rowMenu = null;
    onedit?.(keys);
  };
</script>

<svelte:window
  onclick={(event) => {
    if (rowMenu && !(event.target as Element).closest('.row-menu, .row-menu-trigger'))
      rowMenu = null;
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape') rowMenu = null;
  }}
/>

{#snippet correctionMark(id: string)}
  {@const c = correction(id)}
  {#if c}<sup class="cite"><a href={`#${uid}-${c.id}-note`} title={c.text}>[{c.mark}]</a></sup>{/if}
{/snippet}
{#snippet cite(keys: string[])}
  {#each keys.map(citeNumber).filter((n) => n > 0) as n (n)}<sup class="cite"
      ><a href={`#${uid}-override-${n}`} title="Manually overridden — see sources">[{n}]</a></sup
    >{/each}
{/snippet}

{#snippet edit(keys: string[], label: string)}
  {@render cite(keys)}{@render editButton(keys, label)}
{/snippet}

{#snippet editButton(keys: string[], label: string)}
  {@const available = keys.filter((key) => overrideFields.some((field) => field.key === key))}
  {#if editing && available.length}
    <button
      class="edit"
      class:active={available.every((key) => editKeys.includes(key))}
      type="button"
      title={`Override ${label}`}
      aria-label={`Override ${label}`}
      onclick={() => onedit?.(available)}
      ><svg viewBox="0 0 16 16" aria-hidden="true"
        ><path
          d="M11.2 2.3a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L6 12.5l-3 .8.8-3z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        /><path d="M10 3.5 12.5 6" stroke="currentColor" stroke-width="1.3" /></svg
      ></button
    >
  {/if}
{/snippet}

{#snippet calcChip(value: string, formula: string)}
  <span class="calc-chip" title={`Not stated on the label. ${formula}`}
    ><svg viewBox="0 0 16 16" aria-hidden="true"
      ><rect
        x="3"
        y="1.5"
        width="10"
        height="13"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
      /><rect x="5" y="3.5" width="6" height="2.5" rx="0.4" fill="currentColor" /><circle
        cx="5.75"
        cy="8.5"
        r="0.8"
        fill="currentColor"
      /><circle cx="8" cy="8.5" r="0.8" fill="currentColor" /><circle
        cx="10.25"
        cy="8.5"
        r="0.8"
        fill="currentColor"
      /><circle cx="5.75" cy="11.5" r="0.8" fill="currentColor" /><circle
        cx="8"
        cy="11.5"
        r="0.8"
        fill="currentColor"
      /><circle cx="10.25" cy="11.5" r="0.8" fill="currentColor" /></svg
    ><span class="sr-only">Calculated:</span>{value}</span
  >
{/snippet}

<div class="detail">
  <section>
    <h4>Package</h4>
    <dl>
      <dt>NDC</dt>
      <dd class="mono">{item.ndc}</dd>
      <dt>Product NDC</dt>
      <dd>
        <span class="mono">{item.productCode ?? '—'}</span>{@render edit(
          ['productCode'],
          'product NDC'
        )}
      </dd>
      <dt>Description</dt>
      <dd>
        {item.description ?? '—'}{@render edit(['description'], 'description')}
        {@render correctionMark('uou')}
      </dd>
      <dt>Brand</dt>
      <dd>{item.brandName ?? '—'}{@render edit(['brandName'], 'brand name')}</dd>
      <dt>Generic</dt>
      <dd>{item.genericName ?? '—'}{@render edit(['genericName'], 'generic name')}</dd>
      <dt>Labeler</dt>
      <dd>
        {item.labelerName ?? '—'}
        <span class="mono">({item.labelerCode ?? '?'})</span>{@render edit(
          ['labelerName', 'labelerCode'],
          'labeler'
        )}
      </dd>
      <dt>Dose form</dt>
      <dd>
        {item.doseForm ?? '—'}{@render edit(['doseForm'], 'dose form')}
        {#if item.doseFormCorrection}
          {@render correctionMark('dose-form')}
        {/if}
      </dd>
      <dt>Routes</dt>
      <dd>{d?.product?.routes.join(', ') || '—'}</dd>
      {#if item.size}
        <dt>Unit of sale</dt>
        <dd>
          {item.size.packQty}
          {item.size.container.toLowerCase()}{item.size.packQty === 1 ? '' : 's'}{@render edit(
            ['size.packQty'],
            'unit of sale'
          )}
          {#if item.size.packQty > 1 && item.size.kind !== 'count'}
            <span class="muted">({round(item.size.packQty * item.size.value)} {item.size.unit} total)</span>
          {/if}
        </dd>
        <dt>Unit of use</dt>
        <dd>
          {item.size.value}
          {item.size.unit ?? ''}
          {item.size.container.toLowerCase()}{@render edit(
            ['size.value', 'size.container', 'size.unit'],
            'unit of use'
          )}
          {@render correctionMark('uou')}
        </dd>
      {/if}
      <dt>Multi-dose</dt>
      <dd>
        {flag(item.isMultiDose, 'Multi-dose', 'Single-dose')}{@render edit(
          ['isMultiDose'],
          'multi-dose'
        )}
      </dd>
      <dt>Dry fill</dt>
      <dd>
        {item.isDryFill ? 'Yes — reconstitute before use' : 'No'}{@render edit(
          ['isDryFill'],
          'dry fill'
        )}
      </dd>
    </dl>
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
            : 'Unknown'}{@render edit(['listed'], 'FDA NDC directory')}
      </dd>
      <dt>DailyMed SPL</dt>
      <dd>
        {flag(item.splPresent, 'Found', 'Not found')}{@render edit(['splPresent'], 'DailyMed SPL')}
      </dd>
      <dt>Catalog eligibility</dt>
      <dd class:bad={item.exclusionReason}>{item.exclusionReason ?? 'Eligible'}</dd>
      <dt>RxNav NDC status</dt>
      <dd>{item.rxcuiStatus ?? '—'}{@render edit(['rxcuiStatus'], 'RxNav NDC status')}</dd>
      <dt>RxNav marketing status</dt>
      <dd>{rxnavMarketingStatus ?? '—'}</dd>
      <dt>Species</dt>
      <dd>
        {flag(item.isVeterinary, 'Veterinary', 'Human')}{@render edit(['isVeterinary'], 'species')}
      </dd>
      <dt>Product type</dt>
      <dd>
        {d?.product?.productType ?? '—'}{@render edit(
          ['details.product.productType'],
          'product type'
        )}
      </dd>
      <dt>Marketing category</dt>
      <dd>
        {d?.product?.marketingCategory ?? '—'}{@render edit(
          ['details.product.marketingCategory'],
          'marketing category'
        )}
      </dd>
      <dt>Application</dt>
      <dd>
        <span class="mono">{d?.product?.applicationNumber ?? '—'}</span>{@render edit(
          ['details.product.applicationNumber'],
          'application'
        )}
      </dd>
      <dt>DEA schedule</dt>
      <dd>
        {d?.product?.deaSchedule ?? 'None'}{@render edit(
          ['details.product.deaSchedule'],
          'DEA schedule'
        )}
      </dd>
      <dt>Marketing</dt>
      <dd>
        {date(d?.packaging?.marketingStartDate ?? d?.product?.marketingStartDate) ?? '?'} →
        {date(item.marketingEndDate) ?? 'present'}{@render edit(
          ['marketingEndDate'],
          'marketing end date'
        )}
      </dd>
      <dt>Listing expires</dt>
      <dd>{date(d?.product?.listingExpirationDate) ?? '—'}</dd>
      <dt>Sample</dt>
      <dd>{d?.packaging?.sample === true ? 'Yes' : d?.packaging?.sample === false ? 'No' : '—'}</dd>
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

  {#if d?.product?.pharmClasses.length}
    <section>
      <h4>Pharmacologic class</h4>
      <div class="pharm-classes">
        {#each d.product.pharmClasses as pharmClass, i (i)}
          {@const classType = /\[(.*)]$/.exec(pharmClass)?.[1] ?? ''}
          <div class="pharm-class">
            {#if classType}<span class="class-type mono">{classType}</span>{/if}
            <span>{pharmClass.replace(/\s*\[.*]$/, '')}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if d?.packaging?.siblings.length}
    <section>
      <h4>Sibling packages</h4>
      <div class="table-wrap mini-wrap">
        <table class="data-table mini-table">
          <thead>
            <tr><th scope="col">Pkg</th><th scope="col">Description</th></tr>
          </thead>
          <tbody>
            {#each [...d.packaging.siblings, { ndc: item.ndc, description: item.description }].sort( (a, b) => a.ndc.localeCompare(b.ndc) ) as sibling (sibling.ndc)}
              {@const current = sibling.ndc === item.ndc}
              <tr class:current>
                <td>
                  {#if current}
                    <span class="mono sib-code disabled" aria-current="page" title="This package"
                      >-{sibling.ndc.slice(-2)}</span
                    >
                  {:else}
                    <a
                      class="mono sib-code"
                      href={resolve('/formulary/ndc/[ndc]', { ndc: sibling.ndc })}
                      >-{sibling.ndc.slice(-2)}</a
                    >
                  {/if}
                </td>
                <td>
                  {(sibling.description ?? '')
                    .replace(/\s*\(\d{4,5}-\d{3,4}-\d{1,2}\)\s*/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  {#if volume || item.reconstitution.length || editing}
    <section class="wide">
      <h4>Reconstitution, concentration and volume</h4>
      {#if volume}
        <p class="resolved-summary">
          <strong>Resolved volume:</strong>
          {volume.finalVolumeMl === null
            ? 'Unresolved'
            : `${volume.finalVolumeMl} mL final`}{@render edit(
            ['resolvedVolume.finalVolumeMl'],
            'resolved volume'
          )}
          {#if volume.concentrationMgPerMl !== null || editing}
            · <strong>Resolved concentration:</strong>
            {volume.concentrationMgPerMl ?? '—'} mg/mL{@render edit(
              ['resolvedVolume.concentrationMgPerMl'],
              'resolved concentration'
            )}{/if}
          {#if volume.diluentMl !== null || editing}
            · <strong>Diluent added:</strong>
            {volume.diluentMl ?? '—'} mL{@render edit(
              ['resolvedVolume.diluentMl'],
              'diluent added'
            )}{/if}
          {#if volume.powderDisplacementMl != null || (volume.finalVolumeMl != null && volume.diluentMl != null) || editing}
            · <strong>Powder displacement:</strong>
            {volume.powderDisplacementMl ??
              (volume.finalVolumeMl != null && volume.diluentMl != null
                ? Math.max(0, volume.finalVolumeMl - volume.diluentMl)
                : '—')} mL{@render edit(
              ['resolvedVolume.powderDisplacementMl'],
              'powder displacement'
            )}{/if}
        </p>
        <p class="muted">
          Package volume meaning: {volume.meaning}.{@render edit(
            ['resolvedVolume.meaning'],
            'package volume meaning'
          )}
        </p>
      {/if}
      {#if item.reconstitution.length}
        <div class="table-wrap">
          <table class="data-table">
            <thead
              ><tr
                ><th>Route</th><th>Vial content</th><th>Diluent to add</th><th>Diluent</th><th
                  >Stated final volume</th
                ><th>Stated concentration</th>{#if editing}<th
                    ><span class="visually-hidden">Row actions</span></th
                  >{/if}</tr
              ></thead
            >
            <tbody>
              {#each item.reconstitution as step, i (i)}
                {@const calc = calculated(step)}
                {@const rowKey = `reconstitution.${step.id ?? i}`}
                <tr>
                  <td
                    >{step.routes?.join(', ') ?? 'Not stated'}{@render edit(
                      [`${rowKey}.routes`],
                      'routes'
                    )}{#if step.id && step.id === volume?.rowId}
                      <span class="muted">(default)</span>{/if}</td
                  >
                  <td
                    >{step.vialMassMg === null
                      ? 'Not stated'
                      : `${step.vialMassMg} mg`}{@render edit(
                      [`${rowKey}.vialMassMg`],
                      'vial content'
                    )}</td
                  >
                  <td
                    >{step.diluentMl} mL{@render edit(
                      [`${rowKey}.diluentMl`],
                      'diluent to add'
                    )}</td
                  >
                  <td
                    >{step.diluents?.join(' or ') ?? 'Not stated'}{@render edit(
                      [`${rowKey}.diluents`],
                      'diluent'
                    )}</td
                  >
                  <td
                    >{#if step.finalVolumeMl != null}{step.finalVolumeMl} mL{:else if calc.finalVolumeMl != null}{@render calcChip(
                        `${calc.finalVolumeMl} mL`,
                        `Calculated: ${step.vialMassMg} mg ÷ ${step.concentrations[0].mgPerMl} mg/mL`
                      )}{:else}Not stated{/if}{@render edit(
                      [`${rowKey}.finalVolumeMl`],
                      'final volume'
                    )}</td
                  >
                  <td
                    >{#each step.concentrations as concentration, c (c)}<div>
                        {concentration.mgPerMl} mg/mL{concentration.name
                          ? ` ${concentration.name.toLowerCase()}`
                          : ''}{@render edit(
                          [`${rowKey}.concentrations.${c}.mgPerMl`],
                          'concentration'
                        )}
                      </div>{:else}{#if calc.mgPerMl != null}{@render calcChip(
                          `${calc.mgPerMl} mg/mL`,
                          `Calculated: ${step.vialMassMg} mg ÷ ${step.finalVolumeMl} mL`
                        )}{:else}Not stated{/if}{/each}</td
                  >
                  {#if editing}
                    <td class="row-actions">
                      <button
                        class="row-menu-trigger"
                        type="button"
                        aria-label={`Actions for reconstitution ${i + 1}`}
                        aria-haspopup="menu"
                        aria-expanded={rowMenu === rowKey}
                        onclick={() => (rowMenu = rowMenu === rowKey ? null : rowKey)}>⋯</button
                      >
                      {#if rowMenu === rowKey}
                        <div class="row-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onclick={() =>
                              openFromMenu([
                                `${rowKey}.concentrations.${step.concentrations.length}.mgPerMl`
                              ])}>Add a concentration</button
                          >
                          <button
                            type="button"
                            role="menuitem"
                            onclick={() => openFromMenu([`${rowKey}.removed`])}>Remove row</button
                          >
                        </div>
                      {/if}
                    </td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      {#if editing}
        <button
          class="add-row"
          type="button"
          onclick={() => onedit?.([`reconstitution.${nextAddedRowId(item)}.diluentMl`])}
          >+ Add reconstitution row</button
        >
      {/if}
    </section>
  {/if}

  <section class="wide">
    <h4>Ingredients</h4>
    {#if active.length || inactive.length || ionic.length}
      <div class="table-wrap">
        <table class="data-table ing-table">
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
                <td>{ingredient.kind === 'active' ? substance(ingredient.name) : ingredient.name}</td>
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
                    >{/if}{@render edit(
                    [`details.spl.ingredients.${splIndex(ingredient)}.strength`],
                    `${ingredient.name} strength`
                  )}</td
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
          <li>{substance(ingredient.name)}{ingredient.strength ? ` — ${ingredient.strength}` : ''}</li>
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
    <SplLabelSections sections={d?.label?.sections ?? []} />
  </section>

  {#if d?.rxnav}
    <section class="wide">
      <h4>RxNorm</h4>
      <dl>
        <dt>Concept</dt>
        <dd>
          {d.rxnav.conceptName ?? '—'}
          {#if d.rxnav.rxcui}<span class="mono">({d.rxnav.rxcui})</span>{/if}
          {d.rxnav.conceptStatus ?? ''}
        </dd>
        {#if pseudoScd}
          <dt>Used as</dt>
          <dd>
            {pseudoScd.name} <span class="mono">(pseudo-SCD)</span>
            <br /><span class="muted"
              >RxNorm codes this dry fill by its reconstituted concentration; the catalog places it
              by vial content.</span
            >
          </dd>
        {/if}
        {#each rxnormProps as prop, i (i)}
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
      {#if editing}
        <button
          class="add-row"
          type="button"
          onclick={() => onedit?.([`reconstitution.${nextAddedRowId(item)}.diluentMl`])}
          >+ Add reconstitution row</button
        >
      {/if}
    </section>
  {/if}
  {#if otherRxnavProps.length}
    <section class="wide">
      <h4>RxNav NDC properties</h4>
      <dl>
        {#each otherRxnavProps as prop, i (i)}
          <dt>{prop.name}</dt>
          <dd>{prop.value}</dd>
        {/each}
      </dl>
    </section>
  {/if}
  {#if !item.complete}
    <p class="muted wide">Some providers did not answer; values may be incomplete.</p>
  {/if}
  {#if corrections.length}
    <footer class="wide citations">
      <h4>Corrections</h4>
      <ul class="note-list">
        {#each corrections as c (c.id)}
          <li id={`${uid}-${c.id}-note`}>
            <sup>{c.mark}</sup>
            {c.text}.
            {#if c.evidence.length}
              <ul class="evidence">
                {#each c.evidence as ev, i (i)}
                  <li><b>{ev.kind}</b> ({ev.source}): {ev.excerpt}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    </footer>
  {/if}
  {#if overrides.length}
    <footer class="wide citations">
      <h4>Manual overrides</h4>
      <ol>
        {#each overrides as [key, override], i (key)}
          <li id={`${uid}-override-${i + 1}`}>
            <b>{overrideFields.find((field) => field.key === key)?.label ?? key}:</b>
            {override.value}{@render editButton([key], 'this property')}
            {#if override.ambiguity}<span class="ambiguity-tag"
                >{AMBIGUITY_KINDS[override.ambiguity.kind]?.label ?? override.ambiguity.kind}</span
              >{#if override.ambiguity.note}
                <i>{override.ambiguity.note}</i>{/if}{/if}
            — <OverrideCitation {override} />
          </li>
        {/each}
      </ol>
    </footer>
  {/if}
</div>

<style>
  .resolved-summary {
    font-size: 0.85rem;
    line-height: 1.6;
  }
  .citations {
    border-top: 1px solid #e3e8ee;
    padding-top: 0.6rem;
  }
  .citations ol {
    margin: 0;
    padding-left: 1.6rem;
    color: #5c6777;
    font-size: 0.78rem;
    line-height: 1.45;
  }
  .ambiguity-tag {
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: #fff0d6;
    color: #8a5a00;
    font-weight: 600;
  }
  .citations ul {
    margin: 0;
    padding: 0;
    list-style: none;
    color: #5c6777;
    font-size: 0.78rem;
    line-height: 1.45;
  }
  .citations li:target {
    background: #fff6d6;
  }
  .cite {
    margin-left: 0.15em;
    font-size: 0.7em;
    line-height: 0;
  }
  .cite a {
    color: #3464a5;
    text-decoration: none;
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
  .ing-table {
    min-width: 0;
    font-size: 0.78rem;
    line-height: 1.3;
  }
  .ing-table th,
  .ing-table td {
    padding: 0.28rem 0.5rem;
  }
  .ing-table td:nth-child(1),
  .ing-table td:nth-child(3),
  .ing-table td:nth-child(4),
  .ing-table td:nth-child(5) {
    white-space: nowrap;
  }
  .ing-table td:nth-child(2),
  .ing-table td:nth-child(6) {
    overflow-wrap: anywhere;
  }
  .ing-table td:nth-child(1) {
    color: #5c6777;
    font-size: 0.72rem;
  }

  .mini-wrap {
    border: 1px dashed #b7c4d6;
    border-left: 3px solid #6b8fc7;
    border-radius: 0.3rem;
    background: #f7f9fc;
    box-shadow: none;
  }
  .mini-table {
    min-width: 0;
    font-size: 0.7rem;
    line-height: 1.3;
  }
  .mini-table th,
  .mini-table td {
    padding: 0.2rem 0.45rem;
  }
  .mini-table th {
    position: static;
    background: transparent;
    color: #6b7a90;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.06em;
  }
  .mini-table tbody tr:nth-child(even) {
    background: transparent;
  }
  .mini-table tbody tr:hover {
    background: #e8f0fb;
  }
  .sib-code {
    display: inline-block;
    padding: 0 0.35em;
    border-radius: 0.6em;
    background: #e3ebf7;
    color: #2f5391;
    font-weight: 600;
    text-decoration: none;
  }
  .sib-code.disabled {
    background: #6b8fc7;
    color: #fff;
    cursor: default;
  }
  .mini-table tbody tr.current {
    background: #eaf1fb;
    font-weight: 600;
  }
  .sib-code:not(.disabled):hover {
    background: #cfdcf1;
  }
  .calc-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.1em 0.5em;
    border: 1px solid #e6b89c;
    border-radius: 999px;
    background: #fbede4;
    color: #a4461a;
    font-weight: 600;
    white-space: nowrap;
    cursor: help;
  }
  .calc-chip svg {
    width: 0.95em;
    height: 0.95em;
    flex: 0 0 auto;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .edit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    margin-left: 0.3rem;
    padding: 0;
    border: 1px solid #c9d6e8;
    border-radius: 5px;
    background: #fff;
    color: #3464a5;
    vertical-align: -0.3em;
    cursor: pointer;
  }
  .edit:hover,
  .edit.active {
    border-color: #3464a5;
    background: #3464a5;
    color: #fff;
  }
  .row-actions {
    position: relative;
    width: 2rem;
  }
  .row-menu-trigger {
    padding: 0 0.4rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: none;
    color: #3464a5;
    cursor: pointer;
  }
  .row-menu-trigger:hover,
  .row-menu-trigger[aria-expanded='true'] {
    border-color: #c9d6e8;
    background: #fff;
  }
  .row-menu {
    position: absolute;
    right: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    min-width: 11rem;
    padding: 0.25rem;
    border: 1px solid #c9d6e8;
    border-radius: 6px;
    background: #fff;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
  }
  .row-menu button {
    padding: 0.35rem 0.6rem;
    border: 0;
    border-radius: 4px;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .row-menu button:hover {
    background: #eef3fa;
  }
  .add-row {
    margin-top: 0.5rem;
    padding: 0.25rem 0.6rem;
    border: 1px dashed #c9d6e8;
    border-radius: 5px;
    background: none;
    color: #3464a5;
    cursor: pointer;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .edit svg {
    width: 0.8rem;
    height: 0.8rem;
  }
  .evidence {
    margin: 0.25em 0 0;
    padding-left: 1.1em;
    font-size: 0.8em;
    opacity: 0.8;
  }
</style>
