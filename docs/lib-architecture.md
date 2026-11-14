# Library architecture and refresh checkpoints

## Purpose and main flow

RxDB reconciles external medication evidence into a locally curated formulary. Search and collection stage evidence; explicit loading creates catalog identities and formulary membership. Human corrections and scope-specific views are separate decisions.

```text
RxNav discovery ──→ concepts and package identifiers
                           │
openFDA / DailyMed / GSRS ──┴─→ package interpretation
                                       │
                               evidence + snapshots
                                       │ explicit load
                            catalog identities + formulary links
                                       │
                      scope-specific classification, names, and views
```

Search can update provenance and package eligibility; it does not automatically promote every discovered package into a formulary.

For a one-line summary of every module and component, see the [module reference](lib-modules.md).

Checkpoint sections record their state at completion. The final implementation below supersedes earlier deferrals and schema limitations.

## Current ownership

| Responsibility                                                                                      | Owner                                                                |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Browser-safe package, concept, ingredient, and staged-result contracts                              | `src/lib/catalog/types.ts`                                           |
| Timeouts, shared provider responses, rate-limit retries, key rotation, forced-response invalidation | `src/lib/server/providers/transport.ts`                              |
| RxNav discovery, relationship traversal, ranking, facets, and concept pages                         | `src/lib/server/providers/rxnav.ts`                                  |
| Ordered bounded provider concurrency                                                                | `src/lib/server/providers/concurrency.ts`                            |
| Multi-provider package interpretation and assembly                                                  | `src/lib/server/catalog/enrich-packages.ts`                          |
| Snapshot reads, evidence writes, source hashing, staging, and concept snapshot lookup               | `src/lib/server/catalog/snapshot-store.ts`                           |
| Canonical entity writes and eligibility reconciliation                                              | `src/lib/server/catalog/entity-store.ts`                             |
| Read-through package collection                                                                     | `src/lib/server/catalog/collection.ts`                               |
| Search/load orchestration                                                                           | `src/lib/server/catalog/sync.ts`                                     |
| Formulary membership and origins                                                                    | `src/lib/server/formulary/membership.ts`                             |
| Effective formulary rows and hierarchy grouping                                                     | `src/lib/server/formulary/read.ts`, `src/lib/formulary/hierarchy.ts` |
| Safe rational operations                                                                            | `src/lib/medication/rational.ts`                                     |

Checkpoint 2 adds these browser-safe domain owners:

| Responsibility                                                                   | Owner                                  |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| Strict decimal strength grammar and exact comparison/classification identity     | `src/lib/medication/strength.ts`       |
| Shared clinical-name parsing, with display-specific adapters in existing callers | `src/lib/medication/clinical-name.ts`  |
| Package interpretation, volume derivation, and eligibility rules                 | `src/lib/catalog/package-facts.ts`     |
| Preserving refresh merges, ordered overrides, and derived-value recomputation    | `src/lib/catalog/effective-package.ts` |
| Pure field-review merge and final preview rows                                   | `src/lib/catalog/review-package.ts`    |
| Shared catalog fallbacks for formulary titles and ingredient grouping            | `src/lib/catalog/package-view.ts`      |

Shared contracts must not depend transitively on server modules. A recursive dependency test enforces this for contracts, effective resolution, review, read projections, and clinical parsing, including type-only imports. Server modules can import domain contracts; domain contracts cannot import server orchestration.

The snapshot repository does not import canonical catalog persistence. Catalog persistence and pseudo-SCD backfill can both use it, removing their former runtime dependency cycle. Evidence writes can participate in the caller's transaction through `recordEvidence`; staging supplies its own transaction as before. SQL, locking, snapshot versions, and database schema were not changed by the extraction.

## Current resolution rules and limits

The flows share derivation and correction policy, while discovery, explicit user review, and display fallbacks retain their distinct responsibilities:

1. Provider enrichment selects package-relevant evidence and derives normalized facts. Outages are distinct from confirmed absence. Structured routes take precedence over label-prose fallbacks.
2. Collection merges refreshed data with stored knowledge. Incomplete responses preserve selected previous facts. This policy lives in `catalog/effective-package.ts` alongside correction resolution; it is deliberately field-specific.
3. The shared `resolveEffectivePackage` applies non-volume overrides before volume derivation and explicit volume corrections afterward. A manual dose-form change derives dry-fill state and clears the superseded automatic dose-form correction. An explicit dry-fill override wins regardless of insertion order. Overrides can propagate according to product and unit-of-use scope; a sibling's own correction is preserved.
4. Reinterpretation is an explicit user-selected merge in `reviewPackage`. It recomputes affected volume facts and then applies retained corrections through the shared resolver. Replacing a whole detail section removes nested overrides owned by that section. Preview rows describe the final resolved result. Its existing "incomplete" heuristic still compares data size; it does not establish clinical correctness.
5. Snapshot reads normalize a copy and replay current corrections. Formulary reads use `packageView` to combine snapshots with relational identity/product fallbacks once for both titles and ingredient grouping. Concept fill supplies missing ingredients/forms and marks inference. Local concepts and pharmacologic class rules are read-time, scope-specific decorations and must not be written into provider baselines. Strength display styles (`src/lib/medication/strength-style.ts`: scope rules, optionally per item) are the same kind of decoration: names, titles, hierarchy labels and active-ingredient cells are restated at read time (`1:100,000`, `0.9%`), while grouping keys, sums and stored strengths keep their units.
6. Item naming applies the user's name override before normal display restatement; local/pseudo concept names supply the underlying name where applicable.

