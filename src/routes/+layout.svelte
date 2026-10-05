<script lang="ts">
      import favicon from '$lib/assets/favicon.svg';
      import {navigating, page} from '$app/state';
      import NavProgress from '$lib/components/loading/NavProgress.svelte';
      import PageSkeleton from '$lib/components/loading/PageSkeleton.svelte';
      import {skeletonFor} from '$lib/components/loading/skeleton-route';

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
		const title = (link.dataset.navTitle ?? (/^[\d\s-]*$|^[→←›]|[→↗]$/.test(text) ? '' : text)).trim();
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
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<svelte:window onclickcapture={rememberClick} />

<NavProgress active={pending} />

{#if showSkeleton && kind}
	<PageSkeleton {kind} {tempTitle} params={navigating.to?.params ?? {}} scopeName={page.data.scope?.name ?? ''} />
{/if}

<div class="page" class:pending class:replaced={showSkeleton} inert={pending}>
	{@render children()}
</div>

<style>
	* {
		font-family: 'Inter', sans-serif;
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
