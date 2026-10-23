<!--
@component
One shimmering placeholder block for skeleton screens. Size it with `w`/`h`;
`round` makes a pill or circle.

Usage:
```svelte
<Bone w="12rem" h="1.25rem" />
<Bone w="2rem" h="2rem" round />
```
-->
<script lang="ts">
	let { w = '100%', h = '1rem', round = false, class: className = '' } = $props<{
		/** CSS width. */
		w?: string;
		/** CSS height. */
		h?: string;
		/** Fully rounded ends: a pill, or a circle when `w` equals `h`. */
		round?: boolean;
		/** Extra classes on the block. */
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
