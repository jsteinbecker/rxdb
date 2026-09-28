<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import PackageDetail from '$lib/components/PackageDetail.svelte';
	import ReinterpretDialog from '$lib/components/ReinterpretDialog.svelte';
	import { packageDisplayTitle } from '$lib/package-title';

	let { data } = $props();

	// Going back through history restores the hierarchy exactly as it was
	// (levels, open nodes, filter, scroll). A direct visit falls back to the link.
	let fromFormulary = $state(false);
	let reinterpret: ReinterpretDialog;
	afterNavigate(({ from }) => (fromFormulary = from?.url.pathname === '/formulary'));

	function back(event: MouseEvent) {
		if (!fromFormulary) return;
		event.preventDefault();
		history.back();
	}

	const item = $derived(data.item);
	const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
	const displayTitle = $derived(
		packageDisplayTitle({
			rxNormName: item.details?.rxnav?.conceptName,
			packageDescription: item.description,
			splTitle: item.splTitle,
			isMultiDose: item.isMultiDose,
			labeler: item.labelerName
		})
	);
</script>

<svelte:head>
	<title>NDC {formatNdc(item.ndc)} · RxDB</title>
</svelte:head>

<main>
	<a class="back" href="/formulary" onclick={back}><span aria-hidden="true">←</span> Formulary</a>
	<header>
		<p class="eyebrow">NDC · <span class="mono">{formatNdc(item.ndc)}</span></p>
		<h1>{displayTitle ?? item.brandName ?? item.genericName ?? item.description ?? `NDC ${item.ndc}`}</h1>
		{#if item.labelerName}<p class="sub">{item.labelerName}</p>{/if}
		<button class="action" type="button" onclick={() => reinterpret.open()}>
			Reload &amp; Reinterpret Results
		</button>
	</header>
	<PackageDetail {item} />
	<ReinterpretDialog bind:this={reinterpret} {item} />
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
		padding: 2.5rem 1.5rem 4rem;
	}

	.back {
		display: inline-flex;
		gap: 0.4rem;
		color: #3464a5;
		font-weight: 650;
		text-decoration: none;
	}

	.back:hover {
		text-decoration: underline;
	}

	header {
		position: relative;
		margin: 1.5rem 0 1.25rem;
		padding-right: 15rem;
	}

	.action {
		position: absolute;
		top: 0;
		right: 0;
		padding: 0.45rem 0.9rem;
		border: 1px solid #3464a5;
		border-radius: 7px;
		background: #fff;
		color: #3464a5;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 650;
		cursor: pointer;
	}

	.action:hover {
		background: #eef3fa;
	}

	@media (max-width: 640px) {
		header {
			padding-right: 0;
		}

		.action {
			position: static;
			margin-top: 0.8rem;
		}
	}

	h1 {
		margin: 0;
		font-size: 1.6rem;
		line-height: 1.25;
	}

	.eyebrow {
		margin: 0 0 0.5rem;
		color: #3464a5;
		font-size: 0.8rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.sub {
		margin: 0.4rem 0 0;
		color: #5c6777;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0;
	}
</style>
