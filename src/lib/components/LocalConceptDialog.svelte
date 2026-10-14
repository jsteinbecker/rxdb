<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		asConceptIngredient,
		diffIngredients,
		localConceptName,
		parseScdName,
		type LocalIngredient
	} from '$lib/local-concept';
	import type { IonicRow, LocalConceptInput } from '$lib/local-concept-input';
	import type { LocalConceptView } from '$lib/local-concept-view';
	import LocalConceptDiff from './LocalConceptDiff.svelte';

	type Editor = {
		draft: { input: LocalConceptInput; warnings: string[] };
		existing: { id: string; code: string; input: LocalConceptInput } | null;
		target: { scd: { rxcui: string; name: string | null } | null; blocked: string | null };
		substances: { unii: string; name: string }[];
	};

	let {
		editor,
		localConcept = undefined,
		rxnormName = null,
		message = null
	}: {
		editor: Editor;
		localConcept?: LocalConceptView;
		/** RxNorm's name for this NDC's own concept, the diff's fallback baseline. */
		rxnormName?: string | null;
		/** A failure from the localConceptSave / localConceptStop actions only. */
		message?: string | null;
	} = $props();

	const UNII = /^[A-Z0-9]{10}$/;
	const MASS_UNITS = ['MG', 'MCG', 'G', 'MEQ'];
	const VOLUME_UNITS = ['ML', 'L'];

	let dialog: HTMLDialogElement;
	let stopDialog: HTMLDialogElement;
	let mode = $state<'define' | 'edit'>('define');
	let rows = $state<LocalIngredient[]>([]);
	let doseForm = $state('');
	let note = $state('');
	let ionic = $state<IonicRow[]>([]);
	let evidence = $state({ setId: '', version: '', ndc: '' as string | null });
	let supersede = $state(true);
	let warnings = $state<string[]>([]);
	let pending = $state(false);
	let submitted = $state(false);
	// UNIIs looked up in GSRS this session: name, or null when it had none.
	let lookups = $state<Record<string, string | null>>({});

	const editing = $derived(mode === 'edit' ? editor.existing : null);
	const target = $derived(editor.target);
	const canSupersede = $derived(!target.blocked && !!target.scd);
	const byName = $derived(new Map(editor.substances.map((s) => [s.name.toLowerCase(), s.unii])));
	const byUnii = $derived(new Map(editor.substances.map((s) => [s.unii, s.name])));

	const filled = (row: LocalIngredient) =>
		!!row.substanceName.trim() && Number(row.strengthNumMag) > 0;
	const previewName = $derived(
		rows.filter(filled).length
			? localConceptName({ ingredients: rows.filter(filled), doseForm: doseForm.trim() || '…' })
			: ''
	);
	// What the concept replaces: the SCD's own name when known, else this NDC's concept.
	const baseline = $derived(
		(mode === 'edit' ? localConcept?.supersedes.name : target.scd?.name) ?? rxnormName
	);
	const diff = $derived(
		diffIngredients(
			(baseline && parseScdName(baseline)?.ingredients) || [],
			rows.filter(filled).map(asConceptIngredient)
		)
	);

	const clone = (input: LocalConceptInput) => {
		rows = input.ingredients.map((row) => ({ ...row }));
		doseForm = input.doseForm;
		note = input.note ?? '';
		ionic = (input.ionicContent ?? []).map((row) => ({ ...row }));
		evidence = { setId: input.evidenceSetId, version: input.evidenceVersion, ndc: input.evidenceNdc };
	};

	/** "Define local concept…" from the label draft, or "Edit local concept…" from the saved one. */
	export function open(next: 'define' | 'edit') {
		mode = next === 'edit' && editor.existing ? 'edit' : 'define';
		if (mode === 'edit') {
			clone(editor.existing!.input);
			warnings = [];
		} else {
			clone(editor.draft.input);
			warnings = [...editor.draft.warnings];
		}
		supersede = canSupersede;
		pending = false;
		submitted = false;
		dialog.showModal();
	}

	export function confirmStop() {
		pending = false;
		submitted = false;
		stopDialog.showModal();
	}

	const blankRow = (): LocalIngredient => ({
		substanceUnii: '',
		substanceName: '',
		basis: 'as_labeled',
		moietyUnii: null,
		moietyName: null,
		strengthNumMag: '',
		strengthNumUom: 'MG',
		strengthDenMag: '1',
		strengthDenUom: 'ML'
	});

	/** Picking a known name fills its UNII. */
	function nameChosen(row: LocalIngredient, field: 'substance' | 'moiety') {
		const name = field === 'substance' ? row.substanceName : (row.moietyName ?? '');
		const unii = byName.get(name.trim().toLowerCase());
		if (!unii) return;
		if (field === 'substance') row.substanceUnii = unii;
		else row.moietyUnii = unii;
	}

	/** A typed UNII fills its name from the known list, or from GSRS. */
	async function uniiEntered(row: LocalIngredient, field: 'substance' | 'moiety') {
		const unii = (field === 'substance' ? row.substanceUnii : (row.moietyUnii ?? '')).trim().toUpperCase();
		if (field === 'substance') row.substanceUnii = unii;
		else row.moietyUnii = unii;
		if (!UNII.test(unii)) return;
		let name = byUnii.get(unii) ?? lookups[unii];
		if (name === undefined) {
			try {
				const response = await fetch(`/api/unii/${unii}`);
				const answer = response.ok ? await response.json() : null;
				name = answer?.status === 'ok' ? (answer.substance.name ?? null) : null;
			} catch {
				name = null;
			}
			lookups[unii] = name;
		}
		if (!name) return;
		if (field === 'substance' && !row.substanceName.trim()) row.substanceName = name;
		if (field === 'moiety' && !row.moietyName?.trim()) row.moietyName = name;
	}

	const payload = () => ({
		doseForm,
		ingredients: rows.map((row) => ({
			...row,
			moietyUnii: row.basis === 'active_moiety' ? row.moietyUnii : null,
			moietyName: row.basis === 'active_moiety' ? row.moietyName : null
		})),
		ionicContent: ionic.filter((row) => row.element.trim() || row.mEqPerL.trim()),
		note
	});
