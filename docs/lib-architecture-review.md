# `$lib` architecture review

This is the original baseline assessment. All three implementation checkpoints are complete; see [current ownership and validation](lib-architecture.md) and [migration operations](package-curation-migration.md).

Reviewed October 19, 2026, against the current working tree.

This review describes the pre-refresh baseline. The [refresh checkpoints and current architecture](lib-architecture.md) record the foundation work now implemented.

## Assessment

The project has a valuable domain core, but its module boundaries have fallen behind its behavior. It is a medication catalog reconciliation and curation system: it discovers external concepts, interprets imperfect package evidence, records provenance, lets users correct that interpretation, promotes selected records into a formulary, and presents those records through several views. Compounding and pill visualization are substantial adjacent capabilities.

The largest maintainability problem is that the effective meaning of a package is distributed across provider enrichment, snapshots, overrides, relational catalog records, local concepts, and presentation fallbacks. A developer must understand too much of the system to change one aspect safely. Moving files alone will improve navigation but will not resolve this.

Recommended direction: preserve the domain rules and tests; establish clear ownership of package interpretation, corrections, and display resolution; then organize files around those responsibilities. Avoid a rewrite or a generic plugin framework.

## Scope and evidence

The inventory contains 199 `.ts` files under `src/lib`: 76 test files and 123 other files, totaling approximately 30,800 non-test lines. The latter count includes test support, documentation examples, and a duplicate source file, so it is not a count of production-only code. There are 74 non-test TypeScript files directly in `$lib`.

I inventoried all TypeScript files and their imports/exports, traced the main catalog and curation paths, inspected representative domain algorithms and tests, and examined route consumers and the schema for context. This is an architecture review, not a line-by-line proof of every parser or a validation of external medical data.

Existing edits were present in `dose-form-correction.ts`, `server/catalog-cache.ts`, `server/catalog-providers.ts`, `server/dose-form-correction.test.ts`, and `spl-sections.ts`. Findings describe the working tree, not an isolated committed revision. Those edits were left untouched.

Validation:

- `npm test`: 891 tests, 888 passed, zero failed, three skipped; approximately 23 seconds. Database integration tests were skipped by the ordinary test configuration.
- `npm run check`: zero errors and four CSS warnings, in `SplPassagePicker.svelte`, `PackageDetail.svelte`, `PropertyOverridePanel.svelte`, and the formulary item page.
- Small direct executions confirmed the parser and arithmetic examples below.
- No database integration suite, live provider validation, production build, or performance benchmark was run.

## How the system fits together

### 1. Discovery, enrichment, and staging

`server/catalog-sync.ts` coordinates external search and package collection. `server/catalog-providers.ts` discovers RxNav concepts, ranks and pages them, expands relationships, calls openFDA and DailyMed, selects package-relevant labels, enriches ingredients, and assembles package results. GSRS contributes substance and molecular-weight knowledge through `server/unii-substance-store.ts`.

Search returns concept results before collecting all package details. Package warm-up runs in the background, and `conceptPackages` shares an in-flight promise between warm-up, expanded rows, and loading. Direct NDC searches collect package facts immediately.

`server/catalog-collection.ts` is a useful small application boundary: normalize NDCs, read cached snapshots, fetch missing or stale packages, merge preserved knowledge, carry user overrides across version changes, and stage refreshed results. Its injected store interface makes the behavior independently testable.

`server/catalog-facts.ts` and the root parsing modules derive package size, dose type, dry-fill status, reconstitution options, volume, and eligibility. Label selection and scope matter: a label may describe several strengths, forms, or kit components, so parsing the right sentence is as important as parsing the number correctly.

`server/catalog-store.ts` writes raw evidence and versioned enrichment snapshots through ingestion/source-record tables. Staging records discoveries without creating canonical catalog entities. Snapshots remove raw XML and evidence arrays because the source records retain those separately.

### 2. Formulary promotion and catalog identity

