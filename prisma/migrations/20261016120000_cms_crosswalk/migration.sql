-- CreateTable
CREATE TABLE "cms_crosswalk_row" (
    "ndc11" TEXT NOT NULL,
    "hcpcs" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "descriptor" TEXT,
    "labeler_name" TEXT,
    "drug_name" TEXT,
    "hcpcs_dosage" TEXT,
    "pkg_size" DOUBLE PRECISION,
    "pkg_qty" DOUBLE PRECISION,
    "bill_units" DOUBLE PRECISION,
    "bill_units_pkg" DOUBLE PRECISION,
    "quarter" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_crosswalk_row_pkey" PRIMARY KEY ("ndc11","hcpcs","file")
);

-- CreateIndex
CREATE INDEX "cms_crosswalk_row_ndc11_idx" ON "cms_crosswalk_row"("ndc11");
