<script lang="ts">
import type {PillAppearance} from '$lib/spl-characteristics';
import {appearanceText, swatchOf} from '$lib/spl-characteristics';
import {SECTION_TITLES} from '$lib/spl-appearance-text';
import {drawPill, type ShellLook, holeBevel, holeCounter, holeStroke, markTransform, symbolPath} from '$lib/imprints/iln-render';
import type {PillImageLayout} from '$lib/pill-image-layout';
import {page} from '$app/state';

type SymbolMark = Extract<ReturnType<typeof drawPill>['views'][number]['marks'][number], {kind: 'symbol'}>;

let {
      appearance,
      doseForm,
      size = 72,
      compact = false,
      layout = null,
      photoUrl = null
}: {
      appearance: PillAppearance;
      doseForm: string | null;
      size?: number;
      compact?: boolean;
      layout?: PillImageLayout | null;
      photoUrl?: string | null;
} = $props();

let showPhoto = $state(false);
let photoFailed = $state(false);
const photo = $derived(photoFailed ? null : photoUrl);
// The label's own photo, NLM's C3PI archive, or one saved by hand in development.
const photoName = $derived(
      photoUrl?.includes('dailymed') ? 'label photo' : photoUrl?.startsWith('/dev/') ? 'local photo' : 'NLM archive photo'
);

const uid = $props.id();
// Loaded once for every page by the root layout.
const uniformText = $derived(page.data.uniformImprintSize === true);
const drawing = $derived(drawPill(appearance, doseForm, layout, {uniformText}));
// Room for the outline stroke, in box units.
const PAD = 2;
// px per box unit: `size` is a round tablet's width; a capsule is drawn larger.
const scaleOf = (label: string) => (size / 84) * (label.startsWith('CAPSULE') ? 1.3 : 1);
const FACE_NAMES: Record<string, string> = {F: 'Front', B: 'Back', E: 'Edge', CAPSULE: 'Capsule', 'CAPSULE-BACK': 'Capsule, back'};

/** Channel-wise darken for edges and debossing. */
function shade(hex: string, amount: number): string {
      const n = parseInt(hex.slice(1), 16);
      const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - amount)));
      return `rgb(${c.join(',')})`;
}

const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
type Relief = 'capsule' | 'band' | 'flat' | 'bevel' | 'shallow' | 'convex' | 'deep' | 'concave';

/**
 * How the face is lit, from the hand-set profile or the label's own words
 * (`round, biconvex`). Capsules and the edge band are cylinders; a softgel
 * is a deep dome; a tablet nobody describes reads as an ordinary biconvex.
 */
const relief = $derived.by((): ((label: string, finish: string) => Relief) => {
      const words = `${appearance.profile ?? ''} ${appearance.shapeText ?? ''}`.toLowerCase();
      const stated: Relief | null = /concave/.test(words)
            ? 'concave'
            : /bevel/.test(words)
                  ? 'bevel'
                  : /flat/.test(words)
                        ? 'flat'
                        : /shallow/.test(words)
                              ? 'shallow'
                              : /deep/.test(words)
                                    ? 'deep'
                                    : /convex|curved/.test(words)
                                          ? 'convex'
                                          : null;
      return (label, finish) =>
            label.startsWith('CAPSULE') ? 'capsule' : label === 'E' ? 'band' : (stated ?? (finish === 'ink' ? 'deep' : 'convex'));
});

