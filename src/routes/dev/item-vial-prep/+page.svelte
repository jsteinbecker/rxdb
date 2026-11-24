<script lang="ts">
	import ItemVialPrep from '../../formulary/items/[id]/ItemVialPrep.svelte';
	import { vialPrepVariants, type VialPrepPackage } from '#lib/compounds/vial-prep-consensus.ts';
	import type { ProseReconstitution } from '#lib/labels/dry-fill-volume.ts';

	// Label facts shaped as the parser stores them, run through the real grouping.
	const row = (r: Partial<ProseReconstitution> & { diluentMl: number }, mgPerMl?: number): ProseReconstitution => ({
		vialMassMg: null,
		concentrations: mgPerMl ? [{ mgPerMl } as ProseReconstitution['concentrations'][number]] : [],
		...r
	});
	const pkg = (ndc: string, reconstitution: ProseReconstitution[], isDryFill: boolean | null = true): VialPrepPackage => ({
		packageId: ndc, ndc, title: ndc, isDryFill, reconstitution
	});

	const ceftriaxoneIv = row({ vialMassMg: 1000, diluentMl: 9.6, diluents: ['SWFI', 'D5W'], routes: ['IV'] }, 100);
	const ceftriaxoneIm = [
		row({ vialMassMg: 1000, diluentMl: 2.1, diluents: ['lidocaine 1%', 'SWFI'], routes: ['IM'] }, 350),
		row({ vialMassMg: 1000, diluentMl: 3.6, diluents: ['lidocaine 1%', 'SWFI'], routes: ['IM'] }, 250)
	];
	const cases = [
		{
			title: 'Ceftriaxone 1 g vial — two routes, one label differs, one silent',
			packages: [
				pkg('0409733201', [ceftriaxoneIv, ...ceftriaxoneIm]),
				pkg('6332325010', [ceftriaxoneIv, ...ceftriaxoneIm]),
				pkg('0143985825', [ceftriaxoneIv, ...ceftriaxoneIm]),
				pkg('2507112701', [row({ vialMassMg: 1000, diluentMl: 10, diluents: ['SWFI'], routes: ['IV'] }, 95), ...ceftriaxoneIm]),
				pkg('6839810001', []),
				pkg('0338502341', [], false)
			]
		},
		{
			title: 'Vancomycin 1 g — no route named',
			packages: [
				pkg('0409653301', [row({ vialMassMg: 1000, diluentMl: 20, diluents: ['SWFI'] }, 50)]),
				pkg('6332328420', [row({ vialMassMg: 1000, diluentMl: 20, diluents: ['SWFI'] }, 50)])
			]
		},
		{
			title: 'Amoxicillin 400 mg/5 mL, 100 mL bottle',
			packages: [
				pkg('6518004100', [row({ diluentMl: 64, diluents: ['distilled water'], routes: ['PO'], bottle: true, finalVolumeMl: 100 }, 80)]),
				pkg('0093416173', [row({ diluentMl: 64, diluents: ['distilled water'], routes: ['PO'], bottle: true, finalVolumeMl: 100 }, 80)])
			]
		}
	];
</script>

<main>
	{#each cases as c (c.title)}
		<h3>{c.title}</h3>
		<div class="panel-host"><ItemVialPrep prep={vialPrepVariants(c.packages)} total={c.packages.length} /></div>
	{/each}
</main>

<style>
	main { max-width: 60rem; margin: 0 auto; padding: 4rem 1.5rem 1.5rem; display: grid; gap: 0.75rem; }
	h3 { margin: 1rem 0 0; font-size: 0.85rem; color: #5c6777; font-weight: 600; }
	/* The item page's card, which ItemVialPrep's `panel` class picks up there. */
	.panel-host :global(.panel) { border: 1px solid var(--line); border-radius: 0.75rem; background: white; padding: 1rem 1.25rem; }
	.panel-host :global(.section-head) { display: flex; align-items: baseline; gap: 0.25rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--line); }
	.panel-host :global(.section-head h2) { margin: 0; color: var(--ink); }
</style>
