# Durable package curation migration

Migration: `20261020120000_package_curation`. Apply after a database backup using `prisma migrate deploy`, then generate the Prisma client for the matching application release. This migration was applied to the local development database during checkpoint 3; production deployment remains separate.

## What changes

The migration adds `package_curation` and `package_review_preview` without deleting or rewriting historical source records or canonical/formulary identities. It seeds each package from its latest completed enrichment snapshot, independent of parser version, and retains both the legacy effective snapshot and an available historical uncorrected baseline. Seeds start stale and are decoded conservatively; the first write persists the recovered representation. New provider refreshes establish a fresh baseline.

A recoverable original may be older than the correction; recovery uses it only for the groups owned by that correction. If no historical original exists, affected fields are marked unavailable and clear on removal until refreshed. Historical evidence cannot prove missing original values. Do not bulk remove corrections expecting the migration to invent them.

Revision checks and ordered PostgreSQL advisory locks serialize package decisions with provider refreshes. Review preview consumption, decision writes, and provenance writes share a transaction. Preview tokens survive application restarts, expire after 30 minutes, and cannot apply against a changed revision.

## Deployment verification

1. Back up the database and retain the previous application release.
2. Check migration status, apply the additive migration, and generate the client.
3. Run the rollback-only PostgreSQL integration suite with `npm run test:db` against the migrated development/test database.
4. Verify a package read, correction save, offline removal, refresh with a retained correction, and stale-form conflict. Review a migrated corrected package whose historical original is absent before accepting its recovery behavior.
5. Keep normal source-record retention until recovery has been reviewed. Those records are the migration's recovery evidence.

Do not run old and new writers concurrently: an old release writes only snapshots and cannot maintain the new durable authority. Stop writers during deployment or route all writes to the matching release.

## Rollback

Before new-release writes, application rollback is straightforward: stop writers and restore the previous application. The additive tables can remain; avoid dropping recovery data merely to revert code.

After new-release writes, prefer a forward fix. The new release maintains effective enrichment projections, so the previous application can read the latest corrected view, but its provider refresh/removal behavior has the old baseline-coupling limitations. A lossless storage rollback requires stopping writers, exporting both new tables and source records, and restoring the pre-deployment database backup (with explicit reconciliation of any later user decisions). Never drop the new tables before that export and reconciliation. A destructive automatic down migration is intentionally omitted.
