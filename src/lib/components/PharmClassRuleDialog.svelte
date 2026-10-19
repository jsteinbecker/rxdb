<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ScopeOption } from '$lib/pharm-class-scope-options';

	type Scope = ScopeOption & {
		count: number;
		capped: boolean;
		rule: { id: string; mode: 'replace' | 'add' | 'suppress'; classes: string[]; note: string } | null;
	};
	type Rules = {
		classKey: { moietyNames: string };
		scopes: Scope[];
		known: string[];
		/** True when counts or type-ahead names fell back to empty. */
		degraded?: boolean;
	};

	let {
		rules = null,
		known = [],
		message = null,
		confirmRemove = true
	}: {
		/** The scope choices for assigning a class; omit when only editing existing rules. */
		rules?: Promise<Rules> | Rules | null;
		/** Type-ahead names when there are no `rules`. */
		known?: Promise<string[]> | string[];
		/** A failure from the pharmClassRule / pharmClassRuleDelete actions only; callers filter the page-wide form. */
		message?: string | null;
		/** Ask before deleting a rule (the repo's `confirmRemove` setting). */
		confirmRemove?: boolean;
	} = $props();

	let dialog: HTMLDialogElement;
	let mode = $state<'replace' | 'add' | 'suppress'>('add');
	let classes = $state<string[]>([]);
	let draft = $state('');
	let scope = $state<ScopeOption['id']>('form');
	// The resolved scope choices; null until `open()` has them.
	let loaded = $state<Rules | null>(null);
	let knownNames = $state<string[]>([]);
	// While the streamed options load, and when they could not be loaded.
	let loading = $state(false);
	let loadFailed = $state(false);
	let note = $state('');
	let ruleId = $state('');
	// True while a save is in flight.
	let pending = $state(false);
	// A failure is only shown for a submit made from this dialog since it opened, never one left over from the page.
	let submitted = $state(false);
	// Set while editing an existing rule: its key is fixed, so the scope picker is hidden.
	let editing = $state<{ id: string; title: string } | null>(null);

	function load(scopes: Scope[], id: ScopeOption['id']) {
		scope = id;
		const rule = scopes.find((candidate) => candidate.id === id)?.rule;
		ruleId = rule?.id ?? '';
		if (!rule) {
			mode = 'add';
			classes = [];
			note = '';
			return;
		}
		mode = rule.mode;
		classes = [...rule.classes];
		note = rule.note;
	}

	/** Edit an existing rule; only its mode, classes and note can change. */
	export function edit(rule: {
		id: string;
		title: string;
		mode: 'replace' | 'add' | 'suppress';
		classes: string[];
		note: string | null;
	}) {
		editing = { id: rule.id, title: rule.title };
		ruleId = rule.id;
		draft = '';
		mode = rule.mode;
		classes = [...rule.classes];
		note = rule.note ?? '';
		pending = false;
		submitted = false;
		loaded = null;
		loadFailed = false;
		loading = false;
		dialog.showModal();
		void loadKnown(known);
	}

	/** Type-ahead names are a convenience: a failure leaves the list empty. */
	async function loadKnown(source: Promise<string[]> | string[]) {
		try {
			knownNames = await source;
		} catch {
			knownNames = [];
		}
	}

	export async function open() {
		if (!rules) return;
		editing = null;
		draft = '';
		classes = [];
		note = '';
		mode = 'add';
		pending = false;
		submitted = false;
		loaded = null;
		loadFailed = false;
		loading = true;
		dialog.showModal();
		try {
			const resolved = await rules;
			if (!resolved) {
				loadFailed = true;
				return;
			}
			loaded = resolved;
			knownNames = resolved.known;
			load(resolved.scopes, resolved.scopes.some((s) => s.id === 'form') ? 'form' : 'all');
		} catch {
			loadFailed = true;
			void loadKnown(known);
		} finally {
			loading = false;
		}
	}

	function commit() {
		const name = draft.trim();
		if (name && !classes.includes(name)) classes = [...classes, name];
		draft = '';
	}

	const countText = (scope: Scope) =>
		`${scope.count}${scope.capped ? '+' : ''} cached NDC${scope.count === 1 ? '' : 's'}`;
</script>

