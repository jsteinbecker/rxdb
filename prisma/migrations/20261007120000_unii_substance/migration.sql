CREATE TABLE "unii_substance" (
    "unii" TEXT NOT NULL,
    "name" TEXT,
    "formula" TEXT,
    "mw" DOUBLE PRECISION,
    "moiety_unii" TEXT,
    "moiety_name" TEXT,
    "moiety_count" INTEGER,
    "not_found" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unii_substance_pkey" PRIMARY KEY ("unii")
);
