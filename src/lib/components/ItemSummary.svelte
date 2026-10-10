<script lang="ts">
	import { racemicDisplayName } from '$lib/ingredient-group';
	import { constituentName } from '$lib/ions';
	import RxCui from '$lib/components/RxCui.svelte';
      import {nestTallies, type ItemSummary, type Tally, type TallyNode} from '$lib/item-summary';
      import RouteBadge from './RouteBadge.svelte';

      let {summary}: { summary: ItemSummary } = $props();

      let labelsOpen = $state(false);
      const total = $derived(summary.packageCount);
      const today = new Date().toISOString().slice(0, 10);
      const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
      const ndcList = (ndcs: string[]) => ndcs.map(formatNdc).join(', ');
      const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
      const range = (span: { earliest: string; latest: string }) =>
            span.earliest === span.latest ? span.earliest : `${span.earliest} – ${span.latest}`;

      const common = $derived(summary.inactive.filter((entry) => entry.ndcs.length === summary.enriched));
      const varying = $derived(summary.inactive.filter((entry) => entry.ndcs.length < summary.enriched));
      const alerts = $derived(
            [
                  {label: 'Not in the NDC directory', ndcs: summary.unlisted},
                  {label: 'Inactivated on DailyMed', ndcs: summary.inactivated},
                  {label: 'Veterinary', ndcs: summary.veterinary},
                  ...summary.ended.map((entry) => ({
                        label: `Marketing ${entry.value > today ? 'ends' : 'ended'} ${entry.value}`,
                        ndcs: entry.ndcs
                  })),
                  ...summary.statuses
                        .filter((entry) => entry.value !== 'active')
                        .map((entry) => ({label: `Catalog status: ${entry.value}`, ndcs: entry.ndcs}))
            ].filter((alert) => alert.ndcs.length)
      );
</script>

<svelte:window
      onclick={(event) => {
            if (labelsOpen && !(event.target as Element).closest('.popover-wrap')) labelsOpen = false;
      }}
      onkeydown={(event) => {
            if (event.key === 'Escape') labelsOpen = false;
      }}
/>

