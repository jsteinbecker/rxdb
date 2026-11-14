<!--
@component
	Schematic of a dry-fill container after reconstitution, drawn to scale.

	One linear mL → px scale covers every band, so a 0.4 mL powder displacement
	under 9.6 mL of diluent looks as thin as it is. From the top:

	  capacity             top of the body — only when the capacity is known
	  inaccessible volume  hold-up that cannot be withdrawn (alteplase 2 mg:
	                       2.2 mL added, 2 mL withdrawable → 0.2 mL)
	  final volume         what can be drawn up, at the stated concentration
	  diluent              what was added, and which diluent
	  powder displacement  how much the powder raised the level

	Every label but the concentration sits outside the container on a leader
	line to the height it describes; the concentration is printed on the
	solution.

	The outline comes from `SHAPES`: crimp-capped vials for injectables and
	screw-capped bottles for oral powders, each family graded by size. The
	smallest shape that holds the volume is used unless `shape` names one, and
	the SVG is sized in real pixels so a 2 mL vial draws smaller than a bulk one.
-->
<script lang="ts" module>
	export type ContainerKind = 'vial' | 'bottle';

	export interface ContainerShape {
		id: string;
		kind: ContainerKind;
		label: string;
		/** Largest volume, mL, this shape is picked for. */
		upToMl: number;
		bodyW: number;
		bodyH: number;
		neckW: number;
		neckH: number;
		shoulderH: number;
		capW: number;
		capH: number;
		/** Radius of the bottom corners. */
		radius: number;
	}

	/** Container outlines, the smallest first within each kind. */
	export const SHAPES: readonly ContainerShape[] = [
		// Injectable vials: crimp cap over a stopper, narrow neck, sharp shoulder.
		{ id: 'vial-3', kind: 'vial', label: '2–3 mL vial', upToMl: 4, bodyW: 72, bodyH: 104, neckW: 38, neckH: 10, shoulderH: 12, capW: 46, capH: 16, radius: 8 },
		{ id: 'vial-10', kind: 'vial', label: '5–10 mL vial', upToMl: 12, bodyW: 92, bodyH: 150, neckW: 44, neckH: 10, shoulderH: 16, capW: 56, capH: 18, radius: 11 },
		{ id: 'vial-30', kind: 'vial', label: '20–30 mL vial', upToMl: 35, bodyW: 112, bodyH: 196, neckW: 46, neckH: 12, shoulderH: 20, capW: 58, capH: 18, radius: 12 },
		{ id: 'vial-100', kind: 'vial', label: '50–100 mL vial', upToMl: 120, bodyW: 138, bodyH: 232, neckW: 50, neckH: 12, shoulderH: 26, capW: 62, capH: 18, radius: 14 },
		{ id: 'vial-bulk', kind: 'vial', label: 'Pharmacy bulk vial', upToMl: Infinity, bodyW: 164, bodyH: 256, neckW: 54, neckH: 14, shoulderH: 34, capW: 66, capH: 20, radius: 16 },
		// Oral bottles: screw cap, short wide neck, rounded shoulder.
		{ id: 'bottle-60', kind: 'bottle', label: '30–60 mL bottle', upToMl: 75, bodyW: 104, bodyH: 132, neckW: 58, neckH: 8, shoulderH: 22, capW: 66, capH: 26, radius: 14 },
		{ id: 'bottle-150', kind: 'bottle', label: '100–150 mL bottle', upToMl: 175, bodyW: 132, bodyH: 176, neckW: 64, neckH: 8, shoulderH: 30, capW: 72, capH: 28, radius: 18 },
		{ id: 'bottle-250', kind: 'bottle', label: '200–250 mL bottle', upToMl: Infinity, bodyW: 156, bodyH: 218, neckW: 70, neckH: 10, shoulderH: 36, capW: 78, capH: 30, radius: 22 }
	];

	/** The smallest shape of this kind that holds `ml`. */
	export const shapeFor = (kind: ContainerKind, ml: number): ContainerShape =>
		SHAPES.find((shape) => shape.kind === kind && ml <= shape.upToMl) ??
		SHAPES.findLast((shape) => shape.kind === kind)!;
</script>

