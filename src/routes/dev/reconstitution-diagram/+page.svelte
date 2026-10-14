<script lang="ts">
	import ReconstitutionDiagram, { SHAPES } from '$lib/components/ReconstitutionDiagram.svelte';
	const cases = [
		{ title: 'Alteplase 2 mg', props: { contentMg: 2, diluentMl: 2.2, diluentName: 'SWFI', finalVolumeMl: 2, inaccessibleMl: 0.2, concentrationMgPerMl: 1, capacityMl: 3 } },
		{ title: 'Ceftriaxone 1 g IM (no capacity)', props: { contentMg: 1000, diluentMl: 2.1, diluentName: 'lidocaine 1%', finalVolumeMl: 2.86, concentrationMgPerMl: 350 } },
		{ title: 'Ceftriaxone 1 g IV', props: { contentMg: 1000, diluentMl: 9.6, diluentName: 'SWFI', finalVolumeMl: 10, concentrationMgPerMl: 100, capacityMl: 15 } },
		{ title: 'Vancomycin 1 g (no capacity)', props: { contentMg: 1000, diluentMl: 20, diluentName: 'SWFI', finalVolumeMl: 20.6, concentrationMgPerMl: 50 } },
		{ title: 'Pip/tazo 13.5 g bulk', props: { contentMg: 13500, diluentMl: 51, finalVolumeMl: 60, concentrationMgPerMl: 225, capacityMl: 100 } },
		{ title: 'Pip/tazo 40.5 g bulk', props: { contentMg: 40500, diluentMl: 152, finalVolumeMl: 180, concentrationMgPerMl: 225, capacityMl: 250 } },
		{ title: 'Amoxicillin 250 mg/5 mL, 50 mL', props: { container: 'bottle' as const, contentMg: 2500, diluentMl: 39, diluentName: 'water', finalVolumeMl: 50, concentrationMgPerMl: 50 } },
		{ title: 'Amoxicillin 400 mg/5 mL, 100 mL', props: { container: 'bottle' as const, contentMg: 8000, diluentMl: 64, diluentName: 'water', finalVolumeMl: 100, concentrationMgPerMl: 80, capacityMl: 150 } },
		{ title: 'Cefdinir 250 mg/5 mL, 100 mL', props: { container: 'bottle' as const, contentMg: 5000, diluentMl: 63, diluentName: 'water', finalVolumeMl: 100, concentrationMgPerMl: 50 } },
		{ title: 'Vancomycin oral 250 mL', props: { container: 'bottle' as const, contentMg: 12500, diluentMl: 237, diluentName: 'water', finalVolumeMl: 250, concentrationMgPerMl: 50 } }
	];
	// Every shape, filled to ~60% of its range, to compare outlines.
	const gallery = SHAPES.map((shape) => {
		const cap = Number.isFinite(shape.upToMl) ? shape.upToMl : shape.kind === 'vial' ? 250 : 300;
		return { shape, cap, final: Math.round(cap * 0.6), diluent: Math.round(cap * 0.52) };
	});
</script>

<h2>Cases</h2>
<div class="grid">
	{#each cases as c (c.title)}
		<section><h3>{c.title}</h3><ReconstitutionDiagram {...c.props} /></section>
	{/each}
</div>

<h2>Shape catalog</h2>
<div class="grid">
	{#each gallery as item (item.shape.id)}
		<section>
			<h3>{item.shape.label} <code>{item.shape.id}</code></h3>
			<ReconstitutionDiagram
				shape={item.shape.id}
				container={item.shape.kind}
				capacityMl={item.cap}
				finalVolumeMl={item.final}
				diluentMl={item.diluent}
				concentrationMgPerMl={100}
			/>
		</section>
	{/each}
</div>

<style>
	h2 { padding: 0 1rem; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 1.5rem; padding: 1rem; align-items: end; }
	h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
	code { font-size: 0.75rem; color: #5c6777; }
</style>
