<script lang="ts">
	import {
		DIMENSION_BY_KEY,
		DIMENSIONS,
		levelDimension,
		mergesChildren,
		withMerge
	} from '$lib/formulary-hierarchy';

	/** Drag-and-drop editor for a formulary hierarchy; each level nests under the one before it. */
	let { levels = $bindable() }: { levels: string[] } = $props();

	/** Levels by dimension key; a level's key may carry a merge mark. */
	const inUse = $derived(new Set(levels.map(levelDimension)));

	/** Chip being dragged, and where it came from (a hierarchy index or the palette). */
	let dragging: { key: string; from: number | null } | null = $state(null);
	let dropAt: number | null = $state(null);

	const available = $derived(
		DIMENSIONS.filter(
			(dimension) =>
				!dimension.variant?.hidden &&
				!inUse.has(dimension.key) &&
				!(dimension.variant && inUse.has(dimension.variant.key))
		)
	);

	/** Swap a chip for its variant in place, e.g. separated ↔ combined ingredients. */
	function switchVariant(level: string) {
		const variant = DIMENSION_BY_KEY.get(levelDimension(level))?.variant;
		if (variant)
			levels = levels.map((other) =>
				other === level ? withMerge(variant.key, mergesChildren(level)) : other
			);
	}

	/** Have a level's nodes absorb an only child ("IV – Thiamine"), or stop. */
	const toggleMerge = (level: string) =>
		(levels = levels.map((other) =>
			other === level ? withMerge(level, !mergesChildren(level)) : other
		));

	function place(key: string, index: number) {
		const next = levels.filter((level) => level !== key);
		const from = levels.indexOf(key);
		// Removing the chip first shifts every later slot left by one.
		next.splice(from !== -1 && from < index ? index - 1 : index, 0, key);
		levels = next;
	}

	const remove = (key: string) => (levels = levels.filter((level) => level !== key));

	function move(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= levels.length) return;
		const next = [...levels];
		[next[index], next[target]] = [next[target], next[index]];
		levels = next;
	}

	function startDrag(event: DragEvent, key: string, from: number | null) {
		dragging = { key, from };
		event.dataTransfer?.setData('text/plain', key);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function endDrag() {
		dragging = null;
		dropAt = null;
	}

	function over(event: DragEvent, index: number) {
		if (!dragging) return;
		event.preventDefault();
		dropAt = index;
	}

	/** Which gap a pointer over a chip means: before it or after it. */
	function overChip(event: DragEvent, index: number) {
		if (!dragging) return;
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		over(event, event.clientX < box.left + box.width / 2 ? index : index + 1);
	}

	function drop(event: DragEvent) {
		event.preventDefault();
		if (dragging && dropAt !== null) place(dragging.key, dropAt);
		endDrag();
	}

	function dropOnPalette(event: DragEvent) {
		event.preventDefault();
		if (dragging?.from !== null && dragging) remove(dragging.key);
		endDrag();
	}
</script>

<ol
	class="levels"
	class:dragging={!!dragging}
	ondragover={(event) => over(event, levels.length)}
	ondrop={drop}
	ondragleave={(event) => {
		if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) dropAt = null;
	}}
