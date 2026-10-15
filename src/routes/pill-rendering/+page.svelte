<script lang="ts">
	import PillMockup from '$lib/components/PillMockup.svelte';
	import { ILN_DOC_EXAMPLES, type IlnDocExample } from '$lib/imprints/iln-doc-examples';
	import { explainIln, formatIln, validateIln } from '$lib/imprints/iln-parse';
	import { formatShapeProportion, MAX_PROPORTION, PROPORTIONS, SHAPES, splitShapeProportion } from '$lib/imprints/shapes';
	import { NAMED_SWATCHES, type PillAppearance } from '$lib/spl-characteristics';

	// The help documentation (docs/iln.md) as a walkthrough: each section
	// explains one idea and offers examples that load into the editor.
	type Example = Omit<IlnDocExample, 'id'> & { id?: string };
	interface Section {
		title: string;
		body: string;
		examples: Example[];
	}

	const doc = (id: string): Example => {
		const e = ILN_DOC_EXAMPLES.find((x) => x.id === id);
		if (!e) throw new Error(`unknown ILN doc example ${id}`);
		return e;
	};
	const tab = (iln: string, shape: string, note: string, colors = ['white']): Example => ({
		iln,
		shape,
		doseForm: 'TABLET',
		colors,
		note
	});

	const SECTIONS: Section[] = [
		{
			title: 'Overview',
			body: 'ILN describes where markings sit on a tablet, capsule or softgel. Shape, color and score count are separate fields; ILN references them only where layout depends on them.',
			examples: [doc('intro-arcs-scored-back')]
		},
		{
			title: '1. Surfaces',
			body: 'Tablets and softgels have F (front), B (back) and optionally E (edge), separated by `;`. Capsules use CAP(color) and BODY(color). Always list both faces; write `blank` for an unmarked one. A color on a face label makes a bilayer tablet.',
			examples: [
				tab('F: "M" ; B: blank', 'ROUND', 'One marked face, back blank'),
				doc('bilayer'),
				doc('capsule-two-color')
			]
		},
		{
			title: '2. Canonical orientation',
			body: 'Elongated shapes are drawn long axis horizontal; capsules cap on the left; then turned so the longest straight text reads upright. Directional outlines whose feature is not at its default get a face tag such as F[TIP@W].',
			examples: [doc('tear-tip-west'), tab('F: "WATSON" / "349" ; B: blank', 'OVAL', 'Elongated: long axis horizontal')]
		},
		{
			title: '3. Elements',
			body: 'Quoted text ("ABC"), symbols in angle brackets (<heart>, <logo:Teva>, <hole>), `blank`, and `\\?` for an illegible character. A symbol can enclose markings: <heart: "5">.',
			examples: [doc('symbol-with-markings'), doc('rotated-half'), doc('illegible-and-edge')]
		},
		{
			title: '4. Layout operators',
			body: 'Tightest binding first: space = same line, `/` = next line, `|` = vertical score, `-` = horizontal score, `+` attaches an out-of-flow item at a location code. Parentheses group.',
			examples: [doc('lines-and-score'), doc('horizontal-score'), doc('score-on-blank-face'), doc('cross-score')]
		},
		{
			title: '5. Modifiers',
			body: 'Square brackets after an element: a location code, `fill` (grow to fill space), `emboss`, `xN` repeats, `MIRROR`, and direction tags for holes.',
			examples: [
				doc('fill-priority'),
				tab('F: ("A" / "12")[emboss] ; B: blank', 'ROUND', 'Embossed (raised) text'),
				doc('capsule-radial')
			]
		},
		{
			title: 'Location codes: rim arcs',
			body: 'RIM:W>N>E runs along the edge from west through north to east. RIM:N(cw) centers an arc at north reading clockwise; RIM:N>N(cw) is a full ring.',
			examples: [doc('rim-arcs'), doc('short-top-arc'), doc('full-ring')]
		},
		{
			title: 'Location codes: straight baselines',
			body: 'LINE@PLACE puts a straight run at a compass point (C, N, NW…). LINE>DIR@PLACE rotates it so it reads toward DIR. STACK stacks letters vertically.',
			examples: [doc('vertical-text'), doc('corner-mark'), doc('stacked-letters')]
		},
		{
			title: 'Location codes: off-face surfaces',
			body: 'E: with BAND codes prints around the edge. Capsule print sits on CAP / BODY tracks such as BODY.MID, radial (RAD) or axial (AX), front or @back.',
			examples: [doc('illegible-and-edge'), doc('capsule-axial-back'), doc('capsule-radial')]
		},
		{
			title: 'Holes',
			body: 'Donut shapes have a through-hole drawn with <hole>. HOLE:N>N(cw) rings text around it. Letter-shaped holes take direction tags ([UP@E], [TIP@N]) and MIRROR on the back.',
			examples: [doc('hole-ring'), doc('k-donut'), doc('p-donut'), doc('a-donut'), doc('b-donut'), doc('v-donut')]
		},
		{
			title: 'Shapes',
			body: 'All 19 SPL shapes plus ILN extensions. Pick one to see its outline.',
			examples: [
				...SHAPES.map((s) => tab('F: "ABC" ; B: blank', s.id, `${s.label} (${s.source})`)),
				tab('F: "ABC" ; B: blank', 'STOUT CAPSULE', 'Capsule-shaped, stout (1.8:1)'),
				tab('F: "ABC" ; B: blank', 'LONG CAPSULE', 'Capsule-shaped, long (3.4:1)'),
				tab('F: "ABC" ; B: blank', 'CAPSULE 4:1', 'Capsule-shaped, 4:1')
			]
		}
	];

	const COLORS = Object.keys(NAMED_SWATCHES);

	let iln = $state(SECTIONS[0].examples[0].iln);
	let shape = $state(SECTIONS[0].examples[0].shape);
	let doseForm = $state(SECTIONS[0].examples[0].doseForm);
	// A capsule outline's shape may carry its proportion: `LONG CAPSULE`, `CAPSULE 2.6:1`.
	const shapeParts = $derived(splitShapeProportion(shape));
	const proportion = $derived(PROPORTIONS[shapeParts.base]);
	let color1 = $state('white');
	let color2 = $state('white');
	let selected = $state<string | null>("Overview#0");
	let size = $state(180);

	function load(e: Example, key: string) {
		selected = key;
		iln = e.iln;
		shape = e.shape;
		doseForm = e.doseForm;
		color1 = e.colors[0] ?? 'white';
		color2 = e.colors[1] ?? color1;
	}

	const isCapsule = $derived(doseForm === 'CAPSULE');
	const appearance = $derived<PillAppearance>({
		productCode: null,
		colors: color1 === color2 && !isCapsule ? [color1] : [color1, color2],
		colorText: null,
		shape,
		shapeCode: null,
		shapeText: null,
		sizeMm: null,
		score: null,
		imprint: null,
		iln
	});
	const validation = $derived(validateIln(iln, { shape }));
	const explanation = $derived.by(() => {
		try {
			return explainIln(iln, { shape });
		} catch {
			return null;
		}
	});
	const canonical = $derived.by(() => {
		try {
			return formatIln(iln, { shape });
		} catch {
			return null;
		}
	});