`loadStagedNode` explicitly promotes a staged concept, package, or curated product set. `server/catalog-formulary.ts` manages scope, origin identity, package membership, naming, and removal. `persistCollection` creates or updates canonical identities and relationships. Transactions and advisory locks protect identity creation, and network work is performed before those transactions.

This distinction between staging and promotion is central to the architecture. Keep it explicit. A search can write provenance and refresh eligibility without implying that every discovered drug belongs in the formulary.

Eligibility is more than a query filter: refreshed evidence can exclude packages, end formulary links, or restore eligible catalog status. `hooks.server.ts` also starts an eligibility reconciliation sweep on startup. Treat eligibility as an application policy with observable effects.

### 3. Human curation

The project has several different correction mechanisms:

- Property overrides alter package facts, retain citations, and may propagate to product siblings or equivalent units of use.
- Reinterpretation fetches new evidence and lets users choose which fields to retain, refresh, or replace.
- Local concepts supply a scope-specific replacement interpretation for an RxNorm concept, including derived branded views.
- Pharmacologic class rules change read-time classification.
- Naming, brand tags, strength styles, equivalence groups, and hierarchy settings customize presentation.

These mechanisms solve different problems and should not become one undifferentiated correction engine. They do need an explicit statement of precedence, persistence, scope, and recomputation behavior.

### 4. Read models and presentation

`server/formulary-view.ts` reconstructs formulary rows from relational identities, snapshots, linked product data, a product directory, pseudo-SCDs, local names, and naming preferences. `formulary-hierarchy.ts` groups those rows using configurable dimensions, narrowing and merging. `item-summary.ts`, `package-title.ts`, ingredient scenarios, and constituent grouping provide alternate summaries of the same underlying facts.

Read-time local concepts and pharmacologic class rules decorate package/tree results. Route handlers compose these operations. The search endpoint is 567 lines and the NDC page server is 483 lines, so application logic also extends beyond `$lib`.

### 5. Adjacent subsystems

Compounding is comparatively cohesive: `compound-builder.ts` solves concentration/dose/volume relationships, `quantity.ts` parses and converts inputs, and `server/compound-store.ts` persists scoped drafts and saved formulas.

Pill visualization is a real subsystem: structured SPL characteristics and label prose feed appearance inference, ILN parsing/validation represents markings and geometry, rendering produces drawings, and server modules find photos, analyze images, run OCR, and cache measurements. Its size reflects a substantial feature rather than simple utility bloat.

## What works and should be preserved

1. **Conservative evidence handling.** Provider failure is distinguished from absence; partial refreshes preserve previous knowledge; ambiguous volume evidence can remain unresolved. This is a stronger foundation than optimistically filling every field.
2. **Traceability.** Raw provider payloads, citations, source identities, correction notes, and historical relationships explain why the catalog says what it says.
3. **Separation of discovery from selection.** Staging versus formulary promotion prevents external search from becoming uncontrolled catalog membership.
4. **Many pure, focused rules.** NDC normalization, search relevance, equivalence, local concept resolution, dose-form correction, and several parsing routines can be tested without a running application.
5. **Meaningful regression coverage.** Fixtures exercise outages, rate limits, sibling labels, kits, dry fills, ingredients, naming, and override propagation. The tests are assets for the refresh.
6. **Practical performance work.** In-flight deduplication, bounded enrichment concurrency, snapshot TTLs, label-free bulk reads, batched resolution, and streamed auxiliary page data show attention to real workloads.
7. **Good seams already exist.** `CollectionStore` and `SubstanceTable` are examples of small interfaces that isolate I/O without building an elaborate dependency injection framework.

## Main findings, ordered by value

### 1. The provider module owns too many layers

`server/catalog-providers.ts` is 2,239 lines. It mixes transport policy, caching, API-key rotation, external payload shapes, discovery/ranking, label matching, domain interpretation, and final package assembly. It also owns shared types such as `ExternalPackage`, `PackageDetails`, and `LabelIngredient`, imported throughout browser-facing code.

