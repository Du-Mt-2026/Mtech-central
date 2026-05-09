-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Chip" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "wireguardIp" TEXT NOT NULL DEFAULT '',
    "wireguardPrivKey" TEXT NOT NULL DEFAULT '',
    "wireguardPubKey" TEXT NOT NULL DEFAULT '',
    "socksPort" INTEGER NOT NULL DEFAULT 1080,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dailyLimit" INTEGER NOT NULL DEFAULT 200,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "warmingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "warmingStage" INTEGER NOT NULL DEFAULT 0,
    "isQrPaired" BOOLEAN NOT NULL DEFAULT false,
    "qrPairingCode" TEXT,
    "proxyMode" TEXT NOT NULL DEFAULT 'none',
    "socks5Host" TEXT NOT NULL DEFAULT '',
    "socks5Port" INTEGER NOT NULL DEFAULT 0,
    "socks5User" TEXT NOT NULL DEFAULT '',
    "socks5Pass" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Chip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AntiBanSettings" (
    "id" TEXT NOT NULL,
    "typingMinDelay" INTEGER NOT NULL DEFAULT 500,
    "typingMaxDelay" INTEGER NOT NULL DEFAULT 2000,
    "messageIntervalMin" INTEGER NOT NULL DEFAULT 30,
    "messageIntervalMax" INTEGER NOT NULL DEFAULT 90,
    "randomLineBreaks" BOOLEAN NOT NULL DEFAULT true,
    "emojiVariation" BOOLEAN NOT NULL DEFAULT true,
    "dailyLimitPerChip" INTEGER NOT NULL DEFAULT 200,
    "warmingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "warmingDays" INTEGER NOT NULL DEFAULT 7,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 30,
    "cooldownAfterMessages" INTEGER NOT NULL DEFAULT 50,
    "stopOnWarning" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AntiBanSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'geral',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "chipId" TEXT,
    "contactListId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "messageVariations" TEXT NOT NULL DEFAULT '[]',
    "sendIntervalMin" INTEGER NOT NULL DEFAULT 30,
    "sendIntervalMax" INTEGER NOT NULL DEFAULT 90,
    "contactListId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "antiBanEnabled" BOOLEAN NOT NULL DEFAULT true,
    "warmingMode" TEXT NOT NULL DEFAULT 'normal',

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignChip" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "chipId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignChip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "chipId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Chip_phoneNumber_key" ON "Chip"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_campaignId_stepOrder_key" ON "SequenceStep"("campaignId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignChip_campaignId_chipId_key" ON "CampaignChip"("campaignId", "chipId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "Chip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "ContactList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "ContactList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChip" ADD CONSTRAINT "CampaignChip_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChip" ADD CONSTRAINT "CampaignChip_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "Chip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "Chip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
