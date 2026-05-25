-- AlterTable: Add evolutionApiVersion field to Chip
-- Default is 'v3' so existing chips use Evolution Go
ALTER TABLE "Chip" ADD COLUMN "evolutionApiVersion" TEXT NOT NULL DEFAULT 'v3';
