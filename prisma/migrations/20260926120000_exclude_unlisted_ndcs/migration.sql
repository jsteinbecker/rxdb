-- Retire NDC package entities whose cached authoritative checks confirmed that
-- neither openFDA nor DailyMed lists the package. Unknown/provider failures are
-- kept because they cannot establish absence.
UPDATE entity AS e
SET status = 'catalog-excluded'
FROM external_identifier AS ndc
JOIN source_record AS cache_record ON cache_record.id = ndc.source_record_id
JOIN ingestion_run AS cache_run ON cache_run.id = cache_record.ingestion_run_id
WHERE e.id = ndc.entity_id
  AND e.type = 'package'
  AND e.status IN ('active', 'catalog-excluded')
  AND e.retired_at IS NULL
  AND ndc.namespace = 'ndc11'
  AND ndc.valid_to IS NULL
  AND cache_run.source = 'catalog-enrichment'
  AND cache_record.payload->>'listed' = 'false'
  AND cache_record.payload->>'splPresent' = 'false';