</script>

<svelte:head><title>ILN playground</title></svelte:head>

<div class="playground">
	<aside class="library">
		<header>
			<h1>ILN playground</h1>
			<p>Imprint Layout Notation, by example. Click an example to load it.</p>
		</header>
		{#each SECTIONS as section (section.title)}
			<section>
				<h2>{section.title}</h2>
				<p>{section.body}</p>
				<ul>
					{#each section.examples as e, i (i)}
						<li>
							<button class:active={selected === `${section.title}#${i}`} onclick={() => load(e, `${section.title}#${i}`)}>
								<code>{e.iln}</code>
								<span>{e.note}{e.shape !== 'ROUND' && e.doseForm !== 'CAPSULE' ? ` · ${e.shape}` : ''}</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</aside>

	<main class="stage">
		<label class="editor">
			<span>ILN</span>
			<textarea bind:value={iln} rows="3" spellcheck="false" oninput={() => (selected = null)}></textarea>
		</label>
		<div class="controls">
			<label>
				Dose form
				<select bind:value={doseForm}>
					<option value="TABLET">Tablet</option>
					<option value="CAPSULE">Capsule</option>
				</select>
			</label>
			<label>
				Shape
				<select
					value={shapeParts.base}
					onchange={(event) => (shape = formatShapeProportion(event.currentTarget.value, shapeParts.ratio))}
				>
					{#each SHAPES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
				</select>
			</label>
			{#if proportion}
				<label>
					Length : width
					<input
						type="number"
						min="1.1"
						max={MAX_PROPORTION}
						step="0.1"
						value={Math.round((shapeParts.ratio ?? proportion.default) * 100) / 100}
						oninput={(event) => {
							const ratio = Number(event.currentTarget.value);
							if (ratio > 1 && ratio <= MAX_PROPORTION) shape = formatShapeProportion(shapeParts.base, ratio);
						}}
					/>
				</label>
			{/if}
			<label>
				{isCapsule ? 'Cap' : 'Color'}
				<input list="iln-colors" bind:value={color1} />
			</label>
			<label>
				{isCapsule ? 'Body' : 'Back color'}
				<input list="iln-colors" bind:value={color2} />
			</label>
			<label>
				Size
				<input type="range" min="80" max="320" bind:value={size} />
			</label>
		</div>

		<datalist id="iln-colors">
			{#each COLORS as c (c)}<option value={c}></option><option value={`light ${c}`}></option><option value={`dark ${c}`}></option>{/each}
		</datalist>
		<div class="render">
			{#key `${shape}|${doseForm}`}
				<PillMockup {appearance} {doseForm} {size} />
			{/key}
		</div>

		<div class="status" class:bad={!validation.ok}>
			<strong>{validation.ok ? 'Valid' : 'Invalid'}</strong>
			{#if validation.issues.length}
				<ul>
					{#each validation.issues as issue, i (i)}
						<li class={issue.level}>{issue.level}{issue.surface ? ` (${issue.surface})` : ''}: {issue.message}</li>
					{/each}
				</ul>
			{/if}
		</div>
		{#if explanation}
			<div class="panel"><h3>In English</h3><p>{explanation}</p></div>
		{/if}
		{#if canonical && canonical !== iln.trim()}
			<div class="panel">
				<h3>Canonical form</h3>
				<code>{canonical}</code>
				<button onclick={() => ((iln = canonical), (selected = null))}>Use</button>
			</div>
		{/if}
	</main>
</div>

<style>
	.playground {
		display: grid;
		grid-template-columns: minmax(300px, 420px) 1fr;
		height: calc(100vh - 60px);
		gap: 0;
	}
	.library {
		overflow-y: auto;
		padding: 16px;
		border-right: 1px solid #ddd;
	}
	h1 {
		margin: 0 0 4px;
		font-size: 20px;
	}
	header p,
	section p {
		color: #555;
		font-size: 13px;
		line-height: 1.45;
	}
	h2 {
		font-size: 15px;
		margin: 20px 0 4px;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.library button {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		text-align: left;
		padding: 8px;
		margin-bottom: 6px;
		border: 1px solid #ddd;
		border-radius: 6px;
		background: white;
		cursor: pointer;
		font: inherit;
	}
	.library button:hover {
		border-color: #888;
	}
	.library button.active {
		border-color: #2563eb;
		background: #eff6ff;
	}
	.library code {
		font-size: 12px;
		word-break: break-word;
	}
	.library span {
		font-size: 12px;
		color: #666;
	}
	.stage {
		overflow-y: auto;
		padding: 16px 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-weight: 600;
	}
	textarea {
		font-family: ui-monospace, monospace;
		font-size: 15px;
		padding: 8px;
		resize: vertical;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		font-size: 13px;
	}
	.controls label {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.render {
		display: flex;
		justify-content: center;
		padding: 24px;
		background: #f7f7f7;
		border-radius: 8px;
		min-height: 200px;
	}
	.status {
		font-size: 13px;
		color: #15803d;
	}
	.status.bad {
		color: #b91c1c;
	}
	.status li.warning {
		color: #a16207;
	}
	.panel h3 {
		font-size: 13px;
		margin: 0 0 4px;
	}
	.panel p {
		margin: 0;
		font-size: 14px;
	}
	@media (max-width: 760px) {
		.playground {
			grid-template-columns: 1fr;
			height: auto;
		}
	}
</style>
