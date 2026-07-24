-- Migration: Add WarmingMessagePool table and ai_bot fields to WarmingSession
-- =====================================================================
-- Cria a tabela WarmingMessagePool (pool global de mensagens categorizadas)
-- e adiciona 3 campos à tabela WarmingSession para suportar a estratégia "ai_bot"
-- onde chips conversam com o bot Duda (externo, via Meta Official API).

-- ============================================================
-- 1. Nova tabela: WarmingMessagePool
-- ============================================================
CREATE TABLE "WarmingMessagePool" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmingMessagePool_pkey" PRIMARY KEY ("id")
);

-- Índices para sortear mensagens ativas por categoria rapidamente
CREATE INDEX "WarmingMessagePool_category_active_idx" ON "WarmingMessagePool"("category", "active");
CREATE INDEX "WarmingMessagePool_active_idx" ON "WarmingMessagePool"("active");

-- ============================================================
-- 2. Novos campos em WarmingSession para estratégia ai_bot
-- ============================================================
-- aiBotPhoneNumber: telefone do bot Duda (sem o 55). Ex: "48991742716"
ALTER TABLE "WarmingSession" ADD COLUMN "aiBotPhoneNumber" TEXT;

-- aiBotReplyTimeoutSec: segundos máximos esperando resposta do Duda
-- antes de considerar "missed" (default 300 = 5 minutos)
ALTER TABLE "WarmingSession" ADD COLUMN "aiBotReplyTimeoutSec" INTEGER NOT NULL DEFAULT 300;

-- aiBotMaxMissedReplies: após N respostas consecutivas sem reply, encerra
-- a conversa do dia (default 2)
ALTER TABLE "WarmingSession" ADD COLUMN "aiBotMaxMissedReplies" INTEGER NOT NULL DEFAULT 2;
