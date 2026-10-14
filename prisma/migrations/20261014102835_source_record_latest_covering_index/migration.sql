-- DropIndex
DROP INDEX "source_record_source_native_id_observed_at_idx";

-- CreateIndex
CREATE INDEX "source_record_source_native_id_observed_at_ingestion_run_id_idx" ON "source_record"("source_native_id", "observed_at" DESC, "ingestion_run_id", "id");
