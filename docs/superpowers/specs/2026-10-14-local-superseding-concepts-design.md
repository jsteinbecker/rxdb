# Local superseding concepts

## Goal
Let a user define a **local clinical drug concept** (SCD- or SBD-like) whose ingredients, strengths and dose form are
correct, and have it **stand in for an RxNorm concept that is wrong or out of date**. Every place that resolves that
RxCUI in the scope sees the local concept instead. The RxNorm concept stays visible as provenance.

The first case is TrophAmine 10%. RxNorm SCD 800611 still lists sodium acetate, sodium chloride and sodium
metabisulfite, and several of its amino-acid strengths are wrong. The current label has none of those salts.

## Decisions
- **A new concept, not an override of the RxNorm one.** An SCD is defined by its ingredients, strengths and dose
  form. Changing those makes it a different concept, not a corrected value on the old one. Overrides on the RxNorm
  `ClinicalDrug` would also be rewritten by `persistCollection` on every concept load.
- **Stored as a `ClinicalDrug` entity.** A local concept is an `Entity` of type `clinical_drug` with a `ClinicalDrug`
  row (`tty` = `SCD` or `SBD`) and an `ExternalIdentifier` in a new `local_concept` namespace (`LC000001`, …). The
  existing formulary, identifier and naming code then works on it unchanged. RxNorm sync never writes the
  `local_concept` namespace, so nothing a sync does can touch these rows.
- **The ingredients live in their own table.** `ClinicalDrug` has no ingredient rows, and `ProductIngredient` hangs
  off a labeled `Product`. A new `local_concept_ingredient` table mirrors `ProductIngredient` (substance by UNII,
  basis, numerator and denominator). Strengths are compared in TypeScript, not with generated `measure` columns.
- **Replacement is a scoped mapping.** An `EntityMapping` with a new `MappingType` value `supersedes` links the local
  concept (subject) to the RxNorm concept (object) in one `Scope`. It already carries an approver, validity,
  `supersededAt` and `invalidatedReason`, so a replacement can be switched off without deleting anything. The local
  concept exists everywhere, but replaces the RxNorm concept only in scopes that have an active mapping. Scope is
  `defaultScope()` for now, as for pharm-class rules.
- **Not `Entity.mergedInto`.** That is global and one-way. A local concept can be withdrawn, and other scopes can still
  use the RxNorm concept.
- **Applied when read; snapshots are never changed.** `details.rxnav` in a cached NDC snapshot stays what RxNav
  returned. The resolver runs in loaders and API handlers, the same pattern as pharm-class rules. Removing a mapping
  restores RxNorm behavior immediately.
- **The name is generated in RxNorm's format.** `quantifiedScdName`, `itemName` and `strengthAsPercent` all parse SCD
  names, so a local concept's name is built from its ingredients the way RxNorm writes one: ingredients sorted
  alphabetically, `name N UNIT/UNIT` joined by ` / `, then the dose form, plus ` [Brand]` for an SBD. Users don't type
  the name.
- **Exports keep the RxNorm code.** Outside systems don't know local IDs. API responses keep `rxcui` as RxNav gave it
  and add a `localConcept` object; nothing that consumers already read is replaced.
- **Separate from NDC-level ingredient corrections.** `details.spl.ingredients.<n>.correction` fixes how one label was
  parsed. This feature fixes the concept definition. A local concept can be pre-filled from corrected label rows, but
  the two are stored and applied independently.

## Data
One migration:

`local_concept`: `id` (= the `clinical_drug` entity id, FK), `generic_id` (nullable FK to another `local_concept`; set
on an SBD to point at its SCD), `brand_name` (nullable; required when `tty` = `SBD`), `dose_form` (RxNorm dose-form
name, e.g. `Injectable Solution`), `evidence_set_id` (SPL set id), `evidence_version` (SPL version or effective date),
`evidence_ndc` (nullable), `note` (nullable), `created_by`, `created_at`, `updated_at`.

`local_concept_ingredient`: `id`, `local_concept_id` (FK), `ordinal`, `substance_unii`, `substance_name`, `basis`
(`StrengthBasis`), `moiety_unii` / `moiety_name` (required when `basis` ≠ `ingredient`), `strength_num_mag`,
`strength_num_uom`, `strength_den_mag` (default 1), `strength_den_uom`. There are no `measure` columns: the
existing `product_ingredient.strength*` measure columns are plain composites that nothing fills. Strengths are compared
in TypeScript on exact rationals normalized to mg/mL (or mEq/mL). Unique on `(local_concept_id, substance_unii)`.

