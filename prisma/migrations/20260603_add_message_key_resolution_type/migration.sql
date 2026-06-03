-- AlterTable: Add resolutionType and timeSlots to MessageKey
ALTER TABLE "MessageKey" ADD COLUMN "resolutionType" TEXT NOT NULL DEFAULT 'random';
ALTER TABLE "MessageKey" ADD COLUMN "timeSlots" TEXT;
