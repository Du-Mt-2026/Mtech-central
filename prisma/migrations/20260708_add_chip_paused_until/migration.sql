-- Migration: add_chip_paused_until
-- Adiciona campo pausedUntil para suportar auto-retomada de pausa (circuit breaker)
-- Quando pausedUntil é null = pausa manual indefinida (usuário precisa retomar)
-- Quando pausedUntil é preenchido = auto-retoma nesta data (circuit breaker 463)

ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "pausedUntil" TIMESTAMP(3);
