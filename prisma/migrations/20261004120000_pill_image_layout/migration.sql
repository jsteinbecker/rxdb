CREATE TABLE "pill_image_layout" (
    "set_id" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "imprint" TEXT NOT NULL,
    "analyzer_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "layout" JSONB,
    "error" TEXT,
    "analyzed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pill_image_layout_pkey" PRIMARY KEY ("set_id","image")
);
