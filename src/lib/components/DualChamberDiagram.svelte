<!--
@component
	Schematic of a dual-chamber container (DUPLEX® bag, Act-O-Vial, dual-chamber
	syringe), before and after activation.

	Nothing is drawn up or added: the diluent is sealed in its own chamber
	beside the drug, and breaking the seal mixes them in place. So the left
	shape shows the two sealed chambers, an arrow says "activate", and the right
	shape shows the mixed contents at the resulting concentration. Unlike
	ReconstitutionDiagram it is not drawn to scale; the chambers are the point.
-->
<script lang="ts">
	import type { DualChamberContainer } from '$lib/labels/dual-chamber';

	interface Props {
		/** The labeler's name for the system ("DUPLEX"). */
		system?: string | null;
		container: DualChamberContainer;
		/** Drug content, mg. */
		contentMg?: number | null;
		/** Diluent identity ("3.74% dextrose injection"), when known. */
		diluentName?: string | null;
		/** Diluent chamber volume, mL. */
		diluentMl?: number | null;
		/** Volume after activation, mL; the diluent's when not stated. */
		finalVolumeMl?: number | null;
		/** Stated concentration after activation, mg/mL. */
		concentrationMgPerMl?: number | null;
	}
	let {
		system = null,
		container,
		contentMg = null,
		diluentName = null,
		diluentMl = null,
		finalVolumeMl = null,
		concentrationMgPerMl = null
	}: Props = $props();
	const uid = $props.id();

	const pos = (n: number | null | undefined): number | null =>
		n != null && Number.isFinite(n) && n > 0 ? n : null;
	const num = (n: number) => String(Math.round(n * 100) / 100);
	const mass = (mg: number) =>
		mg >= 1000 ? `${num(mg / 1000)} g` : mg < 1 ? `${num(mg * 1000)} mcg` : `${num(mg)} mg`;
	const perMl = (mgPerMl: number) =>
		mgPerMl < 1 ? `${num(mgPerMl * 1000)} mcg/mL` : `${num(mgPerMl)} mg/mL`;

	const final = $derived(pos(finalVolumeMl) ?? pos(diluentMl));
	const concentration = $derived(
		pos(concentrationMgPerMl) ?? (pos(contentMg) != null && final != null ? contentMg! / final : null)
	);
	const calculated = $derived(pos(concentrationMgPerMl) == null && concentration != null);
	const noun = $derived(
		{ bag: 'bag', syringe: 'syringe', cartridge: 'cartridge', vial: 'vial' }[container]
	);

	// One body shape for both states: a flexible bag hangs from a tab and drains
	// through a port; the rigid containers get a plain cap at the top.
	const W = 112;
	const H = 210;
	const TOP = 40;
	const LEFT_X = 24;
	const RIGHT_X = 352;
	// The diluent chamber is the larger, upper one; the drug sits by the port.
	const SEAL_Y = TOP + H * 0.62;
	const body = (x: number) =>
		container === 'bag'
			? `M ${x + 10} ${TOP} H ${x + W - 10} Q ${x + W} ${TOP} ${x + W} ${TOP + 12} V ${TOP + H - 22} Q ${x + W} ${TOP + H} ${x + W - 22} ${TOP + H} H ${x + 22} Q ${x} ${TOP + H} ${x} ${TOP + H - 22} V ${TOP + 12} Q ${x} ${TOP} ${x + 10} ${TOP} Z`
			: `M ${x + 12} ${TOP} H ${x + W - 12} Q ${x + W} ${TOP} ${x + W} ${TOP + 12} V ${TOP + H - 12} Q ${x + W} ${TOP + H} ${x + W - 12} ${TOP + H} H ${x + 12} Q ${x} ${TOP + H} ${x} ${TOP + H - 12} V ${TOP + 12} Q ${x} ${TOP} ${x + 12} ${TOP} Z`;
	const LABEL_X = LEFT_X + W + 22;
</script>

