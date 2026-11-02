<script lang="ts">
  import { enhance } from '$app/forms';
  import {
    sameConsensusStep,
    type AdoptedVialPrep,
    type ConsensusStep,
    type VialPrepConsensus
  } from '$lib/compounds/vial-prep-consensus';

  let {
    items,
    locked
  }: {
    items: {
      itemId: string;
      item: string;
      slotIds: string[];
      consensus: VialPrepConsensus;
      adopted: AdoptedVialPrep | null;
      adoptedCurrent: boolean | null;
    }[];
    locked: boolean;
  } = $props();

  // Only components that involve a dry fill, or that kept an adopted step, have anything to say.
  const shown = $derived(
    items.filter((entry) => entry.consensus.status !== 'not-needed' || entry.adopted)
  );
  const day = (iso: string) => new Date(iso).toLocaleDateString();

  const STATUS = {
    consensus: 'Consensus',
    partial: 'Partial — some labels unread',
    conflict: 'No consensus'
  } as const;

  const fmt = (value: number) => String(Number(value.toFixed(3)));
  const mass = (mg: number) => (mg >= 1000 ? `${fmt(mg / 1000)} g` : `${fmt(mg)} mg`);
  const describe = (step: ConsensusStep) =>
    [
      `Add ${fmt(step.diluentMl)} mL ${step.diluents.length ? step.diluents.join(' or ') : 'diluent'}`,
      step.vialMassMg !== null ? `to the ${mass(step.vialMassMg)} vial` : 'to the vial',
      step.concentrationMgPerMl !== null ? `→ ${fmt(step.concentrationMgPerMl)} mg/mL` : '',
      step.routes.length ? `(${step.routes.join('/')})` : ''
    ]
      .filter(Boolean)
      .join(' ');
</script>

{#if shown.length}
  <section class="card" aria-labelledby="vial-prep-heading">
    <header class="card-head">
      <h2 id="vial-prep-heading">Vial preparation</h2>
      <span>across every package each formulary item allows</span>
    </header>
    {#each shown as entry (entry.itemId)}
      {@const result = entry.consensus}
      <div class="item">
        <div class="item-head">
          <strong>{entry.item}</strong>
          {#if result.status !== 'not-needed'}
            <span class="status {result.status}">{STATUS[result.status]}</span>
          {/if}
        </div>
        {#if entry.adopted}
          <div class="adopted" class:stale={!entry.adoptedCurrent}>
            <span class="tag">In the compound</span>
            <span>{describe(entry.adopted.step)}</span>
            <span class="when">adopted {day(entry.adopted.adoptedAt)} · {entry.adopted.ndcs.length} NDCs agreed</span>
            {#if !locked}
              <form method="POST" action="?/clearVialPrep" use:enhance>
                {#each entry.slotIds as slotId}<input type="hidden" name="slotId" value={slotId} />{/each}
                <button type="submit">Clear</button>
              </form>
            {/if}
            {#if !entry.adoptedCurrent}
              <p class="warn">The allowed packages' labels no longer all agree on this step. Review it.</p>
            {/if}
          </div>
        {/if}
        {#if result.status !== 'not-needed'}
          {#if result.steps.length}
            <ul class="steps">
              {#each result.steps as step, index}
                <li>
                  <span>{describe(step)}</span>
                  {#if entry.adopted && sameConsensusStep(step, entry.adopted.step)}
                    <span class="when">adopted</span>
                  {:else if !locked}
                    <form method="POST" action="?/adoptVialPrep" use:enhance>
                      <input type="hidden" name="itemId" value={entry.itemId} />
                      <input type="hidden" name="step" value={index} />
                      <button type="submit">{entry.adopted ? 'Use this instead' : 'Adopt'}</button>
                    </form>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if result.status === 'partial'}
              <p class="note">Some allowed vials' labels gave no instruction; check them before adopting.</p>
            {/if}
          {:else if result.status === 'conflict'}
            <p class="note">The labels of the allowed vials share no reconstitution step; prepare per the package used.</p>
          {/if}
          <details>
            <summary>{result.voters.length} of {result.voters.length + result.missing.length} dry-fill packages have label instructions</summary>
            <ul class="packages">
              {#each result.voters as pkg (pkg.packageId)}
                <li>{pkg.ndc} · {pkg.title}</li>
              {/each}
              {#each result.missing as pkg (pkg.packageId)}
                <li class="missing">{pkg.ndc} · {pkg.title} — no instruction found</li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .card {
    margin: 1rem 0;
    border: 1px solid #dfe3ec;
    border-left: 4px solid #2f7d6d;
    border-radius: 10px;
    background: #fff;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    gap: 0.9rem;
    padding: 0.75rem 1rem;
    background: #f5faf8;
    border-bottom: 1px solid #e3e7ee;
    border-radius: 6px 10px 0 0;
  }
  .card-head h2 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 750;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #2a2f3a;
  }
  .card-head span {
    color: #7a8494;
    font-size: 0.9rem;
  }
  .item {
    padding: 0.75rem 1rem;
  }
  .item + .item {
    border-top: 1px solid #eef0f4;
  }
  .item-head {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .status {
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .status.consensus {
    background: #e6f2ea;
    color: #1f6b3a;
  }
  .status.partial {
    background: #fdf3dc;
    color: #8a5a00;
  }
  .status.conflict {
    background: #fbe5e5;
    color: #a3282a;
  }
  .steps {
    margin: 0.5rem 0;
    padding-left: 1.2rem;
  }
  .note {
    margin: 0.5rem 0;
    color: #5c6777;
  }
  details {
    color: #5c6777;
    font-size: 0.9rem;
  }
  .packages {
    margin: 0.35rem 0 0;
    padding-left: 1.2rem;
  }
  .missing {
    color: #8a5a00;
  }
  .steps li {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  form {
    display: inline;
  }
  button {
    padding: 0.15rem 0.6rem;
    border: 1px solid #c9d1dc;
    border-radius: 6px;
    background: #fff;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .adopted {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    flex-wrap: wrap;
    margin: 0.5rem 0;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: #e6f2ea;
  }
  .adopted.stale {
    background: #fdf3dc;
  }
  .tag {
    font-size: 0.75rem;
    font-weight: 700;
    color: #1f6b3a;
  }
  .when {
    color: #5c6777;
    font-size: 0.85rem;
  }
  .warn {
    flex-basis: 100%;
    margin: 0;
    color: #8a5a00;
  }
</style>
