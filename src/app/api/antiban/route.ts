import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/antiban — Get current anti-ban settings
export async function GET() {
  try {
    let settings = await db.antiBanSettings.findFirst()
    if (!settings) {
      // Create default settings if none exist
      settings = await db.antiBanSettings.create({ data: {} })
    }
    return NextResponse.json(settings)
  } catch (error) {
    console.error('Error fetching anti-ban settings:', error)
    return NextResponse.json({ error: 'Erro ao buscar configurações anti-ban' }, { status: 500 })
  }
}

// PATCH /api/antiban — Update anti-ban settings
export async function PATCH(request: NextRequest) {
  try {
    let settings = await db.antiBanSettings.findFirst()
    if (!settings) {
      settings = await db.antiBanSettings.create({ data: {} })
    }

    const body = await request.json()

    // Reset all to defaults
    if (body._resetToDefaults) {
      const defaults = {
        typingMinDelay: 3000,
        typingMaxDelay: 15000,
        messageIntervalMin: 30,
        messageIntervalMax: 90,
        dailyLimitPerChip: 200,
        warmingEnabled: true,
        warmingDays: 7,
        cooldownMinutes: 30,
        cooldownAfterMessages: 50,
        stopOnWarning: true,
        sendingWindowStart: 8,
        sendingWindowEnd: 21,
        timezone: 'America/Sao_Paulo',
      }
      const updated = await db.antiBanSettings.update({
        where: { id: settings.id },
        data: defaults,
      })
      return NextResponse.json(updated)
    }

    // Reset a whole section to defaults
    if (body._resetSection) {
      const sectionFields: Record<string, string[]> = {
        typing: ['typingMinDelay', 'typingMaxDelay'],
        interval: ['messageIntervalMin', 'messageIntervalMax'],
        warming: ['warmingEnabled', 'warmingDays'],
        cooldown: ['dailyLimitPerChip', 'cooldownAfterMessages', 'cooldownMinutes', 'stopOnWarning'],
        sendingWindow: ['sendingWindowStart', 'sendingWindowEnd', 'timezone'],
      }
      const fieldDefaults: Record<string, unknown> = {
        typingMinDelay: 3000,
        typingMaxDelay: 15000,
        messageIntervalMin: 30,
        messageIntervalMax: 90,
        dailyLimitPerChip: 200,
        warmingEnabled: true,
        warmingDays: 7,
        cooldownMinutes: 30,
        cooldownAfterMessages: 50,
        stopOnWarning: true,
        sendingWindowStart: 8,
        sendingWindowEnd: 21,
        timezone: 'America/Sao_Paulo',
      }
      const section = body._resetSection as string
      if (!(section in sectionFields)) {
        return NextResponse.json({ error: 'Seção desconhecida' }, { status: 400 })
      }
      const resetData: Record<string, unknown> = {}
      for (const field of sectionFields[section]) {
        resetData[field] = fieldDefaults[field]
      }
      const updated = await db.antiBanSettings.update({
        where: { id: settings.id },
        data: resetData,
      })
      return NextResponse.json(updated)
    }

    // Reset single field to default
    if (body._resetField) {
      const fieldDefaults: Record<string, unknown> = {
        typingMinDelay: 3000,
        typingMaxDelay: 15000,
        messageIntervalMin: 30,
        messageIntervalMax: 90,
        dailyLimitPerChip: 200,
        warmingEnabled: true,
        warmingDays: 7,
        cooldownMinutes: 30,
        cooldownAfterMessages: 50,
        stopOnWarning: true,
        sendingWindowStart: 8,
        sendingWindowEnd: 21,
        timezone: 'America/Sao_Paulo',
      }
      const field = body._resetField as string
      if (!(field in fieldDefaults)) {
        return NextResponse.json({ error: 'Campo desconhecido' }, { status: 400 })
      }
      const updated = await db.antiBanSettings.update({
        where: { id: settings.id },
        data: { [field]: fieldDefaults[field] },
      })
      return NextResponse.json(updated)
    }

    const allowedFields = [
      'typingMinDelay',
      'typingMaxDelay',
      'messageIntervalMin',
      'messageIntervalMax',
      'dailyLimitPerChip',
      'warmingEnabled',
      'warmingDays',
      'cooldownMinutes',
      'cooldownAfterMessages',
      'stopOnWarning',
      'sendingWindowStart',
      'sendingWindowEnd',
      'timezone',
    ]

    const updateData: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    // Validate ranges
    if (updateData.typingMinDelay !== undefined && Number(updateData.typingMinDelay) < 1000) {
      return NextResponse.json(
        { error: 'Delay mínimo de digitação deve ser pelo menos 1000ms' },
        { status: 400 }
      )
    }
    if (updateData.typingMaxDelay !== undefined && Number(updateData.typingMaxDelay) < Number(updateData.typingMinDelay || settings.typingMinDelay)) {
      return NextResponse.json(
        { error: 'Delay máximo deve ser maior que o mínimo' },
        { status: 400 }
      )
    }
    if (updateData.sendingWindowStart !== undefined && (Number(updateData.sendingWindowStart) < 0 || Number(updateData.sendingWindowStart) > 23)) {
      return NextResponse.json(
        { error: 'Hora de início deve ser entre 0 e 23' },
        { status: 400 }
      )
    }
    if (updateData.sendingWindowEnd !== undefined && (Number(updateData.sendingWindowEnd) < 1 || Number(updateData.sendingWindowEnd) > 24)) {
      return NextResponse.json(
        { error: 'Hora de término deve ser entre 1 e 24' },
        { status: 400 }
      )
    }

    const updated = await db.antiBanSettings.update({
      where: { id: settings.id },
      data: updateData,
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error updating anti-ban settings:', error)
    return NextResponse.json({ error: 'Erro ao atualizar configurações anti-ban' }, { status: 500 })
  }
}
