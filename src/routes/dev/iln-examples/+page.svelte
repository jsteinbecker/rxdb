<script lang="ts">
	import { page } from '$app/state';
	import PillMockup from '$lib/components/PillMockup.svelte';
	import { ILN_DOC_EXAMPLES } from '$lib/imprints/iln-doc-examples';
	import { SHAPES } from '$lib/imprints/shapes';
	import type { PillAppearance } from '$lib/spl-characteristics';

	const appearance = (shape: string, colors: string[], iln: string | null): PillAppearance => ({
		productCode: null,
		colors,
		colorText: null,
		shape,
		shapeCode: null,
		shapeText: null,
		sizeMm: null,
		score: null,
		imprint: null,
		iln
	});

	const items = [
		...ILN_DOC_EXAMPLES.map((e) => ({ ...e, key: `example-${e.id}`, a: appearance(e.shape, e.colors, e.iln) })),
		...SHAPES.map((s) => ({
			key: `shape-${s.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
			iln: 'F: "ABC" ; B: blank',
			note: `${s.label} (${s.source})`,
			doseForm: 'TABLET',
			a: appearance(s.id, ['white'], 'F: "ABC" ; B: blank')
		})),
		// Flat-faced, bevelled polygons with scores: the bevel follows the outline and scores match it.
		...[
			['TRIANGLE', 'F: "1" - "2" ; B: blank'],
			['PENTAGON', 'F: "5" - "5" ; B: blank'],
			['HEPTAGON', 'F: blank - blank ; B: blank'],
			['HEXAGON', 'F: "10" | "10" ; B: blank'],
			['ROUND', 'F: "M" | "30" ; B: blank']
		].map(([shape, iln]) => ({
			key: `bevel-${shape.toLowerCase()}`,
			iln,
			note: `${shape} with bevelled edge`,
			doseForm: 'TABLET',
			a: { ...appearance(shape, ['peach'], iln), profile: 'flat-faced, bevelled edge' }
		})),
		// Raised type across light and dark tablets.
		...[
			['ROUND', 'white', 'F: ("A" / "12")[emboss] ; B: blank'],
			['OVAL', 'yellow', 'F: "M 365"[emboss] ; B: blank'],
			['ROUND', 'blue', 'F: "5"[emboss] | "5"[emboss] ; B: blank']
		].map(([shape, color, iln]) => ({
			key: `emboss-${shape.toLowerCase()}-${color}`,
			iln,
			note: `${shape} with embossed text`,
			doseForm: 'TABLET',
			a: appearance(shape, [color], iln)
		}))
	];

	// `?only=<key>` draws one item alone, for per-file screenshots.
	const only = $derived(page.url.searchParams.get('only'));
	const shown = $derived(only ? items.filter((i) => i.key === only) : items);
</script>

<div class="gallery">
	{#each shown as item (item.key)}
		<figure data-key={item.key}>
			<PillMockup appearance={item.a} doseForm={item.doseForm} size={140} />
			<figcaption><code>{item.iln}</code><span>{item.note}</span></figcaption>
		</figure>
	{/each}
</div>

<style>
	.gallery {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		padding: 16px;
		background: white;
	}
	figure {
		margin: 0;
		padding: 12px;
		border: 1px solid #ddd;
		border-radius: 8px;
		max-width: 440px;
	}
	figcaption {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 8px;
		font-size: 12px;
	}
	figcaption span {
		color: #555;
	}
</style>
