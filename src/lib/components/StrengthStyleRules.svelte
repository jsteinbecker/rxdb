<!--
@component
Settings editor for strength display rules: define, edit and remove them. While a
rule is drafted, a preview shows how it would restyle the formulary's own products,
only where the draft is the rule that wins.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		ruleKey,
		STRENGTH_STYLES,
		ruleFor,
		styleStrength,
		type StrengthStyle,
		type StrengthStyleRule
	} from '$lib/medication/strength-style';

	/** A product the formulary holds: its stored strengths and the dose form text rules match. */
	export type StrengthSample = { ingredients: { name: string; strength: string | null }[]; form: string };

	let {
		rules,
		ingredients,
		doseForms,
		samples,
		message = null
	}: {
		/** The saved rules. */
		rules: StrengthStyleRule[];
		/** Ingredient names across the formulary, offered as suggestions. */
		ingredients: string[];
		/** Dose forms across the formulary, offered as suggestions. */
		doseForms: string[];
		/** The formulary's products, for previewing a draft rule. */
		samples: StrengthSample[];
		/** An error from the last save or delete. */
		message?: string | null;
	} = $props();

	const styleLabel = (style: StrengthStyle) =>
		STRENGTH_STYLES.find((option) => option.value === style)?.label ?? style;

	/** The builder: blank to add a rule, or loaded from one being edited. */
	let editing = $state<string | null>(null);
	let ingredient = $state('');
	let companions = $state<string[]>([]);
	let companionDraft = $state('');
	let doseForm = $state('');
	let style = $state<StrengthStyle>('percent');
	let saving = $state(false);

	function edit(rule: StrengthStyleRule) {
		editing = ruleKey(rule);
		ingredient = rule.ingredient;
		companions = [...rule.withIngredients];
		companionDraft = '';
		doseForm = rule.doseForm ?? '';
		style = rule.style;
	}

	function reset() {
		editing = null;
		ingredient = '';
		companions = [];
		companionDraft = '';
		doseForm = '';
		style = 'percent';
	}

	function addCompanion() {
		const name = companionDraft.trim().replace(/\s+/g, ' ');
		if (name && !companions.some((other) => other.toLowerCase() === name.toLowerCase()))
			companions = [...companions, name];
		companionDraft = '';
	}

	const draft = $derived<StrengthStyleRule | null>(
		ingredient.trim()
			? {
					ingredient: ingredient.trim(),
					withIngredients: companions,
					doseForm: doseForm.trim() || null,
					style
				}
			: null
	);

	/**
	 * What the draft would change, from the formulary's own products. Shown
	 * under the existing rules, so a more specific saved rule still wins.
	 */
	const preview = $derived.by(() => {
		if (!draft) return null;
		const others = rules.filter((rule) => ruleKey(rule) !== editing && ruleKey(rule) !== ruleKey(draft));
		const changes = new Map<string, { stored: string; shown: string; form: string }>();
		let products = 0;
		for (const sample of samples) {
			let changed = false;
			for (const item of sample.ingredients) {
				const names = sample.ingredients.filter((other) => other !== item).map((other) => other.name);
				// Only where the draft is the rule that wins.
				if (ruleFor([...others, draft], item.name, sample.form, names) !== draft) continue;
				const shown = styleStrength(item.strength, draft.style);
				if (!shown) continue;
				changed = true;
				const stored = `${item.name} ${item.strength}`;
				if (!changes.has(stored)) changes.set(stored, { stored, shown: `${item.name} ${shown}`, form: sample.form });
			}
			if (changed) products += 1;
		}
		return { products, examples: [...changes.values()].slice(0, 4) };
	});

	const describe = (rule: StrengthStyleRule) =>
		[
			rule.withIngredients.length ? `with ${rule.withIngredients.join(' + ')}` : null,
			rule.doseForm ?? 'Any dose form',
			styleLabel(rule.style)
		]
			.filter(Boolean)
			.join(' · ');
</script>