{#snippet collapsed(list: Tally[], noun: string)}
      {#if list.length > 1}
            <details class="collapsed">
                  <summary>{list.length} {noun}</summary>
                  {@render tallies(list)}
            </details>
      {:else}{@render tallies(list)}{/if}
{/snippet}

{#snippet tallies(list: Tally[], within?: number, badge = false)}
      {@const of = within ?? total}
      {#if !list.length}
            <span class="unknown">—</span>
      {:else}
            <ul class="values">
                  {#each list as entry (entry.value)}
                        <li title={ndcList(entry.ndcs)}>
                              {#if badge}
                                    <RouteBadge route={entry.value}/>
                              {:else}{entry.value}{/if}
                              {#if list.length > 1 || entry.ndcs.length < of}<span class="count"
                              >{entry.ndcs.length}/{of}</span
                              >{/if}
                        </li>
                  {/each}
            </ul>
      {/if}
{/snippet}

{#snippet tree(nodes: TallyNode[], of: number)}
      <ul class="tree">
            {#each nodes as node (node.value)}
                  <li>
                        <span title={node.label === node.value ? ndcList(node.ndcs) : `${node.value}\n${ndcList(node.ndcs)}`}
                        >{node.label}<span class="count">{node.ndcs.length}/{of}</span></span>
                        {#if node.children.length}{@render tree(node.children, of)}{/if}
                  </li>
            {/each}
      </ul>
{/snippet}

{#snippet subset(ndcs: string[], label: string)}
      {#if ndcs.length}
            <li title={ndcList(ndcs)}>
                  {label}<span class="count">{ndcs.length}/{total}</span>
            </li>
      {/if}
{/snippet}

<section aria-labelledby="summary-heading" class="summary">
      <h2 id="summary-heading">Summary across {plural(total, 'package')}</h2>
      {#if summary.enriched < total}
            <p class="note">
                  Label and listing detail covers {summary.enriched} of {total} packages; the rest have not been
                  enriched yet.
            </p>
      {/if}

      <div class="stats">
            <div><strong>{summary.labelers.length}</strong> {summary.labelers.length === 1 ? 'labeler' : 'labelers'}
            </div>
            <div><strong>{summary.products.length}</strong> {summary.products.length === 1 ? 'product' : 'products'}
            </div>
            <div><strong>{summary.labels.length}</strong> {summary.labels.length === 1 ? 'label' : 'labels'}</div>
            <div>
                  <strong>{summary.applications.length}</strong> {summary.applications.length === 1 ? 'application' : 'applications'}
            </div>
            {#if summary.marketingStart}
                  <div><strong>{summary.marketingStart.earliest.slice(0, 4)}</strong> first marketed</div>
            {/if}
      </div>

      {#if alerts.length}
            <ul class="alerts">
                  {#each alerts as alert (alert.label)}
                        <li title={ndcList(alert.ndcs)}>
                              {alert.label}<span class="count">{alert.ndcs.length}/{total}</span>
                        </li>
                  {/each}
            </ul>
      {/if}

      <div class="grid">
            <section>
                  <h3>Composition</h3>
                  <dl>
                        <dt>Active ingredients</dt>
                        <dd>
                              {#if summary.active.length}
                                    <ul class="ingredients">
                                          {#each summary.active as ingredient (ingredient.unii ?? ingredient.name)}
                                                <li>
                                                      <span class="name">{racemicDisplayName(ingredient.name)}</span>
                                                      {#if ingredient.unii}<a class="mono small"
                                                                              href="/formulary/unii/{ingredient.unii}"
                                                      >{ingredient.unii}</a
                                                      >{/if}
                                                      {#if ingredient.moieties.length && !ingredient.moieties.includes(ingredient.name)}
                                                            <span class="small">as {ingredient.moieties.map(constituentName).join(', ')}</span>
                                                      {/if}
                                                      {@render tallies(ingredient.strengths, summary.enriched)}
                                                </li>
                                          {/each}
                                    </ul>
                              {:else}<span class="unknown">—</span>{/if}
                        </dd>
                        <dt>Dose forms</dt>
                        <dd>{@render tallies(summary.doseForms)}</dd>
                        <dt>Routes</dt>
                        <dd>{@render tallies(summary.routes, undefined, true)}</dd>
                        {#if summary.appearances.length}
                              <dt>Appearance</dt>
                              <dd>{@render tree(nestTallies(summary.appearances), summary.enriched)}</dd>
                        {/if}
                  </dl>
            </section>

            <section>
                  <h3>Regulatory</h3>
                  <dl>
                        <dt>Product type</dt>
                        <dd>{@render tallies(summary.productTypes, summary.enriched)}</dd>
                        <dt>Marketing category</dt>
                        <dd>{@render tallies(summary.marketingCategories, summary.enriched)}</dd>
                        <dt>Applications</dt>
                        <dd>
                              {#if summary.applications.length}
                                    <ul class="values">
                                          {#each summary.applications as application (application.number)}
                                                <li title={ndcList(application.ndcs)}>
                                                      <span class="mono">{application.number}</span>
                                                      <span class="small">{application.labelers.join(', ')}</span>
                                                      <span class="count">{application.ndcs.length}
                                                            /{summary.enriched}</span>
                                                </li>
                                          {/each}
                                    </ul>
                              {:else}<span class="unknown">—</span>{/if}
                        </dd>
                        {#if summary.deaSchedules.length}
                              <dt>DEA schedule</dt>
                              <dd>{@render tallies(summary.deaSchedules, summary.enriched)}</dd>
                        {/if}
                        <dt>Marketed since</dt>
                        <dd>{summary.marketingStart ? range(summary.marketingStart) : '—'}</dd>
                        {#if summary.listingExpires}
                              <dt>Listing expires</dt>
                              <dd>{range(summary.listingExpires)}</dd>
                        {/if}
                        {#if summary.pharmClasses.length}
                              <dt>Pharmacologic class</dt>
                              <dd>{@render tallies(summary.pharmClasses, summary.enriched)}</dd>
                        {/if}
                  </dl>
            </section>

            <section>
                  <h3>Packaging</h3>
                  <dl>
                        <dt>Sizes</dt>
                        <dd>{@render collapsed(summary.sizes, 'sizes')}</dd>
                        <dt>Characteristics</dt>
                        <dd>
                              <ul class="values">
                                    {@render subset(summary.dosing.multi, 'multi-dose')}
                                    {@render subset(summary.dosing.single, 'single-dose')}
                                    {@render subset(summary.dryFill, 'dry fill')}
                                    {@render subset(summary.kits, 'kit')}
                                    {@render subset(summary.samples, 'sample')}
                              </ul>
                        </dd>
                        <dt>Labelers</dt>
                        <dd>{@render collapsed(summary.labelers, 'labelers')}</dd>
                        <dt>Products</dt>
                        <dd>{@render tallies(summary.products)}</dd>
                  </dl>
            </section>

            <section>
                  <h3>Sources</h3>
                  <dl>
                        <dt>RxNorm</dt>
                        <dd>
                              {#if summary.rxcuis.length}
                              <ul class="sources">
                                    {#each summary.rxcuis as concept (concept.rxcui)}
                                    <li title={ndcList(concept.ndcs)}>
                                          <a
                                                class="mono"
                                                href="https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm={concept.rxcui}"
                                                target="_blank"
                                                rel="noreferrer"><RxCui rxcui={concept.rxcui} name={concept.name} /></a
                                          >
                                          {#if concept.name}<span class="small">{concept.name}</span>{/if}
                                          {#if concept.status && concept.status.toLowerCase() !== 'active'}
                                          <span class="flag">{concept.status}</span>{/if}
                                          <span class="count">{concept.ndcs.length}/{summary.enriched}</span>
                                    </li>
                                    {/each}
                              </ul>
                              {:else}<span class="unknown">—</span>{/if}
                        </dd>
                        <dt>Labels (SPL)</dt>
                        <dd>
                              {#if summary.labels.length}
                              <div class="popover-wrap">
                                    <button
                                          type="button"
                                          class="link-button"
                                          aria-expanded={labelsOpen}
                                          onclick={() => (labelsOpen = !labelsOpen)}
                                    >{plural(summary.labels.length, 'label')} ▾
                                    </button>
                                    {#if labelsOpen}
                                    <div class="popover" role="dialog" aria-label="Label SPL links">
                                          <ul class="sources">
                                                {#each summary.labels as label (label.setId)}
                                                <li title={ndcList(label.ndcs)}>
                                                      <a
                                                            href="https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={label.setId}"
                                                            target="_blank"
                                                            rel="noreferrer">{label.title ?? label.setId}</a
                                                      >
                                                      <span class="small"
                                                      >{[label.version && `v${label.version}`, label.effective].filter(Boolean).join(' · ')}</span
                                                      >
                                                      <span class="count">{label.ndcs.length}/{summary.enriched}</span>
                                                </li>
                                                {/each}
                                          </ul>
                                    </div>
                                    {/if}
                                    </div>
                              {:else}<span class="unknown">—</span>{/if}
                        </dd>
                  </dl>
            </section>
      </div>

      {#if summary.inactive.length}
            <details class="inactive">
                  <summary>Excipients ({summary.inactive.length})</summary>
                  {#if common.length}
                        <p><strong>In every labeled package:</strong> {common.map((entry) => entry.value).join(', ')}
                        </p>
                  {/if}
                  {#if varying.length}
                        <p><strong>In some packages:</strong></p>
                        {@render tallies(varying, summary.enriched)}
                  {/if}
            </details>
      {/if}
</section>

<style>
      .summary {
            margin-top: 1.25rem;
      }

      h2 {
            margin: 0 0 0.5rem;
            font-size: 0.8rem;
            color: #5c6777;
            text-transform: uppercase;
            letter-spacing: 0.06em;
      }

      h3 {
            margin: 0 0 0.3rem;
            font-size: 0.85rem;
      }

      .note {
            margin: 0 0 0.75rem;
            color: #8a5a00;
            font-size: 0.85rem;
      }

      .stats {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
      }

      .stats div {
            border: 1px solid #e3e8ee;
            border-radius: 0.6rem;
            padding: 0.25rem 0.6rem;
            color: #5c6777;
            font-size: 0.78rem;
      }

      .stats strong {
            color: #1d2633;
            font-size: 0.92rem;
      }

      .alerts {
            display: flex;
            flex-wrap: wrap;
            gap: 0.4rem;
            margin: 0.75rem 0 0;
            padding: 0;
            list-style: none;
      }

      .alerts li {
            border-radius: 999px;
            background: #fdecea;
            color: #a12622;
            padding: 0.15rem 0.65rem;
            font-size: 0.8rem;
      }

      .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
            gap: 0.6rem 1.5rem;
            margin-top: 0.75rem;
      }

      .grid > section {
            border-top: 1px solid #e3e8ee;
            padding-top: 0.45rem;
      }

      dl {
            display: grid;
            grid-template-columns: minmax(6rem, max-content) 1fr;
            gap: 0.2rem 0.75rem;
            margin: 0;
            font-size: 0.8rem;
            line-height: 1.3;
      }

      dt {
            color: #5c6777;
      }

      dd {
            margin: 0;
            min-width: 0;
      }

      ul {
            margin: 0;
            padding: 0;
            list-style: none;
      }

      .values {
            display: flex;
            flex-wrap: wrap;
            gap: 0.25rem 0.9rem;
      }

      .ingredients li + li,
      .sources li + li {
            margin-top: 0.2rem;
      }

      .ingredients .name {
            font-weight: 650;
      }

      .tree {
            margin: 0;
            padding: 0;
            list-style: none;
      }

      .tree .tree {
            margin-left: 0.4rem;
            border-left: 2px solid #e3e8ef;
            padding-left: 0.7rem;
      }

      .count {
            margin-left: 0.35rem;
            border-radius: 999px;
            background: #eef1f5;
            padding: 0 0.4rem;
            color: #5c6777;
            font-size: 0.72rem;
      }

      .alerts .count {
            background: #f9d4d0;
            color: inherit;
      }

      .flag {
            margin-left: 0.35rem;
            border-radius: 999px;
            background: #fdecea;
            color: #a12622;
            padding: 0 0.4rem;
            font-size: 0.72rem;
      }

      .small {
            margin-left: 0.3rem;
            color: #5c6777;
            font-size: 0.74rem;
      }

      .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      .unknown {
            color: #9aa4b2;
      }

      a {
            color: #204f91;
      }

      .popover-wrap {
            position: relative;
            display: inline-block;
      }

      .link-button {
            border: 0;
            background: none;
            padding: 0;
            color: #204f91;
            font: inherit;
            cursor: pointer;
      }

      .link-button:hover {
            text-decoration: underline;
      }

      .popover {
            position: absolute;
            z-index: 10;
            top: calc(100% + 0.3rem);
            left: 0;
            width: max-content;
            max-width: min(34rem, 80vw);
            max-height: 20rem;
            overflow: auto;
            border: 1px solid #d5dbe3;
            border-radius: 0.5rem;
            background: #fff;
            padding: 0.5rem 0.65rem;
            box-shadow: 0 6px 20px rgba(29, 38, 51, 0.15);
      }

      .inactive {
            margin-top: 0.75rem;
            font-size: 0.8rem;
      }

      .collapsed > summary {
            cursor: pointer;
      }

      .inactive summary {
            cursor: pointer;
            color: #5c6777;
      }

      .inactive p {
            margin: 0.5rem 0 0.25rem;
      }
</style>
