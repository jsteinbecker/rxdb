<script lang="ts">
  import { formatNdc } from '#lib/catalog/ndc.ts';
  import type { ConsensusStep, VialPrepVariants } from '#lib/compounds/vial-prep-consensus.ts';

  /** Every vial preparation the item's packages' labels state, by route, with where they differ. */
  let { prep, total }: { prep: VialPrepVariants; total: number } = $props();

  const fmt = (value: number) => String(Number(value.toFixed(3)));
  const mass = (mg: number) => (mg >= 1000 ? `${fmt(mg / 1000)} g` : `${fmt(mg)} mg`);
  const diluents = (step: ConsensusStep) => (step.diluents.length ? step.diluents.join(' or ') : 'diluent');
  const STATUS = {
    unanimous: 'All labels agree',
    split: 'Labels differ',
    incomplete: 'Agree · some labels silent',
    unassigned: 'No route on label'
  } as const;
  const dryFills = $derived(total - prep.readyToUse.length);
</script>

<section class="panel vial-prep" aria-labelledby="vial-prep-heading">
  <div class="section-head">
    <h2 id="vial-prep-heading">Reconstitution</h2>
    {#if prep.status === 'stated'}<span class="count">from {dryFills} dry-fill label{dryFills === 1 ? '' : 's'}</span>{/if}
  </div>

  {#if prep.status === 'not-needed'}
    <p class="muted">No preparation needed — every package is ready to use.</p>
  {:else}
    {#each prep.groups as group (group.route ?? 'any')}
      <div class="group">
        <div class="group-head">
          <strong>{group.route ?? (prep.groups.length > 1 ? 'Route not stated' : 'Any route')}</strong>
          <span class="status {group.status}">{STATUS[group.status]}</span>
        </div>
        <ul class="variants">
          {#each group.variants as variant, v}
            {@const step = variant.step}
            {@const d = group.differs[v]}
            <li>
              <span class="step">
                Add <span class:diff={d.diluentMl}>{fmt(step.diluentMl)} mL</span>
                <span class:diff={d.diluents}>{diluents(step)}</span>
                {step.bottleMl != null
                  ? `to the ${fmt(step.bottleMl)} mL bottle`
                  : step.vialMassMg !== null
                    ? `to the ${mass(step.vialMassMg)} vial`
                    : 'to the vial'}
                {#if step.concentrationMgPerMl !== null}
                  → <span class:diff={d.concentration}>{fmt(step.concentrationMgPerMl)} mg/mL</span>
                {/if}
              </span>
              <details class="ndcs">
                <summary class="chip" class:all={!d.diluentMl && !d.concentration && !d.diluents}>
                  {variant.ndcs.length} of {variant.of} NDCs
                </summary>
                <span class="list">
                  {#each variant.ndcs as ndc}<a href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a>{/each}
                </span>
              </details>
            </li>
          {/each}
        </ul>
        {#if group.missing.length && group.missing.length !== prep.missing.length}
          <p class="muted small">
            No {group.route} step on {group.missing.length} label{group.missing.length === 1 ? '' : 's'}:
            {#each group.missing as ndc, i}{i ? ', ' : ''}<a href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a>{/each}
          </p>
        {/if}
      </div>
    {/each}
    {#if prep.missing.length}
      <p class="muted small">
        No reconstitution found on {prep.missing.length} label{prep.missing.length === 1 ? '' : 's'}:
        {#each prep.missing as ndc, i}{i ? ', ' : ''}<a href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a>{/each}
      </p>
    {/if}
    {#if prep.readyToUse.length}
      <p class="muted small">{prep.readyToUse.length} ready-to-use package{prep.readyToUse.length === 1 ? '' : 's'} need no preparation.</p>
    {/if}
  {/if}
</section>

<style>
  .vial-prep { display: grid; gap: 0.75rem; }
  .count, .muted { color: var(--muted); }
  .count { margin-left: auto; font-size: 0.85rem; }
  .small { font-size: 0.85rem; margin: 0; }
  .group { display: grid; gap: 0.35rem; }
  .group-head { display: flex; align-items: baseline; gap: 0.6rem; }
  .status { font-size: 0.75rem; padding: 0.05rem 0.45rem; border-radius: 999px; border: 1px solid var(--line); }
  .status.unanimous { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
  .status.split { color: #9a3412; background: #fff7ed; border-color: #fed7aa; }
  .status.incomplete, .status.unassigned { color: #854d0e; background: #fefce8; border-color: #fde68a; }
  .variants { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
  .variants li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.75rem; }
  .step { color: var(--ink); }
  .diff { background: #fef3c7; border-radius: 0.2rem; padding: 0 0.15rem; font-weight: 600; }
  .ndcs { display: inline; }
  .chip { display: inline; cursor: pointer; font-size: 0.75rem; color: var(--muted); list-style: none; }
  .chip::-webkit-details-marker { display: none; }
  .chip.all { color: #166534; }
  .list { display: flex; flex-wrap: wrap; gap: 0.2rem 0.6rem; font-size: 0.8rem; margin-top: 0.2rem; }
  .list a, .small a { color: var(--accent); }
</style>