Checkpoint 3 resolves this former limitation with durable baselines and independent corrections; see the final implementation below.

## Arithmetic and clinical names

`rational.ts` accepts only safe integer components, reduces BigInt intermediates before checking the public number representation, and returns `null` when a result cannot be represented safely. Comparison uses exact cross-products and returns -1, 0, or 1; invalid comparison operands throw a `RangeError`. The compound builder uses these shared operations rather than its former private implementation.

`fromNumber` still reconstructs fractions using a documented tolerance and denominator bound. This checkpoint does not claim arbitrary-precision decimal parsing or replace the separate decimal molecular-weight implementation.

Clinical names now have one grammar in `medication/clinical-name.ts`. Local concept and formulary-fill functions are adapters over that representation. The fill adapter requires an unbranded name with a dose form and removes display-only bulk/release qualifiers; the local adapter permits branded names and strength-only names. Both handle quantity prefixes and compendial ingredient qualifiers consistently.

The strength grammar preserves decimal text, supports bracketed units and microgram aliases, and rejects malformed suffixes, invalid comma grouping, and non-positive magnitudes. Storage and ingredient-editing shapes are adapters over that grammar. Local strength comparison and pharmacologic class keys share an exact BigInt identity using the common mass/volume factors; decimal precision is not lost through a floating-point conversion. Hierarchy display uses the shared grammar but keeps its own formatting and conservative summation policy. Unitless `/1` denominators normalize away; non-unit denominators remain visible.

Not every source-specific parser has been replaced: SPL structures, label prose, molecular-weight decimal factors, and tolerant numeric input still need their own contracts. This checkpoint does not claim arbitrary-precision arithmetic throughout the application.

## Checkpoint 1 scope and validation

This checkpoint implements the foundation work from the architecture review: recursive test discovery, shared contracts, provider transport/RxNav extraction, snapshot/evidence separation, dependency-cycle removal, targeted defect fixes, and removal of two verified duplicate imprint backup files.

`npm test` discovers `src/lib/**/*.test.ts`, including root-level and nested domain tests. Keep database integration tests opt-in through `npm run test:db`; ordinary discovery includes them but their explicit skip guards remain in force.

New regressions cover quantified-name identity, unsafe arithmetic, exact comparison, staging without promotion, snapshot hashing, cache isolation/invalidation, cross-version override recovery, and the browser/server contract boundary. Existing provider fixtures continue to exercise retries, caching, discovery, and package enrichment through the extracted modules.

Checkpoint 2 below implements strength/name consolidation and shared effective resolution. Further provider-specific package adapters and broad domain folder moves remain deferred.

Validation completed for this checkpoint:

- Offline suite: 900 tests discovered, 897 passed, zero failed, three database tests skipped by their opt-in guards.
- PostgreSQL suite: all three integration tests passed outside the sandbox, using the existing rollback-only fixtures. The driver emitted a concurrent-query deprecation warning during the local-concept test.
- Svelte/TypeScript: zero errors and the same four pre-existing CSS warnings.
- Production build: passed; adapter-auto reported that a deployment target has not been configured.
- Scoped ESLint: passed for the extracted modules and changed core logic.
- Runtime import audit: no cycles found among non-test TypeScript modules in `$lib`.
- `git diff --check`: passed.

The pre-existing dose-form, SPL-section, and catalog-cache edits were preserved. No schema migration, deployment, or commit was performed.

## Checkpoint 2 scope

The second checkpoint consolidates strength grammar and identities, clinical-name parsing, package resolution, and review merging. Pure package facts moved out of `server`; the old override-only server module was removed, and consumers import the domain owners directly.

Behavioral fixes covered by regressions:

- Retained manual volume corrections survive reinterpretation and later derivation.
- Replacing a detail section removes its nested overrides, avoiding stale corrections over fresh facts.
- Manual dose-form edits update dry-fill classification and its dependent volume facts.
- Existing snapshots replay current correction rules without mutating the stored input object.
- Oral powder grouping uses the same dose-form fallback as its title, preserving the concentration denominator.
- Local comparison and classification agree on exact decimals and unit aliases.
- Clinical-name consumers agree on quantified names, bracket units, time denominators, and compendial qualifiers; malformed or zero strengths are rejected consistently.

The database schema and provider acquisition workflow remain unchanged. The third checkpoint should separate durable corrections from the provider baseline, provide offline correction removal and replay, and add stale-baseline/conflict detection. A migration and rollback plan are required for that storage change. Read-time classification and local concepts must remain outside persisted provider baselines.

Checkpoint 2 validation:

