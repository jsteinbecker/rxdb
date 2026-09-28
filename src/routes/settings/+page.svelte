<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { DIMENSIONS, DIMENSION_BY_KEY, DEFAULT_LEVELS } from '$lib/formulary-hierarchy';
	import type { ExpandDepth } from '$lib/settings';

	let { data, form } = $props();

	// Editable copies, re-synced from the server after each save.
	const initial = untrack(() => data);
	let name = $state(initial.scope.name);
	let levels = $state<string[]>([...initial.settings.defaultLevels]);
	let expandDepth = $state<ExpandDepth>(initial.settings.expandDepth);
	let confirmRemove = $state(initial.settings.confirmRemove);
	$effect(() => {
		if (data === initial) return;
		name = data.scope.name;
		levels = [...data.settings.defaultLevels];
		expandDepth = data.settings.expandDepth;
		confirmRemove = data.settings.confirmRemove;
	});

	let clearOpen = $state(false);
	let confirmName = $state('');
	let saving = $state(false);
	let clearing = $state(false);
	let saveError = $state<string | null>(null);
	let clearError = $state<string | null>(null);

	const available = $derived(
		DIMENSIONS.filter(
			(dimension) =>
				!dimension.variant?.hidden &&
				!levels.includes(dimension.key) &&
				!(dimension.variant && levels.includes(dimension.variant.key))
		)
	);

	function move(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= levels.length) return;
		const next = [...levels];
		[next[index], next[target]] = [next[target], next[index]];
		levels = next;
	}

	function switchVariant(key: string) {
		const variant = DIMENSION_BY_KEY.get(key)?.variant;
		if (variant) levels = levels.map((level) => (level === key ? variant.key : level));
	}

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
		</section>

		<section class="card">
			<h2>Default hierarchy</h2>
			<p class="hint">
				How the formulary groups packages when opened without a saved layout. Each level nests under
				the one above it; the last level holds the packages.
			</p>
			<input type="hidden" name="defaultLevels" value={levels.join(',')} />
			{#if levels.length}
				<ol class="levels">
					{#each levels as key, index (key)}
						{@const dimension = DIMENSION_BY_KEY.get(key)}
						<li>
							<span class="pos">{index + 1}</span>
							<span class="desc">
								{dimension?.label}
								<span class="small">{dimension?.hint}</span>
							</span>
							{#if dimension?.variant}
								<button type="button" class="ghost" onclick={() => switchVariant(key)}>
									{dimension.variant.mode}
								</button>
							{/if}
							<button
								type="button"
								class="icon"
								aria-label="Move {dimension?.label} up"
								disabled={index === 0}
								onclick={() => move(index, -1)}>↑</button
							>
							<button
								type="button"
								class="icon"
								aria-label="Move {dimension?.label} down"
								disabled={index === levels.length - 1}
								onclick={() => move(index, 1)}>↓</button
							>
							<button
								type="button"
								class="icon"
								aria-label="Remove {dimension?.label}"
								onclick={() => (levels = levels.filter((level) => level !== key))}>×</button
							>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="empty">No levels — the formulary opens as a flat package list.</p>
			{/if}
			<div class="row">
				<select
					aria-label="Add a level"
					value=""
					onchange={(event) => {
						const key = event.currentTarget.value;
						if (key) levels = [...levels, key];
						event.currentTarget.value = '';
					}}
					disabled={!available.length}
				>
					<option value="">Add a level…</option>
					{#each available as dimension (dimension.key)}
						<option value={dimension.key}>{dimension.label} — {dimension.hint}</option>
					{/each}
				</select>
				<button type="button" class="ghost" onclick={() => (levels = [...DEFAULT_LEVELS])}>
					Reset to built-in
				</button>
			</div>

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

	input:not([type]),
	select {
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

	.levels {
		display: grid;
		gap: 0.4rem;
		margin: 0 0 0.75rem;
		padding: 0;
		list-style: none;
	}

	.levels li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid #e3e8ee;
		border-radius: 0.55rem;
		padding: 0.5rem 0.65rem;
		font-size: 0.9rem;
	}

	.pos {
		flex: none;
		width: 1.6rem;
		height: 1.6rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: #e8f0fb;
		color: #204f91;
		font-size: 0.75rem;
		font-weight: 750;
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

	.row select {
		flex: 1;
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
