import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/setup/sync-schema — Migrate AdminUser table to new schema
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { secret } = body

    // Security: Require AUTH_SECRET — no fallback to hardcoded dev secret
    if (!process.env.AUTH_SECRET || secret !== process.env.AUTH_SECRET) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    console.log('[Setup] Starting schema migration...')

    const results: string[] = []

    // Step 1: Check current AdminUser table structure
    try {
      const columns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'AdminUser'
        ORDER BY ordinal_position
      `
      const columnNames = columns.map(c => c.column_name)
      results.push(`Colunas atuais: ${columnNames.join(', ')}`)

      // Check if we need to migrate (if 'name' column doesn't exist but 'username' does)
      if (!columnNames.includes('name') && columnNames.includes('username')) {
        // Old schema → New schema migration
        results.push('Migrando schema antigo para novo...')

        // Add new columns
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "name" TEXT`)
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "email" TEXT`)
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'operador'`)
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true`)
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT`)
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false`)
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "imagem" TEXT NOT NULL DEFAULT ''`)
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "isSystemUser" BOOLEAN NOT NULL DEFAULT false`)
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false`)

        // Copy data from username to name and email
        await db.$executeRawUnsafe(`UPDATE "AdminUser" SET "name" = "username" WHERE "name" IS NULL`)
        await db.$executeRawUnsafe(`UPDATE "AdminUser" SET "email" = "username" || '@mtech.com' WHERE "email" IS NULL`)
        await db.$executeRawUnsafe(`UPDATE "AdminUser" SET "role" = 'master' WHERE "role" = 'operador'`)

        // Make name and email NOT NULL
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ALTER COLUMN "name" SET NOT NULL`)
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ALTER COLUMN "email" SET NOT NULL`)

        // Add unique constraint on email
        await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_email_key" ON "AdminUser"("email")`)

        // Drop old username column
        await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "username"`)

        results.push('Migração concluída com sucesso!')
      } else if (columnNames.includes('name') && columnNames.includes('email')) {
        // Already has new schema — check for missing columns
        if (!columnNames.includes('mustChangePassword')) {
          await db.$executeRawUnsafe(`ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT true`)
          results.push('AdminUser: adicionada coluna mustChangePassword')
        }
        results.push('Schema já está atualizado.')
      } else {
        // Unknown schema state - drop and let Prisma recreate
        results.push('Schema em estado desconhecido. Recriando tabela...')
        await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "AdminUser" CASCADE`)
        results.push('Tabela AdminUser removida. Execute prisma db push para recriar.')
      }
    } catch (dbError: any) {
      results.push(`Erro na migração: ${dbError.message}`)

      // If migration fails, try dropping and recreating
      try {
        results.push('Tentando recriar tabela do zero...')
        await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "AdminUser" CASCADE`)
        results.push('Tabela AdminUser removida. Execute prisma db push para recriar.')
      } catch (dropError: any) {
        results.push(`Erro ao remover tabela: ${dropError.message}`)
      }
    }

    // Step 2: Sync Chip table — add verification anti-ban columns
    try {
      const chipColumns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'Chip'
        ORDER BY ordinal_position
      `
      const chipColumnNames = chipColumns.map(c => c.column_name)

      if (!chipColumnNames.includes('verifiedToday')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "verifiedToday" INTEGER NOT NULL DEFAULT 0`)
        results.push('Chip: adicionada coluna verifiedToday')
      } else {
        results.push('Chip: verifiedToday já existe')
      }

      if (!chipColumnNames.includes('lastVerifiedResetAt')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "lastVerifiedResetAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()`)
        results.push('Chip: adicionada coluna lastVerifiedResetAt')
      } else {
        results.push('Chip: lastVerifiedResetAt já existe')
      }

      if (!chipColumnNames.includes('cooldownUntil')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "cooldownUntil" TIMESTAMP(3)`)
        results.push('Chip: adicionada coluna cooldownUntil')
      } else {
        results.push('Chip: cooldownUntil já existe')
      }

      if (!chipColumnNames.includes('warmingStage')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "warmingStage" INTEGER NOT NULL DEFAULT 0`)
        results.push('Chip: adicionada coluna warmingStage')
      } else {
        results.push('Chip: warmingStage já existe')
      }

      if (!chipColumnNames.includes('warmingPhase')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "warmingPhase" TEXT NOT NULL DEFAULT 'nursery'`)
        results.push('Chip: adicionada coluna warmingPhase')
      } else {
        results.push('Chip: warmingPhase já existe')
      }

      if (!chipColumnNames.includes('prewarmStartedAt')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "prewarmStartedAt" TIMESTAMP(3)`)
        results.push('Chip: adicionada coluna prewarmStartedAt')
      } else {
        results.push('Chip: prewarmStartedAt já existe')
      }

      // New columns for hourly limit tracking
      if (!chipColumnNames.includes('hourlySent')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "hourlySent" INTEGER NOT NULL DEFAULT 0`)
        results.push('Chip: adicionada coluna hourlySent')
      } else {
        results.push('Chip: hourlySent já existe')
      }

      if (!chipColumnNames.includes('lastHourlyResetAt')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Chip" ADD COLUMN IF NOT EXISTS "lastHourlyResetAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()`)
        results.push('Chip: adicionada coluna lastHourlyResetAt')
      } else {
        results.push('Chip: lastHourlyResetAt já existe')
      }
    } catch (chipError: any) {
      results.push(`Erro na migração Chip: ${chipError.message}`)
    }

    // Step 3: Sync AntiBanSettings table — add new schedule columns
    try {
      const absColumns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'AntiBanSettings'
        ORDER BY ordinal_position
      `
      const absColumnNames = absColumns.map(c => c.column_name)

      if (!absColumnNames.includes('nurserySchedule')) {
        const defaultNursery = '[{"dayRange":"1-2","days":[1,2],"limit":10},{"dayRange":"3-4","days":[3,4],"limit":20},{"dayRange":"5-6","days":[5,6],"limit":30},{"dayRange":"7-8","days":[7,8],"limit":40},{"dayRange":"9-10","days":[9,10],"limit":50},{"dayRange":"11-12","days":[11,12],"limit":60},{"dayRange":"13-14","days":[13,14],"limit":80}]'
        await db.$executeRawUnsafe(`ALTER TABLE "AntiBanSettings" ADD COLUMN IF NOT EXISTS "nurserySchedule" TEXT NOT NULL DEFAULT '${defaultNursery}'`)
        results.push('AntiBanSettings: adicionada coluna nurserySchedule')
      } else {
        results.push('AntiBanSettings: nurserySchedule já existe')
      }

      if (!absColumnNames.includes('prewarmSchedule')) {
        const defaultPrewarm = '[{"dayRange":"1","days":[1,1],"limit":11},{"dayRange":"2","days":[2,2],"limit":15},{"dayRange":"3","days":[3,3],"limit":20},{"dayRange":"4","days":[4,4],"limit":25},{"dayRange":"5","days":[5,5],"limit":30},{"dayRange":"6","days":[6,6],"limit":35},{"dayRange":"7","days":[7,7],"limit":40},{"dayRange":"8","days":[8,8],"limit":45},{"dayRange":"9","days":[9,9],"limit":50},{"dayRange":"10","days":[10,10],"limit":60},{"dayRange":"11","days":[11,11],"limit":70},{"dayRange":"12","days":[12,12],"limit":80},{"dayRange":"13","days":[13,13],"limit":90},{"dayRange":"14","days":[14,14],"limit":100},{"dayRange":"15","days":[15,15],"limit":120},{"dayRange":"16","days":[16,16],"limit":140},{"dayRange":"17","days":[17,17],"limit":160},{"dayRange":"18","days":[18,18],"limit":180},{"dayRange":"19","days":[19,19],"limit":190},{"dayRange":"20","days":[20,20],"limit":200}]'
        await db.$executeRawUnsafe(`ALTER TABLE "AntiBanSettings" ADD COLUMN IF NOT EXISTS "prewarmSchedule" TEXT NOT NULL DEFAULT '${defaultPrewarm}'`)
        results.push('AntiBanSettings: adicionada coluna prewarmSchedule')
      } else {
        results.push('AntiBanSettings: prewarmSchedule já existe')
      }

      if (!absColumnNames.includes('readyDailyLimit')) {
        await db.$executeRawUnsafe(`ALTER TABLE "AntiBanSettings" ADD COLUMN IF NOT EXISTS "readyDailyLimit" INTEGER NOT NULL DEFAULT 200`)
        results.push('AntiBanSettings: adicionada coluna readyDailyLimit')
      } else {
        results.push('AntiBanSettings: readyDailyLimit já existe')
      }

      if (!absColumnNames.includes('hourlyLimit')) {
        await db.$executeRawUnsafe(`ALTER TABLE "AntiBanSettings" ADD COLUMN IF NOT EXISTS "hourlyLimit" INTEGER NOT NULL DEFAULT 30`)
        results.push('AntiBanSettings: adicionada coluna hourlyLimit')
      } else {
        results.push('AntiBanSettings: hourlyLimit já existe')
      }

      // New: Variable cooldown fields
      if (!absColumnNames.includes('cooldownMinutesMax')) {
        await db.$executeRawUnsafe(`ALTER TABLE "AntiBanSettings" ADD COLUMN IF NOT EXISTS "cooldownMinutesMax" INTEGER NOT NULL DEFAULT 30`)
        results.push('AntiBanSettings: adicionada coluna cooldownMinutesMax')
      } else {
        results.push('AntiBanSettings: cooldownMinutesMax já existe')
      }

      if (!absColumnNames.includes('cooldownAfterMessagesMax')) {
        await db.$executeRawUnsafe(`ALTER TABLE "AntiBanSettings" ADD COLUMN IF NOT EXISTS "cooldownAfterMessagesMax" INTEGER NOT NULL DEFAULT 50`)
        results.push('AntiBanSettings: adicionada coluna cooldownAfterMessagesMax')
      } else {
        results.push('AntiBanSettings: cooldownAfterMessagesMax já existe')
      }

      // New: Break windows
      if (!absColumnNames.includes('breakWindows')) {
        await db.$executeRawUnsafe(`ALTER TABLE "AntiBanSettings" ADD COLUMN IF NOT EXISTS "breakWindows" TEXT NOT NULL DEFAULT '[]'`)
        results.push('AntiBanSettings: adicionada coluna breakWindows')
      } else {
        results.push('AntiBanSettings: breakWindows já existe')
      }

      // Add linkPreviewEnabled column
      if (!absColumnNames.includes('linkPreviewEnabled')) {
        await db.$executeRawUnsafe(`ALTER TABLE "AntiBanSettings" ADD COLUMN IF NOT EXISTS "linkPreviewEnabled" BOOLEAN NOT NULL DEFAULT false`)
        results.push('AntiBanSettings: adicionada coluna linkPreviewEnabled')
      } else {
        results.push('AntiBanSettings: linkPreviewEnabled já existe')
      }
    } catch (absError: any) {
      results.push(`Erro na migração AntiBanSettings: ${absError.message}`)
    }

    // Step 4: Ensure InboxMessage table exists
    try {
      const inboxExists = await db.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'InboxMessage'
        ) as exists
      `

      if (!inboxExists[0]?.exists) {
        console.log('[Setup] Creating InboxMessage table...')
        await db.$executeRawUnsafe(`
          CREATE TABLE "InboxMessage" (
            "id" TEXT NOT NULL,
            "instanceName" TEXT NOT NULL,
            "remoteJid" TEXT NOT NULL,
            "fromMe" BOOLEAN NOT NULL DEFAULT false,
            "messageContent" TEXT NOT NULL,
            "messageType" TEXT NOT NULL DEFAULT 'text',
            "pushName" TEXT,
            "evolutionMsgId" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id"),
            CONSTRAINT "InboxMessage_evolutionMsgId_key" UNIQUE ("evolutionMsgId")
          )
        `)
        results.push('InboxMessage: tabela criada com sucesso')
      } else {
        results.push('InboxMessage: tabela já existe')
      }
    } catch (inboxError: any) {
      results.push(`Erro ao criar InboxMessage: ${inboxError.message}`)
    }

    // Step 5: Sync Message table — add stepOrder column for multi-step campaigns
    try {
      const msgColumns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'Message'
        ORDER BY ordinal_position
      `
      const msgColumnNames = msgColumns.map(c => c.column_name)

      if (!msgColumnNames.includes('stepOrder')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "stepOrder" INTEGER NOT NULL DEFAULT 1`)
        results.push('Message: adicionada coluna stepOrder')
      } else {
        results.push('Message: stepOrder já existe')
      }
    } catch (msgError: any) {
      results.push(`Erro na migração Message: ${msgError.message}`)
    }

    // Step 6: Sync MessageTemplate table — add steps column for campaign templates
    try {
      const mtColumns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'MessageTemplate'
        ORDER BY ordinal_position
      `
      const mtColumnNames = mtColumns.map(c => c.column_name)

      if (!mtColumnNames.includes('steps')) {
        await db.$executeRawUnsafe(`ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "steps" TEXT`)
        results.push('MessageTemplate: adicionada coluna steps')
      } else {
        results.push('MessageTemplate: steps já existe')
      }
    } catch (mtError: any) {
      results.push(`Erro na migração MessageTemplate: ${mtError.message}`)
    }

    // Step 6.5: Sync InboxMessage table — add new columns for Chatwoot-like inbox
    try {
      const inboxColumns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'InboxMessage'
        ORDER BY ordinal_position
      `
      const inboxColumnNames = inboxColumns.map(c => c.column_name)

      if (!inboxColumnNames.includes('chipId')) {
        await db.$executeRawUnsafe(`ALTER TABLE "InboxMessage" ADD COLUMN IF NOT EXISTS "chipId" TEXT`)
        results.push('InboxMessage: adicionada coluna chipId')
      } else {
        results.push('InboxMessage: chipId já existe')
      }

      if (!inboxColumnNames.includes('remotePhone')) {
        await db.$executeRawUnsafe(`ALTER TABLE "InboxMessage" ADD COLUMN IF NOT EXISTS "remotePhone" TEXT NOT NULL DEFAULT ''`)
        results.push('InboxMessage: adicionada coluna remotePhone')
      } else {
        results.push('InboxMessage: remotePhone já existe')
      }

      if (!inboxColumnNames.includes('mediaUrl')) {
        await db.$executeRawUnsafe(`ALTER TABLE "InboxMessage" ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT`)
        results.push('InboxMessage: adicionada coluna mediaUrl')
      } else {
        results.push('InboxMessage: mediaUrl já existe')
      }

      if (!inboxColumnNames.includes('contactName')) {
        await db.$executeRawUnsafe(`ALTER TABLE "InboxMessage" ADD COLUMN IF NOT EXISTS "contactName" TEXT`)
        results.push('InboxMessage: adicionada coluna contactName')
      } else {
        results.push('InboxMessage: contactName já existe')
      }

      if (!inboxColumnNames.includes('isRead')) {
        await db.$executeRawUnsafe(`ALTER TABLE "InboxMessage" ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN NOT NULL DEFAULT false`)
        results.push('InboxMessage: adicionada coluna isRead')
      } else {
        results.push('InboxMessage: isRead já existe')
      }

      if (!inboxColumnNames.includes('isGroup')) {
        await db.$executeRawUnsafe(`ALTER TABLE "InboxMessage" ADD COLUMN IF NOT EXISTS "isGroup" BOOLEAN NOT NULL DEFAULT false`)
        results.push('InboxMessage: adicionada coluna isGroup')
      } else {
        results.push('InboxMessage: isGroup já existe')
      }

      // Add foreign key constraint for chipId if not exists
      try {
        await db.$executeRawUnsafe(`
          ALTER TABLE "InboxMessage"
          DROP CONSTRAINT IF EXISTS "InboxMessage_chipId_fkey"
        `)
        await db.$executeRawUnsafe(`
          ALTER TABLE "InboxMessage"
          ADD CONSTRAINT "InboxMessage_chipId_fkey"
          FOREIGN KEY ("chipId") REFERENCES "Chip"("id") ON DELETE CASCADE ON UPDATE CASCADE
        `)
        results.push('InboxMessage: FK chipId configurada')
      } catch (fkErr: any) {
        results.push(`InboxMessage: FK chipId - ${fkErr.message}`)
      }

      // Add indexes for performance
      try {
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InboxMessage_chipId_remoteJid_createdAt_idx" ON "InboxMessage"("chipId", "remoteJid", "createdAt")`)
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InboxMessage_chipId_isRead_idx" ON "InboxMessage"("chipId", "isRead")`)
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "InboxMessage_instanceName_createdAt_idx" ON "InboxMessage"("instanceName", "createdAt")`)
        results.push('InboxMessage: índices criados')
      } catch (idxErr: any) {
        results.push(`InboxMessage: índices - ${idxErr.message}`)
      }

      // Update existing records: extract remotePhone from remoteJid
      try {
        await db.$executeRawUnsafe(`
          UPDATE "InboxMessage"
          SET "remotePhone" = SPLIT_PART("remoteJid", '@', 1)
          WHERE "remotePhone" = '' AND "remoteJid" LIKE '%@%'
        `)
        results.push('InboxMessage: remotePhone atualizado para registros existentes')
      } catch (updErr: any) {
        results.push(`InboxMessage: remotePhone update - ${updErr.message}`)
      }

      // Update existing records: link chipId by instanceName
      try {
        await db.$executeRawUnsafe(`
          UPDATE "InboxMessage" im
          SET "chipId" = c.id
          FROM "Chip" c
          WHERE im."instanceName" = c."evolutionInstance"
          AND im."chipId" IS NULL
        `)
        results.push('InboxMessage: chipId vinculado para registros existentes')
      } catch (linkErr: any) {
        results.push(`InboxMessage: chipId link - ${linkErr.message}`)
      }

    } catch (inboxMigrationErr: any) {
      results.push(`Erro na migração InboxMessage: ${inboxMigrationErr.message}`)
    }

    // Step 6.6: Backfill existing campaign messages into InboxMessage
    try {
      // Find campaign messages that are NOT yet in InboxMessage
      // CRITICAL: Mark as isCampaign=true so they don't appear as real conversations in inbox
      const backfillCount = await db.$executeRawUnsafe(`
        INSERT INTO "InboxMessage" ("id", "instanceName", "chipId", "remoteJid", "remotePhone", "fromMe", "messageContent", "messageType", "mediaUrl", "pushName", "contactName", "evolutionMsgId", "isRead", "isGroup", "isCampaign", "createdAt")
        SELECT
          CONCAT('inbox_', m.id) as id,
          c."evolutionInstance" as "instanceName",
          m."chipId",
          CONCAT(ct.phone, '@s.whatsapp.net') as "remoteJid",
          ct.phone as "remotePhone",
          true as "fromMe",
          m.content as "messageContent",
          COALESCE(m.mediatype, 'text') as "messageType",
          m."mediaUrl",
          c."profileName" as "pushName",
          ct.name as "contactName",
          m."evolutionMessageId" as "evolutionMsgId",
          true as "isRead",
          false as "isGroup",
          true as "isCampaign",
          COALESCE(m."sentAt", m."createdAt") as "createdAt"
        FROM "Message" m
        JOIN "Chip" c ON c.id = m."chipId"
        JOIN "Contact" ct ON ct.id = m."contactId"
        WHERE m.status IN ('sent', 'delivered', 'read')
        AND c."evolutionInstance" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "InboxMessage" im
          WHERE im."evolutionMsgId" = m."evolutionMessageId"
          AND m."evolutionMessageId" IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM "InboxMessage" im
          WHERE im.id = CONCAT('inbox_', m.id)
        )
      `)
      results.push(`InboxMessage: backfill inseriu ${backfillCount} mensagens de campanha (isCampaign=true)`)
    } catch (backfillErr: any) {
      results.push(`InboxMessage: backfill - ${backfillErr.message}`)
    }

    // Step 6.7: Mark chip-to-chip (warming) messages as isCampaign
    // These are phantom conversations from the warming engine that appear as real chats
    try {
      const warmingMarked = await db.$executeRawUnsafe(`
        UPDATE "InboxMessage" im
        SET "isCampaign" = true
        WHERE im."isCampaign" = false
        AND EXISTS (
          SELECT 1 FROM "Chip" c
          WHERE (
            c."phoneNumber" = im."remotePhone"
            OR c."phoneNumber" LIKE '%' || REPLACE(im."remotePhone", '55', '')
          )
        )
      `)
      results.push(`InboxMessage: ${warmingMarked} mensagens chip-to-chip (aquecimento) marcadas como isCampaign=true`)
    } catch (warmingErr: any) {
      results.push(`InboxMessage: warming cleanup - ${warmingErr.message}`)
    }

    // Step 6.8: Ensure isCampaign column exists on InboxMessage
    try {
      const inboxCols = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'InboxMessage'
        ORDER BY ordinal_position
      `
      const inboxColNames = inboxCols.map(c => c.column_name)

      if (!inboxColNames.includes('isCampaign')) {
        await db.$executeRawUnsafe(`ALTER TABLE "InboxMessage" ADD COLUMN IF NOT EXISTS "isCampaign" BOOLEAN NOT NULL DEFAULT false`)
        results.push('InboxMessage: adicionada coluna isCampaign')
      } else {
        results.push('InboxMessage: isCampaign já existe')
      }
    } catch (colErr: any) {
      results.push(`InboxMessage: isCampaign column check - ${colErr.message}`)
    }

    // Step 7: Sync Campaign table — add statusReason column
    try {
      const campColumns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'Campaign'
        ORDER BY ordinal_position
      `
      const campColumnNames = campColumns.map(c => c.column_name)

      if (!campColumnNames.includes('statusReason')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "statusReason" TEXT`)
        results.push('Campaign: adicionada coluna statusReason')
      } else {
        results.push('Campaign: statusReason já existe')
      }

      // Drop orphan columns that don't exist in Prisma schema
      // (mediaUrl/mediatype are on SequenceStep and Message, not Campaign)
      if (campColumnNames.includes('mediaUrl')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "mediaUrl"`)
        results.push('Campaign: removida coluna orfã mediaUrl')
      }

      if (campColumnNames.includes('mediatype')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "mediatype"`)
        results.push('Campaign: removida coluna orfã mediatype')
      }

      // Also ensure Message table has mediaUrl and mediatype
      const msgColumns2 = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'Message'
        ORDER BY ordinal_position
      `
      const msgColumnNames2 = msgColumns2.map(c => c.column_name)

      if (!msgColumnNames2.includes('mediaUrl')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT`)
        results.push('Message: adicionada coluna mediaUrl')
      } else {
        results.push('Message: mediaUrl já existe')
      }

      if (!msgColumnNames2.includes('mediatype')) {
        await db.$executeRawUnsafe(`ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mediatype" TEXT`)
        results.push('Message: adicionada coluna mediatype')
      } else {
        results.push('Message: mediatype já existe')
      }
    } catch (campError: any) {
      results.push(`Erro na migração Campaign: ${campError.message}`)
    }

    // Step 8.9: Sync AntiBanSettings — add reconnection, verifier, evolution API columns
    try {
      const absNewColumns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'AntiBanSettings'
        ORDER BY ordinal_position
      `
      const absNewColNames = absNewColumns.map(c => c.column_name)

      const newColumns = [
        { name: 'reconnectMaxConcurrent', type: 'INTEGER NOT NULL DEFAULT 2' },
        { name: 'reconnectMaxAttempts', type: 'INTEGER NOT NULL DEFAULT 10' },
        { name: 'reconnectRespectWindow', type: 'BOOLEAN NOT NULL DEFAULT false' },
        { name: 'reconnectRateLimit', type: 'INTEGER NOT NULL DEFAULT 5' },
        { name: 'reconnectRateWindowMin', type: 'INTEGER NOT NULL DEFAULT 10' },
        { name: 'reconnectBackoffMs', type: `TEXT NOT NULL DEFAULT '[5000,15000,45000,120000,300000,600000]'` },
        { name: 'reconnectInterDelayMs', type: 'INTEGER NOT NULL DEFAULT 15000' },
        { name: 'reconnectConnectTimeoutMs', type: 'INTEGER NOT NULL DEFAULT 60000' },
        { name: 'circuitBreakerThreshold', type: 'INTEGER NOT NULL DEFAULT 3' },
        { name: 'verifyDailyLimit', type: 'INTEGER NOT NULL DEFAULT 300' },
        { name: 'evolutionApiTimeoutMs', type: 'INTEGER NOT NULL DEFAULT 15000' },
        { name: 'autoRejectCalls', type: 'BOOLEAN NOT NULL DEFAULT true' },
        { name: 'autoRejectCallMessage', type: `TEXT NOT NULL DEFAULT 'Desculpa, nao posso atender agora.'` },
      ]

      for (const col of newColumns) {
        if (!absNewColNames.includes(col.name)) {
          await db.$executeRawUnsafe(`ALTER TABLE "AntiBanSettings" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}`)
          results.push(`AntiBanSettings: adicionada coluna ${col.name}`)
        } else {
          results.push(`AntiBanSettings: ${col.name} já existe`)
        }
      }
    } catch (absNewErr: any) {
      results.push(`Erro na migração AntiBanSettings (new cols): ${absNewErr.message}`)
    }

    // Step 8: Create BlockedContact table for blocked contact detection
    try {
      const blockedExists = await db.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'BlockedContact'
        ) as exists
      `

      if (!blockedExists[0]?.exists) {
        console.log('[Setup] Creating BlockedContact table...')
        await db.$executeRawUnsafe(`
          CREATE TABLE "BlockedContact" (
            "id" TEXT NOT NULL,
            "chipId" TEXT NOT NULL,
            "contactPhone" TEXT NOT NULL,
            "contactId" TEXT,
            "reason" TEXT NOT NULL DEFAULT 'undelivered',
            "confidence" TEXT NOT NULL DEFAULT 'medium',
            "undeliveredCount" INTEGER NOT NULL DEFAULT 0,
            "lastSentAt" TIMESTAMP(3),
            "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "autoBlocked" BOOLEAN NOT NULL DEFAULT true,
            "unblockedAt" TIMESTAMP(3),
            "unblockReason" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "BlockedContact_pkey" PRIMARY KEY ("id"),
            CONSTRAINT "BlockedContact_chipId_contactPhone_key" UNIQUE ("chipId", "contactPhone"),
            CONSTRAINT "BlockedContact_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "Chip"("id") ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT "BlockedContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE
          )
        `)
        // Create indexes
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BlockedContact_chipId_idx" ON "BlockedContact"("chipId")`)
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BlockedContact_contactPhone_idx" ON "BlockedContact"("contactPhone")`)
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BlockedContact_unblockedAt_idx" ON "BlockedContact"("unblockedAt")`)
        results.push('BlockedContact: tabela criada com sucesso')
      } else {
        results.push('BlockedContact: tabela já existe')
      }
    } catch (blockedErr: any) {
      results.push(`Erro ao criar BlockedContact: ${blockedErr.message}`)
    }

    // Step 8: Create Conversation table (Chatwoot-like 4-level hierarchy)
    try {
      const convTableExists = await db.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'Conversation'
        ) AS exists
      `
      if (!convTableExists[0]?.exists) {
        await db.$executeRawUnsafe(`
          CREATE TABLE "Conversation" (
            "id" TEXT NOT NULL,
            "chipId" TEXT NOT NULL,
            "remoteJid" TEXT NOT NULL,
            "remotePhone" TEXT NOT NULL DEFAULT '',
            "contactName" TEXT,
            "pushName" TEXT,
            "groupName" TEXT,
            "isGroup" BOOLEAN NOT NULL DEFAULT false,
            "isArchived" BOOLEAN NOT NULL DEFAULT false,
            "status" TEXT NOT NULL DEFAULT 'open',
            "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "lastMessagePreview" TEXT,
            "lastMessageType" TEXT,
            "lastMessageFromMe" BOOLEAN NOT NULL DEFAULT false,
            "lastMessageStatus" TEXT,
            "unreadCount" INTEGER NOT NULL DEFAULT 0,
            "profilePicUrl" TEXT,
            "participantCount" INTEGER,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id"),
            CONSTRAINT "Conversation_chipId_remoteJid_key" UNIQUE ("chipId", "remoteJid"),
            CONSTRAINT "Conversation_chipId_fkey" FOREIGN KEY ("chipId") REFERENCES "Chip"("id") ON DELETE CASCADE ON UPDATE CASCADE
          )
        `)
        // Create indexes
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Conversation_chipId_lastMessageAt_idx" ON "Conversation"("chipId", "lastMessageAt")`)
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Conversation_chipId_status_idx" ON "Conversation"("chipId", "status")`)
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Conversation_isArchived_idx" ON "Conversation"("isArchived")`)
        results.push('Conversation: tabela criada com sucesso')
      } else {
        results.push('Conversation: tabela já existe')
      }

      // Add conversationId column to InboxMessage if not exists
      const inboxColumns = await db.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'InboxMessage'
      `
      const inboxColumnNames = inboxColumns.map(c => c.column_name)
      if (!inboxColumnNames.includes('conversationId')) {
        await db.$executeRawUnsafe(`ALTER TABLE "InboxMessage" ADD COLUMN IF NOT EXISTS "conversationId" TEXT`)
        results.push('InboxMessage: adicionada coluna conversationId')
      } else {
        results.push('InboxMessage: conversationId já existe')
      }
    } catch (convErr: any) {
      results.push(`Erro ao criar Conversation: ${convErr.message}`)
    }

    return NextResponse.json({
      success: true,
      message: 'Migração processada',
      steps: results,
    })
  } catch (error: any) {
    console.error('[Setup] Sync schema error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