- Offline suite: 917 tests discovered, 914 passed, zero failed; three PostgreSQL tests skipped by their opt-in guards.
- PostgreSQL suite: all three rollback-only integration tests passed. The existing concurrent-query driver deprecation warning remains.
- Svelte/TypeScript: zero errors; the same four CSS warnings remain.
- Production build and scoped ESLint passed.
- Runtime import audit found no cycles in non-test library TypeScript modules. The transitive browser/server boundary test passed for the expanded pure domain surface.
- `git diff --check` passed.

No database migration, deployment, or commit was performed for this checkpoint.

## Checkpoint 3: final implementation

The library now groups pure code under `catalog`, `medication`, `labels`, `curation`, `formulary`, `compounds`, `imprints`, and `shared`. Browser helpers live in `client`; components retain their existing component tree. Server code mirrors workflow ownership under `server/catalog`, `server/curation`, `server/formulary`, `server/providers`, `server/medication`, `server/compounds`, `server/media`, and `server/infrastructure`. Tests live beside their domain owners. Imports use these owners directly rather than compatibility barrels.

openFDA discovery and labeler lookup belong to `server/providers/openfda.ts`; DailyMed status acquisition belongs to `server/providers/dailymed.ts`; `server/catalog/enrich-packages.ts` assembles their evidence. Route inference is pure `labels/routes.ts`. Search dispatch lives in `server/catalog/search.ts` with browser-safe search contracts in `catalog/search-types.ts`. The NDC page delegates its read assembly to `server/catalog/package-detail.ts`; route actions retain HTTP/form validation.

`package_curation` is the durable package authority. It stores an unmodified normalized provider baseline, explicit review differences, property corrections, parser version, freshness deadline, and revision. `catalog/package-state.ts` builds effective facts in this order: baseline → explicit review → ordered corrections → dependent derivation. Scope-specific local concepts and class rules remain read decorations. Evidence and effective snapshot projections are written transactionally with decisions; they no longer serve as the sole correction store.

Provider refresh merges against the raw baseline and preserves decisions. A parser-version change makes the baseline stale without discarding corrections. Removing a correction replays stored state without fetching providers. Forms submit the revision they opened; a changed baseline or decision returns HTTP 409 rather than silently overwriting it. Reinterpretation previews persist in PostgreSQL for 30 minutes, carry their source revision, and are consumed in the same transaction as the resulting decisions.

Legacy recovery is deliberately conservative. If historical records contain an uncorrected original, recovery restores the affected source groups while preserving unrelated newer facts. If no original exists, removing that correction clears the unknown group until a provider refresh; the UI explains this before removal. Preserved legacy records make the recovery inspectable. See [migration and rollback](package-curation-migration.md).

Bulk classification and labeler readers use durable state. Formulary directory lookups restrict work to the requested labeler prefixes. Provider warm-up failures are logged with their concept identifier. Partial and approximate search results expire after five minutes instead of the normal twelve hours.

### Cache and job policy

| State                                  | Lifetime and invalidation                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable package decisions              | PostgreSQL; no cache TTL. Revision checks protect edits.                                                                                                                   |
| Provider baseline freshness            | Complete listed packages: 24 hours; incomplete: 5 minutes; unlisted: 7 days. Parser-version mismatch is stale. Correction edits do not renew freshness.                    |
| Shared provider responses              | Process-local, fetch-function isolated; 10 minutes generally, 6 hours for RxNav concept endpoints. Forced refresh bypasses older responses; rejected requests are evicted. |
| Search summaries                       | Process-local, query-keyed; 12 hours normally, 5 minutes for partial/approximate results; rejected work is evicted.                                                        |
| Label-free legacy snapshots            | Process-local, record ID plus observation timestamp; returned values are cloned. Durable package reads take precedence.                                                    |
| Review previews                        | PostgreSQL, 30-minute expiry. Expired rows are pruned when creating previews; apply always checks expiry and revision.                                                     |
| Job progress and warm-up deduplication | Process-local. Restarting the process loses progress, not durable decisions. Multiple workers may duplicate warm-up requests; jobs are not a durable queue.                |

The refresh consolidates ownership without pretending every parser is one grammar. SPL structure, label prose, molecular weights, and display formatting retain their separate contracts. Legacy gaps require fresh evidence; recovering data that was never recorded is outside what this migration can guarantee. Production job durability remains an operational choice, documented above rather than hidden behind an in-memory preview store.

### Final validation

- Offline suite: 924 tests discovered; 920 passed, zero failures, four opt-in database tests skipped.
- PostgreSQL: all four rollback-only integration tests passed, covering durable baselines, retained corrections, offline removal, stale revisions, migration recovery, and atomic preview consumption. The existing driver concurrent-query deprecation warning remains.
- Svelte/TypeScript: zero errors and four existing CSS warnings.
- Production build passed; adapter-auto still needs a deployment target for production hosting.
- Scoped ESLint passed for the changed storage, curation, provider, and route services. Repository-wide lint still has unrelated existing violations; this is not a claim of a clean global lint run.
- Runtime audit: 140 non-test library TypeScript modules, zero runtime import cycles. The expanded transitive browser/server boundary test passed.
- `git diff --check` passed. The additive migration was applied locally; no production deployment or commit was performed.
