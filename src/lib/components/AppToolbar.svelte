<!--
@component
The toolbar above the view: a menu button (narrow screens), a breadcrumb built from the path,
and a quick search that lands on the Search page. It sits outside the page shell, so it stays
usable while a navigation dims the page.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { onmenu }: { onmenu: () => void } = $props();

	const NAMES: Record<string, string> = {
		formulary: 'Formulary',
		items: 'Loaded items',
		'pharm-classes': 'Class rules',
		'local-concepts': 'Local concepts',
		compounds: 'Compounds',
		settings: 'Settings',
		ndc: 'NDC',
		labeler: 'Labeler',
		unii: 'UNII',
		dev: 'Dev',
		'pill-rendering': 'Pill rendering'
	};

	/** Each path segment, linked to its prefix; segments with no page of their own (ndc, labeler) stay plain. */
	const crumbs = $derived.by(() => {
		const parts = page.url.pathname.split('/').filter(Boolean);
		return parts.map((part, i) => ({
			label: NAMES[part] ?? decodeURIComponent(part),
			href: '/' + parts.slice(0, i + 1).join('/'),
			linked: i < parts.length - 1 && !['ndc', 'labeler', 'unii', 'dev'].includes(part)
		}));
	});

	let query = $state('');

	function search(event: SubmitEvent) {
		event.preventDefault();
		const q = query.trim();
		if (!q) return;
		goto(`${resolve('/')}?q=${encodeURIComponent(q)}`);
		query = '';
	}
</script>

<header class="toolbar">
	<button class="menu" type="button" aria-label="Open navigation" onclick={onmenu}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
	</button>

	<nav class="crumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href={resolve('/')}>Home</a></li>
			{#each crumbs as crumb (crumb.href)}
				<li>
					{#if crumb.linked}
						<a href={crumb.href}>{crumb.label}</a>
					{:else}
						<span aria-current="page">{crumb.label}</span>
					{/if}
				</li>
			{/each}
		</ol>
	</nav>

	<form class="search" role="search" onsubmit={search}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3" /></svg>
		<input type="search" placeholder="Search drugs, NDCs, ingredients…" aria-label="Quick search" bind:value={query} />
	</form>
</header>

<style>
	.toolbar {
		position: sticky;
		top: 0;
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 1rem;
		height: var(--toolbar-height, 3.25rem);
		box-sizing: border-box;
		padding: 0 1.5rem;
		border-bottom: 1px solid #e1e5ec;
		background: rgb(255 255 255 / 92%);
		backdrop-filter: blur(8px);
	}

	svg {
		width: 1.1rem;
		height: 1.1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.menu {
		display: none;
		padding: 0.35rem;
		border: 1px solid #d5dbe4;
		border-radius: 6px;
		background: #fff;
		color: #18212f;
		cursor: pointer;
	}

	.crumbs {
		flex: 1;
		min-width: 0;
	}

	ol {
		display: flex;
		align-items: center;
		margin: 0;
		padding: 0;
		overflow: hidden;
		list-style: none;
		font-size: 0.875rem;
		white-space: nowrap;
	}

	li + li::before {
		content: '/';
		margin: 0 0.5rem;
		color: #b3bccb;
	}

	li:last-child {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.crumbs a {
		color: #5b6678;
		text-decoration: none;
	}

	.crumbs a:hover {
		color: #204f91;
	}

	.crumbs span {
		color: #18212f;
		font-weight: 600;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: min(22rem, 40vw);
		padding: 0 0.65rem;
		border: 1px solid #d5dbe4;
		border-radius: 8px;
		background: #f7f8fa;
		color: #7a8597;
	}

	.search:focus-within {
		border-color: #3a7be0;
		background: #fff;
	}

	input {
		flex: 1;
		min-width: 0;
		height: 2rem;
		border: 0;
		outline: 0;
		background: none;
		color: #18212f;
		font: inherit;
		font-size: 0.875rem;
	}

	@media (max-width: 900px) {
		.toolbar {
			padding: 0 1rem;
			gap: 0.75rem;
		}

		.menu {
			display: inline-flex;
		}
	}

	@media (max-width: 560px) {
		.crumbs {
			display: none;
		}

		.search {
			flex: 1;
			width: auto;
		}
	}
</style>
