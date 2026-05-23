import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Backward compat: if value is < 25, it's old hour format → convert to minutes-from-midnight
function toMins(val: number): number {
  return val < 25 ? val * 60 : val
}

// Default nursery schedule (matching sending-engine.ts)
const DEFAULT_NURSERY_SCHEDULE = JSON.stringify([
  { dayRange: '1-2', days: [1, 2], limit: 10 },
  { dayRange: '3-4', days: [3, 4], limit: 20 },
  { dayRange: '5-6', days: [5, 6], limit: 30 },
  { dayRange: '7-8', days: [7, 8], limit: 40 },
  { dayRange: '9-10', days: [9, 10], limit: 50 },
  { dayRange: '11-12', days: [11, 12], limit: 60 },
  { dayRange: '13-14', days: [13, 14], limit: 80 },
])

// Default prewarm schedule (matching sending-engine.ts)
const DEFAULT_PREWARM_SCHEDULE = JSON.stringify([
  { dayRange: '1', days: [1, 1], limit: 11 },
  { dayRange: '2', days: [2, 2], limit: 15 },
  { dayRange: '3', days: [3, 3], limit: 20 },
  { dayRange: '4', days: [4, 4], limit: 25 },
  { dayRange: '5', days: [5, 5], limit: 30 },
  { dayRange: '6', days: [6, 6], limit: 35 },
  { dayRange: '7', days: [7, 7], limit: 40 },
  { dayRange: '8', days: [8, 8], limit: 45 },
  { dayRange: '9', days: [9, 9], limit: 50 },
  { dayRange: '10', days: [10, 10], limit: 60 },
  { dayRange: '11', days: [11, 11], limit: 70 },
  { dayRange: '12', days: [12, 12], limit: 80 },
  { dayRange: '13', days: [13, 13], limit: 90 },
  { dayRange: '14', days: [14, 14], limit: 100 },
  { dayRange: '15', days: [15, 15], limit: 120 },
  { dayRange: '16', days: [16, 16], limit: 140 },
  { dayRange: '17', days: [17, 17], limit: 160 },
  { dayRange: '18', days: [18, 18], limit: 180 },
  { dayRange: '19', days: [19, 19], limit: 190 },
  { dayRange: '20', days: [20, 20], limit: 200 },
])