{#if rules.length}
	<ul class="rules">
		{#each rules as rule (ruleKey(rule))}
			<li class:current={editing === ruleKey(rule)}>
				<span class="desc">
					{rule.ingredient}
					<span class="small">{describe(rule)}</span>
				</span>
				<button type="button" class="ghost" onclick={() => edit(rule)} aria-label="Edit rule for {rule.ingredient}">
					Edit
				</button>
				<form
					method="POST"
					action="?/deleteStrengthStyle"
					use:enhance={() =>
						async ({ update }) => {
							if (editing === ruleKey(rule)) reset();
							await update();
						}}
				>
					<input type="hidden" name="key" value={ruleKey(rule)} />
					<button class="icon" aria-label="Remove rule for {rule.ingredient}" title="Remove rule">×</button>
				</form>
			</li>
		{/each}
	</ul>
{:else}
	<p class="empty">No rules: strengths show as stored.</p>
{/if}

<form
	class="builder"
	method="POST"
	action="?/saveStrengthStyle"
	use:enhance={() => {
		saving = true;
		return async ({ result, update }) => {
			saving = false;
			await update({ reset: false });
			if (result.type === 'success') reset();
		};
	}}
>
	<h3>{editing ? 'Edit rule' : 'Add a rule'}</h3>
	{#if editing}<input type="hidden" name="originalKey" value={editing} />{/if}
	{#each companions as name (name)}<input type="hidden" name="withIngredients" value={name} />{/each}
	<div class="row">
		<label class="field grow">
			<span>Ingredient</span>
			<input
				name="ingredient"
				bind:value={ingredient}
				list="strength-style-ingredients"
				placeholder="sodium chloride"
				maxlength="200"
				required
			/>
		</label>
		<label class="field grow">
			<span>Dose form (optional)</span>
			<input
				name="doseForm"
				bind:value={doseForm}
				list="strength-style-forms"
				placeholder="Injection"
				maxlength="200"
			/>
		</label>
		<label class="field">
			<span>Show as</span>
			<select name="style" bind:value={style}>
				{#each STRENGTH_STYLES as option (option.value)}
					<option value={option.value}>{option.label} ({option.example})</option>
				{/each}
			</select>
		</label>
	</div>
	<div class="field companions">
		<span>Only when combined with (optional)</span>
		<div class="chips">
			{#each companions as name (name)}
				<span class="chip">
					{name}
					<button
						type="button"
						class="chip-remove"
						aria-label="Remove {name}"
						onclick={() => (companions = companions.filter((other) => other !== name))}>×</button
					>
				</span>
			{/each}
			<input
				bind:value={companionDraft}
				list="strength-style-ingredients"
				placeholder={companions.length ? 'and…' : 'lidocaine'}
				aria-label="Add a companion ingredient"
				maxlength="200"
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						addCompanion();
					}
				}}
				onchange={addCompanion}
			/>
		</div>
	</div>

	{#if preview}
		<div class="preview" aria-live="polite">
			{#if preview.examples.length}
				<p class="small">
					Changes {preview.products} product{preview.products === 1 ? '' : 's'} on this formulary, e.g.
				</p>
				<ul>
					{#each preview.examples as example (example.stored)}
						<li><span class="stored">{example.stored}</span> → <strong>{example.shown}</strong></li>
					{/each}
				</ul>
			{:else}
				<p class="small">
					No product on this formulary has a {draft?.ingredient} concentration this rule would restate.
				</p>
			{/if}
		</div>
	{/if}

	<div class="actions">
		<button class="primary" disabled={saving}>{editing ? 'Save rule' : 'Add rule'}</button>
		{#if editing}<button type="button" class="ghost" onclick={reset}>Cancel</button>{/if}
	</div>
	{#if message}<p class="notice error" role="alert">{message}</p>{/if}
</form>

<datalist id="strength-style-ingredients">
	{#each ingredients as name (name)}<option value={name}></option>{/each}
</datalist>
<datalist id="strength-style-forms">
	{#each doseForms as form (form)}<option value={form}></option>{/each}
</datalist>

<style>
	.rules {
		margin: 1rem 0;
		padding: 0;
		list-style: none;
	}

	.rules li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid #e3e8ee;
	}

	.rules li.current {
		background: #f2f6fc;
	}

	.rules form {
		margin: 0;
	}

	.desc {
		flex: 1;
		min-width: 0;
		font-weight: 600;
	}

	.small {
		display: block;
		color: #5b6675;
		font-size: 0.82rem;
		font-weight: 400;
	}

	.empty {
		color: #5b6675;
	}

	.builder {
		display: grid;
		gap: 0.85rem;
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid #e3e8ee;
	}

	.builder h3 {
		margin: 0;
		font-size: 0.95rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-end;
	}

	.grow {
		flex: 1 1 12rem;
	}

	.field {
		display: grid;
		gap: 0.35rem;
		font-size: 0.9rem;
	}

	.field > span {
		color: #3a4452;
	}

	select,
	input {
		border: 1px solid #b9c3d0;
		border-radius: 0.55rem;
		padding: 0.5rem 0.75rem;
		font: inherit;
		background: white;
		min-width: 0;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.chips input {
		flex: 1 1 10rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid #d5dce5;
		border-radius: 999px;
		padding: 0.15rem 0.3rem 0.15rem 0.6rem;
		background: #f6f8fa;
		font-size: 0.85rem;
	}

	.chip-remove {
		border: 0;
		background: none;
		padding: 0 0.25rem;
		line-height: 1;
		cursor: pointer;
		color: #5b6675;
	}

	.preview {
		border: 1px dashed #c9d4e2;
		border-radius: 0.6rem;
		padding: 0.6rem 0.85rem;
		background: #fbfcfe;
	}

	.preview p {
		margin: 0;
	}

	.preview ul {
		margin: 0.35rem 0 0;
		padding-left: 1.1rem;
		font-size: 0.88rem;
	}

	.stored {
		color: #5b6675;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}
</style>