>
	{#each levels as key, index (levelDimension(key))}
		{@const dimension = DIMENSION_BY_KEY.get(levelDimension(key))}
		{@const merging = mergesChildren(key)}
		{#if dropAt === index}<li class="gap" aria-hidden="true"></li>{/if}
		<li
			class="chip level"
			class:lifted={dragging?.key === key}
			draggable="true"
			ondragstart={(event) => startDrag(event, key, index)}
			ondragend={endDrag}
			ondragover={(event) => {
				event.stopPropagation();
				overChip(event, index);
			}}
		>
			<span class="step">{index + 1}</span>
			<span>{dimension?.label}</span>
			{#if dimension?.variant}
				<button
					type="button"
					class="mode"
					title="Toggle separated ingredients vs combinations"
					onclick={() => switchVariant(key)}>⇄ {dimension.variant.mode}</button
				>
			{/if}
			<button
				type="button"
				class="mode merge"
				class:on={merging}
				aria-pressed={merging}
				disabled={index === levels.length - 1 && !merging}
				title={index === levels.length - 1
					? 'The last level has no children to merge'
					: merging
						? 'Merging: a node with one child reads as one row, e.g. “IV – Thiamine”'
						: 'Merge a node with its only child into one row, e.g. “IV – Thiamine”'}
				onclick={() => toggleMerge(key)}>{merging ? '⤓ Merged' : '⤓ Merge'}</button
			>
			<span class="chip-actions">
				<button
					type="button"
					class="icon"
					aria-label="Move {dimension?.label} up a level"
					disabled={index === 0}
					onclick={() => move(index, -1)}>←</button
				>
				<button
					type="button"
					class="icon"
					aria-label="Move {dimension?.label} down a level"
					disabled={index === levels.length - 1}
					onclick={() => move(index, 1)}>→</button
				>
				<button
					type="button"
					class="icon"
					aria-label="Remove {dimension?.label}"
					onclick={() => remove(key)}>×</button
				>
			</span>
		</li>
	{/each}
	{#if dropAt === levels.length}<li class="gap" aria-hidden="true"></li>{/if}
	<li class="leaf-level">NDCs</li>
</ol>

<div
	class="palette"
	role="group"
	aria-label="Available attributes"
	ondragover={(event) => dragging?.from !== null && dragging && event.preventDefault()}
	ondrop={dropOnPalette}
>
	{#each available as dimension (dimension.key)}
		<button
			type="button"
			class="chip"
			draggable="true"
			title={dimension.hint}
			ondragstart={(event) => startDrag(event, dimension.key, null)}
			ondragend={endDrag}
			onclick={() => place(dimension.key, levels.length)}
		>
			<span aria-hidden="true">+</span>
			{dimension.label}
		</button>
	{:else}
		<p class="small">Every attribute is in use.</p>
	{/each}
</div>

<style>
	button {
		border: 0;
		border-radius: 0.55rem;
		background: #204f91;
		color: white;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.levels {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		min-height: 3rem;
		margin: 1rem 0;
		padding: 0.75rem;
		border: 2px dashed #dbe1e8;
		border-radius: 0.75rem;
		list-style: none;
		background: #fbfcfd;
	}

	.levels.dragging {
		border-color: #8fb3e6;
		background: #f2f7fe;
	}

	.chip {
		display: inline-flex;
		flex-wrap: wrap;
		max-width: 100%;
		box-sizing: border-box;
		align-items: center;
		gap: 0.4rem;
		border: 1px solid #cdd6e1;
		border-radius: 999px;
		background: white;
		color: #18212f;
		padding: 0.35rem 0.75rem;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: grab;
		user-select: none;
	}

	.chip.level {
		border-color: #3464a5;
		background: #e8f0fb;
		padding-right: 0.3rem;
	}

	.chip.lifted {
		opacity: 0.4;
	}

	.step {
		display: inline-grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: #204f91;
		color: white;
		font-size: 0.7rem;
	}

	.mode {
		font-size: 0.75rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
	}

	.mode.merge {
		background: white;
		color: #3464a5;
		box-shadow: inset 0 0 0 1px #8fb3e6;
	}

	.mode.merge.on {
		background: #204f91;
		color: white;
		box-shadow: none;
	}

	.chip-actions {
		display: inline-flex;
	}

	.icon {
		background: none;
		color: #3464a5;
		padding: 0.1rem 0.35rem;
		font-size: 0.9rem;
	}

	.gap {
		width: 0.3rem;
		height: 1.9rem;
		border-radius: 1rem;
		background: #3464a5;
	}

	.leaf-level {
		color: #7a8594;
		font-size: 0.8rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.leaf-level::before {
		content: '› ';
	}

	.palette {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.palette .chip {
		color: #3464a5;
	}

	.small {
		color: #7a8594;
		font-size: 0.85rem;
	}
</style>