/** Gradient stops per relief: [offset, colour, opacity]. Light falls from the upper left. */
const STOPS: Record<Relief, [number, string, number][]> = {
      // Cylinders: a highlight band above the axis, falling off to both rims.
      capsule: [[0, '#000', 0.12], [0.22, '#fff', 0.6], [0.38, '#fff', 0.15], [0.75, '#000', 0.08], [1, '#000', 0.28]],
      band: [[0, '#fff', 0.35], [0.5, '#fff', 0], [1, '#000', 0.22]],
      // A flat face catches light evenly; only a faint sheen across it.
      flat: [[0, '#fff', 0.22], [0.6, '#fff', 0.04], [1, '#000', 0.06]],
      // Flat face sheen; the bevel ring itself is drawn as a separate, directionally lit band.
      bevel: [[0, '#fff', 0.18], [0.6, '#fff', 0.04], [1, '#000', 0.05]],
      shallow: [[0, '#fff', 0.35], [0.6, '#fff', 0], [1, '#000', 0.1]],
      convex: [[0, '#fff', 0.55], [0.55, '#fff', 0], [1, '#000', 0.18]],
      deep: [[0, '#fff', 0.75], [0.35, '#fff', 0.15], [0.7, '#000', 0.05], [1, '#000', 0.32]],
      // A dish: the upper wall is in shadow, the lower wall faces the light.
      concave: [[0, '#000', 0.16], [0.45, '#000', 0.04], [0.8, '#fff', 0.2], [1, '#fff', 0.5]]
};

/** Where each radial relief's light sits within the face's box. */
const FOCUS: Partial<Record<Relief, {cx: string; cy: string; r: string}>> = {
      flat: {cx: '30%', cy: '25%', r: '95%'},
      bevel: {cx: '30%', cy: '25%', r: '95%'},
      shallow: {cx: '38%', cy: '33%', r: '75%'},
      convex: {cx: '35%', cy: '30%', r: '75%'},
      deep: {cx: '33%', cy: '28%', r: '72%'},
      concave: {cx: '62%', cy: '68%', r: '78%'}
};

/** Width of a bevelled tablet's edge band, in box units. */
// Contents seen through a clear or translucent capsule half: particle size and spacing per form,
// scattered from a fixed seed so the drawing never shifts between renders.
const GRAIN: Partial<Record<ShellLook['form'], {r: number; gap: number}>> = {
      powder: {r: 0.35, gap: 1.3},
      granules: {r: 0.8, gap: 2.2},
      pellets: {r: 1.5, gap: 3.2},
      beads: {r: 1.5, gap: 3.2},
      minitablets: {r: 2.4, gap: 5}
};
function particles(form: ShellLook['form'], x0: number, y0: number, y1: number) {
      const grain = GRAIN[form];
      if (!grain) return [];
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const out: {cx: number; cy: number; r: number; tone: number}[] = [];
      for (let y = y0 + grain.r; y < y1 + grain.r; y += grain.gap)
            for (let x = x0 + grain.r; x < x0 + 50; x += grain.gap)
                  out.push({
                        cx: x + (rand() - 0.5) * grain.gap * 0.5,
                        cy: y + (rand() - 0.5) * grain.gap * 0.5,
                        r: grain.r * (0.8 + rand() * 0.4),
                        tone: rand() - 0.5
                  });
      return out;
}

/**
 * Surface photos, prepared by `scripts/build-pill-textures.ts`: a grey relief map (grain, specks, no
 * colour) blended over any pill, and the photo's own colour, which only a white pill wears.
 */
type Texture = 'tablet' | 'coated-tablet' | 'capsule';
const WHITE = swatchOf('white');
/** Each white tile's mean colour, printed by the build script: what a white pill's shading is cut from. */
const TEXTURE_WHITE: Record<Texture, string> = {tablet: '#fdf4ed', 'coated-tablet': '#f7f6f6', capsule: '#f6f6f6'};
/** One tile in box units: about half a round tablet across, so the grain reads at its true scale. */
const TILE = {width: 64, height: 43.2};

/** Which surface a view wears: capsule gelatin, a film or sugar coat, or bare compressed powder. Softgels stay smooth. */
const textureOf = $derived.by((): ((label: string, finish: string) => Texture | null) => {
      const coated = /coat/i.test(`${doseForm ?? ''} ${appearance.profile ?? ''} ${appearance.shapeText ?? ''}`);
      return (label, finish) =>
            label.startsWith('CAPSULE') ? 'capsule' : finish === 'ink' ? null : coated ? 'coated-tablet' : 'tablet';
});
/** A region's paint: a white pill takes the texture's own white, every other colour stays as stated. */
const paint = (fill: string, tex: Texture | null) => (tex && fill === WHITE ? TEXTURE_WHITE[tex] : fill);