<script lang="ts">
	interface Props {
		/** Withdrawable volume after reconstitution, mL. */
		finalVolumeMl: number | null;
		/** Diluent added, mL. */
		diluentMl: number | null;
		/** Diluent identity ("SWFI", "lidocaine 1%"), when known. */
		diluentName?: string | null;
		/** Volume the powder adds, mL. Derived from final − diluent when absent. */
		powderDisplacementMl?: number | null;
		/**
		 * Reconstituted volume that cannot be withdrawn mL. Presumed zero unless
		 * the diluent and displacement add up to more than the final volume.
		 */
		inaccessibleMl?: number | null;
		/** Absolute capacity of the container, mL. Not drawn when absent. */
		capacityMl?: number | null;
		/** Stated concentration of the solution, mg/mL. */
		concentrationMgPerMl?: number | null;
		/** Drug content of the container, mg. */
		contentMg?: number | null;
		/** Injectable vial or oral bottle. */
		container?: ContainerKind;
		/** A `SHAPES` id, overriding the size-based pick. */
		shape?: string | null;
	}

	let {
		finalVolumeMl,
		diluentMl,
		diluentName = null,
		powderDisplacementMl = null,
		inaccessibleMl = null,
		capacityMl = null,
		concentrationMgPerMl = null,
		contentMg = null,
		container = 'vial',
		shape = null
	}: Props = $props();

	const uid = $props.id();

	const EPS = 1e-6;
	const pos = (n: number | null | undefined): number | null =>
		n != null && Number.isFinite(n) && n > 0 ? n : null;
	const num = (n: number) => String(Math.round(n * 100) / 100);
	const ml = (n: number) => `${num(n)} mL`;
	const mass = (mg: number) =>
		mg >= 1000 ? `${num(mg / 1000)} g` : mg < 1 ? `${num(mg * 1000)} mcg` : `${num(mg)} mg`;
	const perMl = (mgPerMl: number) =>
		mgPerMl < 1 ? `${num(mgPerMl * 1000)} mcg/mL` : `${num(mgPerMl)} mg/mL`;

	// ── Volumes ────────────────────────────────────────────────────────────────
	const model = $derived.by(() => {
		const final = pos(finalVolumeMl);
		const diluentIn = pos(diluentMl);
		const displacementIn = powderDisplacementMl != null && powderDisplacementMl >= 0 ? powderDisplacementMl : null;
		const added = diluentIn != null ? diluentIn + (displacementIn ?? 0) : null;
		const total = Math.max((final ?? 0) + (pos(inaccessibleMl) ?? 0), added ?? 0);
		if (!(total > 0)) return null;

		const withdrawable = final ?? total - (pos(inaccessibleMl) ?? 0);
		const dead = Math.max(0, total - withdrawable);
		const displacement =
			displacementIn ?? (diluentIn != null && final != null ? Math.max(0, total - dead - diluentIn) : 0);
		const diluent = diluentIn ?? Math.max(0, total - displacement);
		const capacity = pos(capacityMl);
		// Without a capacity the body's top is only headspace; bottles leave
		// room to shake.
		const headspace = container === 'bottle' ? 1.3 : 1.4;
		const scaleMax = Math.max(capacity ?? total * headspace, total);
		const concentration =
			pos(concentrationMgPerMl) ??
			(pos(contentMg) != null && final != null ? contentMg! / final : null);
		return {
			total,
			withdrawable,
			dead,
			displacement,
			diluent,
			diluentKnown: diluentIn != null,
			capacity,
			scaleMax,
			concentration,
			concentrationStated: pos(concentrationMgPerMl) != null,
			overfull: capacity != null && total > capacity * (1 + EPS)
		};
	});

	// ── Geometry ───────────────────────────────────────────────────────────────
	const S = $derived(
		SHAPES.find((candidate) => candidate.id === shape) ??
			shapeFor(container, model ? (model.capacity ?? model.total * 1.15) : 0)
	);
	const bottle = $derived(S.kind === 'bottle');

	const PAD = 14;
	const CAP_Y = 8;
	const g = $derived.by(() => {
		const cx = PAD + Math.max(S.bodyW, S.capW) / 2;
		const L = cx - S.bodyW / 2;
		const R = cx + S.bodyW / 2;
		const nl = cx - S.neckW / 2;
		const nr = cx + S.neckW / 2;
		// The cap overlaps the neck's lip; the neck runs from under it to the shoulder.
		const neckTop = CAP_Y + S.capH - 4;
		const neckBottom = CAP_Y + S.capH + S.neckH;
		const top = neckBottom + S.shoulderH;
		const bottom = top + S.bodyH;
		const r = S.radius;
		// A vial's shoulder breaks sharply off the neck; a bottle's rolls over.
		const k = bottle ? 0.9 : 0.55;
		const shoulderL = `C ${nl} ${neckBottom + S.shoulderH * k}, ${L} ${top - S.shoulderH * (1 - k)}, ${L} ${top}`;
		const shoulderR = `C ${R} ${top - S.shoulderH * (1 - k)}, ${nr} ${neckBottom + S.shoulderH * k}, ${nr} ${neckBottom}`;
		const base = `L ${L} ${bottom - r} Q ${L} ${bottom} ${L + r} ${bottom}
			L ${R - r} ${bottom} Q ${R} ${bottom} ${R} ${bottom - r}`;
		return {
			cx,
			L,
			R,
			nl,
			nr,
			neckTop,
			neckBottom,
			top,
			bottom,
			glass: `M ${nl} ${neckTop} L ${nl} ${neckBottom} ${shoulderL} ${base} L ${R} ${top} ${shoulderR} L ${nr} ${neckTop} Z`,
			// Contents never rise above `top`: the scale's maximum sits there.
			interior: `M ${L} ${top - 4} ${base} L ${R} ${top - 4} Z`,
			colA: R + 9,
			colB: R + 21,
			labelX: R + 64
		};
	});
	const width = $derived(g.labelX + 176);

	const y = (v: number) => (model ? g.bottom - (v / model.scaleMax) * S.bodyH : g.bottom);

	// ── Callouts ───────────────────────────────────────────────────────────────
	const LABEL_H = 30;

	type Callout = {
		key: string;
		/** Height the leader points at. */
		target: number;
		/** Where the leader leaves the container or its bracket. */
		from: number;
		value: string;
		caption: string;
		tone: 'capacity' | 'dead' | 'final' | 'diluent' | 'powder' | 'warn';
		bracket?: { top: number; bottom: number; x: number };
		/** Laid-out label baseline, filled in below. */
		labelY?: number;
	};

	const layout = $derived.by(() => {
		if (!model) return null;
		const m = model;
		const out: Callout[] = [];
		if (m.capacity != null) {
			out.push({
				key: 'capacity',
				target: y(m.capacity),
				from: g.R,
				value: ml(m.capacity),
				caption: `${bottle ? 'Bottle' : 'Vial'} capacity${m.overfull ? ' — exceeded' : ''}`,
				tone: m.overfull ? 'warn' : 'capacity'
			});
		}
		if (m.dead > EPS) {
			const top = y(m.total);
			const bottom = y(m.withdrawable);
			out.push({
				key: 'dead',
				target: (top + bottom) / 2,
				from: g.colA,
				value: ml(m.dead),
				caption: 'Inaccessible volume',
				tone: 'dead',
				bracket: { top, bottom, x: g.colA }
			});
		}
		out.push({
			key: 'final',
			target: y(m.withdrawable),
			from: g.R,
			value: ml(m.withdrawable),
			caption: m.dead > EPS ? 'Final (withdrawable) volume' : 'Final volume',
			tone: 'final'
		});
		if (m.diluent > EPS) {
			const top = y(Math.min(m.total, m.displacement + m.diluent));
			const bottom = y(m.displacement);
			out.push({
				key: 'diluent',
				target: (top + bottom) / 2,
				from: g.colB,
				value: m.diluentKnown ? ml(m.diluent) : `≈ ${ml(m.diluent)}`,
				caption: diluentName ? `Diluent · ${diluentName}` : 'Diluent added',
				tone: 'diluent',
				bracket: { top, bottom, x: g.colB }
			});
		}
		if (m.displacement > EPS) {
			const top = y(m.displacement);
			out.push({
				key: 'powder',
				target: (top + g.bottom) / 2,
				from: g.colB,
				value: ml(m.displacement),
				caption: 'Powder displacement',
				tone: 'powder',
				bracket: { top, bottom: g.bottom, x: g.colB }
			});
		}

		// Spread labels so none overlap, keeping each as near its target as it can:
		// push down past the one above, then pull back up from the floor.
		out.sort((a, b) => a.target - b.target);
		const floor = Math.max(g.bottom, 14 + out.length * LABEL_H);
		let prev = -Infinity;
		for (const c of out) {
			c.labelY = Math.max(c.target, prev + LABEL_H, 14);
			prev = c.labelY;
		}
		let next = floor + LABEL_H;
		for (let i = out.length - 1; i >= 0; i--) {
			out[i].labelY = Math.min(out[i].labelY!, next - LABEL_H);
			next = out[i].labelY!;
		}
		const height = Math.max(g.bottom, out.at(-1)!.labelY! + LABEL_H / 2) + 10;
		return { callouts: out, height };
	});

	// ── Concentration tag ──────────────────────────────────────────────────────
	const tag = $derived.by(() => {
		if (!model?.concentration) return null;
		const top = y(model.withdrawable);
		const bottom = y(model.displacement);
		const lines = [perMl(model.concentration)];
		if (pos(contentMg) != null) lines.push(`${mass(contentMg!)} / ${ml(model.withdrawable)}`);
		const h = lines.length * 14 + 8;
		const w = Math.min(92, S.bodyW - 8);
		// Squeeze the text rather than let it spill past a narrow vial.
		const widest = Math.max(lines[0].length * 7, (lines[1]?.length ?? 0) * 5.6);
		const fit = Math.min(1, (w - 8) / widest);
		// Inside the solution when it fits; otherwise centered on what there is.
		const room = bottom - top;
		const cy = room >= h + 6 ? (top + bottom) / 2 : Math.max((y(model.total) + g.bottom) / 2, top + h / 2);
		return { lines, h, w, fit, cy, calculated: !model.concentrationStated };
	});

	const summary = $derived(
		model
			? [
					model.capacity != null ? `${ml(model.capacity)} ${S.kind}` : S.label,
					`${model.diluentKnown ? '' : 'about '}${ml(model.diluent)} ${diluentName ?? 'diluent'} added`,
					model.displacement > EPS ? `${ml(model.displacement)} powder displacement` : null,
					`${ml(model.withdrawable)} final volume`,
					model.dead > EPS ? `${ml(model.dead)} inaccessible` : null,
					model.concentration ? `at ${perMl(model.concentration)}` : null
				]
					.filter(Boolean)
					.join(', ')
			: ''
	);
