-- findEquivalentPackages looks up cache snapshots by RxCUI on every NDC page
-- view. Without this, that is a sequential scan that detoasts every payload.
CREATE INDEX "source_record_snapshot_rxcui_idx"
  ON "source_record" ((payload #>> '{item,details,rxnav,rxcui}'))
  WHERE payload #>> '{item,details,rxnav,rxcui}' IS NOT NULL;
