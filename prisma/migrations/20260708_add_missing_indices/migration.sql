-- Migration: add_missing_indices
-- Adiciona índices para queries quentes identificadas na análise de performance.
-- Todos usam IF NOT EXISTS para serem idempotentes.

-- Chip: circuit breaker auto-unpause queries
CREATE INDEX IF NOT EXISTS "Chip_paused_pausedUntil_idx" ON "Chip" ("paused", "pausedUntil");

-- Chip: vendedor filter in dashboard
CREATE INDEX IF NOT EXISTS "Chip_vendedorId_idx" ON "Chip" ("vendedorId");

-- Chip: UI filter for warming chips
CREATE INDEX IF NOT EXISTS "Chip_warmingPhase_status_idx" ON "Chip" ("warmingPhase", "status");

-- Contact: contact list queries with ordering
CREATE INDEX IF NOT EXISTS "Contact_contactListId_position_idx" ON "Contact" ("contactListId", "position");

-- Contact: chip relation queries
CREATE INDEX IF NOT EXISTS "Contact_chipId_idx" ON "Contact" ("chipId");

-- Message: delivery rate queries (recent messages by chip)
CREATE INDEX IF NOT EXISTS "Message_chipId_sentAt_idx" ON "Message" ("chipId", "sentAt");