Type-only imports from `$lib/server` are not evidence that server code is being shipped to the browser. They are evidence that shared contracts are owned by the wrong layer. `ExternalPackage` itself includes evidence, derived facts, manual overrides, and read-only local-concept decorations: the name no longer describes a clean external-provider result.

**Refresh:** move shared contracts into browser-safe domain modules first. Extract provider transport and provider-specific adapters. Keep package interpretation in one explicit application pipeline that consumes evidence. Avoid replacing the single large module with a collection of providers that each apply competing business rules.

### 2. The snapshot is both a cache and durable application state

Overrides live inside package snapshots. `latestPropertyOverrides` deliberately recovers them from old snapshot versions. Snapshot values already have corrections applied, so removing an override generally requires another provider fetch to recover the original value; `removePropertyOverrides` documents and implements this dependency.

That means cache invalidation and parser version changes affect the storage path for user-authored state. A temporary provider outage can prevent an ordinary correction removal. Raw evidence remains available, but that is not the same as having a directly usable, unmodified normalized baseline.

`readSnapshot` does shallow validation and normalizes names in place. It also contains compatibility handling for older label-ingredient shapes while accepting only the current catalog version. Version rejection and migration responsibilities are blurred.

**Refresh:** distinguish normalized provider baseline, durable user corrections, effective derived facts, and display decoration. Initially preserve existing storage and use adapters; migrate corrections to durable records only after the boundaries are established. A future effective view should be reproducible from a baseline plus corrections, without requiring a successful network request to undo a correction.

### 3. Correction precedence and recomputation are implicit

`property-override-fields.ts` is 846 lines and combines citation contracts, propagation scope, choices, validation, field access, mutation, and pill rendering integration. Applying overrides requires ordered passes, `appliesLast`, volume-affecting flags, correction replacement flags, row removal, and subsequent volume calculations.

Reinterpretation implements a separate merge policy in `server/reinterpret.ts`. Its `richer` heuristic compares array length or serialized size, which measures quantity of data rather than correctness or completeness. This is a review heuristic, not a dependable general resolution rule.

**Refresh:** make precedence a documented and tested policy. Separate correction definitions by domain, while retaining one explicit application order. Reuse derivation functions across refresh, manual override, and reinterpretation. Keep human review decisions distinct from automatic heuristics. Expose which source or correction determined important effective fields.

### 4. There are demonstrably divergent parsing and arithmetic contracts

`concept-fill.ts` and `local-concept.ts` both export `parseScdName` but implement different grammars and output shapes. Executing both on `4 ML pembrolizumab 25 MG/ML Injection` gives:

- Concept fill: ingredient `pembrolizumab`, strength `100 MG/4ML`.
- Local concept parsing: ingredient name `4 ML pembrolizumab`, strength `25 MG/ML`.

Those outputs are not interchangeable. The second parser treats the quantity prefix as part of the ingredient name, potentially changing comparisons and drift interpretation for this name shape.

Strength parsing also appears in `strength.ts`, `ingredient-correction.ts`, `formulary-hierarchy.ts`, SPL checks, and reconstitution helpers. Different source grammars are reasonable; repeated normalization, validation, and identity rules are the consolidation opportunity.

`rational.ts` uses JavaScript-number products and accepts integers outside the safe range. Direct execution of `(MAX_SAFE_INTEGER / 1) × (3 / 1)` returns numerator `27021597764222972`; the exact integer is `27021597764222973`. `compound-builder.ts` separately implements BigInt intermediates and refuses unsafe reduced results. Thus the shared “exact” arithmetic promise is stronger than its implementation guarantees. This demonstrates an edge-case contract defect, not a confirmed error for ordinary formulary doses.

