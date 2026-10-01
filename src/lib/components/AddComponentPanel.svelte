<script lang="ts">
  import { enhance } from '$app/forms';

  type Candidate = {
    packageId: string;
    ndc: string;
    title: string;
    conc: string | null;
    doseUnit: string | null;
  };

  let { candidates }: { candidates: Candidate[] } = $props();

  let query = $state('');
  let role = $state<'active' | 'diluent'>('active');

  const LIMIT = 30;
  const matches = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return candidates
      .filter((candidate) => {
        const haystack = `${candidate.title} ${candidate.ndc}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .slice(0, LIMIT);
  });
  const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
</script>

<div class="panel">
  <div class="find">
    <input
      bind:value={query}
      type="search"
      placeholder="Drug name or NDC…"
      aria-label="Search the formulary"
      autocomplete="off"
      spellcheck="false"
    />
    <fieldset class="role">
      <legend class="sr">Add as</legend>
      <label><input type="radio" bind:group={role} value="active" /> Active</label>
      <label><input type="radio" bind:group={role} value="diluent" /> Diluent</label>
    </fieldset>
  </div>

  {#if !query.trim()}
    <p class="hint">Search the formulary, then pick the exact package to add.</p>
  {:else if !matches.length}
    <p class="hint">No formulary packages match. Load them from the search page first.</p>
  {:else}
    <form method="POST" action="?/add" use:enhance>
      <input type="hidden" name="role" value={role} />
      <ul>
        {#each matches as candidate (candidate.packageId)}
          <li>
            <button
              name="candidate"
              value={JSON.stringify({
                packageId: candidate.packageId,
                conc: candidate.conc,
                doseUnit: candidate.doseUnit
              })}
            >
              <span class="title">{candidate.title}</span>
              <span class="ndc">{formatNdc(candidate.ndc)}</span>
              <span class="plus" aria-hidden="true">⊕</span>
            </button>
          </li>
        {/each}
      </ul>
    </form>
  {/if}
</div>

<style>
  .panel {
    margin: 0.75rem 0;
    padding: 0.75rem;
    border: 1px solid #d5dcea;
    border-radius: 10px;
    background: #f8faff;
  }
  .find {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  .find > input {
    flex: 1;
    padding: 0.5rem 0.7rem;
    border: 1px solid #c9d1dc;
    border-radius: 8px;
    font: inherit;
  }
  .role {
    display: flex;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    border: 0;
    font-size: 0.85rem;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .hint {
    margin: 0.6rem 0 0;
    color: #5c6777;
    font-size: 0.9rem;
  }
  ul {
    margin: 0.6rem 0 0;
    padding: 0;
    list-style: none;
    max-height: 18rem;
    overflow: auto;
  }
  li button {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    width: 100%;
    padding: 0.45rem 0.5rem;
    border: 0;
    border-bottom: 1px solid #e3e7ee;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  li button:hover {
    background: #eef2f8;
  }
  .title {
    flex: 1;
  }
  .ndc {
    color: #5c6777;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .plus {
    color: #3464a5;
  }
</style>