<figure class="dual" aria-label={`Dual-chamber ${noun}: activate to mix`}>
	<svg viewBox="0 0 520 282" role="img">
		<defs>
			<clipPath id={`${uid}-left`}><path d={body(LEFT_X)} /></clipPath>
			<clipPath id={`${uid}-right`}><path d={body(RIGHT_X)} /></clipPath>
			<pattern id={`${uid}-powder`} width="7" height="7" patternUnits="userSpaceOnUse">
				<rect width="7" height="7" fill="var(--dc-powder-fill)" />
				<circle cx="1.6" cy="1.8" r="0.9" fill="var(--dc-powder)" opacity="0.55" />
				<circle cx="5.2" cy="5.1" r="0.8" fill="var(--dc-powder)" opacity="0.45" />
			</pattern>
		</defs>

		<!-- Before: two sealed chambers -->
		<text x={LEFT_X + W / 2} y="14" class="state">Sealed</text>
		{#if container === 'bag'}
			<rect x={LEFT_X + W / 2 - 14} y={TOP - 14} width="28" height="16" rx="4" class="tab" />
			<rect x={LEFT_X + W / 2 - 8} y={TOP + H} width="16" height="14" rx="2" class="port" />
		{:else}
			<rect x={LEFT_X + W / 2 - 22} y={TOP - 12} width="44" height="14" rx="3" class="cap" />
		{/if}
		<g clip-path={`url(#${uid}-left)`}>
			<rect x={LEFT_X} y={TOP} width={W} height={SEAL_Y - TOP} class="diluent" />
			<rect x={LEFT_X} y={SEAL_Y} width={W} height={TOP + H - SEAL_Y} fill={`url(#${uid}-powder)`} />
		</g>
		<path d={body(LEFT_X)} class="vessel" />
		<line x1={LEFT_X - 4} x2={LEFT_X + W + 4} y1={SEAL_Y} y2={SEAL_Y} class="seal" />

		<!-- Callouts for each chamber -->
		<g class="callout diluent">
			<path d={`M ${LEFT_X + W - 8} ${TOP + 60} H ${LABEL_X - 4}`} class="leader" />
			<rect x={LABEL_X} y={TOP + 49} width="3" height="24" rx="1.5" class="swatch" />
			<text x={LABEL_X + 9} y={TOP + 59} class="value"
				>{diluentMl != null ? `${num(diluentMl)} mL` : 'Diluent'}</text
			>
			<text x={LABEL_X + 9} y={TOP + 72} class="caption">{diluentName ?? 'diluent'}, sealed</text>
		</g>
		<g class="callout seal-note">
			<path d={`M ${LEFT_X + W + 4} ${SEAL_Y} H ${LABEL_X - 4}`} class="leader" />
			<rect x={LABEL_X} y={SEAL_Y - 11} width="3" height="24" rx="1.5" class="swatch" />
			<text x={LABEL_X + 9} y={SEAL_Y - 1} class="value">Peel seal</text>
			<text x={LABEL_X + 9} y={SEAL_Y + 12} class="caption">break to mix</text>
		</g>
		<g class="callout powder">
			<path d={`M ${LEFT_X + W - 8} ${TOP + H - 30} H ${LABEL_X - 4}`} class="leader" />
			<rect x={LABEL_X} y={TOP + H - 41} width="3" height="24" rx="1.5" class="swatch" />
			<text x={LABEL_X + 9} y={TOP + H - 31} class="value"
				>{contentMg != null ? mass(contentMg) : 'Drug'}</text
			>
			<text x={LABEL_X + 9} y={TOP + H - 18} class="caption">dry powder, sealed</text>
		</g>

		<!-- Activation -->
		<g class="activate">
			<path d={`M ${RIGHT_X - 50} ${TOP + H / 2} H ${RIGHT_X - 14}`} />
			<path d={`M ${RIGHT_X - 20} ${TOP + H / 2 - 6} L ${RIGHT_X - 12} ${TOP + H / 2} L ${RIGHT_X - 20} ${TOP + H / 2 + 6}`} />
			<text x={RIGHT_X - 32} y={TOP + H / 2 - 10}>activate</text>
		</g>

		<!-- After: one mixed solution -->
		<text x={RIGHT_X + W / 2} y="14" class="state">Activated</text>
		{#if container === 'bag'}
			<rect x={RIGHT_X + W / 2 - 14} y={TOP - 14} width="28" height="16" rx="4" class="tab" />
			<rect x={RIGHT_X + W / 2 - 8} y={TOP + H} width="16" height="14" rx="2" class="port" />
		{:else}
			<rect x={RIGHT_X + W / 2 - 22} y={TOP - 12} width="44" height="14" rx="3" class="cap" />
		{/if}
		<g clip-path={`url(#${uid}-right)`}>
			<rect x={RIGHT_X} y={TOP} width={W} height={H} class="mixed" />
		</g>
		<path d={body(RIGHT_X)} class="vessel" />
		<line x1={RIGHT_X} x2={RIGHT_X + W} y1={SEAL_Y} y2={SEAL_Y} class="seal open" />
		{#if concentration != null || final != null}
			<g class="tag" class:calculated>
				<rect x={RIGHT_X + 8} y={TOP + H / 2 - 22} width={W - 16} height="44" rx="5" />
				<text x={RIGHT_X + W / 2} y={TOP + H / 2 - 4} class="primary"
					>{concentration != null ? perMl(concentration) : `${num(final!)} mL`}</text
				>
				<text x={RIGHT_X + W / 2} y={TOP + H / 2 + 12}
					>{concentration != null && final != null ? `${num(final)} mL total` : 'total'}</text
				>
			</g>
		{/if}
	</svg>
	{#if calculated}
		<figcaption>Concentration calculated from content ÷ volume; the label does not state it.</figcaption>
	{/if}
</figure>

<style>
	.dual {
		--dc-glass: #5c6777;
		--dc-plastic-fill: rgba(246, 244, 238, 0.35);
		--dc-cap: #8a94a3;
		--dc-diluent: #2f6fb0;
		--dc-diluent-fill: #d6e8fa;
		--dc-powder: #a86f12;
		--dc-powder-fill: #f6e3b8;
		--dc-final: #127a5a;
		--dc-mixed-fill: #d4ece2;
		--dc-seal: #7a4fb0;
		--dc-text: #1f2733;
		--dc-muted: #5c6777;

		margin: 0;
		max-width: 520px;
	}
	svg {
		display: block;
		max-width: 100%;
		height: auto;
		font-family: inherit;
	}
	.vessel {
		fill: none;
		stroke: var(--dc-glass);
		stroke-width: 2.4;
		stroke-linejoin: round;
	}
	.tab,
	.port,
	.cap {
		fill: var(--dc-cap);
	}
	.tab {
		fill: none;
		stroke: var(--dc-glass);
		stroke-width: 2;
	}
	.diluent {
		fill: var(--dc-diluent-fill);
	}
	.mixed {
		fill: var(--dc-mixed-fill);
	}
	.seal {
		stroke: var(--dc-seal);
		stroke-width: 3;
		stroke-dasharray: 6 3;
	}
	.seal.open {
		stroke-width: 1.5;
		opacity: 0.4;
	}
	.state {
		text-anchor: middle;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		fill: var(--dc-muted);
	}
	.activate path {
		fill: none;
		stroke: var(--dc-seal);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.activate text {
		text-anchor: middle;
		font-size: 11px;
		fill: var(--dc-seal);
	}
	.tag rect {
		fill: #fff;
		fill-opacity: 0.92;
		stroke: var(--dc-final);
		stroke-width: 1;
	}
	.tag.calculated rect {
		stroke-dasharray: 3 2;
	}
	.tag text {
		text-anchor: middle;
		font-size: 10px;
		fill: var(--dc-muted);
		font-variant-numeric: tabular-nums;
	}
	.tag text.primary {
		font-size: 12px;
		font-weight: 600;
		fill: var(--dc-text);
	}
	.callout.diluent {
		--tone: var(--dc-diluent);
	}
	.callout.powder {
		--tone: var(--dc-powder);
	}
	.callout.seal-note {
		--tone: var(--dc-seal);
	}
	.leader {
		fill: none;
		stroke: var(--tone);
		stroke-width: 1;
	}
	.swatch {
		fill: var(--tone);
	}
	.value {
		font-size: 12px;
		font-weight: 600;
		fill: var(--dc-text);
		font-variant-numeric: tabular-nums;
	}
	.caption {
		font-size: 10px;
		fill: var(--dc-muted);
	}
	figcaption {
		margin-top: 0.35rem;
		font-size: 0.8rem;
		color: var(--dc-muted);
	}
</style>
