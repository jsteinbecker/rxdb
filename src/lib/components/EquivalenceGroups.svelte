<!--
@component
Settings editor for equivalence groups: sets of a dimension's values (e.g. dose form
spellings) merged and shown under one name. Suggests likely groups from the
formulary's values, and edits, saves and deletes groups.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { SvelteSet } from 'svelte/reactivity';
	import { DIMENSIONS } from "$lib/formulary/hierarchy";
	import {
		equivalenceKey,
		equivalenceWords,
		memberMatches,
		preferredDisplay,
		relatedValues,
		similarity,
		suggestGroups,
		type EquivalenceGroup,
		type Suggestion,
		type ValueCount
	} from "$lib/formulary/equivalence";

	/** Settings editor for equivalence groups: sibling values the hierarchy shows as one node. */
	let {
		groups,
		values,
		message = null,
		savedGroup = null
	}: {
		/** The saved groups. */
		groups: EquivalenceGroup[];
		/** Each dimension's current values across the formulary. */
		values: Record<string, ValueCount[]>;
		/** An error from the last save or delete. */
		message?: string | null;
		/** The name of the group just saved, for a confirmation notice. */
		savedGroup?: string | null;
	} = $props();

	const DIMENSION_ORDER = [
		'doseForm',
		'routeForm',
		'route',
		'ingredient',
		'ingredientCombo',
		'labeler',
		'brand',
		'packageSize',
		'strength'
	];
	const dimensions = [...DIMENSIONS].sort(
		(a, b) =>
			(DIMENSION_ORDER.indexOf(a.key) + 1 || 99) - (DIMENSION_ORDER.indexOf(b.key) + 1 || 99)
	);
	const dimensionName = (key: string) => {
		const dimension = DIMENSIONS.find((item) => item.key === key);
		if (!dimension) return key;
		return dimension.variant
			? `${dimension.label} (${dimension.variant.hidden ? 'combinations' : 'separated'})`
			: dimension.label;
	};

	let dimension = $state('doseForm');
	const current = $derived(values[dimension] ?? []);
	const here = $derived(
		groups
			.map((group, index) => ({ group, index }))
			.filter(({ group }) => group.dimension === dimension)
	);

	// ── Suggestions ──
	const dismissed = new SvelteSet<string>();
	const suggestionId = (suggestion: Suggestion) =>
		`${dimension}:${suggestion.members.map((member) => member.label).join('|')}`;
	const suggestions = $derived(
		suggestGroups(
			current,
			here.map(({ group }) => group)
		).filter((suggestion) => !dismissed.has(suggestionId(suggestion)))
	);
	let showAllSuggestions = $state(false);

	// ── Editor ──
	type Draft = { index: number | null; members: string[]; display: string; displayChosen: boolean };
	let draft = $state<Draft | null>(null);
	let query = $state('');
	let pattern = $state('');
	let saving = $state(false);

	function open(next: Partial<Draft> & { members: string[] }) {
		draft = { index: null, display: '', displayChosen: false, ...next };
		query = '';
		pattern = '';
	}

	function edit(group: EquivalenceGroup, index: number) {
		open({ index, members: [...group.members], display: group.display, displayChosen: true });
	}

	function fromSuggestion(suggestion: Suggestion) {
		open({
			members: suggestion.members.map((member) => member.label),
			display: suggestion.display
		});
	}

	/** Add a value unless one spelled the same way is already a member. */
	function add(label: string) {
		if (!draft) return;
		const key = equivalenceKey(label);
		if (draft.members.some((member) => !member.includes('*') && equivalenceKey(member) === key))
			return;
		draft.members = [...draft.members, label];
		query = '';
	}

	const removeMember = (member: string) => {
		if (!draft) return;
		draft.members = draft.members.filter((other) => other !== member);
		if (draft.display === member && draft.displayChosen) draft.displayChosen = false;
	};

	/** Every current value the draft would merge: its members, their other spellings and its patterns. */
	const captured = $derived(
		draft
			? current.filter((value) =>
					[...draft!.members, ...(draft!.displayChosen ? [draft!.display] : [])].some((member) =>
						memberMatches(member, value.label)
					)
				)
			: []
	);
	const capturedCount = $derived(captured.reduce((sum, value) => sum + value.count, 0));

	/** Until a display is picked, the most readable, most common value captured. */
	const display = $derived(
		draft
			? draft.displayChosen
				? draft.display
				: (preferredDisplay(captured) ?? draft.members[0] ?? '')
			: ''
	);

	/** Captured values another group of this dimension already claims; the earlier group wins. */
	const conflicts = $derived(
		draft
			? captured.filter((value) =>
					here.some(
						({ group, index }) =>
							index !== draft!.index &&
							[group.display, ...group.members].some((member) => memberMatches(member, value.label))
					)
				)
			: []
	);

	const related = $derived(
		draft
			? relatedValues(draft.members, current).filter(
					(value) => !captured.some((other) => other.label === value.label)
				)
			: []
	);

	/** Values matching what is typed: every word a prefix of one of theirs, or a close spelling. */
	const results = $derived.by(() => {
		const words = equivalenceWords(query.replace(/\*/g, ' '));
		if (!draft || !words.length) return [];
		return current
			.filter((value) => !captured.some((other) => other.label === value.label))
			.map((value) => {
				const theirs = equivalenceWords(value.label);
				const prefix = words.every((word) => theirs.some((their) => their.startsWith(word)));
				return {
					...value,
					score: prefix ? 1 + similarity(query, value.label) : similarity(query, value.label)
				};
			})
			.filter((value) => value.score >= 0.6)
			.sort((a, b) => b.score - a.score || b.count - a.count)
			.slice(0, 8);
	});

	const patternMatches = $derived(
		pattern.includes('*') ? current.filter((value) => memberMatches(pattern, value.label)) : []
	);

	function addPattern() {
		if (!draft || !pattern.includes('*')) return;
		if (!draft.members.includes(pattern.trim())) draft.members = [...draft.members, pattern.trim()];
		pattern = '';
	}

	const groupPayload = $derived(
		draft ? JSON.stringify({ dimension, display: display.trim(), members: draft.members }) : ''
	);

	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
	const countOf = (label: string) => current.find((value) => value.label === label)?.count;
