# ILN — Imprint Layout Notation

ILN is a compact string format describing **where** markings sit on a solid oral dosage form: which face, which line, either side of a score, arcs along the rim, rotated text, capsule cap/body print, and which way directional outlines point.

```
F: "50" + "ACME"[RIM:W>N>E] + "MG"[RIM:W>S>E] ; B: "5" | "10"
```

> Front: "50" centered, "ACME" arcing along the top edge, "MG" along the bottom edge. Back: "5" left of a vertical score, "10" right of it.

Shape, color, score count, marking method and hole type are separate fields. ILN references them only where layout depends on them.

ILN is a description aid. For identifying a product for patient care, confirm against package labeling or an authoritative pill-identification source.

## Contents

1. [Use in this codebase](#use-in-this-codebase)
2. [Notation](#iln-notation-reference)
3. [Location codes](#iln-location-codes)
4. [Shapes, holes and direction tags](#shape-definitions)
5. [Converting SPL data and OCR output](#converting-spl-data-and-ocr-output-to-iln)
6. [Gotchas](#gotchas)

## Use in this codebase

All ILN code lives in [src/lib/imprints/](../src/lib/imprints/).

| Module | Responsibility | Main exports |
|---|---|---|
| [iln-parse.ts](../src/lib/imprints/iln-parse.ts) | Parse, validate, canonicalize and explain ILN strings | `parseIln`, `validateIln`, `formatIln`, `explainIln`, `IlnSyntaxError` |
| [iln-location.ts](../src/lib/imprints/iln-location.ts) | Location codes (`PATH:ROUTE@PLACE`), modifiers (incl. legacy forms), OCR baseline → code, face assembly | `parseLocation`, `formatLocation`, `describeLocation`, `parseModifiers`, `locateBaseline`, `buildFace` |
| [spl-to-iln.ts](../src/lib/imprints/spl-to-iln.ts) | SPL XML / flat records → ranked ILN guesses; AST serialization | `guessIln`, `guessFromSplXml`, `guessFromRecord`, `serializeSurfaces`, types `Node`, `Surface`, `IlnGuess` |
| [shapes.ts](../src/lib/imprints/shapes.ts) | Shape and hole vocabularies, direction/hole tags | `SHAPES`, `HOLES`, `findShape`, `findHole`, `isElongated`, `parseShapeOrient`, `parseHoleOrient` |
| [measured-to-iln.ts](../src/lib/imprints/measured-to-iln.ts) | Measured photo layout (from `pill-image-analyze`) → ILN | `measuredToIln` |
| [iln-render.ts](../src/lib/imprints/iln-render.ts) | ILN → marks in a 100×100 box per face, consumed by `PillMockup.svelte` | `drawPill`, `layout`, `PillView`, `PillDrawing` |

### Source precedence when drawing a pill

`drawPill(appearance, doseForm, measured)` picks the notation to render in this order:

1. **Saved ILN** — `appearance.iln`, entered by hand (via property overrides), if it validates.
2. **High-confidence SPL guess** — `guessIln(...)` with `confidence === 'high'`.
3. **Measured photo layout** — when present.
4. **Lower-confidence SPL guess** — fallback.

### Typical usage

```ts
import { validateIln, formatIln, explainIln } from '$lib/imprints/iln-parse';
import { guessFromRecord } from '$lib/imprints/spl-to-iln';

const { ok, issues } = validateIln(src, { shape: 'TEAR' });
const canonical = formatIln(src, { shape: 'TEAR' });
const english = explainIln(src);

const guess = guessFromRecord({ splimprint: 'M;30', splshape_text: 'ROUND', splscore: 2 });
// guess.iln, guess.confidence, guess.notes, guess.alternatives
```

Tests sit beside each module (`*.test.ts`) plus [src/lib/server/iln-render.test.ts](../src/lib/server/iln-render.test.ts) and [src/lib/server/spl-to-iln.test.ts](../src/lib/server/spl-to-iln.test.ts).

### Writing ILN by hand — checklist

1. **Surfaces.** Tablets/softgels: `F`, `B`, optional `E`. Capsules: `CAP(color)`, `BODY(color)`. Always list both faces/halves; use `blank` for unmarked.
2. **Canonical view.** Elongated shapes long axis horizontal; capsules cap on the left; then turn so the longest straight text reads upright. If a directional shape's feature isn't at its default, tag the face (`F[TIP@W]:`).
3. **Pick F.** More marked characters (symbol = 1); tie → scored face.
4. **Flow.** space = same line, `/` = next line, `|` = vertical score, `-` = horizontal score. Quote all text exactly; `\?` for illegible characters.
5. **Out-of-flow items** (arcs, rotated/vertical text, corners, hole rings, capsule print) are attached with `+` and a location code.
6. **Validate and explain** — `validateIln` then `explainIln`, and check the English matches intent.

If a detail is unknown, don't invent it: use centered forms like `RIM:N(cw)` or placeholders like `<symbol>`.

---

## ILN notation reference


Contents: 1 Surfaces · 2 Canonical orientation · 3 Elements · 4 Layout operators · 5 Modifiers · 6 Grammar · 7 Canonical writing rules · 8 Examples

ILN describes *where* markings sit on a solid oral dosage form. Shape, color, score pattern, marking method (imprint/engrave/emboss) and hole shape live in other fields; ILN only references them (score lines as operators, the hole as `<hole>`, colors on surface labels).

Two design rules make it unambiguous:

1. **All literal text is quoted.** Every unquoted character is syntax, so imprints like `"M-30"` or `"A/B"` never collide with operators.
2. **Operators look like the feature they stand for.** `|` vertical score, `-` horizontal score, `/` line break.

### 1. Surfaces

A string is surfaces separated by `;`. Each is `LABEL: layout` or `LABEL: blank`.

| Label | Surface |
|---|---|
| `F`, `B` | Front and back faces (tablets, softgels) |
| `E` | Edge band (side wall) |
| `CAP(color)`, `BODY(color)` | Capsule halves; color required (see [Capsule shells](#capsule-shells) for clear and translucent halves) |
| `CAP+BODY` | Print crossing the capsule seam |

- Any label may take a color: `F(pink)` for bilayer tablets.

#### Capsule shells

A capsule half's color slot also says whether the shell is see-through. A clear or translucent half must state what shows through it: the contents' form, then their color.

| Slot | Shell |
|---|---|
| `CAP(white)` | Opaque white; contents hidden |
| `BODY(clear, powder white)` | Clear, colorless shell over white powder |
| `CAP(translucent blue, pellets orange)` | Blue-tinted see-through shell over orange pellets |

Contents forms: `powder`, `granules`, `pellets`, `beads`, `minitablets`, `liquid`, `gel`, `paste` (singulars such as `pellet` are accepted and canonicalized to these). A clear shell takes no color (write `translucent <tint>` for a tinted one), and an opaque shell takes no contents.

```
CAP(translucent blue, granules white): "AB" ; BODY(clear, granules white): "12"
```
- Faces of directional shapes (tear, bullet, triangle, semicircle …) may take a direction tag after the label and color: `F[TIP@W]`, `B(pink)[FLAT@S]`. See [Shapes](#shape-definitions).
- `F`/`B` (or `CAP`/`BODY`) are always listed, even when blank. `E` and `CAP+BODY` only when marked.
- Never mix tablet labels with capsule labels in one string.

**Which face is F**, in order: (1) more marked characters, each symbol counting 1; (2) the scored face; (3) the face giving the lexically smaller string. Matchers should still treat F/B as unordered.

### 2. Canonical orientation

All positions, scores and rotations refer to one standard view:

- Elongated shapes (see [Shapes](#shape-definitions): OVAL, THIN OVAL, CAPSULE, PAREN, RECTANGLE, BULLET, TEAR, DOUBLE CIRCLE): long axis horizontal.
- Capsules: long axis horizontal, cap on the left, rolled so the cap's print faces the viewer.
- Then rotate (round) or flip 180° (elongated) so the **primary text** reads upright. Primary text = straight-baseline text with the most characters; tie → nearer the center. If on an elongated tablet it runs across the short axis, prefer the orientation that makes it read downward (`LINE>S`) over upward.
- No text: orient so the main symbol is upright; with no symbol either, use the shape's default direction, then the hole's.
- Directional outlines (a tear's tip, a semicircle's flat side) end up wherever the text puts them. Record that with a direction tag when it differs from the shape's default.

### 3. Elements

| Syntax | Meaning |
|---|---|
| `"ABC 10"` | Literal text, case preserved. Spaces inside quotes are real gaps within one text run. Escapes: `\"`, `\\`, `\?` (illegible character). |
| `<name>` | Symbol from a controlled vocabulary: `<heart>`, `<star>`, `<triangle>`, `<line>` (decorative bar, not a score). |
| `<logo:Teva>` | Non-typable logo, qualified by maker. No space after the colon. If a mark can be typed, it is text, not a symbol. |
| `<name: layout>` | Symbol enclosing markings, e.g. `<circle: "5">`. Note the space after the colon. |
| `<hole>` | Placeholder for the through-hole (not a marking); lets markings be placed relative to it. Directional holes take a hole tag: `<hole>[TIP@N]`, `<hole>[UP@E, MIRROR]` (see [Shapes](#shape-definitions)). The hole's shape can be written on the placeholder: `<hole:K>`, `<hole:V>`, `<hole:round>`, or an outline (`<hole:hexagon>`, `square`, `triangle`, `diamond`, `pentagon`, `octagon`, `star`, `heart`, `oval`, `shield`, `cross`, `moon`); it overrides the shape's own hole. A score crossing the hole stays where it is and is broken by it. |
| `<orifice>` | A laser-drilled delivery port (osmotic ER tablets); place it with a location code. |
| `<logo>`, `<symbol>` | Placeholders for an unidentified logo / symbol (used by converters). |
| `blank` | An empty region. As a whole surface body: unmarked surface. As an operand: `B: blank \| blank` = scored, unmarked face. |
| `( layout )` | Grouping. |

### 4. Layout operators (tightest binding first)

| Operator | Meaning |
|---|---|
| `A B` | Same line, A left of B |
| `A / B` | A on the line above B, no score |
| `A \| B` | Vertical score: A left, B right |
| `A - B` | Horizontal score: A above, B below |
| `A + B` | B is also in this region, placed by its own location code |
| `;` | Next surface |

- Scores chain: trisect `"1" | "2" | "3"`.
- Mixing `|` and `-` needs parentheses: cross score `("A" | "B") - ("C" | "D")`.
- Precedence means `"5" / "MG" | "10"` = (5 over MG) left of the score, 10 right.
- `+` binds loosest within a face. Anything with a non-flow location (arcs, rotated or vertical text, corner anchors) is attached with `+`, not juxtaposed. Locations are relative to the enclosing region, so `("5" + <star>[LINE@NW]) | "10"` puts the star in the top-left of the left half.

### 5. Modifiers

Square brackets after any element or group, comma-separated: `"ACME"[RIM:W>N>E, small]`. A group with modifiers is parenthesized: `("5" / "MG")[LINE>S@C]`.

| Kind | Values |
|---|---|
| Location | One location code (see [Location codes](#iln-location-codes)), e.g. `RIM:W>N>E`, `LINE>S@W`, `BODY.MID:RAD>N` |
| Size | `small`, `large` (relative to other markings on the surface), or `fill` (see below) |
| Repeat | `x2`, `x3`: printed n times evenly around a capsule's circumference |
| Side | `back`: capsule print on the side opposite the cap print (same as capsule code `@back`) |
| Method | `deboss` (cut in), `emboss` (raised), `print` (ink on the surface) |
| Ink | `ink:<color>`: a color word (`ink:black`, `ink:dark blue`) or hex (`ink:#1a3c8f`). Implies `print`. |

Canonical order: location, size, repeat, side, method, ink.

**Method and ink** say how a marking is applied when it differs from the product's marking-method field, or when one product mixes methods (an embossed logo beside printed text). On a group they apply to everything inside; an element's own method overrides its group's. Unmarked elements take the surface's usual finish (debossed tablets, printed capsules and softgels).

- `ink:` is only for printed markings: `[deboss, ink:black]` is an error, as are two methods or two inks on one element.
- `formatIln` lowercases both and drops `print` beside an `ink:`, which already implies it.
- Scores, holes and orifices are cuts, not markings; a method on them (or on `blank`) has nothing to mark.

```
F: <logo:Pfizer>[emboss] / "VGR 100"[ink:blue] ; B: blank
CAP(white): "LILLY"[ink:black] ; BODY(blue): ("3105" / "20 mg")[ink:white]
``` 
(Hole tags on `<hole>` come before the location.)

**`fill`** means the element is scaled up, keeping its proportions and its location code, until it takes up most of the space available to it, stopping just short of whatever it would bump into first:

- **Its region's boundary.** The region is the face outline, or the score section it sits in. Score sections are separate regions, so `"5"[fill] | "10"[fill]` sizes each half independently.
- **The hole edge**, if there is one.
- **Any other marking** on the face.

Rules for combining:

- Several `fill` elements in the same region share **equal growth preference**: they grow at the same rate and each stops at its own first obstacle. That gives them equal priority, not equal final size. A short word in a roomy spot can end up larger than a long word in a tight one; write no size modifier on either if they are meant to be the same size.
- Elements without `fill` keep their size and act as fixed obstacles.
- On an arc with a full route (`RIM:W>N>E`), the route already fixes the extent, so `fill` grows the letter height to the track. On a centered arc (`RIM:N(cw)`), the extent grows too.
- `fill` replaces `small`/`large`, so combining them is an error.

ILN does not fix the exact margin left at the stopping point. "Most of the space" is enough to tell a filling element apart from a fixed-size one.

**Legacy shorthands** (still parsed; `formatIln` rewrites them):

| Legacy | Location code |
|---|---|
| `[arc, top]` | `RIM:W>N>E` |
| `[arc, bottom]` | `RIM:W>S>E` |
| `[arc, left]` / `[arc, right]` | `RIM:S>W>N` / `RIM:N>E>S` |
| `[arc, bottom, cw]` | `RIM:E>S>W` |
| `[ring]` | `RIM:N>N(cw)` |
| `[vert]`, `[vert, right]` | `STACK@C`, `STACK@E` |
| `[r90]` / `[r180]` / `[r270]` | `LINE>S@C` / `LINE>W@C` / `LINE>N@C` |
| `[top-left]` etc. | `LINE@NW` etc. |

### 6. Grammar

```
marking = surface { ";" surface }
surface = label [ "(" color ")" ] [ "[" direction "]" ] ":" layout
color   = shell [ "," form " " colorword ]       ; capsule halves; plain color elsewhere
shell   = "clear" | "translucent " colorword | colorword
form    = "powder" | "granules" | "pellets" | "beads" | "minitablets" | "liquid" | "gel" | "paste"
direction = ( "TIP" | "FLAT" | "BASE" | "CORNER" | "LOBE" ) "@" point
label   = "F" | "B" | "E" | "CAP" | "BODY" | "CAP+BODY"
layout  = scored { "+" scored }
scored  = stack { "|" stack } | stack { "-" stack }
stack   = line { "/" line }
line    = item { item }
item    = atom [ "[" mod { "," mod } "]" ]
atom    = text | "<" name [ ":" " " layout ] ">" | "(" layout ")" | "blank"
text    = '"' { char | '\"' | '\\' | '\?' } '"'
```

### 7. Canonical writing rules

- Single spaces around operators; `", "` between modifiers.
- Surfaces in order F, B, E or CAP, BODY, CAP+BODY.
- `+` items ordered clockwise starting from the top; centered items first.
- Omit defaults: no `LINE@C`, no `x1`.
- Colors lowercase.
- Omit a direction tag that equals the shape's default.

`formatIln(src, { shape })` applies all of these (default direction tags only when the shape is given) except F/B swapping and `+` reordering (those change meaning if wrong, so `validateIln` warns instead).

### 8. Examples

```
F: "WATSON" / "349" ; B: "5" | "10"
F: "AN" - "627" ; B: blank
F: "TEVA 3109" ; B: blank | blank                     # score on the unmarked face
F: "10" | "10"[LINE>W@C] ; B: <logo:Teva>             # right half upside down
F: ("A" | "B") - ("C" | "D") ; B: "XYZ"               # cross score
F: "50" + "ACME"[RIM:W>N>E] + "MG"[RIM:W>S>E] ; B: blank
F: "AB" / "12" ; B: <heart: "5">
F: <hole> + "RX 10"[HOLE:N>N(cw)] ; B: blank
F: "ABC 10" ; B: "X"[STACK@C]
F(white): "20" ; B(pink): "P"                          # bilayer
F[TIP@W]: "ABC" ; B: "12"                               # tear: tip on the left of the front
F: "K5" + <hole>[UP@E] ; B: "2" + <hole>[UP@W, MIRROR]   # K-donut
F: "725"[LINE@S, fill] + "MSD"[RIM:N(cw), fill] ; B: blank   # both grow equally
F: "AB\?3" ; B: blank ; E: "12"[BAND:N(cw)]
CAP(white): "LILLY" ; BODY(blue): "3105"
CAP(ivory): blank ; BODY(ivory): "250 mg"[BODY.MID:RAD>N, x2]
CAP(red): "XY" ; BODY(red): "77"[BODY.MID:AX@back]
```

`#` comments above are annotation only; they are not part of ILN.

---

## ILN location codes

Contents: Frame · Syntax · 1 Rim arcs · 2 Inner tracks · 3 Straight baselines · 4 Score-relative · 5 Off-face surfaces · Symbols

### Frame

Everything is in the canonical view (see [Canonical orientation](#2-canonical-orientation)). The 8 compass points N NE E SE S SW W NW are where rays from the face center meet the face **outline**, so the same codes work on round, oval, polygon and irregular shapes. Degrees (0–359, clockwise from N) can replace compass points for finer resolution: `RIM:300>60`. Degrees that equal a compass point are written as the compass name (`315` → `NW`).

Straight text uses a 3×3 zone grid: `NW N NE / W C E / SW S SE`.

### Syntax

`PATH:ROUTE@PLACE`

| Part | Values | Default |
|---|---|---|
| PATH | `RIM`, `MID`, `HOLE`, `ORBIT(<sym>)`, `BEVEL`, `BAND`, `LINE`, `STACK`, `SCORE`, sections, capsule zones | — |
| Curved route | `A>B` short way round; `A>B>C` via B (required for spans ≥ 180°); `A>A(cw)` full ring; `A(cw)` centered at A, extent unknown | — |
| Straight route | `>heading`, compass direction the text reads toward | `>E` |
| Straight place | zone | `@C` |

**Letter-feet rule.** Text reading clockwise along a curve has letter bottoms toward the center; counterclockwise has them toward the edge. The order of route points sets direction, so feet orientation never needs a separate flag. (Mirrored glyphs are a defect, not a layout.)

**Validity.** A two-point route of exactly 180° is ambiguous (add a via point). A route may not reverse direction. Rings and centered forms must state `(cw)` or `(ccw)`. An explicit direction on an open route must agree with the points.

### 1. Rim arcs (following the face edge)

| Code | Span | Reads | Feet | Typical use |
|---|---|---|---|---|
| `RIM:W>N>E` | Top half | cw | in | Classic top arc |
| `RIM:W>S>E` | Bottom half | ccw | out | Classic bottom arc, upright |
| `RIM:E>N>W` | Top half | ccw | out | Top arc, reads upside down |
| `RIM:E>S>W` | Bottom half | cw | in | Bottom arc continuing a ring, upside down |
| `RIM:S>W>N` | Left half | cw | in | Reads upward on the left |
| `RIM:N>E>S` | Right half | cw | in | Reads downward on the right |
| `RIM:N>W>S` / `RIM:S>E>N` | Left / right half | ccw | out | |
| `RIM:W>N`, `RIM:N>E`, `RIM:E>S`, `RIM:S>W` | Quarters | cw | in | Short words in a quadrant |
| `RIM:NW>NE` | Top, centered 90° | cw | in | Short top arc |
| `RIM:SW>SE` | Bottom, centered 90° | ccw | out | Short bottom arc ("MG") |
| `RIM:SW>NW` / `RIM:NE>SE` | Left / right, centered 90° | cw | in | |
| `RIM:NW>N` etc. | 45° | by order | | Single characters near the edge |
| `RIM:W>N>E>S` | 270° | cw | in | Long text wrapping most of the way |
| `RIM:N>N(cw)` | Full ring from N | cw | in | Text all the way around |
| `RIM:S>S(ccw)` | Full ring from S | ccw | out | Ring reading upright at the bottom |
| `RIM:N(cw)` | Centered at N | cw | in | Extent unknown (OCR couldn't measure span) |

Every arc can be reversed; the table lists forms that occur. On polygons and ovals the path follows the outline, so `RIM:SW>SE` on a triangle is straight text along its bottom side.

### 2. Inner tracks

| Code | Meaning |
|---|---|
| `MID:W>N>E` | Arc at mid radius, e.g. inner arc under a rim arc |
| `MID:N>N(cw)` | Ring at mid radius |
| `HOLE:N>N(cw)` | Ring hugging the through-hole (face should include `<hole>`) |
| `HOLE:W>N>E` | Arc above the hole |
| `ORBIT(<heart>):W>N>E` | Arc around another element, which must be on the same surface |

Nested arcs on the same side are listed outer to inner: RIM, MID, HOLE.

### 3. Straight baselines

| Code | Meaning |
|---|---|
| `LINE@C` | Horizontal, centered (default; omit it in ILN) |
| `LINE@N` / `LINE@S` | Horizontal, upper / lower zone |
| `LINE@W` / `LINE@E` | Horizontal, left / right zone |
| `LINE@NW` … `LINE@SE` | Horizontal, in a corner |
| `LINE>S@C` / `LINE>N@C` | Vertical, reading down / up |
| `LINE>N@W` / `LINE>S@E` | Vertical along the left / right side (caplet ends) |
| `LINE>W@C` | Upside down |
| `LINE>NE@C` / `LINE>SE@C` | Diagonal rising / falling |
| `STACK@C`, `STACK@W`, `STACK@E` | Upright letters stacked top to bottom |

Horizontal (`>E`) LINE text is in-flow; in ILN it is usually expressed with `/` and juxtaposition instead of a code. Every other code is out-of-flow and attached with `+`.

### 4. Score-relative

ILN's `|` and `-` already place content *between* scores. These describe text relative to the score line itself:

| Code | Meaning |
|---|---|
| `SCORE:ALONG.N` / `.S` | Parallel to a horizontal score, hugging its north / south side |
| `SCORE:ALONG.W` / `.E` | Parallel to a vertical score, hugging its west / east side |
| `SCORE:ACROSS` | The score runs through the glyphs |
| `SCORE:GAP` | Text in a break of an interrupted score |
| `SCORE:END.N` / `.S` / `.E` / `.W` | Beyond that end of a partial score |
| `HALF.N/S/E/W`, `QUAD.NE/NW/SE/SW`, `THIRD.W/C/E` (or `.N/C/S`) | Flat aliases for score sections, for databases that can't store ILN expressions |

### 5. Off-face surfaces

| Code | Meaning |
|---|---|
| `BAND:N(cw)` | On the side wall (surface `E`), centered at N as seen from F, reading cw, letter bottoms toward B |
| `BAND:N(cw, feet F)` | Same, bottoms toward F |
| `BAND:N>N(cw)` | Full wrap around the side wall |
| `BAND:ACROSS@N` | Running across the side wall from F toward B |
| `BEVEL:<route>` | Any RIM route, on the sloped margin between face and side wall |
| `CAP.MID:AX`, `BODY.MID:AX` | Capsule, axial (along the length), reading toward the body |
| `BODY.MID:AX<` | Axial, upside down |
| `CAP.TIP:…`, `BODY.SEAM:…` | Zones along each half: TIP (domed end), MID, SEAM (near the overlap) |
| `CAP.MID:RAD>N` / `RAD>S` | Radial: around the girth, appearing vertical in the canonical view |
| `BODY.SEAM:RING` | All the way around the circumference |
| `SPAN:AX` | Axial text crossing the seam (surface `CAP+BODY`) |
| `…@back`, `…@90` | Rotation around the long axis from the cap's front print |

Softgels use F/B with the molding seam as the rim, so RIM codes run along the seam.

### Symbols

Symbols take the same codes and behave like a single letter on that baseline: on a cw rim track the top points outward, on a ccw track inward, on `LINE>S` it is turned 90° clockwise.

---

## Shape definitions

Shape is its own field, separate from the ILN string. ILN depends on it in two ways:

- **Elongated** shapes put the long axis horizontal in the canonical view.
- **Directional** shapes record which way the outline points with a per-face tag, e.g. `F[TIP@E]`.

`SHAPES` / `HOLES` in `shapes.ts` hold these tables; `findShape(name)` and `findHole(name)` look one up. Lookup accepts the SPL term, NCI code, the Drugs.com term, a label or an alias, case-insensitively (`oval`, `C48345`, `HEXAGON (6 sided)`, `Capsule/Oblong`, `oblong`, `()`, `U-shape`).

### SPL shapes (FDA value set, NCI concept C48557)

| Shape | NCI code | Elongated | Direction feature | Default |
|---|---|---|---|---|
| BULLET | C48335 | yes | TIP (pointed end) | TIP@E |
| CAPSULE | C48336 | yes | — | |
| CLOVER | C48337 | no | LOBE | LOBE@N |
| DIAMOND | C48338 | no | CORNER | CORNER@N |
| DOUBLE CIRCLE | C48339 | yes | — | |
| FREEFORM | C48340 | no | — | |
| GEAR | C48341 | no | — | |
| HEPTAGON (7 sided) | C48342 | no | TIP (vertex opposite a flat side) | TIP@N |
| HEXAGON (6 sided) | C48343 | no | FLAT or CORNER | FLAT@N |
| OCTAGON (8 sided) | C48344 | no | FLAT or CORNER | FLAT@N |
| OVAL | C48345 | yes | — | |
| PENTAGON (5 sided) | C48346 | no | TIP | TIP@N |
| RECTANGLE | C48347 | yes | — | |
| ROUND | C48348 | no | — | |
| SEMI-CIRCLE | C48349 | no | FLAT (straight side) | FLAT@S |
| SQUARE | C48350 | no | FLAT or CORNER | FLAT@N |
| TEAR | C48351 | yes | TIP | TIP@E |
| TRAPEZOID | C48352 | no | BASE (longer parallel side) | BASE@S |
| TRIANGLE | C48353 | no | TIP (apex) | TIP@N |

CAPSULE here is the outline (straight sides, semicircular ends), not the capsule dosage form. `OBLONG`, `CAPLET` and `STADIUM` are accepted as aliases for it.

### ILN extension shapes

These have no SPL code. When a system only accepts SPL terms, report the fallback.

| Shape | Aliases | Definition | SPL fallback |
|---|---|---|---|
| THIN OVAL | narrow oval, slim oval | Oval whose length is at least twice its width | OVAL |
| PAREN | `()`, `( )`, arched rectangle | Straight top and bottom edges, shallow outward-curved ends like "( )"; flatter ends than CAPSULE's semicircles | CAPSULE (or RECTANGLE) |
| BARREL | Drugs.com "Barrel" | Rectangle-like with bowed sides; possibly the same outline as PAREN | RECTANGLE (or CAPSULE) |
| U-SHAPE | Drugs.com "U-shape" | One straight edge, opposite end fully rounded, like a filled U; taller than a semicircle. Direction: FLAT, default FLAT@N | SEMI-CIRCLE (or FREEFORM) |
| SHIELD | shield-shaped | Flat or slightly convex top, sides curving to a rounded point. Direction: TIP, default TIP@S. Drugs.com files many under U-shape | FREEFORM |
| EGG | Drugs.com "Egg-shape", ovoid | Oval with one narrower end. Elongated; TIP at E or W, default TIP@E | OVAL |
| HEART | Drugs.com "Heart-shape" | Heart outline. Direction: TIP, default TIP@S | FREEFORM |
| KIDNEY | Drugs.com "Kidney-shape", bean | One long side concave. Elongated; NOTCH at N or S, default NOTCH@N | FREEFORM (or OVAL) |
| CHARACTER | Drugs.com "Character-shape" | Figurative outline (animal, cartoon). Describe the figure in free text | FREEFORM |
| DONUT | doughnut, ring, annular | Round outline with a round through-hole (hole field = ROUND) | ROUND |
| V-DONUT | V donut | Round outline with a V-shaped through-hole (hole field = V) | ROUND |
| K-DONUT | K donut | Round outline with a K-shaped through-hole (hole field = K) | ROUND |

THIN OVAL, PAREN, BARREL, EGG and KIDNEY are elongated. To add another extension, add an entry to `SHAPES` in `src/lib/imprints/shapes.ts` (id, label, `source: 'ILN'`, `splFallback`, `elongated`, `features`, `defaultOrient`, description, aliases) and a test in `shapes.test.ts`.

### Drugs.com vocabulary

Drugs.com's pill identifier uses 18 shape categories. They map as follows: Barrel → BARREL, Capsule/Oblong → CAPSULE, Character-shape → CHARACTER, Egg-shape → EGG, Eight-sided → OCTAGON, Oval → OVAL, Figure eight-shape → DOUBLE CIRCLE, Five-sided → PENTAGON, Gear-shape → GEAR, Heart-shape → HEART, Kidney-shape → KIDNEY, Rectangle → RECTANGLE, Round → ROUND, Seven-sided → HEPTAGON, Six-sided → HEXAGON, Three-sided → TRIANGLE, U-shape → U-SHAPE. "Four-sided" is deliberately unmapped: it can be SQUARE, DIAMOND, TRAPEZOID or RECTANGLE, so look at the pill.

### Holes

Hole type is its own field. Known types:

| Hole | Through? | Notes |
|---|---|---|
| ROUND | yes | Centered circular hole (donut/ring tablets). Rare in marketed tablets; common in the extended-release research literature. Place markings with `<hole>` and `HOLE:` codes. |
| ORIFICE | no | Small laser-drilled delivery port on one face of osmotic extended-release (OROS-type) tablets. Mark it with `<orifice>` plus a location code, e.g. `+ <orifice>[LINE@NE]`. |
| V | yes | V-shaped. Direction: `TIP` (the point), default `TIP@S` (an upright V). Symmetric, so never mirrored. |
| K | yes | K-shaped. Direction: `UP` (top of the letter), default `UP@N`. Chiral: reads normally from one face and mirror-reversed from the other. |

To add a hole type, add an entry to `HOLES` in `src/lib/imprints/shapes.ts` (features, default, `chiral`) with a test.

#### Hole tags

A directional hole's orientation is written as modifiers on the `<hole>` placeholder, in that face's canonical view:

```
F: "10" + <hole>[TIP@N] ; B: blank                         # V-donut, V points up on the front
F: "K5" + <hole>[UP@E] ; B: "2" + <hole>[UP@W, MIRROR]      # K-donut
```

- `TIP@point` or `UP@point`, plus `MIRROR` on the face where a chiral hole reads backwards.
- Each face's text sets its view, so each face gets its own tag. The two faces are related only by physics: a K reads mirrored on exactly one face.
- Default tags (`TIP@S` for V, `UP@N` for K, not mirrored) are omitted; `formatIln(src, { shape })` drops them.
- A face with no text is oriented by the shape's default direction, then by the hole's default, so its `<hole>` needs no direction (a K on that face may still need `MIRROR`).
- `validateIln(src, { shape })` checks the tag against the hole type, rejects `MIRROR` on symmetric holes, flags `<hole>` on shapes that have no hole, and errors if both faces of a chiral hole are tagged with the same mirroring.
- Hole tags can be combined with location codes on the same `<hole>`; they are written first.

### Direction tags

Written after the face label (and color): `F[TIP@E]: ...`, `B(pink)[FLAT@S]: ...`.

- Form: `FEATURE@point`. FEATURE is `TIP`, `FLAT`, `BASE`, `CORNER`, `LOBE` or `NOTCH`; point is a compass point or 0–359 degrees.
- The tag describes the outline **in that face's canonical view**. The text sets that view, so it is per face: flipping a tear-shaped tablet over usually moves the tip from E to W.
- Elongated directional shapes are restricted by the horizontal long axis: tips of BULLET, TEAR and EGG sit at E or W; the concave side of KIDNEY at N or S.
- Faces with no text are oriented by the shape's default direction, so they take no tag.
- The default tag is omitted. `formatIln(src, { shape })` drops it for you.
- Squares, hexagons and octagons use FLAT vs CORNER for "flat top" vs "point top". A square printed so it reads like a diamond is `SQUARE` with `CORNER@N`; a true rhombus is `DIAMOND`.

`validateIln(src, { shape })` checks that each tag uses a feature the shape actually has and respects the E/W rule. It also flags tags on faces with no text.

### Example

A tear-shaped tablet: "ABC" on the front reads upright with the tip on the left. The back has "12", and flipping it puts the tip on the right (the default).

```
F[TIP@W]: "ABC" ; B: "12"
```

`explainIln` reads this as: `Front (tip at the left): "ABC"` / `Back: "12"`.

---

## Converting SPL data and OCR output to ILN

### SPL appearance data → ILN (`guessFromSplXml`, `guessFromRecord`)

SPL records *what* is marked, not *where*. `SPLIMPRINT` is a flat string where `;` can separate faces **or** lines on one face, and `SPLSCORE` gives the number of pieces (1 = unscored, 2–4), not the score's position. So the converter returns a ranked guess:

```json
{ "iln": "...", "form": "tablet|capsule|softgel", "confidence": "high|medium|low",
  "notes": ["one per assumption"], "alternatives": [{ "iln": "...", "reason": "..." }] }
```

#### Accepted inputs

- **SPL XML** (full document or fragment). One result per `<subject>` product. Reads `<characteristic>` codes SPLCOLOR, SPLSHAPE, SPLSIZE, SPLSCORE, SPLIMPRINT, SPLSYMBOL, SPLCOATING, plus `formCode` displayName and product `<name>`. Kit parts within one product are merged (limitation).
- **Flat record** (JSON). Keys are case-insensitive: `splimprint`/`imprint`, `splcolor_text`/`color` (`;` or `,` separated), `splshape_text`/`shape`, `splscore`/`score`, `splsymbol`/`symbol`, `splsize`/`size`, `dosage_form`/`form`, `medicine_name`/`name`.

#### Heuristics (each adds a penalty; lowest total wins)

| Situation | Guess |
|---|---|
| Dosage form contains CAPSULE | Two-piece capsule, unless LIQUID FILLED / SOFT → softgel (F/B faces) |
| No dosage form, shape CAPSULE, 2 colors | Capsule (flagged) |
| 1 imprint segment | All on one face, other face blank |
| 2 segments | One per face (alt: stacked on one face) |
| 3+ segments | First alone, rest stacked on the other face (alts listed) |
| F vs B | More marked characters → F |
| Score 2–4 | 1) split text that looks like halves (numeric or identical tokens/lines) → 2) unmarked face → 3) any evenly splittable text → 4) not encoded, with a note |
| Score direction | Elongated shapes (per [Shapes](#shape-definitions)) `\|`; stacked lines on other shapes `-`; tokens `\|` |
| Score 4 | Cross score assumed (could be three parallel scores; noted) |
| `LOGO` / `SYMBOL` token in imprint | `<logo>` |
| SPLSYMBOL true, no logo token | `<symbol>` on an unmarked surface, else attached with `+` |
| Capsule colors | First listed = cap (SPL doesn't say; noted) |
| Capsule, single `WORD 123` segment | Word on cap, number on body |

SPL never says which way a directional outline points, so converter output has no direction tags. Add them from a photo when it matters.

#### Presenting results

Always present SPL-derived ILN as a guess: show the primary string, the confidence, and the notes. When confidence is not `high`, show the alternatives too. If the user has a photo or the physical product, the photo wins. Use `explainIln` to turn the guess into plain English if the user isn't fluent in ILN.

### OCR output → location codes (`locateBaseline`, `buildFace`)

Input JSON:

```json
{
  "face": { "cx": 640, "cy": 480, "rx": 300, "ry": 300, "upDeg": 30,
            "hole": { "cx": 640, "cy": 480, "r": 40 } },
  "elements": [
    { "text": "ACME", "baseline": [{ "x": 0, "y": 0 }, "..."] },
    { "symbol": "heart", "baseline": ["..."] }
  ],
  "options": { "snapToleranceDeg": 10, "degreeStep": 5, "straightness": 0.04, "orbitOf": "<heart>" }
}
```

Or a single `"baseline": [...]` instead of `"elements"` to locate one run.

- Coordinates are image pixels, y down.
- `face`: an ellipse approximating the face outline. `rx` is the half-width along the **canonical** horizontal axis, `ry` the half-height along the canonical vertical.
- `upDeg`: where canonical N points in the image, degrees clockwise from image-up. Determine it from the primary text's orientation (canonical orientation rules) before calling.
- `baseline`: points along the text's baseline **in reading order** (first glyph to last). At least 2 points; 5+ recommended for curved text. Reading order is what determines cw/ccw, so don't sort the points.
- `hole`: optional, enables `HOLE` classification.

What it does: normalizes the face to a unit circle, then:

- **Straight** (max deviation from chord / chord length < 0.04): `LINE` code. Heading snapped to 8 directions; zone from the 3×3 grid (thirds at ±1/3 radius).
- **Curved**: circle fit. Center more than 0.3 radii from the face center → `ORBIT` (set `options.orbitOf`). Near the hole → `HOLE`. Radius ≥ 0.62 → `RIM`, else `MID`.
- Direction from swept angle; ≥ 330° → ring. Endpoints snap to a compass point within 10°, else round to 5°. Via points are inserted for spans ≥ 180°.

With `elements`, the result also includes `face`: the assembled layout (horizontal text in flow, everything else attached with `+` clockwise from the top). Prefix it with the surface label yourself, e.g. `F: ` + face.

Limits: straight text along a flat polygon side comes out as `LINE` (a note suggests `RIM`); zones use baseline points, which sit slightly below the visual center of the text; capsule geometry is not located; scores are not inferred, so wrap the result with `|`/`-` yourself when the OCR detects score lines.

---

## Gotchas

- `-` outside quotes is always a horizontal score. A hyphen in the imprint goes inside the quotes: `"M-30"`.
- `<logo:Teva>` (no space) is a qualified symbol name; `<circle: "5">` (with a space) is a symbol containing markings.
- `"A B"` is one text run with a gap; `"A" "B"` is two elements on the same line.
- A two-point 180° arc (`RIM:W>E`) is invalid — add a via point: `RIM:W>N>E`.
- Several `fill` elements get equal growth priority, not equal size. If two strings must match in size, give neither a size modifier.
- Directional holes (V, K) are tagged on `<hole>`, not the face: `<hole>[UP@E]`. A K hole reads mirrored on one face, which adds `MIRROR`.
- Direction tags are per face; flipping a tear-shaped tablet usually moves the tip from E to W. Faces with no text take no tag.
- A clear or translucent capsule half without its contents' form and color is an error, as is contents on an opaque half.
- Capsule codes (`CAP.MID:AX`) belong only on capsule surfaces; `BAND` codes only on `E`.
- Mixing `|` and `-` requires parentheses.
- SPL-derived ILN is always a guess; capsule cap/body color assignment from SPL is a guess too.