</script>

{#if model && layout}
	<figure class="recon" style:max-width={`${width}px`}>
		<svg
			viewBox={`0 0 ${width} ${layout.height}`}
			width={width}
			role="img"
			aria-labelledby={`${uid}-title`}
		>
			<title id={`${uid}-title`}>Reconstitution schematic: {summary}</title>
			<defs>
				<clipPath id={`${uid}-inside`}><path d={g.interior} /></clipPath>
				<linearGradient id={`${uid}-solution`} x1="0" x2="1">
					<stop offset="0" stop-color="var(--rd-diluent-fill-edge)" />
					<stop offset="0.45" stop-color="var(--rd-diluent-fill)" />
					<stop offset="1" stop-color="var(--rd-diluent-fill-edge)" />
				</linearGradient>
				<pattern id={`${uid}-powder`} width="7" height="7" patternUnits="userSpaceOnUse">
					<rect width="7" height="7" fill="var(--rd-powder-fill)" />
					<circle cx="1.6" cy="1.8" r="0.9" fill="var(--rd-powder)" opacity="0.55" />
					<circle cx="5.2" cy="5.1" r="0.8" fill="var(--rd-powder)" opacity="0.45" />
				</pattern>
				<pattern id={`${uid}-dead`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
					<rect width="6" height="6" fill="var(--rd-dead-fill)" />
					<line x1="0" y1="0" x2="0" y2="6" stroke="var(--rd-dead)" stroke-width="1.6" opacity="0.5" />
				</pattern>
			</defs>

			<!-- Closure -->
			{#if bottle}
				<rect x={g.cx - S.capW / 2} y={CAP_Y} width={S.capW} height={S.capH} rx="4" class="cap screw" />
				{#each Array.from({ length: Math.floor((S.capW - 10) / 6) }, (_, i) => i) as i (i)}
					<line
						x1={g.cx - S.capW / 2 + 7 + i * 6}
						x2={g.cx - S.capW / 2 + 7 + i * 6}
						y1={CAP_Y + 4}
						y2={CAP_Y + S.capH - 4}
						class="knurl"
					/>
				{/each}
			{:else}
				<rect x={g.nl + 3} y={CAP_Y + S.capH - 6} width={S.neckW - 6} height="10" rx="2" class="stopper" />
				<rect x={g.cx - S.capW / 2} y={CAP_Y} width={S.capW} height={S.capH} rx="3" class="cap" />
				<rect x={g.cx - S.capW / 2} y={CAP_Y + S.capH - 6} width={S.capW} height="6" class="crimp" />
			{/if}

			<!-- Contents, clipped to the glass -->
			<g clip-path={`url(#${uid}-inside)`}>
				<rect x={g.L} y={y(model.total)} width={S.bodyW} height={g.bottom - y(model.total)} fill={`url(#${uid}-solution)`} />
				{#if model.displacement > EPS}
					<rect
						x={g.L}
						y={y(model.displacement)}
						width={S.bodyW}
						height={Math.max(1.5, g.bottom - y(model.displacement))}
						fill={`url(#${uid}-powder)`}
					/>
					<line x1={g.L} x2={g.R} y1={y(model.displacement)} y2={y(model.displacement)} class="edge powder" />
				{/if}
				{#if model.dead > EPS}
					<rect
						x={g.L}
						y={y(model.total)}
						width={S.bodyW}
						height={Math.max(1.5, y(model.withdrawable) - y(model.total))}
						fill={`url(#${uid}-dead)`}
					/>
				{/if}
				<!-- Meniscus -->
				<path
					d={`M ${g.L} ${y(model.total) - 3} Q ${g.cx} ${y(model.total) + 4} ${g.R} ${y(model.total) - 3}`}
					class="meniscus"
				/>
				<line x1={g.L} x2={g.R} y1={y(model.withdrawable)} y2={y(model.withdrawable)} class="edge final" />
			</g>

			<!-- Glass or plastic, drawn over the contents -->
			<path d={g.glass} class="vessel" class:plastic={bottle} />
			<path d={`M ${g.L + 9} ${g.top + 6} L ${g.L + 9} ${g.bottom - S.radius - 4}`} class="glint" />
			{#if model.capacity != null}
				<line x1={g.L} x2={g.R} y1={y(model.capacity)} y2={y(model.capacity)} class="edge capacity" />
			{/if}

			<!-- Concentration, printed on the solution -->
			{#if tag}
				<g class="tag" class:calculated={tag.calculated}>
					<rect x={g.cx - tag.w / 2} y={tag.cy - tag.h / 2} width={tag.w} height={tag.h} rx="5" />
					{#each tag.lines as line, i (i)}
						<text
							x={g.cx}
							y={tag.cy - tag.h / 2 + 15 + i * 14}
							class:primary={i === 0}
							style:font-size={`${(i === 0 ? 12 : 10) * tag.fit}px`}
						>{line}</text>
					{/each}
				</g>
			{/if}

			<!-- Callouts -->
			{#each layout.callouts as c (c.key)}
				<g class={`callout ${c.tone}`}>
					{#if c.bracket}
						<path
							d={`M ${c.bracket.x - 4} ${c.bracket.top} H ${c.bracket.x} V ${c.bracket.bottom} H ${c.bracket.x - 4}`}
							class="bracket"
						/>
					{/if}
					<path
						d={`M ${c.from} ${c.target} H ${g.labelX - 26} L ${g.labelX - 10} ${c.labelY} H ${g.labelX - 4}`}
						class="leader"
					/>
					<circle cx={c.from} cy={c.target} r="2" class="dot" />
					<rect x={g.labelX} y={c.labelY! - 11} width="3" height="24" rx="1.5" class="swatch" />
					<text x={g.labelX + 9} y={c.labelY! - 1} class="value">{c.value}</text>
					<text x={g.labelX + 9} y={c.labelY! + 12} class="caption">{c.caption}</text>
				</g>
			{/each}
		</svg>
		{#if tag?.calculated}
			<figcaption>Concentration calculated from content ÷ final volume; the label does not state it.</figcaption>
		{/if}
	</figure>
{/if}

<style>
	.recon {
		--rd-glass: #5c6777;
		--rd-glass-fill: rgba(232, 240, 248, 0.25);
		--rd-plastic-fill: rgba(246, 244, 238, 0.35);
		--rd-cap: #8a94a3;
		--rd-crimp: #b4bcc8;
		--rd-screw: #e9edf2;
		--rd-stopper: #4a515c;
		--rd-diluent: #2f6fb0;
		--rd-diluent-fill: #d6e8fa;
		--rd-diluent-fill-edge: #bcd7f2;
		--rd-powder: #a86f12;
		--rd-powder-fill: #f6e3b8;
		--rd-dead: #7b8594;
		--rd-dead-fill: #e7eaee;
		--rd-final: #127a5a;
		--rd-warn: #b42318;
		--rd-text: #1f2733;
		--rd-muted: #5c6777;

		margin: 0;
	}

	svg {
		display: block;
		max-width: 100%;
		height: auto;
		font-family: inherit;
	}

	.vessel {
		fill: var(--rd-glass-fill);
		stroke: var(--rd-glass);
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.vessel.plastic {
		fill: var(--rd-plastic-fill);
		stroke-width: 2.4;
	}

	.cap {
		fill: var(--rd-cap);
	}
	.cap.screw {
		fill: var(--rd-screw);
		stroke: var(--rd-glass);
		stroke-width: 1.5;
	}
	.knurl {
		stroke: var(--rd-glass);
		stroke-width: 0.8;
		opacity: 0.45;
	}
	.crimp {
		fill: var(--rd-crimp);
	}
	.stopper {
		fill: var(--rd-stopper);
	}

	.glint {
		stroke: #fff;
		stroke-width: 3;
		stroke-linecap: round;
		opacity: 0.55;
	}

	.meniscus {
		fill: none;
		stroke: var(--rd-diluent);
		stroke-width: 1.2;
		opacity: 0.7;
	}

	.edge {
		stroke-width: 1.2;
	}
	.edge.final {
		stroke: var(--rd-final);
		stroke-dasharray: 5 3;
		stroke-width: 1.5;
	}
	.edge.powder {
		stroke: var(--rd-powder);
		opacity: 0.6;
	}
	.edge.capacity {
		stroke: var(--rd-glass);
		stroke-dasharray: 2 3;
	}

	.tag rect {
		fill: #fff;
		fill-opacity: 0.92;
		stroke: var(--rd-diluent);
		stroke-width: 1;
	}
	.tag.calculated rect {
		stroke-dasharray: 3 2;
	}
	.tag text {
		text-anchor: middle;
		font-size: 10px;
		fill: var(--rd-muted);
		font-variant-numeric: tabular-nums;
	}
	.tag text.primary {
		font-size: 12px;
		font-weight: 600;
		fill: var(--rd-text);
	}

	.callout {
		--tone: var(--rd-glass);
	}
	.callout.dead {
		--tone: var(--rd-dead);
	}
	.callout.final {
		--tone: var(--rd-final);
	}
	.callout.diluent {
		--tone: var(--rd-diluent);
	}
	.callout.powder {
		--tone: var(--rd-powder);
	}
	.callout.warn {
		--tone: var(--rd-warn);
	}

	.leader,
	.bracket {
		fill: none;
		stroke: var(--tone);
		stroke-width: 1;
	}
	.bracket {
		stroke-width: 1.4;
	}
	.dot,
	.swatch {
		fill: var(--tone);
	}
	.value {
		font-size: 12px;
		font-weight: 600;
		fill: var(--rd-text);
		font-variant-numeric: tabular-nums;
	}
	.caption {
		font-size: 10px;
		fill: var(--tone);
	}

	figcaption {
		margin-top: 0.25rem;
		color: var(--rd-muted);
		font-size: 0.75rem;
	}
</style>
