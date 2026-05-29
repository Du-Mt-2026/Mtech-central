import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toMins } from '@/lib/time-utils'
import { FIELD_DEFAULTS, SECTION_FIELDS, antiBanUpdateSchema, scheduleEntrySchema, breakWindowSchema, humanBehaviorConfigSchema } from '@/lib/constants'
import { ZodError } from 'zod'
import { clearAntiBanApiCache } from '@/lib/evolution-api'

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
      const updated = await db.antiBanSettings.update({
        where: { id: settings.id },
        data: FIELD_DEFAULTS,
      })
      clearAntiBanApiCache() // Invalidate cached API settings (timeout, call reject, etc.)
      return NextResponse.json(updated)
    }

    // Reset a whole section to defaults
    if (body._resetSection) {
      const section = body._resetSection as string
      if (!(section in SECTION_FIELDS)) {
        return NextResponse.json({ error: 'Seção desconhecida' }, { status: 400 })
      }
      const resetData: Record<string, unknown> = {}
      for (const field of SECTION_FIELDS[section]) {
        resetData[field] = FIELD_DEFAULTS[field]
      }
      const updated = await db.antiBanSettings.update({
        where: { id: settings.id },
        data: resetData,
      })
      clearAntiBanApiCache() // Invalidate cached API settings
      return NextResponse.json(updated)
    }

    // Reset single field to default
    if (body._resetField) {
      const field = body._resetField as string
      if (!(field in FIELD_DEFAULTS)) {
        return NextResponse.json({ error: 'Campo desconhecido' }, { status: 400 })
      }
      const updated = await db.antiBanSettings.update({
        where: { id: settings.id },
        data: { [field]: FIELD_DEFAULTS[field] },
      })
      clearAntiBanApiCache() // Invalidate cached API settings
      return NextResponse.json(updated)
    }

    // ============================================================
    // ZOD VALIDATION — replaces all manual range checks
    // ============================================================
    const parsed = antiBanUpdateSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]
      const field = firstError.path.join('.')
      const message = firstError.message
      return NextResponse.json({ error: message, field }, { status: 400 })
    }

    // Build updateData from parsed (only fields that were provided)
    const updateData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        updateData[key] = value
      }
    }

    // Cross-field validation: typingMaxDelay >= typingMinDelay (when only one is sent, use DB value)
    if (updateData.typingMaxDelay !== undefined) {
      const minDelay = Number(updateData.typingMinDelay ?? settings.typingMinDelay)
      if (Number(updateData.typingMaxDelay) < minDelay) {
        return NextResponse.json(
          { error: 'Delay máximo deve ser maior que o mínimo', field: 'typingMaxDelay' },
          { status: 400 }
        )
      }
    }

    // Cross-field validation: cooldownMinutesMax >= cooldownMinutes
    if (updateData.cooldownMinutesMax !== undefined) {
      const minCooldown = Number(updateData.cooldownMinutes ?? settings.cooldownMinutes)
      if (Number(updateData.cooldownMinutesMax) < minCooldown) {
        return NextResponse.json(
          { error: 'Cooldown máximo deve ser maior ou igual ao mínimo', field: 'cooldownMinutesMax' },
          { status: 400 }
        )
      }
    }

    // Cross-field validation: cooldownAfterMessagesMax >= cooldownAfterMessages
    if (updateData.cooldownAfterMessagesMax !== undefined) {
      const minAfter = Number(updateData.cooldownAfterMessages ?? settings.cooldownAfterMessages)
      if (Number(updateData.cooldownAfterMessagesMax) < minAfter) {
        return NextResponse.json(
          { error: 'Limite máximo de mensagens deve ser maior ou igual ao mínimo', field: 'cooldownAfterMessagesMax' },
          { status: 400 }
        )
      }
    }

    // Convert schedule arrays to JSON strings for DB storage
    for (const scheduleField of ['nurserySchedule', 'prewarmSchedule'] as const) {
      if (updateData[scheduleField] !== undefined) {
        if (typeof updateData[scheduleField] !== 'string') {
          updateData[scheduleField] = JSON.stringify(updateData[scheduleField])
        } else {
          // Validate the JSON string content
          try {
            const arr = JSON.parse(updateData[scheduleField] as string)
            const result = scheduleEntrySchema.array().safeParse(arr)
            if (!result.success) {
              return NextResponse.json(
                { error: `Schedule ${scheduleField} inválido`, field: scheduleField },
                { status: 400 }
              )
            }
          } catch {
            return NextResponse.json(
              { error: `Schedule ${scheduleField} JSON inválido`, field: scheduleField },
              { status: 400 }
            )
          }
        }
      }
    }

    // Convert breakWindows array to JSON string for DB storage
    if (updateData.breakWindows !== undefined) {
      if (typeof updateData.breakWindows !== 'string') {
        // Already validated by Zod — just stringify
        updateData.breakWindows = JSON.stringify(updateData.breakWindows)
      } else {
        // Validate the JSON string content
        try {
          const arr = JSON.parse(updateData.breakWindows as string)
          const result = breakWindowSchema.array().safeParse(arr)
          if (!result.success) {
            return NextResponse.json(
              { error: 'breakWindows JSON inválido', field: 'breakWindows' },
              { status: 400 }
            )
          }
          // Re-stringify with defaults applied by Zod (e.g., label = 'Pausa')
          updateData.breakWindows = JSON.stringify(result.data)
        } catch {
          return NextResponse.json(
            { error: 'breakWindows JSON inválido', field: 'breakWindows' },
            { status: 400 }
          )
        }
      }
    }

    // Convert humanBehaviorConfig to JSON string for DB storage
    if (updateData.humanBehaviorConfig !== undefined) {
      if (typeof updateData.humanBehaviorConfig !== 'string') {
        // Already validated by Zod — just stringify
        updateData.humanBehaviorConfig = JSON.stringify(updateData.humanBehaviorConfig)
      } else {
        // Validate the JSON string content
        try {
          const parsed = JSON.parse(updateData.humanBehaviorConfig as string)
          const result = humanBehaviorConfigSchema.safeParse(parsed)
          if (!result.success) {
            const firstError = result.error.issues[0]
            return NextResponse.json(
              { error: `humanBehaviorConfig inválido: ${firstError.message}`, field: `humanBehaviorConfig.${firstError.path.join('.')}` },
              { status: 400 }
            )
          }
          // Re-stringify with defaults applied by Zod
          updateData.humanBehaviorConfig = JSON.stringify(result.data)
        } catch {
          return NextResponse.json(
            { error: 'humanBehaviorConfig JSON inválido', field: 'humanBehaviorConfig' },
            { status: 400 }
          )
        }
      }
    }

    // Convert reconnectBackoffMs array to JSON string for DB storage
    if (updateData.reconnectBackoffMs !== undefined) {
      if (typeof updateData.reconnectBackoffMs !== 'string') {
        // Validate it's an array of positive numbers
        const arr = updateData.reconnectBackoffMs as number[]
        if (!Array.isArray(arr) || arr.length === 0 || !arr.every(n => typeof n === 'number' && n > 0)) {
          return NextResponse.json(
            { error: 'reconnectBackoffMs deve ser um array de números positivos', field: 'reconnectBackoffMs' },
            { status: 400 }
          )
        }
        updateData.reconnectBackoffMs = JSON.stringify(arr)
      } else {
        try {
          const arr = JSON.parse(updateData.reconnectBackoffMs as string)
          if (!Array.isArray(arr) || arr.length === 0 || !arr.every((n: number) => typeof n === 'number' && n > 0)) {
            return NextResponse.json(
              { error: 'reconnectBackoffMs deve ser um array de números positivos', field: 'reconnectBackoffMs' },
              { status: 400 }
            )
          }
        } catch {
          return NextResponse.json(
            { error: 'reconnectBackoffMs JSON inválido', field: 'reconnectBackoffMs' },
            { status: 400 }
          )
        }
      }
    }

    // Convert banCodes array to JSON string for DB storage
    if (updateData.banCodes !== undefined) {
      if (typeof updateData.banCodes !== 'string') {
        const arr = updateData.banCodes as number[]
        if (!Array.isArray(arr) || arr.length === 0 || !arr.every(n => typeof n === 'number' && n > 0)) {
          return NextResponse.json(
            { error: 'banCodes deve ser um array de números positivos', field: 'banCodes' },
            { status: 400 }
          )
        }
        updateData.banCodes = JSON.stringify(arr)
      } else {
        try {
          const arr = JSON.parse(updateData.banCodes as string)
          if (!Array.isArray(arr) || !arr.every((n: number) => typeof n === 'number' && n > 0)) {
            return NextResponse.json(
              { error: 'banCodes deve ser um array de números positivos', field: 'banCodes' },
              { status: 400 }
            )
          }
        } catch {
          return NextResponse.json(
            { error: 'banCodes JSON inválido', field: 'banCodes' },
            { status: 400 }
          )
        }
      }
    }

    // Convert restrictionKeywords array to JSON string for DB storage
    if (updateData.restrictionKeywords !== undefined) {
      if (typeof updateData.restrictionKeywords !== 'string') {
        const arr = updateData.restrictionKeywords as string[]
        if (!Array.isArray(arr) || arr.length === 0 || !arr.every(s => typeof s === 'string' && s.length > 0)) {
          return NextResponse.json(
            { error: 'restrictionKeywords deve ser um array de strings não vazias', field: 'restrictionKeywords' },
            { status: 400 }
          )
        }
        updateData.restrictionKeywords = JSON.stringify(arr)
      } else {
        try {
          const arr = JSON.parse(updateData.restrictionKeywords as string)
          if (!Array.isArray(arr) || !arr.every((s: string) => typeof s === 'string' && s.length > 0)) {
            return NextResponse.json(
              { error: 'restrictionKeywords deve ser um array de strings não vazias', field: 'restrictionKeywords' },
              { status: 400 }
            )
          }
        } catch {
          return NextResponse.json(
            { error: 'restrictionKeywords JSON inválido', field: 'restrictionKeywords' },
            { status: 400 }
          )
        }
      }
    }

    // Convert warningKeywords array to JSON string for DB storage
    if (updateData.warningKeywords !== undefined) {
      if (typeof updateData.warningKeywords !== 'string') {
        const arr = updateData.warningKeywords as string[]
        if (!Array.isArray(arr) || arr.length === 0 || !arr.every(s => typeof s === 'string' && s.length > 0)) {
          return NextResponse.json(
            { error: 'warningKeywords deve ser um array de strings não vazias', field: 'warningKeywords' },
            { status: 400 }
          )
        }
        updateData.warningKeywords = JSON.stringify(arr)
      } else {
        try {
          const arr = JSON.parse(updateData.warningKeywords as string)
          if (!Array.isArray(arr) || !arr.every((s: string) => typeof s === 'string' && s.length > 0)) {
            return NextResponse.json(
              { error: 'warningKeywords deve ser um array de strings não vazias', field: 'warningKeywords' },
              { status: 400 }
            )
          }
        } catch {
          return NextResponse.json(
            { error: 'warningKeywords JSON inválido', field: 'warningKeywords' },
            { status: 400 }
          )
        }
      }
    }

    const updated = await db.antiBanSettings.update({
      where: { id: settings.id },
      data: updateData,
    })

    clearAntiBanApiCache() // Invalidate cached API settings (timeout, call reject, etc.)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ZodError) {
      const firstError = error.issues[0]
      return NextResponse.json(
        { error: firstError.message, field: firstError.path.join('.') },
        { status: 400 }
      )
    }
    console.error('Error updating anti-ban settings:', error)
    return NextResponse.json({ error: 'Erro ao atualizar configurações anti-ban' }, { status: 500 })
  }
}
