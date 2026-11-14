<!--
@component
Editor for a formulary hierarchy, drawn as the outline it produces: each level is indented
under the one before it and the packages sit at the bottom. Levels are added from a list of
attributes, reordered with the arrows (or by dragging), switched to a variant (e.g.
separated ↔ combined ingredients), or set to absorb an only child.
-->
<script lang="ts">
	import {
		DIMENSION_BY_KEY,
		DIMENSIONS,
		levelDimension,
		mergesChildren,
		withMerge
	} from '#lib/formulary/hierarchy.ts';

	let {
		levels = $bindable()
	}: {
		/** Level keys, outermost first; bound back as the hierarchy is edited. */
		levels: string[];
	} = $props();

	/** Levels by dimension key; a level's key may carry a merge mark. */
	const inUse = $derived(new Set(levels.map(levelDimension)));

	const available = $derived(
		DIMENSIONS.filter(
			(dimension) =>
				!dimension.variant?.hidden &&
				!inUse.has(dimension.key) &&
				!(dimension.variant && inUse.has(dimension.variant.key))
		)
	);

	/** Index of the level being dragged, and the gap it would land in. */
	let dragging: number | null = $state(null);
	let dropAt: number | null = $state(null);

	/** Swap a level for its variant in place, e.g. separated ↔ combined ingredients. */
	function setVariant(level: string, key: string) {
		levels = levels.map((other) => (other === level ? withMerge(key, mergesChildren(level)) : other));
	}

	/** Have a level's nodes absorb an only child ("IV – Thiamine"), or stop. */
	const toggleMerge = (level: string) =>
		(levels = levels.map((other) =>
			other === level ? withMerge(level, !mergesChildren(level)) : other
		));

	const add = (key: string) => (levels = [...levels, key]);
	const remove = (index: number) => (levels = levels.filter((_, other) => other !== index));

	function move(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= levels.length) return;
		const next = [...levels];
		[next[index], next[target]] = [next[target], next[index]];
		levels = next;
	}

	function overRow(event: DragEvent, index: number) {
		if (dragging === null) return;
		event.preventDefault();
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		dropAt = event.clientY < box.top + box.height / 2 ? index : index + 1;
	}

	function drop(event: DragEvent) {
		event.preventDefault();
		if (dragging !== null && dropAt !== null) {
			const next = [...levels];
			const [moved] = next.splice(dragging, 1);
			// Removing the row first shifts every later slot up by one.
			next.splice(dropAt > dragging ? dropAt - 1 : dropAt, 0, moved);
			levels = next;
		}
		dragging = dropAt = null;
	}

	/** The variants a level can switch between, itself included. */
	function variantsOf(key: string) {
		const dimension = DIMENSION_BY_KEY.get(key);
		if (!dimension?.variant) return [];
		const other = DIMENSION_BY_KEY.get(dimension.variant.key)!;
		return [dimension, other].map((d) => ({ key: d.key, mode: d.variant!.mode }));
	}
</script>

