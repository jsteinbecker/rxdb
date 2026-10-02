<script lang="ts">
      import {page} from '$app/state';
      import {untrack} from 'svelte';
      import {afterNavigate, replaceState} from '$app/navigation';
      import {resolve} from '$app/paths';
      import {SvelteSet} from 'svelte/reactivity';
      import {
            buildTree,
            type ComboDoseDisplay,
            comboKey,
            DIMENSION_BY_KEY,
            DIMENSIONS,
            type FormularyRow,
            packageSize,
            parseLevels,
            strengthOf,
            summedDescription,
            type TreeNode
      } from '$lib/formulary-hierarchy';

      let { data } = $props();

	// Restore the tree as it was when returning from an NDC's detail page.
	export const snapshot = {
		capture: () => ({ expanded: [...expanded], filter }),
		restore: (value: { expanded: string[]; filter: string }) => {
			expanded.clear();
			for (const id of value.expanded) expanded.add(id);
			filter = value.filter;
		}
	};

	const PRESETS: { label: string; levels: string[] }[] = [
		{
			label: 'Route → form → item',
			levels: ['routeClass', 'routeForm', 'formularyItem', 'packaging']
		},
		{
			label: 'Ingredient → strength → size',
			levels: ['ingredient', 'doseForm', 'strength', 'packageSize']
		},
		{ label: 'Labeler → item', levels: ['labeler', 'formularyItem'] },
		{ label: 'Flat list', levels: [] }
	];

	let levels = $state(
		parseLevels(
			page.url.searchParams.get('levels'),
			untrack(() => data.settings.defaultLevels)
		)
	);
	let filter = $state('');
	/** Chip being dragged, and where it came from (a hierarchy index or the palette). */
	let dragging: { key: string; from: number | null } | null = $state(null);
	let dropAt: number | null = $state(null);
	const expanded = new SvelteSet<string>();

	const available = $derived(
		DIMENSIONS.filter(
			(dimension) =>
				!dimension.variant?.hidden &&
				!levels.includes(dimension.key) &&
				!(dimension.variant && levels.includes(dimension.variant.key))
		)
	);

	/** Swap a chip for its variant in place, e.g. separated ↔ combined ingredients. */
	function switchVariant(key: string) {
		const variant = DIMENSION_BY_KEY.get(key)?.variant;
		if (variant) levels = levels.map((level) => (level === key ? variant.key : level));
	}

	/** Dose display per combination, updated optimistically and saved to the scope. */
	let comboDoseDisplay: Record<string, ComboDoseDisplay> = $state(
		untrack(() => ({ ...data.settings.comboDoseDisplay }))
	);

	const displayedRows = $derived(
		data.rows.map((row: FormularyRow) => {
			const key = comboKey(row);
			return key && comboDoseDisplay[key] ? { ...row, doseDisplay: comboDoseDisplay[key] } : row;
		})
	);

	let saveError: string | null = $state(null);

	/** Tree node whose options menu is open; one at a time. */
	let menuFor: string | null = $state(null);

	const nodeRows = (node: TreeNode): FormularyRow[] => [
		...node.rows,
		...node.children.flatMap(nodeRows)
	];
	/** The one formulary item a node stands for, when its rows all come from one load. */
	const nodeItemId = (node: TreeNode) => {
		const ids = new Set(nodeRows(node).map((row) => row.formularyItemId));
		return ids.size === 1 ? [...ids][0] : null;
	};

	const firstRow = (node: TreeNode): FormularyRow | undefined =>
		node.rows[0] ?? (node.children[0] && firstRow(node.children[0]));

	const doseChoice = (combo: string) => {
		const display = comboDoseDisplay[combo];
		return !display ? 'each' : display.mode === 'sum' ? 'sum' : `single:${display.ingredient}`;
	};

	async function setComboDose(combo: string, choice: string) {
		const previous = comboDoseDisplay[combo];
		const [mode, ingredient] = choice.split(/:(.*)/);
		const rest = { ...comboDoseDisplay };
		delete rest[combo];
		comboDoseDisplay =
			mode === 'sum'
				? { ...rest, [combo]: { mode: 'sum' } }
				: mode === 'single'
					? { ...rest, [combo]: { mode: 'single', ingredient } }
					: rest;
		const body = new FormData();
		body.set('combo', combo);
		body.set('mode', mode);
		if (ingredient) body.set('ingredient', ingredient);
		const response = await fetch('?/comboDose', {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => null);
		const result = response && (await response.json().catch(() => null));
		if (result?.type !== 'success') {
			comboDoseDisplay = previous ? { ...rest, [combo]: previous } : rest;
			saveError = `Couldn't save the dose display for ${combo}. Try again.`;
		} else saveError = null;
	}

	const rows = $derived.by(() => {
		const term = filter.trim().toLowerCase();
		if (!term) return displayedRows;
		return displayedRows.filter((row: FormularyRow) =>
			[row.ndc, row.formularyItem, row.description, row.brandName, row.genericName, row.labeler]
				.concat(row.ingredients.map((item) => item.name))
				.some((value) => value?.toLowerCase().includes(term))
		);
	});

	const tree = $derived(buildTree(rows, levels));

	/** How many open levels sit beneath each open node. On narrow screens the tree
	 * doesn't indent, so ancestors shrink and fade by this much to read as further away. */
	const recede = $derived.by(() => {
		const depths = new Map<string, number>();
		const measure = (node: TreeNode): number => {
			const below = expanded.has(node.id) ? 1 + Math.max(0, ...node.children.map(measure)) : 0;
			depths.set(node.id, below);
			return below;
		};
		tree.forEach(measure);
		return depths;
	});
	// Enriched catalog facts can refresh while this page is cached in the router.
	// Keep open branches only while their actual node still exists in the tree.
	$effect(() => {
		const liveIds = new SvelteSet<string>();
		walk(tree, (node) => liveIds.add(node.id));
		for (const id of expanded) if (!liveIds.has(id)) expanded.delete(id);
	});

	// Keep the hierarchy in the URL so a layout can be bookmarked or shared. The
	// router is not ready until the first navigation completes, so wait for it.
	let mounted = $state(false);
	afterNavigate(() => (mounted = true));
	$effect(() => {
		if (!mounted) return;
		const url = new URL(page.url);
		url.searchParams.set('levels', levels.join(','));
		if (url.search !== page.url.search) replaceState(resolve(`/formulary?${url.searchParams}`), {});
	});

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

	function walk(nodes: TreeNode[], visit: (node: TreeNode) => void) {
		for (const node of nodes) {
			visit(node);
			walk(node.children, visit);
		}
	}

	function expandAll() {
		walk(tree, (node) => expanded.add(node.id));
	}

	// Open the tree to the depth chosen in Settings. Done once at setup, so the
	// server renders it open too; later hierarchy changes start collapsed.
	untrack(() => {
		if (data.settings.expandDepth === 'all') expandAll();
		else if (data.settings.expandDepth === 'first') for (const node of tree) expanded.add(node.id);
	});

	function toggle(id: string) {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}

	const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
</script>

<svelte:window
	onclick={(event) => {
		if (menuFor && !(event.target as Element).closest('.row-menu')) menuFor = null;
	}}
	onkeydown={(event) => event.key === 'Escape' && (menuFor = null)}
/>

<svelte:head>
	<title>Formulary · RxDB</title>
</svelte:head>

{#snippet summedText(text: string, display: ComboDoseDisplay | undefined)}
	{@const summed = summedDescription(text, display)}
	{#if summed}
		<span class="paren">(</span>{summed.names}<span class="paren">)</span>
		{summed.strength}
		{summed.rest}
	{:else}
		{text}
	{/if}
{/snippet}

{#snippet packageList(items: FormularyRow[])}
	<ul class="packages">
		{#each items as row (`${row.formularyItemId}:${row.packageId}`)}
			<li class:excluded={row.status !== 'active'}>
				<a class="package" href={resolve('/formulary/ndc/[ndc]', { ndc: row.ndc })}>
					<span class="mono ndc">{formatNdc(row.ndc)}</span>
					<span class="desc">
						{@render summedText(
							row.displayTitle ?? row.description ?? row.formularyItem,
							row.doseDisplay
						)}
						<span class="small">
							{[row.brandName, strengthOf(row), packageSize(row), row.labeler]
								.filter(Boolean)
								.join(' · ')}
						</span>
					</span>
					{#if row.status !== 'active'}<span class="flag">{row.status}</span>{/if}
					<span class="chevron" aria-hidden="true">›</span>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet branch(nodes: TreeNode[], depth: number)}
	<ul class="tree" role={depth ? 'group' : 'tree'}>
		{#each nodes as node (node.id)}
			{@const isOpen = expanded.has(node.id)}
			{@const combo = node.dimension === 'ingredientCombo' && node.label.includes(' / ')}
			<li role="treeitem" aria-expanded={isOpen} aria-selected="false">
				<div class="node-row" style:--recede={recede.get(node.id) ?? 0}>
					<button class="node" onclick={() => toggle(node.id)} style:--depth={depth}>
						<span class="twisty" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
						<span class="node-label"
							>{#if node.dimension === 'formularyItem'}{@render summedText(
									node.label,
									firstRow(node)?.doseDisplay
								)}{:else}{node.label}{/if}</span
						>
						<span class="node-dim">{DIMENSION_BY_KEY.get(node.dimension)?.label}</span>
						<span class="count">{plural(node.count, 'NDC')}</span>
					</button>
					{#if node.dimension === 'formularyItem' && nodeItemId(node)}
						<a
							class="item-link"
							href={resolve('/formulary/items/[id]', { id: nodeItemId(node)! })}
							aria-label="Open formulary item {node.label}">Item →</a
						>
					{/if}
					{#if combo}
						{@const current = doseChoice(node.label)}
						<div class="row-menu" class:open={menuFor === node.id}>
							<button
								class="menu-trigger"
								aria-label="Dose display options"
								aria-haspopup="menu"
								aria-expanded={menuFor === node.id}
								onclick={() => (menuFor = menuFor === node.id ? null : node.id)}>⋯</button
							>
							{#if menuFor === node.id}
								<div class="menu" role="menu">
									<p class="menu-heading">Show dose as</p>
									{#each [['each', 'Each ingredient'], ['sum', 'Sum (same unit)'], ...node.label
											.split(' / ')
											.map((name) => [`single:${name}`, `Only ${name}`])] as [value, text] (value)}
										<button
											role="menuitemradio"
											aria-checked={current === value}
											onclick={() => {
												menuFor = null;
												if (current !== value) setComboDose(node.label, value);
											}}
										>
											<span class="check" aria-hidden="true">{current === value ? '✓' : ''}</span
											>{text}
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
				{#if isOpen}
					<div class="children">
						{#if node.children.length}
							{@render branch(node.children, depth + 1)}
						{:else}
							{@render packageList(node.rows)}
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<main>
	{#if saveError}
		<div class="toast" role="alert">
			{saveError}
			<button aria-label="Dismiss" onclick={() => (saveError = null)}>×</button>
		</div>
	{/if}
	<header>
		<p class="eyebrow">
			<a href={resolve('/')}>RxDB</a> / Formulary · <a href={resolve('/formulary/items')}>Manage loaded items →</a> ·
			<a href={resolve('/compounds')}>Compounds</a> ·
			<a href={resolve('/settings')}>Settings</a>
		</p>
		<h1>{data.scope.name}</h1>
		<p>
			{plural(data.rows.length, 'package')} across {plural(
				new Set(data.rows.map((row: FormularyRow) => row.formularyItemId)).size,
				'formulary item'
			)}. Drag attributes into the hierarchy to decide how the formulary splits; each one nests
			under the one before it.
		</p>
	</header>

	<section class="builder" aria-label="Hierarchy builder">
		<div class="builder-head">
			<h2>Hierarchy</h2>
			<div class="presets">
				{#each PRESETS as preset (preset.label)}
					<button
						class="ghost"
						class:active={preset.levels.join() === levels.join()}
						onclick={() => (levels = [...preset.levels])}>{preset.label}</button
					>
				{/each}
			</div>
		</div>

		<ol
			class="levels"
			class:dragging={!!dragging}
			ondragover={(event) => over(event, levels.length)}
			ondrop={drop}
			ondragleave={(event) => {
				if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node))
					dropAt = null;
			}}
		>
			{#each levels as key, index (key)}
				{#if dropAt === index}<li class="gap" aria-hidden="true"></li>{/if}
				<li
					class="chip level"
					class:lifted={dragging?.key === key}
					draggable="true"
					style:--depth={index}
					ondragstart={(event) => startDrag(event, key, index)}
					ondragend={endDrag}
					ondragover={(event) => {
						event.stopPropagation();
						overChip(event, index);
					}}
				>
					<span class="step">{index + 1}</span>
					<span class="chip-label">{DIMENSION_BY_KEY.get(key)?.label}</span>
					{#if DIMENSION_BY_KEY.get(key)?.variant}
						{@const variant = DIMENSION_BY_KEY.get(key)?.variant}
						<button
							class="mode"
							title="Toggle separated ingredients vs combinations"
							onclick={() => switchVariant(key)}>⇄ {variant?.mode}</button
						>
					{/if}
					<span class="chip-actions">
						<button
							class="icon"
							aria-label="Move {DIMENSION_BY_KEY.get(key)?.label} up a level"
							disabled={index === 0}
							onclick={() => move(index, -1)}>←</button
						>
						<button
							class="icon"
							aria-label="Move {DIMENSION_BY_KEY.get(key)?.label} down a level"
							disabled={index === levels.length - 1}
							onclick={() => move(index, 1)}>→</button
						>
						<button
							class="icon"
							aria-label="Remove {DIMENSION_BY_KEY.get(key)?.label}"
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
	</section>

	<section class="results">
		<div class="toolbar">
			<input
				type="search"
				bind:value={filter}
				placeholder="Filter by name, ingredient, NDC, labeler"
			/>
			<button class="ghost" onclick={expandAll} disabled={!levels.length}>Expand all</button>
			<button class="ghost" onclick={() => expanded.clear()} disabled={!levels.length}
				>Collapse all</button
			>
		</div>

		{#if !data.rows.length}
			<p class="empty">
				Nothing is in this formulary yet. <a href={resolve('/')}>Search and load</a> concepts or packages first.
			</p>
		{:else if !rows.length}
			<p class="empty">No packages match “{filter}”.</p>
		{:else if levels.length}
			{@render branch(tree, 0)}
		{:else}
			{@render packageList(rows)}
		{/if}
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f7f8fa;
		color: #18212f;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}

	main {
		max-width: 1040px;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}

	header p:last-child {
		color: #5c6777;
		line-height: 1.55;
		max-width: 46rem;
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
		margin: 0;
		font-size: 1rem;
	}

	button {
		border: 0;
		border-radius: 0.55rem;
		background: #204f91;
		color: white;
		padding: 0.6rem 0.9rem;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	button.ghost {
		background: white;
		color: #204f91;
		border: 1px solid #cdd6e1;
		font-size: 0.85rem;
		padding: 0.45rem 0.75rem;
	}

	button.ghost.active {
		background: #e8f0fb;
		border-color: #3464a5;
	}

	.builder {
		margin: 2rem 0;
		border: 1px solid #dbe1e8;
		border-radius: 0.9rem;
		background: white;
		padding: 1.1rem;
	}

	.builder-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
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

	.toolbar {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.toolbar input {
		flex: 1;
		min-width: 0;
		border: 1px solid #b9c3d0;
		border-radius: 0.55rem;
		padding: 0.6rem 0.85rem;
		font: inherit;
	}

	.tree,
	.packages {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.children {
		margin-left: 0.9rem;
		padding-left: 0.6rem;
		border-left: 2px solid #e3e8ee;
	}

	.node {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		width: 100%;
		background: none;
		color: inherit;
		text-align: left;
		padding: 0.45rem 0.5rem;
		border-radius: 0.45rem;
		font-weight: 500;
	}

	.node-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.node-row .node {
		flex: 1;
		min-width: 0;
	}

	.toast {
		position: fixed;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		display: flex;
		gap: 0.75rem;
		align-items: center;
		padding: 0.6rem 0.9rem;
		background: #7f1d1d;
		color: #fff;
		border-radius: 0.5rem;
		font-size: 0.85rem;
		box-shadow: 0 6px 20px rgb(15 23 42 / 0.2);
	}

	.toast button {
		background: none;
		color: inherit;
		padding: 0 0.2rem;
	}

	.item-link {
		flex: none;
		color: #3464a5;
		font-size: 0.8rem;
		font-weight: 650;
		text-decoration: none;
		opacity: 0;
	}

	.node-row:hover .item-link,
	.item-link:focus-visible {
		opacity: 1;
	}

	.item-link:hover {
		text-decoration: underline;
	}

	.row-menu {
		position: relative;
		flex: none;
	}

	.menu-trigger {
		background: none;
		color: #5c6777;
		padding: 0.1rem 0.45rem;
		border-radius: 0.35rem;
		line-height: 1;
		opacity: 0;
	}

	.node-row:hover .menu-trigger,
	.menu-trigger:focus-visible,
	.row-menu.open .menu-trigger,
	.menu-trigger:disabled {
		opacity: 1;
	}

	.menu-trigger:hover,
	.row-menu.open .menu-trigger {
		background: #eef2f7;
	}

	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 0.25rem);
		z-index: 10;
		min-width: 12rem;
		padding: 0.3rem;
		background: #fff;
		border: 1px solid #d9dee6;
		border-radius: 0.5rem;
		box-shadow: 0 6px 20px rgb(15 23 42 / 0.12);
	}

	.menu-heading {
		margin: 0.2rem 0.5rem 0.3rem;
		color: #5c6777;
		font-size: 0.75rem;
	}

	.menu button {
		display: flex;
		width: 100%;
		gap: 0.4rem;
		background: none;
		color: inherit;
		text-align: left;
		padding: 0.35rem 0.5rem;
		border-radius: 0.35rem;
		font-size: 0.85rem;
	}

	.menu button:hover {
		background: #eef2f7;
	}

	.check {
		width: 0.9rem;
		color: #3464a5;
	}

	.node:hover {
		background: #eef2f7;
	}

	.twisty {
		width: 0.8rem;
		color: #3464a5;
	}

	.node-dim {
		flex: none;
		color: #7a8594;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.node-dim::after {
		content: ':';
		margin-right: 0.35rem;
	}

	.paren {
		opacity: 0.35;
	}

	.node-label {
		flex: 1;
		min-width: 0;
		font-weight: 650;
		overflow-wrap: anywhere;
	}

	.count {
		flex: none;
		color: #5c6777;
		font-size: 0.8rem;
	}

	.packages {
		display: grid;
		gap: 0.35rem;
		padding: 0.35rem 0 0.6rem;
	}

	.packages li {
		border: 1px solid #e3e8ee;
		border-radius: 0.55rem;
		background: white;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
	}

	.package {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		width: 100%;
		background: none;
		color: inherit;
		text-decoration: none;
	}

	.package .desc {
		flex: 1;
	}

	.package:hover .chevron {
		color: #3464a5;
	}

	.chevron {
		flex: none;
		color: #9aa4b2;
	}

	.packages li.excluded {
		opacity: 0.6;
	}

	.ndc {
		flex: none;
		color: #204f91;
		font-weight: 650;
	}

	.desc {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.desc .small {
		display: block;
	}

	.flag {
		flex: none;
		border-radius: 999px;
		background: #fdecec;
		color: #9a2a2a;
		padding: 0.15rem 0.5rem;
		font-size: 0.7rem;
		font-weight: 700;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.small {
		color: #7a8594;
		font-size: 0.75rem;
	}

	.empty {
		color: #5c6777;
	}

	@media (max-width: 640px) {
		main {
			padding: 2.5rem 1rem;
		}

		.toolbar {
			flex-wrap: wrap;
		}

		.toolbar input {
			flex-basis: 100%;
		}

		.package {
			flex-wrap: wrap;
		}

		/* Stack levels flush-left instead of indenting; ancestors recede instead. */
		.children {
			margin-left: 0;
			padding-left: 0;
			border-left: none;
		}

		.node-dim {
			display: none;
		}

		.node-row {
			font-size: calc(1em * max(0.78, 1 - 0.06 * var(--recede)));
			opacity: max(0.45, 1 - 0.14 * var(--recede));
		}
	}
</style>
