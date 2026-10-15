<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { DEFAULT_LEVELS, levelLabel } from '$lib/formulary-hierarchy';
	import HierarchyBuilder from '$lib/components/HierarchyBuilder.svelte';
	import type { ExpandDepth } from '$lib/settings';

	let { data, form } = $props();

	// Editable copies, re-synced from the server after each save.
	const initial = untrack(() => data);
	let name = $state(initial.scope.name);
	// The builder keeps its draft across saves so a view can be tweaked and saved again.
	let levels = $state<string[]>([...initial.settings.defaultLevels]);
	let viewName = $state(initial.settings.defaultView ?? '');
	let savingView = $state(false);
	let expandDepth = $state<ExpandDepth>(initial.settings.expandDepth);
	let confirmRemove = $state(initial.settings.confirmRemove);
	let uniformImprintSize = $state(initial.settings.uniformImprintSize);
	$effect(() => {
		if (data === initial) return;
		name = data.scope.name;
		expandDepth = data.settings.expandDepth;
		confirmRemove = data.settings.confirmRemove;
		uniformImprintSize = data.settings.uniformImprintSize;
	});

	let clearOpen = $state(false);
	let confirmName = $state('');
	let saving = $state(false);
	let clearing = $state(false);
	let saveError = $state<string | null>(null);
	let clearError = $state<string | null>(null);

	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
</script>

<svelte:head>
	<title>Settings · RxDB</title>
</svelte:head>

<main>
	<header>
		<p class="eyebrow"><a href="/">RxDB</a> / <a href="/formulary">Formulary</a> / Settings</p>
		<h1>Settings</h1>
		<p>Preferences for {data.scope.name}.</p>
	</header>

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
		max-width: 760px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}

	header p:last-child,
	.hint {
		color: #5c6777;
		line-height: 1.55;
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
		main {
			padding: 2.5rem 1rem;
		}

		.row.between {
			flex-wrap: wrap;
		}
	}
</style>