Ionic content (e.g. acetate mEq/L) is **not** an ingredient row. It is optional `ionic_content` JSON on
`local_concept`, shaped like `LabelIngredient.ionicContent`, so the label's electrolyte statement can be shown without
turning it into a fake salt.

`MappingType` gets `supersedes` (an enum migration). `entity_mapping` gets a nullable `superseded_name` (see Drift).
`assertedBySource` = `local` (a new `Source` row, seeded in the migration).

An SBD has no ingredient rows of its own. It inherits them through `generic_id`. `ClinicalDrug.name` is regenerated
whenever the ingredients, dose form or brand change.

## Resolution
`resolveConcept(db, scopeId, rxcuis: string[]) → Map<rxcui, LocalConcept>` (in `src/lib/server/local-concept.ts`):
one query joining `external_identifier (rxnorm_rxcui)` → `entity_mapping (supersedes, scope, valid_to IS NULL,
superseded_at IS NULL)` → `local_concept` + ingredients. RxCUIs with no mapping are missing from the map.

The pure part, `applyLocalConcept(item, local)` (in `src/lib/local-concept-view.ts`), returns a copy of a package or
concept view with `localConcept: { id, code, name, tty, ingredients, supersedes: { rxcui, name } }` added.
`details.rxnav` is left alone. The UI and API decide what to show from `localConcept`.