<dialog bind:this={dialog}>
	<form
		method="POST"
		action="?/pharmClassRule"
		use:enhance={({ cancel, formData, action }) => {
			if (action.search.startsWith('?/pharmClassRuleDelete')) {
				if (confirmRemove && !confirm('Delete this rule?')) return cancel();
			} else {
				// The form data is already built from the DOM, which does not yet hold a typed-but-
				// uncommitted class; add it to the request itself, then to the chips.
				const name = draft.trim();
				if (name && !formData.getAll('classes').includes(name)) formData.append('classes', name);
				commit();
			}
			pending = true;
			submitted = true;
			return async ({ result, update }) => {
				await update({ reset: false });
				pending = false;
				if (result.type === 'success') dialog.close();
			};
		}}
	>
		<h2>{editing ? 'Edit rule' : 'Assign class'}</h2>
		<p>
			For {editing ? editing.title : (loaded?.classKey.moietyNames || 'this package')}. Applies at
			display time; the source data is untouched.
		</p>
		{#if loading}
			<p class="muted" role="status">Loading options…</p>
		{:else if loadFailed}
			<p class="error" role="alert">
				Could not load the scope options, so a new rule cannot be saved now. Close and try again.
			</p>
		{:else if loaded?.degraded}
			<p class="muted" role="status">Match counts or suggestions could not be loaded.</p>
		{/if}
		<fieldset class="modes">
			<legend>Mode</legend>
			<label><input type="radio" name="mode" value="replace" bind:group={mode} /> Replace</label>
			<label><input type="radio" name="mode" value="add" bind:group={mode} /> Add</label>
			<label><input type="radio" name="mode" value="suppress" bind:group={mode} /> Hide</label>
		</fieldset>
		<div class="field">
			<label for="pharm-class-input">
				{mode === 'suppress' ? 'Classes to hide (none hides all)' : 'Classes'}
			</label>
			{#if classes.length}
				<ul class="chips">
					{#each classes as name (name)}
						<li>
							{name}
							<input type="hidden" name="classes" value={name} />
							<button
								type="button"
								aria-label={`Remove ${name}`}
								onclick={() => (classes = classes.filter((c) => c !== name))}>×</button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<input
				id="pharm-class-input"
				list="pharm-class-known"
				bind:value={draft}
				maxlength="160"
				placeholder="Type to search known classes, Enter to add"
				onkeydown={(event) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					commit();
				}}
				onchange={commit}
			/>
			<datalist id="pharm-class-known">
				{#each knownNames as name (name)}<option value={name}></option>{/each}
			</datalist>
		</div>
		{#if !editing && loaded}
			<fieldset class="scopes">
				<legend>Applies to</legend>
				{#each loaded.scopes as option (option.id)}
					<label>
						<input
							type="radio"
							name="scope"
							value={option.id}
							checked={scope === option.id}
							onchange={() => loaded && load(loaded.scopes, option.id)}
						/>
						{option.label}
						<span class="count">{countText(option)}{option.rule ? ' · has a rule' : ''}</span>
					</label>
				{/each}
			</fieldset>
		{/if}
		<div class="field">
			<label for="pharm-class-note">Note</label>
			<textarea id="pharm-class-note" name="note" rows="2" maxlength="500" bind:value={note}></textarea>
		</div>
		{#if message && submitted}<p class="error" role="alert">{message}</p>{/if}
		<input type="hidden" name="id" value={ruleId} />
		<div class="dialog-actions">
			{#if ruleId}
				<button class="link danger" type="submit" formaction="?/pharmClassRuleDelete">
					Delete rule
				</button>
			{/if}
			<span class="spacer"></span>
			<button class="link" type="button" onclick={() => dialog.close()}>Cancel</button>
			<button
				class="save"
				type="submit"
				disabled={pending || loading || (!editing && (loadFailed || !loaded))}
			>
				{ruleId ? 'Update rule' : 'Save rule'}
			</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		width: min(32rem, calc(100vw - 2rem));
		border: 1px solid #c9d6e8;
		border-radius: 0.65rem;
		padding: 1.1rem 1.25rem;
	}

	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.15rem;
	}

	p {
		margin: 0 0 0.75rem;
		color: #5c6777;
		font-size: 0.85rem;
	}

	fieldset {
		margin: 0 0 0.75rem;
		padding: 0;
		border: 0;
		font-size: 0.85rem;
	}

	legend,
	.field > label {
		margin-bottom: 0.3rem;
		font-size: 0.85rem;
		font-weight: 650;
	}

	.modes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
	}

	.modes legend {
		flex-basis: 100%;
	}

	.scopes label {
		display: block;
		padding: 0.15rem 0;
	}

	.count {
		margin-left: 0.4rem;
		color: #5c6777;
	}

	.field {
		display: grid;
		gap: 0.3rem;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
	}

	.field input,
	.field textarea {
		font: inherit;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chips li {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.1rem 0.2rem 0.1rem 0.5rem;
		border: 1px solid #c9d6e8;
		border-radius: 999px;
		background: #eef3fa;
		font-size: 0.8rem;
	}

	.chips button {
		padding: 0 0.3rem;
		border: 0;
		background: none;
		color: #5c6777;
		cursor: pointer;
	}

	.muted {
		margin: 0 0 0.6rem;
	}

	.error {
		margin: 0.6rem 0 0;
		color: #a4461a;
	}

	.dialog-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 0.9rem;
	}

	.spacer {
		flex: 1;
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: #3464a5;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.link:hover {
		text-decoration: underline;
	}

	.link.danger {
		color: #a4461a;
	}

	.save {
		padding: 0.4rem 0.9rem;
		border: 0;
		border-radius: 7px;
		background: #3464a5;
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 650;
		cursor: pointer;
	}

	.save:disabled {
		opacity: 0.6;
	}
</style>
