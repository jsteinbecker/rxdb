<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { untrack } from 'svelte';
	import { DEFAULT_LEVELS, levelLabel } from "$lib/formulary/hierarchy";
	import HierarchyBuilder from '$lib/components/HierarchyBuilder.svelte';
	import EquivalenceGroups from '$lib/components/EquivalenceGroups.svelte';
	import type { ExpandDepth } from "$lib/formulary/settings";
	import StrengthStyleRules from '$lib/components/StrengthStyleRules.svelte';
	import { buildCompoundName, NAME_CASES, type CompoundNaming } from '$lib/compounds/compound-naming';

	let { data, form } = $props();

	// Editable copies, re-synced from the server after each save.
	const initial = untrack(() => data);
	let name = $state(initial.scope.name);
	// The builder keeps its draft across saves so a view can be tweaked and saved again.
	let levels = $state<string[]>([...initial.settings.defaultLevels]);
	let viewName = $state(initial.settings.defaultView ?? '');
	let savingView = $state(false);
	let expandDepth = $state<ExpandDepth>(initial.settings.expandDepth);
	let singleExpand = $state(initial.settings.singleExpand);
	let confirmRemove = $state(initial.settings.confirmRemove);
	let uniformImprintSize = $state(initial.settings.uniformImprintSize);
	let naming = $state<CompoundNaming>({ ...initial.settings.compoundNaming });
	let savingNaming = $state(false);

	$effect(() => {
		if (data === initial) return;
		naming = { ...data.settings.compoundNaming };
		name = data.scope.name;
		expandDepth = data.settings.expandDepth;
		singleExpand = data.settings.singleExpand;
		confirmRemove = data.settings.confirmRemove;
		uniformImprintSize = data.settings.uniformImprintSize;
	});

	let clearOpen = $state(false);
	let confirmName = $state('');
	let saving = $state(false);
	let clearing = $state(false);
	let saveError = $state<string | null>(null);
	let clearError = $state<string | null>(null);

	const CASE_LABELS: Record<string, string> = {
		'as-is': 'As written',
		upper: 'UPPER CASE',
		lower: 'lower case',
		title: 'Title Case'
	};
	// Sample compounds the preview names with the rules as typed.
	const SAMPLES = [
		[
			{ role: 'active', ingredients: ['vancomycin'], doseUnit: 'mg', dose: { n: 1250, d: 1 }, conc: { n: 50, d: 1 }, volume: { n: 25, d: 1 } },
			{ role: 'diluent', ingredients: ['sodium chloride'], doseUnit: 'mg', dose: null, conc: null, volume: { n: 250, d: 1 } }
		],
		[
			{ role: 'active', ingredients: ['fentanyl'], doseUnit: 'mcg', dose: { n: 1000, d: 1 }, conc: { n: 50, d: 1 }, volume: { n: 20, d: 1 } },
			{ role: 'active', ingredients: ['bupivacaine'], doseUnit: 'mg', dose: { n: 125, d: 1 }, conc: { n: 5, d: 2 }, volume: { n: 50, d: 1 } }
		],
		[]
	] as const;
	const previews = $derived(
		SAMPLES.map((sample) =>
			buildCompoundName(
				sample.map((line) => ({ ...line, ingredients: [...line.ingredients] })),
				naming
			)
		)
	);

	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
</script>

<svelte:head>
	<title>Settings · RxDB</title>
</svelte:head>