</script>

<datalist id="local-concept-substances">
	{#each editor.substances as substance (substance.unii)}<option value={substance.name}></option>{/each}
</datalist>

<dialog bind:this={dialog} class="editor">
	<form
		method="POST"
		action="?/localConceptSave"
		use:enhance={({ formData }) => {
			formData.set('concept', JSON.stringify(payload()));
			pending = true;
			submitted = true;
			return async ({ result, update }) => {
				await update({ reset: false });
				pending = false;
				if (result.type === 'success') dialog.close();
			};
		}}
	>
		<h2>{editing ? `Edit local concept ${editing.code}` : 'Define local concept'}</h2>
		<p class="hint">
			A local SCD with the label's ingredients. It stands in for the RxNorm concept in this formulary;
			RxNorm's data is kept as provenance.
		</p>
		{#if warnings.length}
			<ul class="warnings" role="status">
				{#each warnings as warning, i (i)}<li>{warning}</li>{/each}
			</ul>
		{/if}

		<fieldset>
			<legend>Ingredients</legend>
			<div class="table-wrap">
				<table class="rows">
					<thead>
						<tr>
							<th>Substance</th>
							<th>Basis</th>
							<th>Strength</th>
							<th><span class="visually-hidden">Remove</span></th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row, i (i)}
							<tr>
								<td>
									<input
										class="name"
										list="local-concept-substances"
										aria-label={`Ingredient ${i + 1} substance`}
										bind:value={row.substanceName}
										onchange={() => nameChosen(row, 'substance')}
										maxlength="300"
									/>
									<input
										class="unii mono"
										aria-label={`Ingredient ${i + 1} UNII`}
										placeholder="UNII"
										bind:value={row.substanceUnii}
										onchange={() => uniiEntered(row, 'substance')}
										maxlength="10"
									/>
								</td>
								<td>
									<select aria-label={`Ingredient ${i + 1} basis`} bind:value={row.basis}>
										<option value="as_labeled">as labeled</option>
										<option value="active_moiety">as moiety</option>
									</select>
									{#if row.basis === 'active_moiety'}
										<input
											class="name"
											list="local-concept-substances"
											aria-label={`Ingredient ${i + 1} moiety`}
											placeholder="Moiety"
											value={row.moietyName ?? ''}
											oninput={(event) => (row.moietyName = event.currentTarget.value)}
											onchange={() => nameChosen(row, 'moiety')}
											maxlength="300"
										/>
										<input
											class="unii mono"
											aria-label={`Ingredient ${i + 1} moiety UNII`}
											placeholder="UNII"
											value={row.moietyUnii ?? ''}
											oninput={(event) => (row.moietyUnii = event.currentTarget.value)}
											onchange={() => uniiEntered(row, 'moiety')}
											maxlength="10"
										/>
									{/if}
								</td>
								<td class="strength">
									<input
										class="mag"
										inputmode="decimal"
										aria-label={`Ingredient ${i + 1} strength`}
										bind:value={row.strengthNumMag}
									/>
									<select aria-label={`Ingredient ${i + 1} unit`} bind:value={row.strengthNumUom}>
										{#each MASS_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
									</select>
									/
									<input
										class="per"
										inputmode="decimal"
										aria-label={`Ingredient ${i + 1} per amount`}
										bind:value={row.strengthDenMag}
									/>
									<select aria-label={`Ingredient ${i + 1} per unit`} bind:value={row.strengthDenUom}>
										{#each VOLUME_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
									</select>
								</td>
								<td>
									<button
										class="remove"
										type="button"
										aria-label={`Remove ingredient ${i + 1}`}
										onclick={() => (rows = rows.filter((_, j) => j !== i))}>×</button
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<button class="link" type="button" onclick={() => (rows = [...rows, blankRow()])}>
				+ Add ingredient
			</button>
		</fieldset>

		<div class="field">
			<label for="local-concept-dose-form">Dose form</label>
			<input id="local-concept-dose-form" bind:value={doseForm} maxlength="300" />
		</div>

		<fieldset>
			<legend>Ionic content (from the label's electrolyte statement)</legend>
			{#each ionic as row, i (i)}
				<div class="ionic-row">
					<input aria-label={`Ion ${i + 1} element`} placeholder="Acetate" bind:value={row.element} maxlength="100" />
					<select aria-label={`Ion ${i + 1} comparator`} bind:value={row.comparator}>
						<option value="">=</option>
						<option value="~">about</option>
						<option value="<">&lt;</option>
					</select>
					<input
						class="mag"
						inputmode="decimal"
						aria-label={`Ion ${i + 1} mEq/L`}
						bind:value={row.mEqPerL}
					/>
					<span>mEq/L</span>
					<input
						class="source"
						aria-label={`Ion ${i + 1} source note`}
						placeholder="Source note"
						value={row.source ?? ''}
						oninput={(event) => (row.source = event.currentTarget.value)}
						maxlength="300"
					/>
					<button
						class="remove"
						type="button"
						aria-label={`Remove ion ${i + 1}`}
						onclick={() => (ionic = ionic.filter((_, j) => j !== i))}>×</button
					>
				</div>
			{/each}
			<button
				class="link"
				type="button"
				onclick={() => (ionic = [...ionic, { element: '', comparator: '', mEqPerL: '', source: null }])}
			>
				+ Add ion
			</button>
		</fieldset>

		<div class="field">
			<label for="local-concept-note">Note</label>
			<textarea id="local-concept-note" rows="2" maxlength="2000" bind:value={note}></textarea>
		</div>

		<div class="preview">
			<p><span class="muted">Name</span> {previewName || '—'}</p>
			{#if diff.length}<LocalConceptDiff {diff} />{/if}
		</div>

		<dl class="evidence">
			<dt>Evidence</dt>
			<dd>
				SPL set <span class="mono">{evidence.setId || '—'}</span>, version
				<span class="mono">{evidence.version || '—'}</span>{#if evidence.ndc}, NDC
					<span class="mono">{evidence.ndc}</span>{/if}
			</dd>
		</dl>

		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{:else if target.scd}
			<label class="supersede">
				<input type="checkbox" name="supersede" bind:checked={supersede} disabled={!canSupersede} />
				Supersede RxCUI <span class="mono">{target.scd.rxcui}</span> in this formulary
			</label>
			{#if target.blocked}<p class="hint">{target.blocked} The concept is saved without superseding.</p>{/if}
		{:else}
			<p class="hint">{target.blocked ?? 'No RxNorm SCD found.'} The concept is saved without superseding.</p>
		{/if}

		{#if message && submitted}<p class="error" role="alert">{message}</p>{/if}
		<div class="dialog-actions">
			<span class="spacer"></span>
			<button class="link" type="button" onclick={() => dialog.close()}>Cancel</button>
			<button class="save" type="submit" disabled={pending || !rows.length}>
				{editing ? 'Update local concept' : 'Save local concept'}
			</button>
		</div>
	</form>
</dialog>

<dialog bind:this={stopDialog} class="confirm">
	<form
		method="POST"
		action="?/localConceptStop"
		use:enhance={() => {
			pending = true;
			submitted = true;
			return async ({ result, update }) => {
				await update({ reset: false });
				pending = false;
				if (result.type === 'success') stopDialog.close();
			};
		}}
	>
		<h2>Stop superseding</h2>
		{#if localConcept}
			<p>
				RxNorm's concept comes back everywhere in this formulary. {localConcept.code} is kept and can
				supersede again later.
			</p>
			<input type="hidden" name="id" value={localConcept.id} />
		{/if}
		{#if message && submitted}<p class="error" role="alert">{message}</p>{/if}
		<div class="dialog-actions">
			<span class="spacer"></span>
			<button class="link" type="button" onclick={() => stopDialog.close()}>Cancel</button>
			<button class="save danger" type="submit" disabled={pending || !localConcept}>Stop superseding</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		border: 1px solid #c9d6e8;
		border-radius: 0.65rem;
		padding: 1.1rem 1.25rem;
	}

	.editor {
		width: min(56rem, calc(100vw - 2rem));
	}

	.confirm {
		width: min(28rem, calc(100vw - 2rem));
	}

	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
	}

	p {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
	}

	.hint,
	.muted {
		color: #5c6777;
	}

	.muted {
		margin-right: 0.3rem;
	}

	.warnings {
		margin: 0 0 0.75rem;
		padding: 0.4rem 0.6rem 0.4rem 1.5rem;
		border-radius: 6px;
		background: #fff6e5;
		color: #7a4d00;
		font-size: 0.82rem;
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

	.table-wrap {
		overflow-x: auto;
	}

	.rows {
		width: 100%;
		border-collapse: collapse;
	}

	.rows th {
		padding: 0.2rem 0.3rem;
		color: #5c6777;
		font-weight: 650;
		text-align: left;
	}

	.rows td {
		padding: 0.15rem 0.3rem;
		vertical-align: top;
		white-space: nowrap;
	}

	input,
	select,
	textarea {
		font: inherit;
		font-size: 0.82rem;
	}

	.name {
		width: 12rem;
	}

	.unii {
		width: 7rem;
	}

	.mag {
		width: 4.5rem;
	}

	.per {
		width: 2.5rem;
	}

	.source {
		flex: 1;
		min-width: 8rem;
	}

	.ionic-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		margin-bottom: 0.3rem;
	}

	.remove {
		padding: 0 0.4rem;
		border: 0;
		background: none;
		color: #5c6777;
		cursor: pointer;
	}

	.field {
		display: grid;
		gap: 0.3rem;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
	}

	.preview {
		margin: 0 0 0.75rem;
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		background: #f7f9fc;
	}

	.preview p {
		margin: 0 0 0.4rem;
	}

	.evidence {
		display: flex;
		gap: 0.5rem;
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
	}

	.evidence dt {
		font-weight: 650;
	}

	.evidence dd {
		margin: 0;
	}

	.supersede {
		display: block;
		margin-bottom: 0.5rem;
		font-size: 0.85rem;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
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

	.save.danger {
		background: #a4461a;
	}

	.save:disabled {
		opacity: 0.6;
	}
</style>
