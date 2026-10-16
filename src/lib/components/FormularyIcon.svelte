<script lang="ts" module>
	/** `on`: on the formulary; `flagged`: linked but kept off; `unknown`: not on it. */
	export type FormularyStatus = 'on' | 'flagged' | 'unknown';

	const LABELS: Record<FormularyStatus, string> = {
		on: 'On formulary',
		flagged: 'Linked to the formulary but excluded',
		unknown: 'Not on formulary'
	};
</script>

<script lang="ts">
	let { status, title }: { status: FormularyStatus; title?: string } = $props();
	const label = $derived(title ?? LABELS[status]);
</script>

<svg
	class="formulary-icon {status}"
	viewBox="0 0 24 24"
	width="1.25em"
	height="1.25em"
	role="img"
	aria-label={label}
>
	<title>{label}</title>
	<!-- An open-faced book: spine on the left, pages to the right. -->
	<path
		class="book"
		d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5Zm0 15A1.5 1.5 0 0 0 5.5 21H19v-3"
	/>
	{#if status === 'on'}
		<path class="mark" d="m8.5 10.5 2.25 2.25L15 8.5" />
	{:else if status === 'flagged'}
		<path class="mark" d="M11.5 6.5v4.5" />
		<circle class="dot" cx="11.5" cy="14" r="1.1" />
	{:else}
		<path class="mark" d="M9.5 8.25a2 2 0 1 1 2.75 1.85c-.5.2-.75.6-.75 1.15v.5" />
		<circle class="dot" cx="11.5" cy="14.25" r="1.1" />
	{/if}
</svg>

<style>
	.formulary-icon {
		flex: none;
		vertical-align: -0.25em;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.dot {
		fill: currentColor;
		stroke: none;
	}
	.on {
		color: #22863a;
	}
	.flagged {
		color: #d4700a;
	}
	.unknown {
		color: #9aa3ae;
	}
</style>
