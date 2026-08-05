-- CreateTable: WarmingMessagePool
-- Pool global de mensagens categorizadas para uso na estratégia "ai_bot"
-- do Warming Engine. Compartilhado entre todas as sessões e todos os chips.
CREATE TABLE "WarmingMessagePool" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmingMessagePool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarmingMessagePool_category_idx" ON "WarmingMessagePool"("category");

-- CreateIndex
CREATE INDEX "WarmingMessagePool_active_idx" ON "WarmingMessagePool"("active");

-- AddColumn: New ai_bot fields on WarmingSession
-- strategy aceita um novo valor: "ai_bot" (não precisa de ALTER, é String)
-- aiBotPhoneNumber: número do "operator" (default: número do Duda — 4899670797)
ALTER TABLE "WarmingSession" ADD COLUMN "aiBotPhoneNumber" TEXT;

ALTER TABLE "WarmingSession" ADD COLUMN "aiBotReplyTimeoutSec" INTEGER NOT NULL DEFAULT 300;

ALTER TABLE "WarmingSession" ADD COLUMN "aiBotMaxMissedReplies" INTEGER NOT NULL DEFAULT 2;
