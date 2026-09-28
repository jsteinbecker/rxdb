# rxdb

SvelteKit starter using Bun, TypeScript, Pug templates, and Prisma with a self-hosted PostgreSQL database.

## Quick start

1. Copy `.env.example` to `.env` and set `DATABASE_URL` for your PostgreSQL instance.
2. Install dependencies (this also generates the Prisma client):

   ```sh
   bun install
   ```

3. Add Prisma models to `prisma/schema.prisma`, then apply your first migration:

   ```sh
   bun run db:migrate --name init
   ```

4. Start the app:

   ```sh
   bun run dev
   ```

Use `bun run db:studio` to inspect the database. Server-side code can import the shared Prisma client from `$lib/server/prisma`.

## Catalog collection

Search refreshes the canonical catalog from RxNav, openFDA, and DailyMed before
reading local results. The collection steps ported from MedPool include:

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
- Persistent, versioned enrichment snapshots in the existing source-record tables.
  Complete positive results refresh after 24 hours, directory-negative results
  after seven days, and partial results after five minutes. Parser-version changes
  invalidate snapshots. No new schema migration is required.
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

Collection remains bounded: eight seed concepts, up to 64 group/form membership
expansions and 64 counterpart lookups, eight collected concrete drug concepts,
and 12 NDCs per drug (96 unique packages per request). This is an on-demand
collection flow, not an exhaustive catalog import or scheduled refresh service.
DailyMed XML is retained as evidence; reconstitution parsing uses openFDA's label
prose and tables.

## Validation

- `npm test` runs offline provider, parsing, activity, and cache fixtures.
- `npm run check` runs Svelte and TypeScript checks.
- `npm run test:db` verifies persistence against `DATABASE_URL` from `.env`.
  All integration-test fixture writes run inside a transaction that is rolled back.
  This database test is skipped during the ordinary offline test run.
