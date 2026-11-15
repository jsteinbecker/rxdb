-- AlterTable
ALTER TABLE "source_record" ADD COLUMN     "payload_ref" BYTEA,
ALTER COLUMN "payload" DROP NOT NULL;

-- CreateTable
CREATE TABLE "source_payload" (
    "hash" BYTEA NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "source_payload_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "spl_label" (
    "hash" BYTEA NOT NULL,
    "set_id" TEXT,
    "version" TEXT,
    "effective_time" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spl_label_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "spl_label_section" (
    "label_hash" BYTEA NOT NULL,
    "position" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "blocks" JSONB,

    CONSTRAINT "spl_label_section_pkey" PRIMARY KEY ("label_hash","position")
);

-- CreateIndex
CREATE INDEX "spl_label_set_id_idx" ON "spl_label"("set_id");

-- AddForeignKey
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_payload_ref_fkey" FOREIGN KEY ("payload_ref") REFERENCES "source_payload"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spl_label_section" ADD CONSTRAINT "spl_label_section_label_hash_fkey" FOREIGN KEY ("label_hash") REFERENCES "spl_label"("hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one of the inline payload and the shared reference holds the body.
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_payload_one_of"
    CHECK (("payload" IS NULL) <> ("payload_ref" IS NULL));
CREATE INDEX "source_record_payload_ref_idx" ON "source_record"("payload_ref");