**SBD → SCD.** An NDC usually resolves to an SBD (TrophAmine NDC 0264-1933-10 → RxCUI 1189640). If the SBD itself has
no mapping but its generic counterpart does (`RxConceptDetails.counterparts`, read with `loadConceptSnapshots`; the
NDC snapshot only carries the SBD's RxCUI), the resolver returns a **derived** local SBD:
the local SCD's ingredients, plus the RxNorm brand. It is marked `derived: true` and has no row of its own. A user
can save it as a real local SBD later.

## Where it is applied
- **Formulary load** (`loadToFormulary`, concept targets): keeps storing RxNorm's name. Local names are applied when
  read, so "Stop superseding" restores the RxNorm name everywhere at once. The origin key stays `rxcui:<RxCUI>`, so
  reloading the same RxCUI finds the same item.
- **Formulary item page** and `formulary-view.ts`: the name and ingredient list come from the local concept, with a
  "Local concept · supersedes RxCUI 800611" badge. The existing `nameOverride` still wins over the generated name.
- **NDC page** (`PackageDetail.svelte`, RxNorm block): show the local concept first, with RxNorm's concept beneath it
  as "RxNorm says", and the differences highlighted (added, removed and changed ingredients).
- **API**: `/api/v1/ndc/[ndc]`, `/api/v1/search`, `/api/v1/search/packages` add `localConcept`.
  `/api/v1/rxcui/names` returns the local name with `superseded: true` alongside the RxNorm name. If the lookup fails,
  responses fall back to RxNorm data, as the pharm-class lookup does in search.
- **Not applied** in sync, staging, `reinterpret`, override propagation or `findEquivalentPackages` matching. Those
  keep working on raw RxCUIs.

## Drift
When a mapping is approved, it stores the RxNorm concept's name in `entity_mapping.superseded_name`. After each
RxNorm concept load (`persistCollection`), every active `supersedes` mapping whose RxNorm concept was just loaded is
compared:
- the concept's name changed → `ReviewItem` kind `local_concept_drift`, severity `info` ("RxNorm changed 800611; check
  whether the local concept is still needed")
- the concept became inactive or remapped (`conceptStatus`, `history`) → same kind, severity `warning`
- the RxNorm ingredients now equal the local ones (same UNIIs and normalized strengths) → severity `info`, suggesting
  the user retire the local concept

The review item sets `mappingId` (which reaches both concepts) and `entityId` = the local concept. Only one open
drift item exists per mapping; a newer finding updates it. Nothing changes automatically.

## UI
- **"Define local concept…"** in the ⋯ menu of the NDC page's RxNorm block and of a concept-backed formulary item.
  It opens an editor:
  - Pre-filled from this NDC's SPL active ingredients, after any ingredient corrections and moiety conversion
    (`IngredientCorrection` shape, GSRS molecular weights), converted to the per-mL strengths RxNorm uses.
  - Each row: substance (UNII type-ahead from `unii_substance`), basis, moiety, strength. Rows can be added or removed.
  - Dose form, with the RxNorm form pre-filled.
  - Optional ionic content from the label's electrolyte statement.
  - The generated name, live, and a diff against the RxNorm concept.
  - Evidence: the SPL set id and version are filled from the NDC and can't be blank.
  - Save creates the local SCD and, unless the box is unticked, an active `supersedes` mapping to the RxNorm SCD in
    the current scope.
- **`/formulary/local-concepts`**: a table of local concepts (code, name, what each one supersedes, scope, open drift
  reviews), with edit, "Stop superseding" (sets `valid_to` on the mapping) and retire. Linked from the formulary eyebrow
  nav next to "Class rules".

## First case: TrophAmine 10%
Evidence: NDC 0264-1933-10 (B. Braun, 500 mL), SPL set `cb6d23ff-3ec5-445a-acbe-f88fd57949bf`, effective
2026-08-19. The NDC resolves to RxCUI 1189640 (SBD), whose generic is SCD 800611.

RxNorm 800611 vs. the label (all strengths in mg/mL):

| Ingredient | RxNorm 800611 | Label | Local concept |
|---|---|---|---|
| sodium acetate | 0.097 MEQ/ML | not listed | removed |
| sodium chloride | 0.003 MEQ/ML | not listed | removed |
| sodium metabisulfite | 0.5 | not listed | removed |
| leucine | 1.4 | 14 | 14 |
| lysine | 1.2 | lysine acetate 12 (lysine 8.51) | lysine 8.51 (basis moiety, from lysine acetate) |
| cysteine | 0.24 | cysteine HCl 0.24 (cysteine 0.166) | cysteine 0.166 (basis moiety, from cysteine HCl) |
| tyrosine | 2.84 | tyrosine 0.44 + N-acetyl-L-tyrosine 2.4 | tyrosine 0.44; N-acetyl-L-tyrosine 2.4 (two rows) |
| isoleucine, methionine, phenylalanine, threonine, tryptophan, valine, histidine, alanine, arginine, proline, serine, glycine, aspartic acid, glutamic acid, taurine | as listed | match | unchanged |

Ionic content from the label: acetate about 96 mEq/L, "provided as acetic acid and lysine acetate"; chloride
< 3 mEq/L. Acetic acid is an inactive ingredient and gets no row.

Setup: a local SCD superseding 800611 in the default formulary scope. The NDC (via SBD 1189640) picks up a derived
local SBD "… [TrophAmine]", with no separate row needed.

## Testing
- `node:test` unit tests:
  - name generation: alphabetical order, RxNorm number formatting (no trailing zeros, leading zero kept), dose form,
    SBD brand suffix; the generated name round-trips through `quantifiedScdName`
  - `applyLocalConcept`: adds `localConcept`, leaves `details.rxnav` untouched, and a missing mapping leaves the item
    unchanged
  - derived SBD: an SBD with no mapping whose counterpart SCD is mapped
  - drift classification: name changed, concept retired/remapped, ingredients now match, nothing changed
  - the diff of RxNorm vs. local ingredients for the TrophAmine table above
- Dev-server check: create the TrophAmine local SCD from NDC 0264-1933-10, then confirm that
  - the NDC page shows the local concept, the RxNorm diff, and acetate as ionic content
  - loading RxCUI 800611 into the formulary gives the local name, and reloading finds the same item
  - `/api/v1/ndc/00264193310` has both `rxcui` and `localConcept`
  - "Stop superseding" brings back RxNorm's name everywhere without a reload of the cache

## Out of scope (follow-ups)
- Saved local SBDs. The schema supports them (`generic_id`, `brand_name`), but this round only creates local SCDs;
  SBD-coded NDCs get the derived SBD.
- Local concepts with no RxNorm concept to supersede (new products RxNorm doesn't have yet).
- Local versions of other term types (SCDC, GPCK/BPCK kits).
- Mapping NDCs straight to a local concept when RxNav gives them no RxCUI.
- Sharing local concepts across scopes, or exporting them as a FHIR `Medication` extension.
- TrophAmine 6%, which isn't in the cache yet. It will need its own local SCD.

## Open questions
- **Scope:** per formulary scope (as written), or global once org scopes exist?
- **N-acetyl-L-tyrosine:** list it as its own row (as written, matching the label), or as tyrosine equivalent
  (1.95 mg/mL, as the NDC directory does)?
- **Basis for salts:** lysine and cysteine are on a moiety basis here, as RxNorm does for amino acids. Confirm that's
  the convention to follow.