const bevelOf = (view: {width: number; height: number}) => Math.min(view.width, view.height) * 0.07;

const turn = (deg: number) => (deg ? `rotate(${deg} 50 50)` : undefined);
const inkFor = (fill: string) => (luminance(fill) < 0.45 ? '#f4f4f0' : '#26262a');

// The photo takes the mockup's width, so swapping never reflows the row.
const viewsWidth = $derived(
      drawing.views.reduce((sum, view) => sum + (view.width + 2 * PAD) * scaleOf(view.label), 0) +
      (drawing.views.length - 1) * 9.6
);

const tooltip = $derived(
      [
            appearanceText(appearance),
            ...(appearance.labelText
                  ? [`From ${SECTION_TITLES[appearance.labelText.section] ?? 'the label'}: “${appearance.labelText.text}”`]
                  : []),
            ...(photo ? [showPhoto ? 'Click for the mockup' : `Click for the ${photoName}`] : []),
            ...(drawing.saved
                  ? [`ILN (saved): ${drawing.saved}`]
                  : drawing.measured
                        ? [
                              `Layout measured from the ${photoName} (${Math.round(drawing.measured.confidence * 100)}% match)`,
                              ...(drawing.measured.missing.length ? ['Some imprint text was not found in the photo'] : [])
                        ]
                        : [`ILN (${drawing.guess.confidence} confidence): ${drawing.guess.iln}`, ...drawing.guess.notes])
      ].join('\n')
);
</script>

