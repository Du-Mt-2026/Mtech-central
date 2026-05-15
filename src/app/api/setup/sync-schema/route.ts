import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/setup/sync-schema — Migrate AdminUser table to new schema
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { secret } = body

    // Protect with secret
    if (secret !== process.env.AUTH_SECRET && secret !== 'octupuszap-dev-secret-change-in-production') {
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
        // Already has new schema
        results.push('Schema já está atualizado. Nenhuma migração necessária.')
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
    } catch (chipError: any) {
      results.push(`Erro na migração Chip: ${chipError.message}`)
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
