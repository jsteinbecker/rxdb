<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { editState, evidenceText, supersedeItem, supersedesText } from '$lib/local-concept-list';

	let { data, form } = $props();

	let menuFor = $state<string | null>(null);

	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
</script>

<svelte:window
	onclick={(event) => {
		if (menuFor && !(event.target as Element).closest('.row-menu')) menuFor = null;
	}}
	onkeydown={(event) => event.key === 'Escape' && (menuFor = null)}
/>

<svelte:head>
	<title>Local concepts · RxDB</title>
</svelte:head>

<main>
	<header>
		<p class="eyebrow">
			<a href={resolve('/')}>RxDB</a> / <a href={resolve('/formulary')}>Formulary</a> / Local concepts ·
			<a href={resolve('/settings')}>Settings</a>
		</p>
		<h1>Local concepts</h1>
		<p>
			{plural(data.concepts.length, 'local concept')} in {data.scope.name}. A local concept replaces
			the name and ingredients of the RxNorm concept it supersedes; RxNorm's own data is untouched.
		</p>
	</header>

	{#if (form?.action === 'localConceptStop' ||
		form?.action === 'localConceptRetire' ||
		form?.action === 'localConceptResupersede' ||
		form?.action === 'localConceptSupersede') && form.message}
		<p class="notice error" role="alert">{form.message}</p>
	{/if}

	{#if !data.concepts.length}
		<p class="empty">
			No local concepts yet. Open an NDC page from the <a href={resolve('/formulary')}>formulary</a>
			and choose Define local concept from the RxNorm block's ⋯ menu to create one.
		</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Code</th>
					<th>Name</th>
					<th>Supersedes</th>
					<th>Scope</th>
					<th class="num">Open drift</th>
					<th>Evidence</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.concepts as concept (concept.id)}
					{@const edit = editState(concept)}
					{@const supersedeAction = supersedeItem(concept)}
					<tr>
						<td class="mono">{concept.code}</td>
						<td>{concept.name}</td>
						<td class:muted={!concept.supersedes?.active}>{supersedesText(concept.supersedes)}</td>
						<td>{data.scope.name}</td>
						<td class="num">
							<!-- No review-items page exists yet, so the count is not a link. -->
							<span title="Open RxNorm drift reviews">{concept.openDrift}</span>
						</td>
						<td class="mono">{evidenceText(concept.evidence)}</td>
						<td class="actions">
							<div class="row-menu" class:open={menuFor === concept.id}>
								<button
									class="menu-trigger"
									aria-label="Local concept options"
									aria-haspopup="menu"
									aria-expanded={menuFor === concept.id}
									onclick={() => (menuFor = menuFor === concept.id ? null : concept.id)}>⋯</button
								>
								{#if menuFor === concept.id}
									<div class="menu" role="menu">
										{#if edit.ndc}
											<a
												role="menuitem"
												href="{resolve('/formulary/ndc/[ndc]', { ndc: edit.ndc })}?localConcept=edit">Edit</a
											>
										{:else}
											<button type="button" role="menuitem" disabled title={edit.reason}>Edit</button>
										{/if}
										{#if supersedeAction}
											<form
												method="POST"
												action="?/{supersedeAction.action}"
												use:enhance={() => {
													menuFor = null;
												}}
											>
												<input type="hidden" name="id" value={concept.id} />
												<button
													role="menuitem"
													title={supersedeAction.action === 'localConceptSupersede'
														? 'Supersede the RxNorm SCD of the NDC it was defined from'
														: undefined}>{supersedeAction.label}</button
												>
											</form>
										{/if}
										{#if concept.supersedes?.active}
											<form
												method="POST"
												action="?/localConceptStop"
												use:enhance={({ cancel }) => {
													if (
														data.settings.confirmRemove &&
														!confirm(`Stop ${concept.code} superseding RxCUI ${concept.supersedes?.rxcui}?`)
													)
														return cancel();
													menuFor = null;
												}}
											>
												<input type="hidden" name="id" value={concept.id} />
												<button role="menuitem">Stop superseding</button>
											</form>
										{/if}
										<form
											method="POST"
											action="?/localConceptRetire"
											use:enhance={({ cancel }) => {
												if (!confirm(`Retire ${concept.code}? It stops applying everywhere.`))
													return cancel();
												menuFor = null;
											}}
										>
											<input type="hidden" name="id" value={concept.id} />
											<button class="danger" role="menuitem">Retire</button>
										</form>
									</div>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>

<style>
	main {
		max-width: 1040px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}

	header p:last-child {
		color: #5c6777;
		line-height: 1.55;
		max-width: 46rem;
	}

	.eyebrow {
		margin: 0 0 0.5rem;
		color: #3464a5;
		font-size: 0.8rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.eyebrow a {
		color: inherit;
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
		letter-spacing: -0.045em;
	}

	.notice {
		border-radius: 0.55rem;
		padding: 0.6rem 0.85rem;
	}

	.notice.error {
		background: #fdecec;
		color: #9a2a2a;
	}

	.empty,
	.muted {
		color: #5c6777;
	}

	.mono {
		font-family: ui-monospace, monospace;
		font-size: 0.82rem;
		word-break: break-all;
	}

	table {
		width: 100%;
		margin-top: 1.5rem;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	th,
	td {
		padding: 0.55rem 0.6rem;
		border-bottom: 1px solid #e3e8ef;
		text-align: left;
		vertical-align: top;
	}

	th {
		color: #7a8594;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.num {
		text-align: right;
		white-space: nowrap;
	}

	.actions {
		width: 1%;
	}

	.row-menu {
		position: relative;
	}

	.menu-trigger {
		background: none;
		border: 0;
		color: #5c6777;
		padding: 0.1rem 0.45rem;
		border-radius: 0.35rem;
		line-height: 1;
		cursor: pointer;
	}

	.menu-trigger:hover,
	.row-menu.open .menu-trigger {
		background: #eef2f7;
	}

	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 0.25rem);
		z-index: 10;
		min-width: 10rem;
		padding: 0.3rem;
		background: #fff;
		border: 1px solid #d9dee6;
		border-radius: 0.5rem;
		box-shadow: 0 6px 20px rgb(15 23 42 / 0.12);
	}

	.menu button,
	.menu a {
		display: flex;
		width: 100%;
		box-sizing: border-box;
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		text-decoration: none;
		padding: 0.35rem 0.5rem;
		border-radius: 0.35rem;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.menu button:hover,
	.menu a:hover {
		background: #eef2f7;
	}

	.menu button:disabled {
		color: #9aa4b2;
		cursor: not-allowed;
		background: none;
	}

	.menu .danger {
		color: #a4461a;
	}
</style>