</script>

<div class="groups">
	<label class="field">
		<span>Attribute</span>
		<select
			bind:value={dimension}
			onchange={() => {
				draft = null;
				showAllSuggestions = false;
			}}
		>
			{#each dimensions as item (item.key)}
				{@const count = groups.filter((group) => group.dimension === item.key).length}
				<option value={item.key}
					>{dimensionName(item.key)}{count ? ` · ${plural(count, 'group')}` : ''}</option
				>
			{/each}
		</select>
	</label>

	{#if here.length}
		<ul class="list">
			{#each here as { group, index } (index)}
				<li>
					<span class="desc">
						<span class="display">{group.display}</span>
						<span class="badge">Shown</span>
						<span class="members">
							{#each group.members.filter((member) => member !== group.display) as member (member)}
								<span class="chip" class:pattern={member.includes('*')}>{member}</span>
							{/each}
						</span>
					</span>
					<button type="button" class="ghost" onclick={() => edit(group, index)}>Edit</button>
					<form
						method="POST"
						action="?/deleteGroup"
						use:enhance={() =>
							async ({ update }) => {
								await update({ reset: false });
								if (draft?.index === index) draft = null;
							}}
					>
						<input type="hidden" name="index" value={index} />
						<button class="icon" aria-label="Delete group {group.display}">×</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">No groups for {dimensionName(dimension).toLowerCase()} yet.</p>
	{/if}

	{#if suggestions.length && !draft}
		<div class="suggestions">
			<h4>Suggested from your formulary</h4>
			<ul>
				{#each showAllSuggestions ? suggestions : suggestions.slice(0, 4) as suggestion (suggestionId(suggestion))}
					<li>
						<span class="kind" class:similar={suggestion.kind === 'similar'}
							>{suggestion.kind === 'formatting' ? 'Same text' : 'Similar'}</span
						>
						<span class="desc">
							{#each suggestion.members as member, at (member.label)}{#if at}<span class="sep"
										>,</span
									>{/if}
								<span class:shown={member.label === suggestion.display}>{member.label}</span><span
									class="n">{member.count}</span
								>{/each}
						</span>
						<button type="button" class="ghost" onclick={() => fromSuggestion(suggestion)}
							>Review</button
						>
						<button
							type="button"
							class="icon"
							aria-label="Dismiss suggestion"
							onclick={() => dismissed.add(suggestionId(suggestion))}>×</button
						>
					</li>
				{/each}
			</ul>
			{#if suggestions.length > 4}
				<button
					type="button"
					class="link"
					onclick={() => (showAllSuggestions = !showAllSuggestions)}
				>
					{showAllSuggestions ? 'Fewer' : `All ${suggestions.length} suggestions`}
				</button>
			{/if}
		</div>
	{/if}

	{#if !draft}
		<button
			type="button"
			class="ghost"
			onclick={() => open({ members: [] })}
			disabled={!current.length}>New group</button
		>
		{#if !current.length}<span class="small">No values in the formulary for this attribute.</span
			>{/if}
	{:else}
		<form
			class="editor"
			method="POST"
			action="?/saveGroup"
			use:enhance={() => {
				saving = true;
				return async ({ result, update }) => {
					await update({ reset: false });
					saving = false;
					if (result.type === 'success') draft = null;
				};
			}}
		>
			<h4>{draft.index === null ? 'New group' : `Editing “${display}”`}</h4>
			<input type="hidden" name="group" value={groupPayload} />
			{#if draft.index !== null}<input type="hidden" name="index" value={draft.index} />{/if}

			<div class="search">
				<input
					placeholder="Find values to merge — e.g. “film coat”"
					bind:value={query}
					aria-label="Find values"
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							if (results[0]) add(results[0].label);
						}
					}}
				/>
				{#if results.length}
					<ul class="results" role="listbox">
						{#each results as value (value.label)}
							<li>
								<button type="button" onclick={() => add(value.label)}>
									+ {value.label}<span class="n">{value.count}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if query.trim()}
					<p class="small">No values match “{query}”.</p>
				{/if}
			</div>

			<fieldset>
				<legend>Merged values · shown as</legend>
				{#if !draft.members.length}
					<p class="small">Search above, or pick from related values below.</p>
				{/if}
				<ul class="members-edit">
					{#each draft.members as member (member)}
						{@const isPattern = member.includes('*')}
						<li>
							{#if isPattern}
								<span class="chip pattern" title="Pattern: * stands for any words">{member}</span>
								<span class="small"
									>{plural(
										current.filter((value) => memberMatches(member, value.label)).length,
										'value'
									)}</span
								>
							{:else}
								<label class="radio">
									<input
										type="radio"
										name="display-choice"
										checked={display === member}
										onchange={() => {
											draft!.display = member;
											draft!.displayChosen = true;
										}}
									/>
									{member}
									{#if countOf(member) !== undefined}<span class="n">{countOf(member)}</span>{/if}
									{#if display === member}<span class="badge">Default</span>{/if}
								</label>
							{/if}
							<button
								type="button"
								class="icon"
								aria-label="Remove {member}"
								onclick={() => removeMember(member)}>×</button
							>
						</li>
					{/each}
					{#each captured.filter((value) => !draft!.members.includes(value.label)) as value (value.label)}
						<li class="auto">
							<label class="radio">
								<input
									type="radio"
									name="display-choice"
									checked={display === value.label}
									onchange={() => {
										draft!.display = value.label;
										draft!.displayChosen = true;
									}}
								/>
								{value.label}<span class="n">{value.count}</span>
								{#if display === value.label}<span class="badge">Default</span>{/if}
							</label>
							<span class="small">matched automatically</span>
						</li>
					{/each}
				</ul>
				<label class="custom">
					<span>Custom label</span>
					<input
						value={draft.displayChosen &&
						!captured.some((value) => value.label === draft!.display) &&
						!draft.members.includes(draft.display)
							? draft.display
							: ''}
						placeholder={display || 'Shown at the merged node'}
						oninput={(event) => {
							const text = event.currentTarget.value;
							draft!.display = text;
							draft!.displayChosen = Boolean(text.trim());
						}}
					/>
				</label>
			</fieldset>

			{#if related.length}
				<div class="related">
					<span class="small">Related values</span>
					{#each related as value (value.label)}
						<button
							type="button"
							class="chip add"
							title="{Math.round(value.score * 100)}% alike"
							onclick={() => add(value.label)}
							>+ {value.label}<span class="n">{value.count}</span></button
						>
					{/each}
				</div>
			{/if}

			<div class="pattern-row">
				<label class="field grow">
					<span
						>Pattern <span class="small"
							>— <code>*</code> stands for any words, e.g. <code>tablet * coated</code>; case,
							punctuation, plurals and abbreviations don't matter</span
						></span
					>
					<input
						bind:value={pattern}
						placeholder="tablet * coated"
						onkeydown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								addPattern();
							}
						}}
					/>
				</label>
				<button type="button" class="ghost" disabled={!pattern.includes('*')} onclick={addPattern}
					>Add pattern</button
				>
			</div>
			{#if patternMatches.length}
				<p class="small">
					Matches {patternMatches.map((value) => value.label).join(', ')}
				</p>
			{:else if pattern.includes('*')}
				<p class="small">Matches nothing in the formulary yet.</p>
			{/if}

			{#if conflicts.length}
				<p class="notice warn">
					{conflicts.map((value) => value.label).join(', ')}
					{conflicts.length === 1 ? 'is' : 'are'} already in another group; the group listed first wins.
				</p>
			{/if}

			<p class="summary">
				{#if captured.length > 1}
					Merges {plural(captured.length, 'value')} ({plural(capturedCount, 'package')}) into
					<strong>{display}</strong>.
				{:else}
					Pick at least two values, or one value and a pattern, to merge.
				{/if}
			</p>

			{#if message}<p class="notice error" role="alert">{message}</p>{/if}
			<div class="row">
				<button class="primary" disabled={saving || !display.trim() || !draft.members.length}>
					{saving ? 'Saving…' : draft.index === null ? 'Save group' : 'Update group'}
				</button>
				<button type="button" class="ghost" onclick={() => (draft = null)}>Cancel</button>
			</div>
		</form>
	{/if}
	{#if savedGroup && !draft}<p class="notice" role="status">Saved “{savedGroup}”.</p>{/if}
</div>

<style>
	.groups {
		display: grid;
		gap: 0.85rem;
		justify-items: start;
	}

	.groups > * {
		justify-self: stretch;
	}

	.groups > button {
		justify-self: start;
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
	input:not([type='radio']) {
		border: 1px solid #b9c3d0;
		border-radius: 0.55rem;
		padding: 0.5rem 0.75rem;
		font: inherit;
		background: white;
		min-width: 0;
	}

	h4 {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li,
	.suggestions li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0;
		border-bottom: 1px solid #e3e8ee;
	}

	.list form {
		margin: 0;
	}

	.desc {
		flex: 1;
		min-width: 0;
		font-size: 0.9rem;
	}

	.display {
		font-weight: 650;
	}

	.members {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.3rem;
	}

	.chip {
		border: 1px solid #d5dce5;
		border-radius: 999px;
		padding: 0.1rem 0.55rem;
		background: #f6f8fa;
		font-size: 0.8rem;
	}

	.chip.pattern {
		font-family: ui-monospace, monospace;
		background: #fff8e6;
		border-color: #ecd9a6;
	}

	.chip.add {
		cursor: pointer;
		font-weight: 500;
	}

	.chip.add:hover {
		background: #e8f0fb;
		border-color: #a9c1e6;
	}

	.badge {
		margin-left: 0.35rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: #e8f0fb;
		color: #204f91;
		font-size: 0.72rem;
		font-weight: 650;
	}

	.n {
		margin-left: 0.3rem;
		color: #7a8594;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}

	.suggestions {
		border: 1px dashed #c9d4e2;
		border-radius: 0.6rem;
		padding: 0.75rem 0.9rem;
		background: #fbfcfe;
	}

	.suggestions li:last-child {
		border-bottom: 0;
	}

	.kind {
		flex: none;
		padding: 0.05rem 0.45rem;
		border-radius: 0.3rem;
		background: #e9f6ee;
		color: #1f6b3a;
		font-size: 0.72rem;
		font-weight: 650;
	}

	.kind.similar {
		background: #fff3dc;
		color: #8a5a00;
	}

	.shown {
		font-weight: 650;
	}

	.sep {
		margin-right: 0.25rem;
		color: #7a8594;
	}

	.editor {
		display: grid;
		gap: 0.85rem;
		border: 1px solid #c9d4e2;
		border-radius: 0.6rem;
		padding: 1rem;
	}

	.search {
		display: grid;
		gap: 0.35rem;
	}

	.results {
		border: 1px solid #e3e8ee;
		border-radius: 0.5rem;
	}

	.results button {
		width: 100%;
		border: 0;
		border-radius: 0;
		background: none;
		text-align: left;
		font-weight: 500;
		padding: 0.4rem 0.7rem;
	}

	.results li + li {
		border-top: 1px solid #eef1f5;
	}

	.results button:hover,
	.results li:first-child button {
		background: #f2f6fc;
	}

	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
	}

	legend {
		margin-bottom: 0.35rem;
		font-size: 0.85rem;
		font-weight: 650;
	}

	.members-edit li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0;
	}

	.members-edit li.auto {
		opacity: 0.85;
	}

	.radio {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex: 1;
		min-width: 0;
		font-size: 0.9rem;
	}

	.custom {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
		font-size: 0.85rem;
	}

	.custom input {
		flex: 1;
	}

	.related {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.pattern-row {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.grow {
		flex: 1;
	}

	code {
		font-size: 0.85em;
	}

	.summary {
		margin: 0;
		font-size: 0.9rem;
		color: #3a4452;
	}

	.small {
		color: #7a8594;
		font-size: 0.75rem;
	}

	p.small {
		margin: 0;
	}

	.empty {
		margin: 0;
		color: #5c6777;
		font-size: 0.9rem;
	}

	.row {
		display: flex;
		gap: 0.5rem;
	}

	button {
		border-radius: 0.55rem;
		padding: 0.4rem 0.75rem;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 650;
		cursor: pointer;
	}

	button.icon {
		border: 1px solid #d5dce5;
		background: white;
		padding: 0.2rem 0.5rem;
	}

	button.ghost {
		border: 1px solid #d5dce5;
		background: white;
		color: #3a4452;
	}

	button.link {
		border: 0;
		background: none;
		color: #2a5ea8;
		padding: 0.25rem 0;
	}

	button.primary {
		border: 1px solid #204f91;
		background: #2a5ea8;
		color: white;
		padding: 0.55rem 1rem;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.notice {
		margin: 0;
		border-radius: 0.55rem;
		background: #e9f6ee;
		color: #1f6b3a;
		padding: 0.55rem 0.8rem;
		font-size: 0.85rem;
	}

	.notice.error {
		background: #fdecec;
		color: #9a2a2a;
	}

	.notice.warn {
		background: #fff3dc;
		color: #8a5a00;
	}
</style>
