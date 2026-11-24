<!--
@component
The item's reconstitution, drawn as recipes: powder vial + diluent → solution, one
card per step the labels state, grouped by route. Each card carries how many of the
route's labels state it, and the fields where a minority step differs from the
most-stated one are flagged on the card.

The total volume on the solution is derived (vial content ÷ concentration), so it is
marked approximate; labels' own withdrawal volumes live on the package view.
-->
<script lang="ts">
  import { formatNdc } from '#lib/catalog/ndc.ts';
  import type { ConsensusStep, VialPrepRouteGroup, VialPrepVariants } from '#lib/compounds/vial-prep-consensus.ts';

  /** Every vial preparation the item's packages' labels state, by route, with where they differ. */
  let { prep, total }: { prep: VialPrepVariants; total: number } = $props();

  const fmt = (value: number) => String(Number(value.toFixed(3)));
  const mass = (mg: number) => (mg >= 1000 ? `${fmt(mg / 1000)} g` : `${fmt(mg)} mg`);
  const STATUS = {
    unanimous: { icon: '✓', text: 'All labels agree' },
    split: { icon: '≠', text: 'Labels differ' },
    incomplete: { icon: '✓', text: 'Agree · some labels silent' },
    unassigned: { icon: '?', text: 'No route on label' }
  } as const;
  const ROUTE_NAME: Record<string, string> = { IV: 'Intravenous', IM: 'Intramuscular', SC: 'Subcutaneous', PO: 'Oral' };

  /** Volume after mixing, when the vial's content and the concentration are both known. */
  const derivedMl = (step: ConsensusStep) =>
    step.bottleMl == null && step.vialMassMg !== null && step.concentrationMgPerMl
      ? step.vialMassMg / step.concentrationMgPerMl
      : null;
  /** Approximate, so it reads as such: one decimal under 10 mL, whole mL above. */
  const approx = (ml: number) => (ml < 10 ? ml.toFixed(1).replace(/\.0$/, '') : String(Math.round(ml)));
  /** Fill height of the mixed solution, as a share of the container, from diluent vs. total. */
  const fillOf = (step: ConsensusStep) => {
    const final = step.bottleMl ?? derivedMl(step);
    return final && final > step.diluentMl ? Math.min(0.82, 0.62 + (final - step.diluentMl) / final) : 0.7;
  };
  const groupLabel = (group: VialPrepRouteGroup) =>
    group.route ?? (prep.status === 'stated' && prep.groups.length > 1 ? 'Route not stated' : 'Any route');

  const dryFills = $derived(total - (prep.status === 'stated' ? prep.readyToUse.length : total));
</script>

