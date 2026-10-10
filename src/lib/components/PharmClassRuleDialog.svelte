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
	};

	let {
		rules,
		message = null
	}: {
		rules: Promise<Rules> | Rules;
		/** A validation failure from the last form action. */
		message?: string | null;
	} = $props();

	let dialog: HTMLDialogElement;
	let mode = $state<'replace' | 'add' | 'suppress'>('add');
	let classes = $state<string[]>([]);
	let draft = $state('');
	let scope = $state<ScopeOption['id']>('form');
	let note = $state('');
	let ruleId = $state('');
	// True while a save is in flight.
	let pending = $state(false);

	function load(scopes: Scope[], id: ScopeOption['id']) {
		scope = id;
		const rule = scopes.find((candidate) => candidate.id === id)?.rule;
		ruleId = rule?.id ?? '';
		if (!rule) return;
		mode = rule.mode;
		classes = [...rule.classes];
		note = rule.note;
	}

	export async function open() {
		const loaded = await rules;
		draft = '';
		classes = [];
		note = '';
		mode = 'add';
		load(loaded.scopes, loaded.scopes.some((s) => s.id === 'form') ? 'form' : 'all');
		pending = false;
		dialog.showModal();
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
	{#await rules then loaded}
		<form
			method="POST"
			action="?/pharmClassRule"
			use:enhance={() => {
				commit();
				pending = true;
				return async ({ result, update }) => {
					await update({ reset: false });
					pending = false;
					if (result.type === 'success') dialog.close();
				};
			}}
		>
			<h2>Assign class</h2>
			<p>For {loaded.classKey.moietyNames}. Applies at display time; the source data is untouched.</p>
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
					{#each loaded.known as name (name)}<option value={name}></option>{/each}
				</datalist>
			</div>
			<fieldset class="scopes">
				<legend>Applies to</legend>
				{#each loaded.scopes as option (option.id)}
					<label>
						<input
							type="radio"
							name="scope"
							value={option.id}
							checked={scope === option.id}
							onchange={() => load(loaded.scopes, option.id)}
						/>
						{option.label}
						<span class="count">{countText(option)}{option.rule ? ' · has a rule' : ''}</span>
					</label>
				{/each}
			</fieldset>
			<div class="field">
				<label for="pharm-class-note">Note</label>
				<textarea id="pharm-class-note" name="note" rows="2" maxlength="500" bind:value={note}></textarea>
			</div>
			{#if message}<p class="error" role="alert">{message}</p>{/if}
			<input type="hidden" name="id" value={ruleId} />
			<div class="dialog-actions">
				{#if ruleId}
					<button class="link danger" type="submit" formaction="?/pharmClassRuleDelete">
						Delete rule
					</button>
				{/if}
				<span class="spacer"></span>
				<button class="link" type="button" onclick={() => dialog.close()}>Cancel</button>
				<button class="save" type="submit" disabled={pending}>
					{ruleId ? 'Update rule' : 'Save rule'}
				</button>
			</div>
		</form>
	{/await}
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
		font-size: 1.05rem;
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
