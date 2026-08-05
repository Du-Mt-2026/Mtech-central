-- Migration: add_chip_paused_fields
-- Adiciona campos para pausa individual de chips (Problema 4)
-- Um chip pausado continua conectado ao WhatsApp mas não recebe novas mensagens de campanha

ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "pauseReason" TEXT;