{#snippet container(kind: 'vial' | 'bottle', contents: 'powder' | 'solution', fill = 0.7)}
  {@const bottle = kind === 'bottle'}
  {@const top = bottle ? 16 : 18}
  {@const level = top + (60 - top) * (1 - fill)}
  <svg class="container {contents}" viewBox="0 0 44 64" aria-hidden="true">
    {#if bottle}
      <rect class="cap" x="12" y="1" width="20" height="9" rx="2" />
      <path class="glass" d="M15 10 h14 v4 q9 3 9 12 v30 a6 6 0 0 1 -6 6 h-20 a6 6 0 0 1 -6 -6 v-30 q0 -9 9 -12 z" />
    {:else}
      <rect class="cap" x="11" y="1" width="22" height="8" rx="1.5" />
      <path class="glass" d="M14 9 h16 v5 l6 5 v37 a6 6 0 0 1 -6 6 h-16 a6 6 0 0 1 -6 -6 v-37 l6 -5 z" />
    {/if}
    <clipPath id="body-{kind}">
      {#if bottle}<path d="M7 18 h30 v38 a5 5 0 0 1 -5 5 h-20 a5 5 0 0 1 -5 -5 z" />
      {:else}<path d="M9 20 h26 v36 a5 5 0 0 1 -5 5 h-16 a5 5 0 0 1 -5 -5 z" />{/if}
    </clipPath>
    <g clip-path="url(#body-{kind})">
      {#if contents === 'powder'}
        <path class="powder" d="M0 64 V52 q8 -5 14 -3 t14 -2 t16 1 V64 z" />
        {#each [[13, 55], [19, 52], [25, 56], [31, 53], [16, 59], [28, 59], [22, 57], [35, 57]] as [cx, cy]}
          <circle class="grain" {cx} {cy} r="0.9" />
        {/each}
      {:else}
        <rect class="liquid" x="0" y={level} width="44" height={64 - level} />
        <path class="meniscus" d="M0 {level} q22 3 44 0" />
        <rect class="shine" x="12" y={level + 4} width="3" height={Math.max(0, 52 - level)} rx="1.5" />
      {/if}
    </g>
  </svg>
{/snippet}

<section class="panel vial-prep" aria-labelledby="vial-prep-heading">
  <div class="section-head">
    <h2 id="vial-prep-heading">Reconstitution</h2>
    {#if prep.status === 'stated'}
      <span class="tally">
        <span class="pill dry">{dryFills} dry fill{dryFills === 1 ? '' : 's'}</span>
        {#if prep.readyToUse.length}<span class="pill ready">{prep.readyToUse.length} ready to use</span>{/if}
        {#if prep.missing.length}<span class="pill silent">{prep.missing.length} without instructions</span>{/if}
      </span>
    {/if}
  </div>

  {#if prep.status === 'not-needed'}
    <p class="muted">No preparation needed — every package is ready to use.</p>
  {:else}
    {#each prep.groups as group (group.route ?? 'any')}
      {@const label = groupLabel(group)}
      {@const alternatives = group.status !== 'split' && group.variants.length > 1}
      <div class="route-group route-{(group.route ?? 'none').toLowerCase()}">
        <header class="group-head">
          <span class="route-code" title={group.route ? ROUTE_NAME[group.route] : label}>{group.route ?? '—'}</span>
          <span class="route-name">{group.route ? ROUTE_NAME[group.route] ?? group.route : label}</span>
          <span class="status {group.status}"><b aria-hidden="true">{STATUS[group.status].icon}</b>{STATUS[group.status].text}</span>
          {#if alternatives}<span class="hint">{group.variants.length} options — use either</span>{/if}
        </header>

        <ol class="recipes" class:alternatives>
          {#each group.variants as variant, v}
            {@const step = variant.step}
            {@const d = group.differs[v]}
            {@const kind = step.bottleMl != null ? 'bottle' : 'vial'}
            {@const final = derivedMl(step)}
            {@const odd = d.diluentMl || d.diluents || d.concentration}
            {@const agreed = variant.ndcs.length === variant.of}
            {#if v && alternatives}<li class="or" aria-hidden="true"><span>or</span></li>{/if}
            <li class="recipe" class:odd>
              <div class="flow">
                <figure class="stage">
                  {@render container(kind, 'powder')}
                  <figcaption>
                    <strong>{step.vialMassMg !== null ? mass(step.vialMassMg) : kind === 'bottle' ? 'Powder' : 'Dry vial'}</strong>
                    <small>{kind === 'bottle' ? 'for oral suspension' : 'powder'}</small>
                  </figcaption>
                </figure>

                <span class="op" aria-hidden="true">+</span>

                <figure class="stage diluent" class:diff={d.diluentMl || d.diluents}>
                  <svg class="drop" viewBox="0 0 40 52" aria-hidden="true">
                    <path d="M20 3 C 30 17 36 26 36 34 a16 16 0 0 1 -32 0 C 4 26 10 17 20 3 z" />
                    <path class="drop-shine" d="M12 33 a8 8 0 0 0 5 8" />
                  </svg>
                  <figcaption>
                    <strong class:diff={d.diluentMl}>Add {fmt(step.diluentMl)} mL</strong>
                    <span class="diluents" class:diff={d.diluents}>
                      {#each step.diluents.length ? step.diluents : ['diluent'] as name, i}
                        {#if i}<i>or</i>{/if}<span class="chip" class:generic={!step.diluents.length}>{name}</span>
                      {/each}
                    </span>
                  </figcaption>
                </figure>

                <span class="op arrow" aria-hidden="true">
                  <svg viewBox="0 0 40 12"><path d="M0 6 H34 M28 1 L36 6 L28 11" /></svg>
                  <small>{kind === 'bottle' ? 'shake' : 'swirl'}</small>
                </span>

                <figure class="stage result" class:diff={d.concentration}>
                  {@render container(kind, 'solution', fillOf(step))}
                  <figcaption>
                    {#if step.concentrationMgPerMl !== null}
                      <strong class="conc" class:diff={d.concentration}>{fmt(step.concentrationMgPerMl)}<small> mg/mL</small></strong>
                    {:else}
                      <strong class="conc unknown">Concentration not stated</strong>
                    {/if}
                    {#if step.bottleMl != null}
                      <small>{fmt(step.bottleMl)} mL bottle</small>
                    {:else if final !== null}
                      <small title="Vial content ÷ concentration; the labels' withdrawal volume is on each package">≈ {approx(final)} mL in the vial</small>
                    {/if}
                  </figcaption>
                </figure>
              </div>

              <details class="agreement">
                <summary>
                  <span class="meter" class:all={agreed} style:--share={variant.ndcs.length / variant.of}
                    role="img" aria-label="{variant.ndcs.length} of {variant.of} labels"></span>
                  <span class="meter-text">
                    <b>{variant.ndcs.length}</b> of {variant.of} label{variant.of === 1 ? '' : 's'}
                    {#if odd}<span class="flag">differs</span>{/if}
                  </span>
                </summary>
                <span class="ndc-list">
                  {#each variant.ndcs as ndc}<a href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a>{/each}
                </span>
              </details>
            </li>
          {/each}
        </ol>

        {#if group.missing.length && group.missing.length !== prep.missing.length}
          <p class="note">
            No {group.route} step on {group.missing.length} label{group.missing.length === 1 ? '' : 's'}:
            {#each group.missing as ndc, i}{i ? ', ' : ''}<a href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a>{/each}
          </p>
        {/if}
      </div>
    {/each}

    {#if prep.missing.length || prep.readyToUse.length}
      <footer class="notes">
        {#if prep.missing.length}
          <p class="note silent">
            <b aria-hidden="true">!</b>
            No reconstitution found on {prep.missing.length} label{prep.missing.length === 1 ? '' : 's'}:
            {#each prep.missing as ndc, i}{i ? ', ' : ''}<a href="/formulary/ndc/{ndc}">{formatNdc(ndc)}</a>{/each}
          </p>
        {/if}
        {#if prep.readyToUse.length}
          <p class="note ready">
            <b aria-hidden="true">✓</b>
            {prep.readyToUse.length} ready-to-use package{prep.readyToUse.length === 1 ? ' needs' : 's need'} no preparation.
          </p>
        {/if}
      </footer>
    {/if}
  {/if}
</section>

<style>
  .vial-prep { display: grid; gap: 1rem; }
  .muted { color: var(--muted); }

  /* Header tally */
  .tally { margin-left: auto; display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .pill { font-size: 0.75rem; padding: 0.1rem 0.55rem; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
  .pill.dry { color: #334155; background: #f1f5f9; }
  .pill.ready { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
  .pill.silent { color: #854d0e; background: #fefce8; border-color: #fde68a; }

  /* Route groups: each route has a hue, carried by its code, rail and solution. */
  .route-group { --hue: #64748b; --tint: #f1f5f9; --liquid: #cbd5e1; display: grid; gap: 0.55rem; }
  .route-iv { --hue: #1d4ed8; --tint: #eff6ff; --liquid: #93c5fd; }
  .route-im { --hue: #7c3aed; --tint: #f5f3ff; --liquid: #c4b5fd; }
  .route-sc { --hue: #0f766e; --tint: #f0fdfa; --liquid: #99f6e4; }
  .route-po { --hue: #c2410c; --tint: #fff7ed; --liquid: #fdba74; }

  .group-head { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
  .route-code {
    display: inline-grid; place-items: center; min-width: 2.1rem; height: 2.1rem; padding: 0 0.3rem; box-sizing: border-box;
    border-radius: 999px; background: var(--hue); color: white; font-weight: 700; font-size: 0.8rem; letter-spacing: 0.02em;
  }
  .route-name { font-weight: 650; color: var(--ink); }
  .status { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; padding: 0.1rem 0.55rem; border-radius: 999px; border: 1px solid var(--line); }
  .status b { font-size: 0.8rem; }
  .status.unanimous { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
  .status.split { color: #9a3412; background: #fff7ed; border-color: #fed7aa; }
  .status.incomplete, .status.unassigned { color: #854d0e; background: #fefce8; border-color: #fde68a; }
  .hint { font-size: 0.8rem; color: var(--muted); }

  /* Recipe cards */
  .recipes { list-style: none; margin: 0; padding: 0 0 0 1.05rem; border-left: 2px solid var(--tint); margin-left: 1rem; display: grid; gap: 0.5rem; }
  .recipe {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.75rem 1.5rem;
    padding: 0.75rem 1rem; border: 1px solid var(--line); border-radius: 0.75rem;
    background: linear-gradient(90deg, var(--tint), white 60%);
  }
  .recipe.odd { border-style: dashed; border-color: #fdba74; background: linear-gradient(90deg, #fff7ed, white 60%); }
  .or { display: flex; align-items: center; gap: 0.5rem; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.12em; }
  .or::before, .or::after { content: ''; flex: 1; border-top: 1px dashed var(--line); }

  .flow { display: flex; align-items: center; flex-wrap: nowrap; gap: 0.5rem 0.9rem; }
  .stage { display: flex; align-items: center; gap: 0.6rem; margin: 0; }
  .stage figcaption { display: grid; gap: 0.1rem; line-height: 1.2; }
  .stage strong { color: var(--ink); font-size: 1rem; }
  .stage small { color: var(--muted); font-size: 0.78rem; white-space: nowrap; }
  .op { color: var(--muted); font-size: 1.25rem; font-weight: 300; }
  .op.arrow { display: grid; justify-items: center; gap: 0.05rem; }
  .op.arrow svg { width: 2.4rem; height: 0.75rem; }
  .op.arrow path { fill: none; stroke: var(--hue); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .op.arrow small { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; }

  .container { width: 2.1rem; height: 3.05rem; flex: none; overflow: visible; }
  .container .glass { fill: rgba(255, 255, 255, 0.85); stroke: #94a3b8; stroke-width: 1.4; }
  .container .cap { fill: #94a3b8; }
  .container.solution .cap { fill: var(--hue); }
  .container .powder { fill: #e7e2d6; stroke: #cfc6b2; stroke-width: 0.8; }
  .container .grain { fill: #b9ad93; }
  .container .liquid { fill: var(--liquid); opacity: 0.85; }
  .container .meniscus { fill: none; stroke: var(--hue); stroke-width: 1; opacity: 0.5; }
  .container .shine { fill: white; opacity: 0.55; }

  .drop { width: 1.6rem; height: 2.1rem; flex: none; }
  .drop path:first-child { fill: #e0f2fe; stroke: #38bdf8; stroke-width: 1.6; }
  .drop .drop-shine { fill: none; stroke: white; stroke-width: 2; stroke-linecap: round; }

  .diluents { display: flex; flex-wrap: nowrap; white-space: nowrap; align-items: baseline; gap: 0.25rem; }
  .diluents i { font-style: normal; font-size: 0.72rem; color: var(--muted); }
  .chip { font-size: 0.74rem; padding: 0.02rem 0.4rem; border-radius: 0.3rem; background: white; border: 1px solid #bae6fd; color: #075985; }
  .chip.generic { border-style: dashed; color: var(--muted); border-color: var(--line); }

  .conc { font-size: 1.35rem !important; font-weight: 750; color: var(--hue) !important; letter-spacing: -0.01em; }
  .conc small { font-size: 0.8rem; font-weight: 600; color: var(--hue); }
  .conc.unknown { font-size: 0.85rem !important; font-weight: 500; color: var(--muted) !important; }

  /* A field that differs from the route's most-stated step. */
  .diff:is(strong, span) { background: #fef3c7; box-shadow: 0 0 0 2px #fef3c7; border-radius: 0.2rem; }
  .conc.diff { color: #9a3412 !important; }
  .conc.diff small { color: #9a3412; }

  /* Agreement meter */
  .agreement { justify-self: end; text-align: right; width: 10.5rem; }
  .agreement summary { list-style: none; cursor: pointer; display: grid; justify-items: end; gap: 0.3rem; }
  .agreement summary::-webkit-details-marker { display: none; }
  .meter {
    width: 6.5rem; height: 0.4rem; border-radius: 999px; background: #e5e7eb; overflow: hidden; position: relative;
  }
  .meter::before { content: ''; position: absolute; inset: 0; width: calc(var(--share) * 100%); background: #f59e0b; border-radius: inherit; }
  .meter.all::before { background: #16a34a; }
  .meter-text { font-size: 0.8rem; color: var(--muted); white-space: nowrap; }
  .meter-text b { color: var(--ink); }
  .flag { margin-left: 0.3rem; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9a3412; }
  .ndc-list { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.2rem 0.6rem; font-size: 0.8rem; margin-top: 0.35rem; }
  .ndc-list a, .note a { color: var(--accent); }

  .notes { display: grid; gap: 0.3rem; padding-top: 0.6rem; border-top: 1px dashed var(--line); }
  .note { margin: 0; font-size: 0.85rem; color: var(--muted); }
  .route-group > .note { margin-left: 2.1rem; }
  .note b {
    display: inline-grid; place-items: center; width: 1.1rem; height: 1.1rem; margin-right: 0.3rem;
    border-radius: 50%; font-size: 0.7rem; vertical-align: 0.05rem;
  }
  .note.silent b { background: #fef3c7; color: #854d0e; }
  .note.ready b { background: #dcfce7; color: #166534; }

  @media (max-width: 720px) {
    .flow { flex-wrap: wrap; }
    .recipe { grid-template-columns: minmax(0, 1fr); }
    .agreement { justify-self: start; text-align: left; width: auto; }
    .agreement summary { justify-items: start; }
    .ndc-list { justify-content: flex-start; }
  }
</style>