**Refresh:** create one parsed clinical-name representation with source-specific adapters, and one strict strength representation. Retain explicit grammar differences where needed. Consolidate safe arithmetic semantics and decimal parsing; preserve the deliberate distinction between molecular-weight decimal factors and rational quantities. Share unit definitions while allowing different source vocabularies.

### 5. Effective package facts are assembled in several places

Enrichment derives facts, cache merge restores prior facts, overrides recompute selected facts, reinterpretation recomputes volume, and formulary readers add fallbacks and concept inference. Titles, hierarchy placement, summaries, and details consume overlapping representations.

This makes it hard to answer: “Which value wins here, why, and will the other page make the same decision?” Local concepts intentionally remain read-time decorations, but that boundary is enforced mostly by comments and call-site conventions.

**Refresh:** establish a shared effective-package resolution policy and separately named display projections. Reuse the same derived facts for titles, hierarchy, summaries, and details. Keep scope-specific local concept/class decorations outside persisted provider baselines. Do not collapse all display functions into a universal presenter with dozens of flags.

### 6. Persistence responsibilities create a real dependency cycle

`catalog-store.ts` imports `linkPseudoScd` from `pseudo-scd-store.ts`; `pseudo-scd-store.ts` imports snapshot loading from `catalog-store.ts`. This is a runtime cycle. It currently works with the observed call patterns, but it couples repository initialization and complicates isolation.

Other import cycles involve type references, including hierarchy/concept fill and ILN geometry/model relationships. They should not all be described as runtime faults.

**Refresh:** extract snapshot/evidence reads and writes from canonical entity persistence. Put pseudo-SCD backfill orchestration above both repositories. Then `catalog-store` no longer serves simultaneously as snapshot repository, identity repository, eligibility service, and derivation coordinator.

### 7. Cache and background-work policies are scattered

There are provider response caches, search/ranking caches, concept in-flight work, snapshot caches, label-free payload caches, substance caches, reinterpretation preview tokens, image work queues, and a process-local job registry. Several of these are appropriately different; they do not need one universal cache abstraction.

However, warm-up errors are swallowed, process-local jobs are not durable, and preview tokens are local to one process. These become operational limits if deployed across processes or restarted mid-review. They are not proof that the current deployment is broken.

`syncExternalSearch` caches normal results for 12 hours and only shortens approximate results to five minutes; partial results have no corresponding short lifetime there, even though partial package snapshots retry after five minutes. Different cache layers can therefore report stale partial summaries.

`formularyRows` also loads a directory of all matching catalog product identifiers for each invocation, rather than just the products represented in the requested scope. That is a concrete scaling concern; its actual cost needs measurement.

**Refresh:** document keys, ownership, lifetime, invalidation, and deployment assumptions for each cache. Align partial-result retry policies. Log background failures. Constrain directory queries to needed identifiers. Add durable jobs or shared preview storage only when deployment requirements justify them.

### 8. Navigation and test ownership obscure the domains

Seventy-four root modules form one long alphabetic list; many pure-helper tests live under `server`. The test command explicitly selects `server/*.test.ts` and `imprints/*.test.ts`, so moving tests without updating discovery can silently stop running them.

`imprints/iln-location 2.ts` and `imprints/iln-location.ts~` are tracked and byte-identical to `iln-location.ts`. These are actual redundant artifacts. Most of the small domain modules are not.

The README still opens with starter-project instructions, and its collection description includes bounds that differ from the current `MAX_CONCEPTS = 10` and staged/lazy collection flow. Architecture documentation should describe the current system rather than a previous iteration.

**Refresh:** organize by stable domain, colocate tests, make test discovery recursive, remove duplicate backups in a separate cleanup, and write a short architecture/precedence guide. Keep tiny cohesive modules; merge files only when they share a responsibility and lifecycle.

## Proposed organization

A useful destination is a small set of domains, mirrored under SvelteKit's server boundary. Names below are illustrative, not a mandate to create every file immediately.