<ol class="outline" ondrop={drop} ondragover={(event) => dragging !== null && event.preventDefault()}>
	{#each levels as level, index (levelDimension(level))}
		{@const key = levelDimension(level)}
		{@const dimension = DIMENSION_BY_KEY.get(key)}
		{@const merging = mergesChildren(level)}
		{@const last = index === levels.length - 1}
		<li
			class="level"
			class:lifted={dragging === index}
			class:drop-before={dropAt === index && dragging !== null}
			class:drop-after={dropAt === index + 1 && last && dragging !== null}
			style:--depth={index}
			draggable="true"
			ondragstart={(event) => {
				dragging = index;
				event.dataTransfer?.setData('text/plain', level);
			}}
			ondragend={() => (dragging = dropAt = null)}
			ondragover={(event) => overRow(event, index)}
		>
			<span class="grip" aria-hidden="true">⋮⋮</span>
			<span class="step">{index + 1}</span>
			<span class="name">
				{dimension?.label}
				<span class="example">{dimension?.hint}</span>
			</span>

			{#if variantsOf(key).length}
				<select
					aria-label="How {dimension?.label} splits"
					value={key}
					onchange={(event) => setVariant(level, event.currentTarget.value)}
				>
					{#each variantsOf(key) as option (option.key)}
						<option value={option.key}>{option.mode}</option>
					{/each}
				</select>
			{/if}

			<label
				class="merge"
				title="When a group holds just one item, show both on a single row, e.g. “IV – Thiamine”"
			>
				<input
					type="checkbox"
					checked={merging}
					disabled={last && !merging}
					onchange={() => toggleMerge(level)}
				/>
				Merge
			</label>

			<span class="actions">
				<button
					type="button"
					aria-label="Move {dimension?.label} up"
					disabled={index === 0}
					onclick={() => move(index, -1)}>↑</button
				>
				<button
					type="button"
					aria-label="Move {dimension?.label} down"
					disabled={last}
					onclick={() => move(index, 1)}>↓</button
				>
				<button
					type="button"
					class="remove"
					aria-label="Remove {dimension?.label}"
					onclick={() => remove(index)}>✕</button
				>
			</span>
		</li>
	{/each}
	<li class="leaf" style:--depth={levels.length}>
		Packages (NDCs)
		{#if !levels.length}<span class="example">No levels — the formulary is a flat list</span>{/if}
	</li>
</ol>

<div class="add">
	<span class="add-label">Add a level</span>
	<div class="palette">
		{#each available as dimension (dimension.key)}
			<button type="button" class="chip" title={dimension.hint} onclick={() => add(dimension.key)}>
				+ {dimension.label}
			</button>
		{:else}
			<span class="example">Every attribute is in use.</span>
		{/each}
	</div>
</div>

<style>
	.outline {
		margin: 0.75rem 0;
		padding: 0;
		list-style: none;
	}

	.level,
	.leaf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-left: calc(min(var(--depth), 6) * 0.9rem);
		margin-bottom: 0.35rem;
	}

	.level {
		flex-wrap: nowrap;
		position: relative;
		padding: 0.45rem 0.5rem;
		border: 1px solid #cdd6e1;
		border-radius: 0.6rem;
		background: white;
		cursor: grab;
	}

	.level:hover {
		border-color: #8fb3e6;
	}

	.level.lifted {
		opacity: 0.4;
	}

	.level.drop-before {
		box-shadow: 0 -3px 0 #3464a5;
	}

	.level.drop-after {
		box-shadow: 0 3px 0 #3464a5;
	}

	.grip {
		color: #a9b3c0;
		font-size: 0.8rem;
		letter-spacing: -0.15em;
	}

	.step {
		display: inline-grid;
		flex: none;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		background: #204f91;
		color: white;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.name {
		flex: 1;
		min-width: 0;
		font-weight: 650;
	}

	.name .example {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.example {
		display: block;
		color: #7a8594;
		font-size: 0.75rem;
		font-weight: 400;
	}

	select {
		border: 1px solid #cdd6e1;
		border-radius: 0.45rem;
		padding: 0.25rem 0.4rem;
		font: inherit;
		font-size: 0.8rem;
	}

	.merge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: #3a4452;
		font-size: 0.8rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.actions {
		display: inline-flex;
		gap: 0.15rem;
	}

	.actions button {
		border: 1px solid #d5dce5;
		border-radius: 0.4rem;
		background: white;
		color: #3464a5;
		padding: 0.15rem 0.45rem;
		font: inherit;
		cursor: pointer;
	}

	.actions button:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.actions .remove {
		color: #9a2a2a;
	}

	.leaf {
		padding: 0.35rem 0.5rem;
		color: #7a8594;
		font-size: 0.8rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.leaf .example {
		text-transform: none;
		letter-spacing: 0;
	}

	.add {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
	}

	.add-label {
		color: #3a4452;
		font-size: 0.85rem;
		font-weight: 650;
	}

	.palette {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		border: 1px dashed #8fb3e6;
		border-radius: 999px;
		background: #f2f7fe;
		color: #204f91;
		padding: 0.3rem 0.7rem;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 650;
		cursor: pointer;
	}

	.chip:hover {
		border-style: solid;
	}
</style>
