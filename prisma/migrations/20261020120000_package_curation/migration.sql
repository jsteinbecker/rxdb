BEGIN;
CREATE TABLE "package_curation" (
  "ndc" VARCHAR(11) PRIMARY KEY CHECK (ndc ~ '^[0-9]{11}$'),
  "baseline" JSONB NOT NULL,
  "baseline_version" TEXT NOT NULL,
  "refresh_at" TIMESTAMPTZ NOT NULL,
  "overrides" JSONB NOT NULL DEFAULT '{}',
  "review" JSONB NOT NULL DEFAULT '{}',
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  "initialized" BOOLEAN NOT NULL DEFAULT true,
  "unknown_keys" TEXT[] NOT NULL DEFAULT '{}',
  "legacy_snapshot" JSONB,
  "legacy_baseline" JSONB,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "package_review_preview" (
  "token" UUID PRIMARY KEY,
  "ndc" VARCHAR(11) NOT NULL CHECK (ndc ~ '^[0-9]{11}$'),
  "source_revision" INTEGER NOT NULL,
  "baseline" JSONB NOT NULL,
  "overrides" JSONB NOT NULL,
  "review" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL
);
CREATE INDEX "package_review_preview_expires_at_idx" ON "package_review_preview"("expires_at");

-- Preserve the latest effective snapshot and all decisions, regardless of parser version.
-- The application reconstructs corrected fields from the last unmodified observation
-- on first access, under a per-package lock. Original source records are never removed.
INSERT INTO package_curation
  (ndc, baseline, baseline_version, refresh_at, overrides, initialized, legacy_snapshot, legacy_baseline)
SELECT latest.source_native_id, latest.payload -> 'item',
  COALESCE(latest.payload ->> 'version', 'legacy'),
  CURRENT_TIMESTAMP,
  COALESCE(latest.payload #> '{item,propertyOverrides}', '{}'::jsonb),
  false, latest.payload, original.payload -> 'item'
FROM (
  SELECT DISTINCT ON (r.source_native_id) r.source_native_id, r.payload
  FROM source_record r JOIN ingestion_run run ON run.id = r.ingestion_run_id
  WHERE run.source = 'catalog-enrichment' AND run.status = 'completed'
    AND r.source_native_id ~ '^[0-9]{11}$'
    AND jsonb_typeof(r.payload -> 'item') = 'object'
  ORDER BY r.source_native_id, r.observed_at DESC, r.id DESC
) latest
LEFT JOIN LATERAL (
  SELECT r.payload
  FROM source_record r JOIN ingestion_run run ON run.id = r.ingestion_run_id
  WHERE run.source = 'catalog-enrichment' AND run.status = 'completed'
    AND r.source_native_id = latest.source_native_id
    AND COALESCE(r.payload #> '{item,propertyOverrides}', '{}'::jsonb) = '{}'::jsonb
  ORDER BY r.observed_at DESC, r.id DESC LIMIT 1
) original ON true
ON CONFLICT (ndc) DO NOTHING;
COMMIT;
