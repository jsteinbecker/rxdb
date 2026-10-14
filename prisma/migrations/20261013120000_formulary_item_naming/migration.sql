-- AlterTable
ALTER TABLE "formulary_item" ADD COLUMN "name_override" TEXT,
ADD COLUMN "strength_as_percent" BOOLEAN NOT NULL DEFAULT false;