<figure class="pill" title={tooltip}>
      {#if photo}
            <button
                  type="button"
                  class="toggle"
                  aria-pressed={showPhoto}
                  aria-label={showPhoto ? 'Show pill mockup' : `Show ${photoName}`}
                  onclick={() => (showPhoto = !showPhoto)}
            >
                  {#if showPhoto}
                        <img
                              class="photo"
                              src={photo}
                              alt={`${photoName}: ${appearanceText(appearance)}`}
                              width={Math.max(viewsWidth, size)}
                              onerror={() => ((photoFailed = true), (showPhoto = false))}
                        />
                  {:else}
                        {@render views()}
                  {/if}
            </button>
      {:else}
            {@render views()}
      {/if}
      {#if !compact && showPhoto && photo}
            <span class="confidence">{photoName}</span>
      {:else if !compact && drawing.saved}
            <span class="confidence">layout saved by hand</span>
      {:else if !compact && drawing.measured}
            <span class="confidence">layout from {photoName}</span>
      {:else if !compact && drawing.guess.confidence !== 'high'}
            <span class="confidence" data-level={drawing.guess.confidence}>layout {drawing.guess.confidence}
                                                                           confidence</span>
      {/if}
</figure>

<!-- A hole's outline grown by `grow`, so one shape serves as the cut, its wall and its lip. -->
{#snippet holeShape(mark: SymbolMark, grow: number, paint: string, alpha: number, offset: number)}
      {@const width = holeStroke(mark)}
      {@const counter = holeCounter(mark)}
      <g transform={offset ? `translate(${offset} ${offset})` : undefined} opacity={alpha}>
            <g transform={markTransform(mark)} stroke={paint} stroke-linecap="round" stroke-linejoin="round">
                  {#if width}
                        <path d={symbolPath(mark)} fill="none" stroke-width={width + grow}/>
                        {#if counter}
                              <path d={counter} fill={paint} stroke-width={grow || 0.01}/>
                        {/if}
                  {:else}
                        <path d={symbolPath(mark)} fill={paint} stroke-width={grow || 0.01}/>
                  {/if}
            </g>
      </g>
{/snippet}

{#snippet surface(x: number, width: number, fill: string, tex: Texture | null, id: string)}
      {#if tex && fill === WHITE}
            <rect {x} y="0" {width} height="100" fill={`url(#${id}-white)`}/>
      {:else}
            <rect {x} y="0" {width} height="100" {fill}/>
            {#if tex}
                  <!-- Relief only: mid-grey leaves the colour alone, lighter and darker grain lifts and sinks it. -->
                  <rect {x} y="0" {width} height="100" fill={`url(#${id}-grain)`} class="grain"/>
            {/if}
      {/if}
{/snippet}

{#snippet half(x: number, fill: string, look: ShellLook | null | undefined, h: number, tex: Texture | null, id: string)}
      {#if !look}
            {@render surface(x, 50, fill, tex, id)}
      {:else}
            {@const top = 50 - h / 2}
            {@const level = top + h * (look.form === 'liquid' || look.form === 'gel' ? 0.3 : 0.4)}
            <!-- See-through shell, clipped to its own half so contents never cross the seam:
                 a pale, mostly empty shell with the contents settled in its lower part, then the tint. -->
            <svg {x} y="0" width="50" height="100" viewBox={`${x} 0 50 100`} overflow="hidden">
                  <rect {x} y="0" width="50" height="100" fill={look.tint ?? '#f3f6f8'} fill-opacity={look.tint ? 0.28 : 0.55}/>
                  {#if GRAIN[look.form]}
                        {#each particles(look.form, x, level, top + h) as p, i (i)}
                              <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.tone > 0 ? fill : shade(fill, 0.08 + p.tone * -0.2)}
                                      stroke={look.form === 'pellets' || look.form === 'beads' || look.form === 'minitablets' ? shade(fill, 0.3) : 'none'}
                                      stroke-width="0.25"/>
                        {/each}
                  {:else}
                        <rect {x} y={level} width="50" height={top + h - level} {fill}/>
                        <line x1={x} y1={level} x2={x + 50} y2={level} stroke="#fff" stroke-opacity="0.6" stroke-width="0.5"/>
                        {#if look.form === 'liquid'}
                              <circle cx={x + 25} cy={level + (top + h - level) * 0.4} r="2.5" fill="#fff" fill-opacity="0.35"
                                      stroke={shade(fill, 0.25)} stroke-width="0.3"/>
                        {/if}
                  {/if}
                  {#if look.tint}
                        <rect {x} y="0" width="50" height="100" fill={look.tint} fill-opacity="0.22"/>
                  {/if}
                  <!-- Glassy highlight along the upper wall. -->
                  <rect {x} y={top + h * 0.14} width="50" height={h * 0.08} fill="#fff" fill-opacity="0.45"/>
            </svg>
      {/if}
{/snippet}

{#snippet views()}
      <div class="views" class:compact>
            {#each drawing.views as view, v (view.label)}
                  {@const id = `${uid}-${v}`}
                  {@const lit = relief(view.label, view.finish)}
                  {@const tex = textureOf(view.label, view.finish)}
                  {@const base = paint(view.fills[0], tex)}
                  {@const holes = view.marks.filter((m): m is SymbolMark => m.kind === 'symbol' && m.style === 'hole')}
                  <div class="view">
                        <svg
                              viewBox={`${50 - view.width / 2 - PAD} ${50 - view.height / 2 - PAD} ${view.width + 2 * PAD} ${view.height + 2 * PAD}`}
                              width={(view.width + 2 * PAD) * scaleOf(view.label)}
                              height={(view.height + 2 * PAD) * scaleOf(view.label)}
                              role="img"
                              aria-label={`${FACE_NAMES[view.label] ?? view.label} of pill`}
                        >
                              <defs>
                                    <!-- Raised type: the glyph's own alpha as a height map, lit from the upper left,
                                         so its rounded shoulders catch light on one side and fall into shade on the other.
                                         Shade bottoms out near half brightness: a raised mark is the tablet's own colour, never dark. -->
                                    <filter id={`${id}-emboss`} x="-20%" y="-20%" width="140%" height="140%"
                                            color-interpolation-filters="sRGB">
                                          <feGaussianBlur in="SourceAlpha" stdDeviation="0.45" result="height"/>
                                          <feDiffuseLighting in="height" surfaceScale="2.6" diffuseConstant="1"
                                                             lighting-color="#fff" result="light">
                                                <feDistantLight azimuth="225" elevation="38"/>
                                          </feDiffuseLighting>
                                          <feSpecularLighting in="height" surfaceScale="2.6" specularConstant="0.5"
                                                              specularExponent="18" lighting-color="#fff" result="gloss">
                                                <feDistantLight azimuth="225" elevation="38"/>
                                          </feSpecularLighting>
                                          <feComposite in="SourceGraphic" in2="light" operator="arithmetic" k1="0.85" k2="0.48" result="shaded"/>
                                          <feComposite in="gloss" in2="SourceAlpha" operator="in" result="glint"/>
                                          <feComposite in="glint" in2="shaded" operator="arithmetic" k2="0.55" k3="1"/>
                                    </filter>
                                    <!-- Cut type: the same height map read as a dent, so the light falls the other way:
                                         the upper-left walls sit in shade and the lower-right walls face the light. -->
                                    <filter id={`${id}-deboss`} x="-20%" y="-20%" width="140%" height="140%"
                                            color-interpolation-filters="sRGB">
                                          <feGaussianBlur in="SourceAlpha" stdDeviation="0.4" result="depth"/>
                                          <feDiffuseLighting in="depth" surfaceScale="2.4" diffuseConstant="1"
                                                             lighting-color="#fff" result="light">
                                                <feDistantLight azimuth="45" elevation="38"/>
                                          </feDiffuseLighting>
                                          <feComposite in="SourceGraphic" in2="light" operator="arithmetic" k1="0.85" k2="0.45"/>
                                    </filter>
                                    <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
                                          <feGaussianBlur stdDeviation="0.5"/>
                                    </filter>
                                    {#if holes.length}
                                          <mask id={`${id}-holes`} maskUnits="userSpaceOnUse" x="-100" y="-100"
                                                width="300" height="300">
                                                <rect x="-100" y="-100" width="300" height="300" fill="#fff"/>
                                                {#each holes as mark, i (i)}
                                                      {@render holeShape(mark, 0, '#000', 1, 0)}
                                                {/each}
                                          </mask>
                                    {/if}
                                    {#if tex}
                                          {#each ['grain', 'white'] as kind (kind)}
                                                <pattern id={`${id}-${kind}`} patternUnits="userSpaceOnUse"
                                                         width={TILE.width} height={TILE.height}>
                                                      <image href={`/textures/${kind === 'grain' ? 'detail' : 'white'}/${tex}.jpg`}
                                                             width={TILE.width} height={TILE.height} preserveAspectRatio="none"/>
                                                </pattern>
                                          {/each}
                                    {/if}
                                    <clipPath id={`${id}-clip`}>
                                          <path d={view.path} transform={turn(view.rotate)}/>
                                    </clipPath>
                                    {#each view.marks as mark, i (i)}
                                          {#if mark.kind === 'arc'}
                                                <path id={`${id}-arc-${i}`} d={mark.d} fill="none"/>
                                          {/if}
                                    {/each}
                                    {#if lit === 'capsule' || lit === 'band'}
                                          <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
                                                {#each STOPS[lit] as [offset, color, opacity] (offset)}
                                                      <stop {offset} stop-color={color} stop-opacity={opacity}/>
                                                {/each}
                                          </linearGradient>
                                          {#if lit === 'capsule'}
                                                <!-- The domed tips turn away from the viewer, so they darken toward each end;
                                                     the near (left) dome catches a little light first. -->
                                                {@const tip = Math.min(0.5, view.height / 2 / view.width)}
                                                <linearGradient id={`${id}-tips`} x1="0" y1="0" x2="1" y2="0">
                                                      <stop offset="0" stop-color="#000" stop-opacity="0.3"/>
                                                      <stop offset={tip * 0.35} stop-color="#fff" stop-opacity="0.12"/>
                                                      <stop offset={tip} stop-color="#fff" stop-opacity="0"/>
                                                      <stop offset={1 - tip} stop-color="#000" stop-opacity="0"/>
                                                      <stop offset={1 - tip * 0.35} stop-color="#000" stop-opacity="0.1"/>
                                                      <stop offset="1" stop-color="#000" stop-opacity="0.38"/>
                                                </linearGradient>
                                          {/if}
                                    {:else}
                                          <radialGradient id={`${id}-shine`} {...FOCUS[lit]}>
                                                {#each STOPS[lit] as [offset, color, opacity] (offset)}
                                                      <stop {offset} stop-color={color} stop-opacity={opacity}/>
                                                {/each}
                                          </radialGradient>
                                          {#if lit === 'bevel'}
                                                <!-- A band inset along the outline itself, so polygons keep straight bevels and sharp corners;
                                                     the clip trims the outer half of the stroke. -->
                                                <mask id={`${id}-ring-mask`} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"
                                                      x="-100" y="-100" width="300" height="300">
                                                      <path d={view.path} transform={turn(view.rotate)} fill="none" stroke="#fff"
                                                            stroke-width={bevelOf(view) * 2} stroke-linejoin="miter" stroke-miterlimit="10"/>
                                                </mask>
                                                <linearGradient id={`${id}-ring-light`} x1="0.15" y1="0.1" x2="0.85" y2="0.9">
                                                      <stop offset="0" stop-color="#fff" stop-opacity="0.3"/>
                                                      <stop offset="0.45" stop-color="#fff" stop-opacity="0.04"/>
                                                      <stop offset="0.6" stop-color="#000" stop-opacity="0.04"/>
                                                      <stop offset="1" stop-color="#000" stop-opacity="0.2"/>
                                                </linearGradient>
                                          {/if}
                                    {/if}
                              </defs>

                              <g mask={holes.length ? `url(#${id}-holes)` : undefined}>
                              <g clip-path={`url(#${id}-clip)`}>
                                    {#if view.fills.length === 2}
                                          {@render half(0, view.fills[0], view.shells?.[0], view.height, tex, id)}
                                          {@render half(50, view.fills[1], view.shells?.[1], view.height, tex, id)}
                                          <line x1="50" y1="0" x2="50" y2="100" stroke={shade(paint(view.fills[1], tex), 0.3)}
                                                stroke-width="0.8"/>
                                    {:else}
                                          {@render surface(0, 100, view.fills[0], tex, id)}
                                    {/if}

                                    {#each view.marks as mark, i (i)}
                                          {#if mark.kind === 'score' && lit === 'bevel'}
                                                <!-- A V-groove cut like the bevel: its upper-left wall in shade, its lower-right wall lit. -->
                                                {@const g = bevelOf(view) * 1.1}
                                                {@const vertical = mark.x1 === mark.x2}
                                                {#each [[-1, '#000', 0.2], [1, '#fff', 0.3]] as [side, color, opacity] (side)}
                                                      {@const dx = vertical ? (Number(side) * g) / 4 : 0}
                                                      {@const dy = vertical ? 0 : (Number(side) * g) / 4}
                                                      <line
                                                            x1={mark.x1 + dx - (vertical ? 0 : 50)}
                                                            y1={mark.y1 + dy - (mark.y1 === mark.y2 ? 0 : 50)}
                                                            x2={mark.x2 + dx + (vertical ? 0 : 50)}
                                                            y2={mark.y2 + dy + (mark.y1 === mark.y2 ? 0 : 50)}
                                                            stroke={String(color)}
                                                            stroke-opacity={Number(opacity)}
                                                            stroke-width={g / 2}
                                                      />
                                                {/each}
                                          {:else if mark.kind === 'score'}
                                                <line
                                                      x1={mark.x1 - (mark.x1 === mark.x2 ? 0 : 50)}
                                                      y1={mark.y1 - (mark.y1 === mark.y2 ? 0 : 50)}
                                                      x2={mark.x2 + (mark.x1 === mark.x2 ? 0 : 50)}
                                                      y2={mark.y2 + (mark.y1 === mark.y2 ? 0 : 50)}
                                                      stroke={shade(base, 0.32)}
                                                      stroke-width="1.6"
                                                />
                                                <line
                                                      x1={mark.x1 + (mark.x1 === mark.x2 ? 0.9 : -50)}
                                                      y1={mark.y1 + (mark.y1 === mark.y2 ? 0.9 : -50)}
                                                      x2={mark.x2 + (mark.x1 === mark.x2 ? 0.9 : 50)}
                                                      y2={mark.y2 + (mark.y1 === mark.y2 ? 0.9 : 50)}
                                                      stroke="#fff"
                                                      stroke-opacity="0.5"
                                                      stroke-width="0.7"
                                                />
                                          {/if}
                                    {/each}

                                    <!-- Sized to the face so the gradient follows an oval's or capsule's proportions. -->
                                    <rect x={50 - view.width / 2} y={50 - view.height / 2} width={view.width}
                                          height={view.height} fill={`url(#${id}-shine)`}/>
                                    {#if lit === 'bevel'}
                                          <rect x={50 - view.width / 2} y={50 - view.height / 2} width={view.width}
                                                height={view.height} fill={`url(#${id}-ring-light)`} mask={`url(#${id}-ring-mask)`}/>
                                    {/if}
                                    {#if lit === 'capsule'}
                                          <rect x={50 - view.width / 2} y={50 - view.height / 2} width={view.width}
                                                height={view.height} fill={`url(#${id}-tips)`}/>
                                    {/if}

                                    {#each view.marks as mark, i (i)}
                                          {@const
                                                fill = view.fills.length === 2 ? paint(view.fills[(mark.kind === 'text' || mark.kind === 'symbol') && mark.x > 50 ? 1 : 0], tex) : base}
                                          {@const finish = (mark.kind === 'score' ? undefined : mark.finish) ?? view.finish}
                                          {@const color = finish === 'ink'
                                                ? ((mark.kind === 'score' ? undefined : mark.ink) ?? inkFor(fill))
                                                : finish === 'emboss' ? shade(fill, 0.04) : shade(fill, 0.2)}
                                          {#if mark.kind === 'text'}
                                                <g transform={markTransform(mark)} opacity={mark.opacity}>
                                                      <!-- Lit up-left: a cut's lower lip catches light, a raised mark's upper face does, and its foot casts shade. -->
                                                      {#if finish === 'deboss'}
                                                            <!-- The cut's lower-right lip catches the light. -->
                                                            {@const lip = Math.max(0.35, mark.size * 0.045)}
                                                            <text class="glyph" x={mark.x + lip * 0.4} y={mark.y + lip}
                                                                  font-size={mark.size} fill="#fff" fill-opacity="0.6"
                                                            >{mark.text}</text
                                                            >
                                                      {:else if finish === 'emboss'}
                                                            <!-- A soft cast shadow down-right, then a tight contact shadow at the foot. -->
                                                            {@const lift = Math.max(0.35, mark.size * 0.05)}
                                                            <text class="glyph" x={mark.x + lift * 1.2} y={mark.y + lift * 1.6}
                                                                  font-size={mark.size} fill={shade(fill, 0.55)} fill-opacity="0.3"
                                                                  filter={`url(#${id}-soft)`}
                                                            >{mark.text}</text
                                                            >
                                                            <text class="glyph" x={mark.x + lift * 0.3} y={mark.y + lift * 0.45}
                                                                  font-size={mark.size} fill={shade(fill, 0.35)} fill-opacity="0.35"
                                                            >{mark.text}</text
                                                            >
                                                      {/if}
                                                      <text class="glyph" class:ink={finish === 'ink'} x={mark.x}
                                                            y={mark.y} font-size={mark.size} fill={color}
                                                            filter={finish === 'ink' ? undefined : `url(#${id}-${finish})`}
                                                      >{mark.text}</text
                                                      >
                                                </g>
                                          {:else if mark.kind === 'arc'}
                                                <text class="glyph" class:ink={finish === 'ink'}
                                                      font-size={mark.size} fill={color} style:text-anchor={mark.anchor}
                                                >
                                                      <textPath
                                                            href={`#${id}-arc-${i}`}
                                                            startOffset={mark.anchor === 'middle' ? '50%' : '0'}>{mark.text}</textPath
                                                      >
                                                </text
                                                >
                                          {:else if mark.kind === 'symbol' && mark.style === 'hole'}
                                                <!-- Embossed lip: lit up-left, shadowed down-right; the cut itself is masked out below. -->
                                                {@const bevel = holeBevel(mark)}
                                                {@render holeShape(mark, bevel, shade(fill, 0.5), 0.55, 0.5)}
                                                {@render holeShape(mark, bevel, '#fff', 0.7, -0.5)}
                                                {@render holeShape(mark, 0.7, shade(fill, 0.45), 1, 0)}
                                          {:else if mark.kind === 'symbol'}
                                                <path
                                                      d={symbolPath(mark)}
                                                      transform={markTransform(mark)}
                                                      opacity={mark.opacity}
                                                      fill={mark.style === 'fill' ? color : mark.style === 'hole' ? '#f7f8fa' : 'none'}
                                                      stroke={mark.style === 'fill' ? 'none' : mark.style === 'hole' ? shade(fill, 0.45) : color}
                                                      stroke-width={mark.style === 'hole' ? 1.2 : 1}
                                                />
                                          {/if}
                                    {/each}
                              </g>

                              <path d={view.path} transform={turn(view.rotate)} fill="none" stroke={shade(base, 0.35)}
                                    stroke-width="1"/>
                              </g>
                        </svg>
                        {#if !compact && drawing.views.length > 1}
                              <span class="caption">{FACE_NAMES[view.label] ?? view.label}</span>
                        {/if}
                  </div>
            {/each}
      </div>
{/snippet}

<style>
      .pill {
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            gap: 0.2rem;
            margin: 0;
      }

      .toggle {
            all: unset;
            cursor: pointer;
            border-radius: 6px;
      }

      .toggle:focus-visible {
            outline: 2px solid var(--accent, #4a7bd0);
            outline-offset: 2px;
      }

      .photo {
            display: block;
            height: auto;
            border-radius: 4px;
      }

      /* A light diagonal weave for the pill to sit on, so its cast shadow has somewhere to land. */
      .views {
            --stage: #f3f2ee;
            --stage-line: rgb(0 0 0 / 0.045);
            display: flex;
            gap: 0.6rem;
            align-items: center;
            padding: 0.6rem 0.8rem 0.8rem;
            border-radius: 6px;
            background:
                  repeating-linear-gradient(45deg, var(--stage-line) 0 1px, transparent 1px 6px),
                  repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.35) 0 1px, transparent 1px 9px),
                  var(--stage);
            box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.05);
      }

      .views.compact {
            padding: 0.3rem 0.4rem 0.45rem;
            border-radius: 4px;
      }

      .view {
            display: flex;
            flex-direction: column;
            align-items: center;
      }

      svg {
            overflow: visible;
            /* Light falls from the upper left: a soft cast shadow down-right, plus a tight contact shadow. */
            filter: drop-shadow(0.12em 0.22em 0.18em rgb(0 0 0 / 0.22)) drop-shadow(0 1px 1px rgb(0 0 0 / 0.25));
      }

      /* The relief map is centred on mid-grey, which soft-light leaves untouched. */
      .grain {
            mix-blend-mode: soft-light;
      }

      .glyph {
            font-family: ui-rounded, 'SF Pro Rounded', 'Helvetica Neue', Arial, sans-serif;
            font-weight: 700;
            text-anchor: middle;
            dominant-baseline: central;
            letter-spacing: 0.02em;
      }

      .glyph.ink {
            font-weight: 600;
      }

      .caption,
      .confidence {
            font-size: 0.7rem;
            color: var(--muted, #777);
      }

      .confidence[data-level='low'] {
            font-style: italic;
      }
</style>
