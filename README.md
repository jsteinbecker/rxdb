# rxdb

Medication catalog reconciliation and formulary curation, built with SvelteKit, TypeScript, Pug, and Prisma on PostgreSQL.

See [the library architecture](docs/lib-architecture.md) for module ownership, staging and correction rules, and the refresh checkpoints. The [architecture review](docs/lib-architecture-review.md) records the original assessment and refresh plan. The [module reference](docs/lib-modules.md) lists every module and component in `src/lib` with its summary, and the documentation conventions they follow; regenerate it with `npm run docs:lib` after changing a module doc.

## Quick start

1. Create `.env` and set `DATABASE_URL` for your PostgreSQL instance. Configure `OPENFDA_API_KEY` (and numbered additional keys, if available) for provider requests.
2. Install dependencies (this also generates the Prisma client):

   ```sh
   bun install
   ```

3. Apply the existing database migrations:

   ```sh
   bun run db:migrate
   ```

4. Start the app:

   ```sh
   bun run dev
   ```

Use `bun run db:studio` to inspect the database. Server-side code can import the shared Prisma client from `$lib/server/infrastructure/database`.

## Catalog collection

Search stages concepts and package evidence from RxNav, openFDA, and DailyMed alongside local results. Explicit loading promotes selected records into the canonical catalog and formulary. The collection steps ported from MedPool include:

- Exact/approximate name discovery, numeric RxCUI lookup, and normalized NDC lookup.
- Group → form → drug membership through `inverse_isa`, branded/generic counterparts,
  and the IN/MIN fallback for precise ingredients.
- FDA queries across possible labeled NDC hyphenations, plus direct package
  enrichment when RxNorm has no match.
- Package size, container and pack count parsing; multi-dose classification from
  packaging and NDC-specific label text.
- Dry-fill reconstitution parsing from label prose and tables, retaining separate
  labeled, diluent, and final volumes. Ambiguous or incomplete evidence stays
  unresolved. Reconstituted volume is never stored as unopened liquid fill.
- Veterinary-only concept and animal-label package filtering. Dual human/veterinary
  concepts remain eligible, with their packages checked individually.
- The activity ladder: FDA marketing dates, then RxNav status for unlisted/unknown
  packages, then DailyMed label absence only when FDA absence was established.
  Provider outages do not establish absence.
- Durable provider baselines and independent corrections in `package_curation`, with
  evidence and effective projections retained in source-record tables. Complete listed
  packages refresh after 24 hours, unlisted packages after seven days, and partial
  results after five minutes. Parser changes invalidate freshness while preserving
  decisions. See the [migration and rollback notes](docs/package-curation-migration.md).
- Updates to existing catalog records, shared product identity across package NDCs,
  strength history, transactional evidence writes, and preservation of known values
  during partial provider failures. Advisory locks serialize identity creation.

`GET /api/v1/search?q=...` uses these steps and reports partial-provider warnings.
`GET /api/v1/ndc/<ndc>` returns collected package facts, reconstitution information,
listing status, and the exclusion reason, including for excluded packages. Raw
provider payloads and XML remain in provenance storage; API keys are removed from
stored source URLs.

Excluded entities use `catalog-excluded` status and can return to active status on
new positive evidence. Manually retired/inactive entities are not reactivated.
Marketing dates are reevaluated even when a package's snapshot remains fresh.

RxNav discovery returns ranked pages of ten concepts. Search returns concepts before collecting all their packages; background warm-up and expanded rows share package collection. Direct NDC searches collect the requested package immediately. Provider operations use bounded concurrency. This is an on-demand flow, not an exhaustive catalog import or scheduled refresh service.

DailyMed XML is retained as evidence and supplies structured label sections alongside openFDA's label prose and tables.

## Validation

- `npm test` recursively runs offline library tests, including provider, parsing, activity, cache, and architecture-boundary fixtures.
- `npm run check` runs Svelte and TypeScript checks.
- `npm run test:db` verifies persistence against `DATABASE_URL` from `.env`.
  All integration-test fixture writes run inside a transaction that is rolled back.
  This database test is skipped during the ordinary offline test run.
