<!--
@component
The app's permanent sidebar: brand, the sections (Search, Formulary and its pages, Compounds,
Settings), and a collapse control. Collapsed, it is an icon rail; under 900px it becomes a
drawer the toolbar opens (`open`). The current page is marked with `aria-current`.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let {
		collapsed = $bindable(false),
		open = $bindable(false)
	}: { collapsed?: boolean; open?: boolean } = $props();

	type Link = { href: string; label: string; icon: string };

	/* 24×24 stroke paths, one per link. */
	const ICONS = {
		search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3',
		overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
		items: 'M4 6h16M4 12h16M4 18h16',
		classes: 'M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4',
		concepts: 'M12 3v18M3 12h18M6 6l12 12M18 6 6 18',
		quarantine: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
		compounds: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3',
		settings:
			'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-2-4-2 1-2-1-1-3h-4l-1 3-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1 1 3h4l1-3 2-1 2 1 2-4z',
		collapse: 'M15 6l-6 6 6 6'
	};

	const GROUPS: { title: string; links: Link[] }[] = [
		{ title: 'Lookup', links: [{ href: resolve('/'), label: 'Search', icon: ICONS.search }] },
		{
			title: 'Formulary',
			links: [
				{ href: resolve('/formulary'), label: 'Overview', icon: ICONS.overview },
				{ href: resolve('/formulary/items'), label: 'Loaded items', icon: ICONS.items },
				{ href: resolve('/formulary/pharm-classes'), label: 'Class rules', icon: ICONS.classes },
				{ href: resolve('/formulary/local-concepts'), label: 'Local concepts', icon: ICONS.concepts },
				{ href: resolve('/formulary/quarantine'), label: 'Quarantine', icon: ICONS.quarantine },
				{ href: resolve('/compounds'), label: 'Compounds', icon: ICONS.compounds }
			]
		},
		{ title: 'System', links: [{ href: resolve('/settings'), label: 'Settings', icon: ICONS.settings }] }
	];

	const path = $derived(page.url.pathname);
	/** The link a path belongs to: the longest matching prefix, so /formulary/items/7 is Loaded items. */
	const current = $derived(
		GROUPS.flatMap((g) => g.links)
			.filter((l) => path === l.href || (l.href !== '/' && path.startsWith(l.href + '/')))
			.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null
	);
</script>

<aside class="sidebar" class:collapsed class:open aria-label="Main navigation">
	<a class="brand" href={resolve('/')} title="RxDB">
		<span class="mark" aria-hidden="true">Rx</span>
		<span class="label">RxDB</span>
	</a>

	<nav>
		{#each GROUPS as group (group.title)}
			<p class="group label">{group.title}</p>
			<ul>
				{#each group.links as link (link.href)}
					<li>
						<a
							href={link.href}
							title={collapsed ? link.label : undefined}
							aria-current={current === link.href ? (path === link.href ? 'page' : 'true') : undefined}
							onclick={() => (open = false)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d={link.icon} /></svg>
							<span class="label">{link.label}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/each}
	</nav>

	<button
		class="collapse"
		type="button"
		aria-pressed={collapsed}
		title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
		onclick={() => (collapsed = !collapsed)}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS.collapse} /></svg>
		<span class="label">Collapse</span>
	</button>
</aside>

<style>
	.sidebar {
		position: sticky;
		top: 0;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		width: var(--sidebar-width);
		height: 100vh;
		padding: 0.75rem 0.6rem;
		overflow: hidden auto;
		background: #121a27;
		color: #c3cbd8;
		transition: width 0.18s ease;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		height: 2.25rem;
		margin: 0 0.2rem 1rem;
		color: #fff;
		font-weight: 800;
		letter-spacing: -0.02em;
		text-decoration: none;
	}

	.mark {
		display: grid;
		flex: none;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 8px;
		background: #3a7be0;
		font-size: 0.85rem;
	}

	nav {
		flex: 1;
	}

	.group {
		margin: 1rem 0.6rem 0.35rem;
		color: #6f7c90;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	ul {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	nav a,
	.collapse {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.6rem;
		border: 0;
		border-radius: 7px;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}

	nav a:hover,
	.collapse:hover {
		background: #1d2838;
		color: #fff;
	}

	nav a[aria-current] {
		background: #23324a;
		color: #fff;
	}

	nav a[aria-current='page'] {
		box-shadow: inset 3px 0 0 #3a7be0;
	}

	svg {
		flex: none;
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.collapse {
		margin-top: 0.5rem;
		color: #8792a5;
	}

	.collapsed .label {
		display: none;
	}

	.collapsed .group {
		height: 1px;
		margin: 0.75rem 0.5rem;
		background: #26324a;
	}

	.collapsed .collapse svg {
		transform: rotate(180deg);
	}

	/* Narrow screens: a drawer over the page, always full width, opened from the toolbar. */
	@media (max-width: 900px) {
		.sidebar {
			position: fixed;
			z-index: 60;
			left: 0;
			width: 15rem;
			transform: translateX(-100%);
			transition: transform 0.2s ease;
		}

		.sidebar.open {
			transform: none;
			box-shadow: 0 0 40px rgb(0 0 0 / 35%);
		}

		.collapsed .label {
			display: revert;
		}

		.collapsed .group {
			height: auto;
			margin: 1rem 0.6rem 0.35rem;
			background: none;
		}

		.collapse {
			display: none;
		}
	}
</style>
