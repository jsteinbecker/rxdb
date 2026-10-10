CREATE TABLE "pill_photo" (
    "ndc" TEXT NOT NULL,
    "part" INTEGER NOT NULL,
    "set_id" TEXT,
    "image" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pill_photo_pkey" PRIMARY KEY ("ndc","part")
);
