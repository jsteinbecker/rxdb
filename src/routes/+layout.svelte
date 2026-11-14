<script lang="ts">
      import favicon from '#lib/assets/favicon.svg';
      import {navigating, page} from '$app/state';
      import NavProgress from '#lib/components/loading/NavProgress.svelte';
      import JobProgress from '#lib/components/loading/JobProgress.svelte';
      import PageSkeleton from '#lib/components/loading/PageSkeleton.svelte';
      import {skeletonFor} from '#lib/components/loading/skeleton-route.ts';
      import AppNav from '#lib/components/AppNav.svelte';
      import AppToolbar from '#lib/components/AppToolbar.svelte';
      import {afterNavigate} from '$app/navigation';

      let { children } = $props();

	/** The page dims right away; the destination's skeleton only takes over if the load drags on. */
	const SKELETON_DELAY_MS = 220;

	/**
	 * The clicked link names its destination before the load can: `data-nav-title` if the link
	 * sets one, else its own text when that is plain (no nested markup, not just an identifier).
	 */
	let clicked = $state<{ path: string; title: string } | null>(null);

	function rememberClick(event: MouseEvent) {
		const link = (event.target as Element | null)?.closest?.('a[href]');
		if (!(link instanceof HTMLAnchorElement) || link.origin !== location.origin) return;
		const text = link.children.length ? '' : (link.textContent ?? '').replace(/\s+/g, ' ').trim();
		const title = (link.dataset.navTitle ?? (/^[\d\s-]*$|^[A-Z\d]{10}$|^[→←›]|[→↗]$/.test(text) ? '' : text)).trim();
		clicked = title ? { path: link.pathname, title } : null;
	}

	const tempTitle = $derived(
		clicked && navigating.to?.url.pathname === clicked.path ? clicked.title : ''
	);

	const pending = $derived(navigating.to !== null);
	const kind = $derived(
		// Same route (a filter or query change) keeps the page in place, dimmed.
		navigating.to && navigating.to.route.id !== navigating.from?.route.id
			? skeletonFor(navigating.to.route.id)
			: null
	);

	let slow = $state(false);
	$effect(() => {
		slow = false;
		if (!pending) return;
		const timer = setTimeout(() => (slow = true), SKELETON_DELAY_MS);
		return () => clearTimeout(timer);
	});

	const showSkeleton = $derived(slow && kind !== null);

	/** The sidebar's rail state is remembered per browser; the narrow-screen drawer starts shut. */
	const COLLAPSED_KEY = 'rxdb.sidebar.collapsed';
	let collapsed = $state(false);
	let drawerOpen = $state(false);
	$effect.pre(() => {
		try {
			collapsed = localStorage.getItem(COLLAPSED_KEY) === '1';
		} catch {}
	});
	$effect(() => {
		try {
			localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
		} catch {}
	});
	afterNavigate(() => (drawerOpen = false));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<svelte:window onclickcapture={rememberClick} onkeydown={(e) => e.key === 'Escape' && (drawerOpen = false)} />

<NavProgress active={pending} />
<JobProgress />

<div class="shell" class:collapsed>
	<AppNav bind:collapsed bind:open={drawerOpen} />
	{#if drawerOpen}
		<button class="scrim" type="button" aria-label="Close navigation" onclick={() => (drawerOpen = false)}></button>
	{/if}

	<div class="workspace">
		<AppToolbar onmenu={() => (drawerOpen = true)} />

		{#if showSkeleton && kind}
			<!-- Same frame as the page it stands in for, so nothing shifts when the page arrives. -->
			<div class="page">
				<PageSkeleton {kind} {tempTitle} params={navigating.to?.params ?? {}} scopeName={page.data.scope?.name ?? ''} />
			</div>
		{/if}

		<div class="page" class:pending class:replaced={showSkeleton} inert={pending}>
			{@render children()}
		</div>
	</div>
</div>

<style>
	/*
	 * Every page is styled for a light background, so the shell pins it: without this a page
	 * that sets no background shows the browser's dark canvas under dark-mode OS settings.
	 */
	:global(:root) {
		color-scheme: light;
	}

	:global(body) {
		margin: 0;
		background: #f7f8fa;
		color: #18212f;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}

	* {
		font-family: 'Inter', sans-serif;
	}

	/* A dialog otherwise takes the browser's black text instead of the page's ink. */
	:global(dialog) {
		color: inherit;
	}

	/* The app frame: a permanent sidebar, then a workspace of toolbar over the view. */
	.shell {
		--sidebar-width: 15rem;
		/* Sticky page elements park below the sticky toolbar: `top: calc(var(--sticky-top) + …)`. */
		--toolbar-height: 3.25rem;
		--sticky-top: var(--toolbar-height);
		display: grid;
		grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
		min-height: 100vh;
	}

	.shell.collapsed {
		--sidebar-width: 3.75rem;
	}

	.workspace {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.scrim {
		display: none;
	}

	@media (max-width: 900px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
		}

		.scrim {
			display: block;
			position: fixed;
			z-index: 55;
			inset: 0;
			border: 0;
			background: rgb(18 26 39 / 45%);
		}
	}

	/*
	 * The view every page shares: one gutter, one top and bottom margin. A page picks its column
	 * with `--page-width`: 760px for a single form column, 1280px by default, wider for records
	 * that need it; the column stays left-aligned against the sidebar like a dashboard.
	 */
	.page > :global(main) {
		box-sizing: content-box;
		max-width: var(--page-width, 1280px);
		margin: 0 auto 0 0;
		padding: 1.75rem 2rem 4rem;
	}

	@media (min-width: 1800px) {
		.page > :global(main) {
			margin: 0 auto;
		}
	}

	@media (max-width: 640px) {
		.page > :global(main) {
			padding: 1.25rem 1rem 3rem;
		}
	}

	.page {
		transition:
			opacity 0.18s ease,
			filter 0.18s ease;
	}

	.page.pending {
		opacity: 0.45;
		filter: saturate(0.7);
		cursor: progress;
	}

	/* Keep the stale page mounted (its state survives) but out of sight once the skeleton shows. */
	.page.replaced {
		display: none;
	}
</style>