```text
src/lib/
  catalog/                 shared concept/package contracts and identifiers
  medication/              strengths, units, ingredients, names, equivalence
  labels/                  SPL extraction, scope, appearance text, reconstitution
  curation/                overrides, citations, local concepts, class rules
  formulary/               hierarchy, summaries, settings, display policies
  compounds/               builder and quantity interaction
  imprints/                ILN model, parsing, geometry, rendering
  client/                  browser stores and capture/watch state
  components/              grouped by feature when components are next edited
  shared/                  only genuinely cross-domain helpers
  server/
    providers/             transport, RxNav, openFDA, DailyMed, GSRS, CMS
    catalog/               collect/search/load workflows, evidence and identity stores
    curation/              correction persistence and orchestration
    formulary/             membership and read queries
    compounds/             persistence and scoped operations
    media/                 photos, analysis, OCR, measurement work
    infrastructure/        database client, logging, job progress
```

Dependency direction:

```text
routes / UI
    → application workflows and read projections
    → domain contracts and pure rules

server application workflows
    → provider adapters and repositories
    → database / network / filesystem
```

Browser-safe modules must not require server modules at runtime. Shared contracts should also avoid type-only dependence on server-owned models. Domain rules should not depend on route handlers or database clients. Components can use domain rules without introducing a server dependency.

Do not add a large root barrel or a universal `utils.ts`. Prefer direct imports and a few narrow domain entry points. The existing one-line `index.ts` does not need to become a public export of the entire project.

## Phased refresh

| Phase                                     | Concrete work                                                                                                                                                                             | Completion criterion                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Establish the baseline                 | Retain existing tests; add the quantified-name and arithmetic regression cases; update test discovery before moving tests; document staging, correction precedence, and source ownership. | New cases expose existing divergence; the full existing suite remains included.                                                             |
| 2. Fix ownership without behavior changes | Extract shared contracts, transport, provider adapters, and snapshot repository; break the store/pseudo-SCD cycle. Remove verified duplicate artifacts separately.                        | Browser-facing types no longer originate in provider orchestration; the runtime repository cycle is gone; behavior stays covered.           |
| 3. Consolidate semantics                  | Unify clinical-name parsing outputs, strength validation, unit definitions, safe arithmetic, and common derived-fact recomputation. Preserve source-specific adapters.                    | Refresh, override, and reinterpretation paths follow explicit common contracts and pass boundary cases.                                     |
| 4. Make correction state durable          | Preserve an unmodified normalized baseline; migrate user corrections independently of parser cache versions; add conflict detection when saving against an outdated baseline.             | Corrections survive cache invalidation; removing a correction works without a live provider call; concurrent edits are checked.             |
| 5. Simplify reads and navigation          | Consolidate effective-fact resolution, reduce route orchestration, organize remaining modules/tests by domain, constrain bulk directory queries, and document cache/job policies.         | Package title, detail, summary, and hierarchy agree under partial data and corrections; a developer can trace a feature through one domain. |

Phase 4 is the largest behavioral/storage change and should be a separate project, with a migration and rollback plan. Phases 1–2 provide useful improvement without waiting for it. Avoid mixing broad file moves, parser changes, and a storage migration into one review.

## What would count as success

The goal is fewer concepts to hold in mind, not simply fewer files. A worthwhile refresh should make these statements true:

- A provider adapter fetches and decodes evidence; it does not own the application's shared package model.
- One documented policy explains how baseline facts, preserved stale facts, corrections, and scope-specific views interact.
- A correction can be applied, removed, and replayed independently of network availability.
- Different readers agree on package facts while remaining free to format them differently.
- Exact arithmetic has one explicit safety contract.
- Feature tests live with their domain and are discovered automatically.
- Cache version changes do not dictate the lifetime of user decisions.

The current code is working well enough to support an incremental refresh. Its passing suite and substantial pure-domain logic make that practical. Preserve that investment while removing the accidental coupling around it.