// GET /api/antiban — Get current anti-ban settings
export async function GET() {
  try {
    let settings = await db.antiBanSettings.findFirst()
    if (!settings) {
      // Create default settings if none exist
      settings = await db.antiBanSettings.create({ data: {} })
    }
    // Auto-migrate old hour-based values to minutes-from-midnight
    const needsMigration = settings.sendingWindowStart < 25 || settings.sendingWindowEnd < 25
    if (needsMigration) {
      const migrated = await db.antiBanSettings.update({
        where: { id: settings.id },
        data: {
          sendingWindowStart: toMins(settings.sendingWindowStart),
          sendingWindowEnd: toMins(settings.sendingWindowEnd),
        },
      })
      return NextResponse.json(migrated)
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
        cooldownMinutes: 30,
        cooldownMinutesMax: 30,
        cooldownAfterMessages: 50,
        cooldownAfterMessagesMax: 50,
        stopOnWarning: true,
        sendingWindowStart: 480,
        sendingWindowEnd: 1260,
        timezone: 'America/Sao_Paulo',
        breakWindows: '[]',
        nurserySchedule: DEFAULT_NURSERY_SCHEDULE,
        prewarmSchedule: DEFAULT_PREWARM_SCHEDULE,
        readyDailyLimit: 200,
        hourlyLimit: 30,
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
        warming: ['warmingEnabled', 'nurserySchedule', 'prewarmSchedule', 'readyDailyLimit', 'hourlyLimit'],
        cooldown: ['dailyLimitPerChip', 'cooldownMinutes', 'cooldownMinutesMax', 'cooldownAfterMessages', 'cooldownAfterMessagesMax', 'stopOnWarning'],
        sendingWindow: ['sendingWindowStart', 'sendingWindowEnd', 'timezone', 'breakWindows'],
      }
      const fieldDefaults: Record<string, unknown> = {
        typingMinDelay: 3000,
        typingMaxDelay: 15000,
        messageIntervalMin: 30,
        messageIntervalMax: 90,
        dailyLimitPerChip: 200,
        warmingEnabled: true,
        cooldownMinutes: 30,
        cooldownMinutesMax: 30,
        cooldownAfterMessages: 50,
        cooldownAfterMessagesMax: 50,
        stopOnWarning: true,
        sendingWindowStart: 480,
        sendingWindowEnd: 1260,
        timezone: 'America/Sao_Paulo',
        breakWindows: '[]',
        nurserySchedule: DEFAULT_NURSERY_SCHEDULE,
        prewarmSchedule: DEFAULT_PREWARM_SCHEDULE,
        readyDailyLimit: 200,
        hourlyLimit: 30,
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
        cooldownMinutes: 30,
        cooldownMinutesMax: 30,
        cooldownAfterMessages: 50,
        cooldownAfterMessagesMax: 50,
        stopOnWarning: true,
        sendingWindowStart: 480,
        sendingWindowEnd: 1260,
        timezone: 'America/Sao_Paulo',
        breakWindows: '[]',
        nurserySchedule: DEFAULT_NURSERY_SCHEDULE,
        prewarmSchedule: DEFAULT_PREWARM_SCHEDULE,
        readyDailyLimit: 200,
        hourlyLimit: 30,
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
      'cooldownMinutes',
      'cooldownMinutesMax',
      'cooldownAfterMessages',
      'cooldownAfterMessagesMax',
      'stopOnWarning',
      'sendingWindowStart',
      'sendingWindowEnd',
      'timezone',
      'breakWindows',
      'nurserySchedule',
      'prewarmSchedule',
      'readyDailyLimit',
      'hourlyLimit',
    ]

    const updateData: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        // For schedule fields, store as JSON string
        if ((field === 'nurserySchedule' || field === 'prewarmSchedule') && typeof body[field] !== 'string') {
          updateData[field] = JSON.stringify(body[field])
        } else {
          updateData[field] = body[field]
        }
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
    if (updateData.sendingWindowStart !== undefined && (Number(updateData.sendingWindowStart) < 0 || Number(updateData.sendingWindowStart) > 1440)) {
      return NextResponse.json(
        { error: 'Horário de início deve ser entre 0 e 1440 minutos' },
        { status: 400 }
      )
    }
    if (updateData.sendingWindowEnd !== undefined && (Number(updateData.sendingWindowEnd) < 0 || Number(updateData.sendingWindowEnd) > 1440)) {
      return NextResponse.json(
        { error: 'Horário de término deve ser entre 0 e 1440 minutos' },
        { status: 400 }
      )
    }
    if (updateData.readyDailyLimit !== undefined && Number(updateData.readyDailyLimit) < 10) {
      return NextResponse.json(
        { error: 'Limite diário aquecido deve ser pelo menos 10' },
        { status: 400 }
      )
    }
    if (updateData.hourlyLimit !== undefined && Number(updateData.hourlyLimit) < 5) {
      return NextResponse.json(
        { error: 'Limite por hora deve ser pelo menos 5' },
        { status: 400 }
      )
    }

    // Validate schedule JSON if provided
    for (const scheduleField of ['nurserySchedule', 'prewarmSchedule']) {
      if (updateData[scheduleField] !== undefined) {
        try {
          const parsed = typeof updateData[scheduleField] === 'string'
            ? JSON.parse(updateData[scheduleField] as string)
            : updateData[scheduleField]
          if (!Array.isArray(parsed) || parsed.length === 0) {
            return NextResponse.json(
              { error: `Schedule ${scheduleField} deve ser um array não-vazio` },
              { status: 400 }
            )
          }
          for (const entry of parsed) {
            if (!entry.dayRange || entry.limit === undefined || entry.limit < 1) {
              return NextResponse.json(
                { error: `Cada entrada do schedule deve ter dayRange e limit >= 1` },
                { status: 400 }
              )
            }
          }
          // Ensure it's stored as JSON string
          if (typeof updateData[scheduleField] !== 'string') {
            updateData[scheduleField] = JSON.stringify(updateData[scheduleField])
          }
        } catch {
          return NextResponse.json(
            { error: `Schedule ${scheduleField} inválido` },
            { status: 400 }
          )
        }
      }
    }

    // Validate breakWindows JSON if provided
    if (updateData.breakWindows !== undefined) {
      try {
        const parsed = typeof updateData.breakWindows === 'string'
          ? JSON.parse(updateData.breakWindows as string)
          : updateData.breakWindows
        if (!Array.isArray(parsed)) {
          return NextResponse.json(
            { error: 'breakWindows deve ser um array' },
            { status: 400 }
          )
        }
        for (const entry of parsed) {
          if (entry.start === undefined || entry.end === undefined || entry.start < 0 || entry.end > 1440 || entry.start >= entry.end) {
            return NextResponse.json(
              { error: 'Cada janela de pausa deve ter start < end (0-1440 minutos)' },
              { status: 400 }
            )
          }
          entry.label = entry.label || 'Pausa'
        }
        updateData.breakWindows = JSON.stringify(parsed)
      } catch {
        return NextResponse.json(
          { error: 'breakWindows JSON inválido' },
          { status: 400 }
        )
      }
    }

    // Validate cooldownMinutesMax >= cooldownMinutes
    if (updateData.cooldownMinutesMax !== undefined && Number(updateData.cooldownMinutesMax) < Number(updateData.cooldownMinutes || settings.cooldownMinutes)) {
      return NextResponse.json(
        { error: 'Cooldown máximo deve ser maior ou igual ao mínimo' },
        { status: 400 }
      )
    }

    // Validate cooldownAfterMessagesMax >= cooldownAfterMessages
    if (updateData.cooldownAfterMessagesMax !== undefined && Number(updateData.cooldownAfterMessagesMax) < Number(updateData.cooldownAfterMessages || settings.cooldownAfterMessages)) {
      return NextResponse.json(
        { error: 'Limite máximo de mensagens deve ser maior ou igual ao mínimo' },
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
