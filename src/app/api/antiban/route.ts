import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Whitelist of allowed fields for anti-ban settings
const ALLOWED_FIELDS = [
  'typingMinDelay',
  'typingMaxDelay',
  'messageIntervalMin',
  'messageIntervalMax',
  'randomLineBreaks',
  'emojiVariation',
  'dailyLimitPerChip',
  'warmingEnabled',
  'warmingDays',
  'cooldownMinutes',
  'cooldownAfterMessages',
  'stopOnWarning',
] as const

// Default values matching Prisma schema @default() annotations
export const ANTI_BAN_DEFAULTS = {
  typingMinDelay: 500,
  typingMaxDelay: 2000,
  messageIntervalMin: 30,
  messageIntervalMax: 90,
  randomLineBreaks: true,
  emojiVariation: true,
  dailyLimitPerChip: 200,
  warmingEnabled: true,
  warmingDays: 7,
  cooldownMinutes: 30,
  cooldownAfterMessages: 50,
  stopOnWarning: true,
} as const

type AllowedField = typeof ALLOWED_FIELDS[number]

export async function GET() {
  try {
    let settings = await db.antiBanSettings.findFirst()
    if (!settings) {
      settings = await db.antiBanSettings.create({ data: {} })
    }
    return NextResponse.json(settings)
  } catch (error) {
    console.error('AntiBan GET error:', error)
    return NextResponse.json({ error: 'Erro ao carregar configurações anti-ban' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    let settings = await db.antiBanSettings.findFirst()
    if (!settings) {
      settings = await db.antiBanSettings.create({ data: {} })
    }

    const body = await request.json()

    // Handle reset to defaults
    if (body._resetToDefaults) {
      const reset = await db.antiBanSettings.update({
        where: { id: settings.id },
        data: { ...ANTI_BAN_DEFAULTS },
      })
      return NextResponse.json(reset)
    }

    // Only allow whitelisted fields — prevent arbitrary field injection
    const sanitizedData: Record<string, unknown> = {}
    for (const key of ALLOWED_FIELDS) {
      if (key in body) {
        sanitizedData[key] = body[key]
      }
    }

    if (Object.keys(sanitizedData).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo válido para atualizar' }, { status: 400 })
    }

    const updated = await db.antiBanSettings.update({
      where: { id: settings.id },
      data: sanitizedData as Record<AllowedField, unknown>,
    })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('AntiBan PATCH error:', error)
    return NextResponse.json({ error: 'Erro ao atualizar configurações anti-ban' }, { status: 500 })
  }
}
