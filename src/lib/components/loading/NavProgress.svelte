<!--
@component
Slim top bar that creeps toward the end while a navigation is pending, plus a corner
spinner.
-->
<script lang="ts">
	let { active } = $props<{
		/** Whether a navigation is pending. */
		active: boolean;
	}>();
</script>

<div class="bar" class:active role="progressbar" aria-hidden={!active} aria-label="Loading page">
	<span></span>
</div>

<div class="spinner" class:active role="status" aria-live="polite">
	<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
		<circle class="track" cx="12" cy="12" r="9" />
		<circle class="arc" cx="12" cy="12" r="9" />
	</svg>
	<span class="label">Loading…</span>
</div>

<style>
	.bar {
		position: fixed;
		inset: 0 0 auto 0;
		height: 3px;
		z-index: 1000;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.3s ease 0.1s;
	}

	.bar.active {
		opacity: 1;
		transition-delay: 0s;
	}

	.bar span {
		display: block;
		height: 100%;
		width: 100%;
		transform-origin: left;
		transform: scaleX(0);
		background: linear-gradient(90deg, #204f91, #3464a5 55%, #7aa7e0);
		border-radius: 0 3px 3px 0;
		box-shadow: 0 0 10px rgba(52, 100, 165, 0.55);
	}

	.bar.active span {
		/* Eases quickly to ~85% and then crawls, so it never looks finished before it is. */
		animation: creep 12s cubic-bezier(0.1, 0.7, 0.2, 1) forwards;
	}

	.spinner {
		position: fixed;
		top: 1rem;
		right: 1rem;
		z-index: 1000;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.8rem 0.45rem 0.6rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.82);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border: 1px solid rgba(32, 79, 145, 0.14);
		box-shadow: 0 6px 24px rgba(24, 33, 47, 0.12);
		color: #3464a5;
		font-size: 0.78rem;
		font-weight: 650;
		letter-spacing: 0.02em;
		opacity: 0;
		transform: translateY(-6px) scale(0.96);
		pointer-events: none;
		transition:
			opacity 0.2s ease,
			transform 0.2s ease;
	}

	.spinner.active {
		opacity: 1;
		transform: none;
		transition-delay: 0.15s; /* skip it entirely for near-instant navigations */
	}

	svg {
		animation: spin 0.85s linear infinite;
	}

	circle {
		fill: none;
		stroke-width: 3;
	}

	.track {
		stroke: #dbe5f3;
	}

	.arc {
		stroke: #204f91;
		stroke-linecap: round;
		stroke-dasharray: 22 60;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes creep {
		0% {
			transform: scaleX(0);
		}
		12% {
			transform: scaleX(0.55);
		}
		100% {
			transform: scaleX(0.92);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		svg,
		.bar.active span {
			animation-duration: 3s;
		}
	}
</style>
