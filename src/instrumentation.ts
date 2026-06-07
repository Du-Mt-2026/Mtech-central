// Next.js Instrumentation hook — runs once on server startup
// Used to ensure database schema is up-to-date before the app starts serving requests

export async function register() {
  // Only run on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { db } = await import('@/lib/db')

      // Ensure MessageKey table has resolutionType and timeSlots columns
      try {
        const columns = await db.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'MessageKey'
        `
        const columnNames = columns.map(c => c.column_name)

        if (!columnNames.includes('resolutionType')) {
          await db.$executeRawUnsafe(`ALTER TABLE "MessageKey" ADD COLUMN IF NOT EXISTS "resolutionType" TEXT NOT NULL DEFAULT 'random'`)
          console.log('[Instrumentation] Added resolutionType column to MessageKey')
        }
        if (!columnNames.includes('timeSlots')) {
          await db.$executeRawUnsafe(`ALTER TABLE "MessageKey" ADD COLUMN IF NOT EXISTS "timeSlots" TEXT`)
          console.log('[Instrumentation] Added timeSlots column to MessageKey')
        }
      } catch (schemaErr) {
        console.error('[Instrumentation] Failed to sync MessageKey schema:', schemaErr)
      }

      // Seed default keys if they don't exist
      try {
        const defaultKeys = [
          {
            name: 'BOM_DIA',
            label: 'Saudação - Bom dia',
            category: 'saudacao',
            variations: JSON.stringify(['Bom dia!', 'Bom dia, tudo bem?', 'Oi, bom dia!', 'Olá, bom dia!', 'Bom dia! Como vai?']),
            resolutionType: 'random',
            timeSlots: null,
            isDefault: true,
          },
          {
            name: 'BOA_TARDE',
            label: 'Saudação - Boa tarde',
            category: 'saudacao',
            variations: JSON.stringify(['Boa tarde!', 'Boa tarde, tudo bem?', 'Oi, boa tarde!', 'Olá, boa tarde!', 'Boa tarde! Como vai?']),
            resolutionType: 'random',
            timeSlots: null,
            isDefault: true,
          },
          {
            name: 'BOA_NOITE',
            label: 'Saudação - Boa noite',
            category: 'saudacao',
            variations: JSON.stringify(['Boa noite!', 'Boa noite, tudo bem?', 'Oi, boa noite!', 'Olá, boa noite!', 'Boa noite! Como vai?']),
            resolutionType: 'random',
            timeSlots: null,
            isDefault: true,
          },
          {
            name: 'SAUDACAO',
            label: 'Saudação Automática',
            category: 'saudacao',
            variations: JSON.stringify(['{{BOM_DIA}}', '{{BOA_TARDE}}', '{{BOA_NOITE}}']),
            resolutionType: 'time_based',
            timeSlots: JSON.stringify([
              { key: 'BOM_DIA', start: '06:01', end: '12:00' },
              { key: 'BOA_TARDE', start: '12:01', end: '19:00' },
              { key: 'BOA_NOITE', start: '19:01', end: '06:00' },
            ]),
            isDefault: true,
          },
        ]

        for (const keyData of defaultKeys) {
          const existing = await db.messageKey.findUnique({ where: { name: keyData.name } })
          if (!existing) {
            await db.messageKey.create({ data: keyData })
            console.log(`[Instrumentation] Created default key: ${keyData.name}`)
          } else {
            // Update to ensure correct config
            await db.messageKey.update({
              where: { name: keyData.name },
              data: {
                label: keyData.label,
                category: keyData.category,
                variations: keyData.variations,
                resolutionType: keyData.resolutionType,
                timeSlots: keyData.timeSlots,
                isDefault: true,
              },
            })
          }
        }
      } catch (seedErr) {
        console.error('[Instrumentation] Failed to seed default keys:', seedErr)
      }

      console.log('[Instrumentation] Startup complete')
    } catch (err) {
      console.error('[Instrumentation] Startup failed:', err)
    }
  }
}
