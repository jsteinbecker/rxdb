<script lang="ts">
	/** One shimmering placeholder block. Size it with `w`/`h`; `round` makes a pill or circle. */
	let { w = '100%', h = '1rem', round = false, class: className = '' } = $props<{
		w?: string;
		h?: string;
		round?: boolean;
		class?: string;
	}>();
</script>

<span class="bone {className}" class:round style:width={w} style:height={h}></span>

<style>
	.bone {
		display: block;
		max-width: 100%;
		border-radius: 0.4rem;
		background: linear-gradient(
			100deg,
			#e6ebf2 30%,
			#f4f7fb 48%,
			#f4f7fb 52%,
			#e6ebf2 70%
		);
		background-size: 220% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}

	.round {
		border-radius: 999px;
	}

	@keyframes shimmer {
		from {
			background-position: 110% 0;
		}
		to {
			background-position: -110% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bone {
			animation: none;
		}
	}
</style>