<main>
	<PageHeader title="Settings">
		{#snippet eyebrow()}
                  <a href="/">RxDB</a>
                  /
                  <a href="/formulary">Formulary</a>
                  / Settings
            {/snippet}
		<p>Preferences for {data.scope.name}.</p>
	</PageHeader>

	<form
		method="POST"
		action="?/save"
		use:enhance={() => {
			saving = true;
			saveError = null;
			return async ({ result, update }) => {
				await update({ reset: false });
				saving = false;
				if (result.type === 'error') saveError = 'Settings could not be saved. Try again.';
			};
		}}
	>
		<section class="card">
			<h2>General</h2>
			<label class="field">
				<span>Formulary name</span>
				<input name="name" bind:value={name} maxlength="120" required />
			</label>
			<label class="check">
				<input type="checkbox" name="confirmRemove" bind:checked={confirmRemove} />
				<span>
					Ask before removing a loaded item
					<span class="small">On the Loaded items page.</span>
				</span>
			</label>
			<label class="check">
				<input type="checkbox" name="uniformImprintSize" bind:checked={uniformImprintSize} />
				<span>
					One text size per pill face
					<span class="small">
						Imprint strings on a face share the smallest size any of them fits. Strings the ILN
						marks small, large or fill keep their own size.
					</span>
				</span>
			</label>
		</section>

		<section class="card">
			<h2>Formulary display</h2>
			<fieldset>
				<legend>When the formulary opens</legend>
				{#each [['none', 'Everything collapsed'], ['first', 'First level expanded'], ['all', 'Everything expanded']] as [value, label] (value)}
					<label class="radio">
						<input type="radio" name="expandDepth" {value} bind:group={expandDepth} />
						{label}
					</label>
				{/each}
			</fieldset>
			<label class="check">
				<input type="checkbox" name="singleExpand" bind:checked={singleExpand} />
				<span>
					One open node per level
					<span class="small">
						Opening a node closes the others beside it, and they fade slightly so the open
						branch stands out.
					</span>
				</span>
			</label>
		</section>

		{#if saveError}
			<p class="notice error" role="alert">{saveError}</p>
		{:else if form?.section === 'save'}
			{#if form.saved}
				<p class="notice" role="status">Settings saved.</p>
			{:else if form.message}
				<p class="notice error" role="alert">{form.message}</p>
			{/if}
		{/if}
		<div class="actions">
			<button class="primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
		</div>
	</form>

	<form
		method="POST"
		action="?/saveNaming"
		use:enhance={() => {
			savingNaming = true;
			return async ({ update }) => {
				await update({ reset: false });
				savingNaming = false;
			};
		}}
	>
		<section class="card" aria-labelledby="naming-heading">
			<h2 id="naming-heading">Compound naming</h2>
			<p class="small">
				Compounds are named from their components as they are added. Use
				<code>{'{tokens}'}</code> for values; text in <code>[brackets]</code> is left out when a
				token inside it is empty. Saving renames every draft compound; saved compounds keep their
				names.
			</p>
			<label class="field">
				<span>Name <span class="small"><code>{'{actives}'}</code> <code>{'{diluents}'}</code> <code>{'{total}'}</code></span></span>
				<input name="template" bind:value={naming.template} maxlength="200" required />
			</label>
			<label class="field">
				<span>Each active <span class="small"><code>{'{ingredient}'}</code> <code>{'{dose}'}</code> <code>{'{conc}'}</code> <code>{'{volume}'}</code></span></span>
				<input name="active" bind:value={naming.active} maxlength="200" required />
			</label>
			<label class="field">
				<span>Each diluent <span class="small"><code>{'{ingredient}'}</code> <code>{'{conc}'}</code> <code>{'{volume}'}</code></span></span>
				<input name="diluent" bind:value={naming.diluent} maxlength="200" required />
			</label>
			<label class="field">
				<span>Between components</span>
				<input name="joiner" bind:value={naming.joiner} maxlength="20" />
			</label>
			<label class="field">
				<span>Letter case</span>
				<select name="letterCase" bind:value={naming.letterCase}>
					{#each NAME_CASES as value (value)}<option {value}>{CASE_LABELS[value]}</option>{/each}
				</select>
			</label>
			<label class="field">
				<span>Before any component is added</span>
				<input name="untitled" bind:value={naming.untitled} maxlength="120" required />
			</label>
			<div class="field">
				<span>Preview</span>
				<ul class="previews">
					{#each previews as preview, index (index)}<li>{preview}</li>{/each}
				</ul>
			</div>
			{#if form?.section === 'naming'}
				{#if form.saved}
					<p class="notice" role="status">Naming rules saved; drafts renamed.</p>
				{:else if form.message}
					<p class="notice error" role="alert">{form.message}</p>
				{/if}
			{/if}
			<div class="actions">
				<button class="primary" disabled={savingNaming}>
					{savingNaming ? 'Saving…' : 'Save naming rules'}
				</button>
				<button name="reset" value="true" formnovalidate>Restore defaults</button>
			</div>
		</section>
	</form>

	<section class="card" aria-labelledby="views-heading">
		<h2 id="views-heading">Views</h2>
		<p class="hint">
			Each view is a hierarchy the formulary can be shown as. Drag attributes in to decide how it
			splits; each level nests under the one before it, and the last holds the packages.
		</p>

		{#if data.settings.views.length}
			<ul class="views">
				{#each data.settings.views as view (view.name)}
					<li>
						<span class="desc">
							{view.name}
							{#if view.name === data.settings.defaultView}<span class="badge">Default</span>{/if}
							<span class="small">
								{view.levels.map(levelLabel).join(' → ') ||
									'Flat package list'}
							</span>
						</span>
						<button
							type="button"
							class="ghost"
							onclick={() => {
								viewName = view.name;
								levels = [...view.levels];
							}}>Edit</button
						>
						{#if view.name !== data.settings.defaultView}
							<form method="POST" action="?/defaultView" use:enhance>
								<input type="hidden" name="viewName" value={view.name} />
								<button class="ghost">Make default</button>
							</form>
						{/if}
						<form method="POST" action="?/deleteView" use:enhance>
							<input type="hidden" name="viewName" value={view.name} />
							<button class="icon" aria-label="Delete view {view.name}">×</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">No views yet — the formulary opens as a flat package list.</p>
		{/if}

		<form
			class="view-builder"
			method="POST"
			action="?/saveView"
			use:enhance={() => {
				savingView = true;
				return async ({ update }) => {
					await update({ reset: false });
					savingView = false;
				};
			}}
		>
			<h3>Hierarchy builder</h3>
			<HierarchyBuilder bind:levels />
			<input type="hidden" name="levels" value={levels.join(',')} />
			<div class="row">
				<label class="field grow">
					<span>View name</span>
					<input name="viewName" bind:value={viewName} maxlength="80" required />
				</label>
				<button class="primary" disabled={savingView || !viewName.trim()}>
					{savingView
						? 'Saving…'
						: data.settings.views.some((view) => view.name === viewName.trim())
							? 'Update view'
							: 'Save view'}
				</button>
				<button type="button" class="ghost" onclick={() => (levels = [...DEFAULT_LEVELS])}>
					Reset
				</button>
			</div>
			{#if form?.section === 'views'}
				{#if form.message}
					<p class="notice error" role="alert">{form.message}</p>
				{:else if form.savedView}
					<p class="notice" role="status">Saved “{form.savedView}”.</p>
				{/if}
			{/if}
		</form>
	</section>

	<section class="card" aria-labelledby="groups-heading">
		<h2 id="groups-heading">Equivalence groups</h2>
		<p class="hint">
			Values that should read as one node wherever the hierarchy splits on that attribute — e.g.
			“Tablet, Coated” and “Tablet, Film Coated” shown as “Tablet, Coated”. Spellings that differ
			only in case, punctuation, word order, plurals or common abbreviations match on their own.
		</p>
		<EquivalenceGroups
			groups={data.settings.equivalenceGroups}
			values={data.dimensionValues}
			message={form?.section === 'groups' && 'message' in form ? form.message : null}
			savedGroup={form?.section === 'groups' && 'savedGroup' in form ? form.savedGroup : null}
		/>
	</section>

	<section class="card" aria-labelledby="strength-styles-heading">
		<h2 id="strength-styles-heading">Strength display</h2>
		<p class="hint">
			Ingredients whose strength is shown in special terms, such as sodium chloride as “0.9%” or
			epinephrine with lidocaine as “1:100,000”. This changes names, package titles, the hierarchy
			and ingredient tables everywhere; stored strengths stay as they are. A rule naming companion
			ingredients or a dose form wins over a broader one, and an item’s own strength style wins
			over every rule.
		</p>

		<StrengthStyleRules
			rules={data.settings.strengthStyles}
			ingredients={data.dimensionValues.ingredient?.map((value) => value.label) ?? []}
			doseForms={data.dimensionValues.doseForm?.map((value) => value.label) ?? []}
			samples={data.strengthSamples}
			message={form?.section === 'strengthStyles' && 'message' in form ? form.message : null}
		/>
	</section>

	<section class="card danger-zone">
		<h2>Danger zone</h2>
		<div class="row between">
			<div>
				<strong>Clear formulary</strong>
				<p class="hint">
					Deletes everything saved — all {plural(data.itemCount, 'loaded item')}, catalog data, history,
					and settings. This cannot be undone.
				</p>
			</div>
			{#if !clearOpen}
				<button
					type="button"
					class="danger"
					onclick={() => (clearOpen = true)}>Clear formulary…</button
				>
			{/if}
		</div>

		{#if form?.section === 'clear' && form.cleared}
			<p class="notice" role="status">
				Formulary cleared · {plural(form.cleared.itemsRemoved, 'item')} removed, {plural(
					form.cleared.packagesUnlinked,
					'package'
				)} unlinked.
			</p>
		{/if}

		{#if clearOpen}
			<form
				class="confirm"
				method="POST"
				action="?/clear"
				use:enhance={() => {
					clearing = true;
					clearError = null;
					return async ({ result, update }) => {
						await update();
						clearing = false;
						if (result.type === 'error')
							clearError = 'The formulary could not be cleared. Try again.';
						if (result.type === 'success') {
							clearOpen = false;
							confirmName = '';
						}
					};
				}}
			>
				<label class="field">
					<span>
						This cannot be undone from here. Type <strong>{data.scope.name}</strong> to confirm.
					</span>
					<input name="confirmName" bind:value={confirmName} autocomplete="off" />
				</label>
				{#if clearError || (form?.section === 'clear' && form.message)}
					<p class="notice error" role="alert">{clearError ?? form?.message}</p>
				{/if}
				<div class="row">
					<button class="danger solid" disabled={clearing || confirmName.trim() !== data.scope.name}
						>{clearing ? 'Clearing…' : 'Clear formulary'}</button
					>
					<button
						type="button"
						class="ghost"
						onclick={() => {
							clearOpen = false;
							confirmName = '';
						}}>Cancel</button
					>
				</div>
			</form>
		{/if}
	</section>
</main>

<style>
	main {
		--page-width: 760px;
	}

	.hint {
		color: #5c6777;
		line-height: 1.55;
	}

	h2 {
		margin: 0 0 0.75rem;
		font-size: 1.05rem;
	}

	.card {
		border: 1px solid #e3e8ee;
		border-radius: 0.75rem;
		background: white;
		padding: 1.25rem;
		margin: 1.25rem 0;
	}

	.field {
		display: grid;
		gap: 0.35rem;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.field span {
		font-weight: 400;
		color: #3a4452;
	}

	input:not([type]) {
		border: 1px solid #b9c3d0;
		border-radius: 0.55rem;
		padding: 0.6rem 0.85rem;
		font: inherit;
		background: white;
		min-width: 0;
	}

	.check,
	.radio {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		margin-top: 1rem;
		font-size: 0.9rem;
	}

	.radio {
		margin-top: 0.4rem;
	}

	fieldset {
		border: 0;
		padding: 0;
		margin: 1.25rem 0 0;
	}

	legend {
		font-size: 0.9rem;
		font-weight: 650;
	}

	.views {
		margin: 1rem 0;
		padding: 0;
		list-style: none;
	}

	.views li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid #e3e8ee;
	}

	.views form {
		margin: 0;
	}

	.badge {
		margin-left: 0.35rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: #e8f0fb;
		color: #204f91;
		font-size: 0.75rem;
		font-weight: 650;
	}

	.view-builder {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid #e3e8ee;
	}

	.view-builder h3 {
		margin: 0;
		font-size: 0.95rem;
	}

	.view-builder .row {
		align-items: flex-end;
	}

	.grow {
		flex: 1;
	}

	.desc {
		flex: 1;
		min-width: 0;
		font-weight: 600;
	}

	.small {
		display: block;
		color: #7a8594;
		font-size: 0.75rem;
		font-weight: 400;
	}

	.row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.row.between {
		justify-content: space-between;
		flex-wrap: nowrap;
	}

	.row.between .hint {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
	}

	button {
		border-radius: 0.55rem;
		padding: 0.45rem 0.8rem;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 650;
		cursor: pointer;
	}

	button.icon {
		border: 1px solid #d5dce5;
		background: white;
		padding: 0.25rem 0.55rem;
	}

	button.ghost {
		border: 1px solid #d5dce5;
		background: white;
		color: #3a4452;
	}

	button.primary {
		border: 1px solid #204f91;
		background: #2a5ea8;
		color: white;
		padding: 0.6rem 1.1rem;
	}

	button.danger {
		flex: none;
		border: 1px solid #e3b4b4;
		background: white;
		color: #9a2a2a;
	}

	button.danger:hover:not(:disabled) {
		background: #fdecec;
	}

	button.danger.solid {
		background: #b33434;
		border-color: #9a2a2a;
		color: white;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
	}

	.danger-zone {
		border-color: #e3b4b4;
		margin-top: 2.5rem;
	}

	.danger-zone h2 {
		color: #9a2a2a;
	}

	.confirm {
		display: grid;
		gap: 0.75rem;
		margin-top: 1rem;
		border-top: 1px solid #f0d6d6;
		padding-top: 1rem;
	}

	.notice {
		border-radius: 0.55rem;
		background: #e9f6ee;
		color: #1f6b3a;
		padding: 0.6rem 0.85rem;
	}

	.notice.error {
		background: #fdecec;
		color: #9a2a2a;
	}

	.empty {
		color: #5c6777;
	}

	@media (max-width: 640px) {
		.row.between {
			flex-wrap: wrap;
		}
	}
	.previews {
		margin: 0.25rem 0 0;
		padding-left: 1.1rem;
		font-weight: 600;
	}
</style>
