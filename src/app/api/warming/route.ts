// API Routes for Chip Warming (Aquecimento de Chips)
// GET  /api/warming         — List all warming sessions
// POST /api/warming         — Create a new warming session

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { DEFAULT_WARMING_TEMPLATES } from '@/lib/warming-engine'
import { FIELD_DEFAULTS } from '@/lib/constants'

// GET — List all warming sessions
export async function GET() {
  try {
    const sessions = await db.warmingSession.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ sessions })
  } catch (error: any) {
    console.error('[Warming API] Error listing sessions:', error.message)
    return NextResponse.json(
      { error: 'Erro ao listar sessões de aquecimento' },
      { status: 500 }
    )
  }
}

// POST — Create a new warming session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const {
      name,
      strategy = 'round_robin',
      chipIds = [],
      messageTemplates,
      messagesPerChip = 150,
      intervalMin,
      intervalMax,
      activeHoursStart,
      activeHoursEnd,
      breakWindows = [],
      timezone,
      messageTypeDistribution = { text: 47, image: 27, audio: 26 },
      scheduledAt,
      // AI Bot strategy fields (apenas usados quando strategy === 'ai_bot')
      aiBotPhoneNumber,
      aiBotReplyTimeoutSec,
      aiBotMaxMissedReplies,
    } = body

    // Inherit defaults from AntiBanSettings (UI) when not explicitly provided.
    // "o sistema deve seguir a UI, sempre" — warming sessions should respect
    // the same anti-ban config the user already set in the UI.
    let antiBanDefaults: Record<string, unknown> = {}
    try {
      const saved = await db.antiBanSettings.findFirst()
      if (saved) {
        antiBanDefaults = saved as unknown as Record<string, unknown>
      }
    } catch { /* DB not available */ }

    // Priority: explicit body param > AntiBanSettings from DB > hardcoded defaults
    const effectiveIntervalMin = intervalMin ?? (antiBanDefaults.messageIntervalMin as number) ?? (FIELD_DEFAULTS.messageIntervalMin as number)
    const effectiveIntervalMax = intervalMax ?? (antiBanDefaults.messageIntervalMax as number) ?? (FIELD_DEFAULTS.messageIntervalMax as number)
    const effectiveActiveHoursStart = activeHoursStart ?? (antiBanDefaults.sendingWindowStart as number) ?? (FIELD_DEFAULTS.sendingWindowStart as number)
    const effectiveActiveHoursEnd = activeHoursEnd ?? (antiBanDefaults.sendingWindowEnd as number) ?? (FIELD_DEFAULTS.sendingWindowEnd as number)
    const effectiveTimezone = timezone ?? (antiBanDefaults.timezone as string) ?? (FIELD_DEFAULTS.timezone as string)

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    // Validações específicas por estratégia
    const minChips = antiBanDefaults.minChipsForWarming as number ?? 3

    if (strategy === 'ai_bot') {
      // Estratégia ai_bot: chips conversam com o bot Duda (não entre si).
      // Não exige 3+ chips (grafo social não se aplica — chips falam com um único número externo).
      // Mínimo de 1 chip; máximo definido pelo usuário.
      if (!chipIds || chipIds.length < 1) {
        return NextResponse.json({ error: 'Estratégia ai_bot requer pelo menos 1 chip' }, { status: 400 })
      }

      if (!aiBotPhoneNumber?.trim()) {
        return NextResponse.json({ error: 'Estratégia ai_bot requer aiBotPhoneNumber (telefone do bot Duda)' }, { status: 400 })
      }

      // Limpa o telefone (só dígitos)
      const cleanedPhone = aiBotPhoneNumber.replace(/\D/g, '')
      if (cleanedPhone.length < 10 || cleanedPhone.length > 13) {
        return NextResponse.json({ error: 'aiBotPhoneNumber inválido (esperado: 10-13 dígitos, ex: 48991742716)' }, { status: 400 })
      }
    } else {
      // Estratégias legacy (pairs, round_robin, random, group): exigem 3+ chips
      if (!chipIds || chipIds.length < minChips) {
        return NextResponse.json({ error: `Precisa de pelo menos ${minChips} chips — 2 chips só entre si cria padrão detectável pelo Meta (grafo social artificial)` }, { status: 400 })
      }
    }

    // Validate chips exist
    const chips = await db.chip.findMany({
      where: { id: { in: chipIds } },
      select: { id: true, status: true, evolutionInstance: true },
    })

    if (chips.length < (strategy === 'ai_bot' ? 1 : minChips)) {
      return NextResponse.json({ error: 'Apenas ' + chips.length + ' chips encontrados no banco. Mínimo: ' + (strategy === 'ai_bot' ? 1 : minChips) + ' chips' }, { status: 400 })
    }

    // Validate that ALL chips are connected and have an Evolution instance
    const disconnectedChips = chips.filter(c => c.status !== 'connected' || !c.evolutionInstance)
    if (disconnectedChips.length > 0) {
      const names = disconnectedChips.map(c => c.id).join(', ')
      return NextResponse.json(
        { error: `${disconnectedChips.length} chip(s) desconectado(s) ou sem instância Evolution. Conecte todos os chips antes de criar a sessão de aquecimento. IDs: ${names}` },
        { status: 400 }
      )
    }

    // Use default templates if not provided
    const templates = messageTemplates || DEFAULT_WARMING_TEMPLATES

    const session = await db.warmingSession.create({
      data: {
        name: name.trim(),
        strategy,
        chipIds: JSON.stringify(chipIds),
        messageTemplates: JSON.stringify(templates),
        messagesPerChip,
        intervalMin: effectiveIntervalMin,
        intervalMax: effectiveIntervalMax,
        activeHoursStart: effectiveActiveHoursStart,
        activeHoursEnd: effectiveActiveHoursEnd,
        breakWindows: JSON.stringify(breakWindows),
        timezone: effectiveTimezone,
        messageTypeDistribution: JSON.stringify(messageTypeDistribution),
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: 'draft',
        // Campos específicos da estratégia ai_bot (null/defaults nas outras)
        aiBotPhoneNumber: strategy === 'ai_bot' ? aiBotPhoneNumber.replace(/\D/g, '') : null,
        aiBotReplyTimeoutSec: strategy === 'ai_bot' ? (Number(aiBotReplyTimeoutSec) || 300) : 300,
        aiBotMaxMissedReplies: strategy === 'ai_bot' ? (Number(aiBotMaxMissedReplies) || 2) : 2,
      },
    })

    return NextResponse.json({ session }, { status: 201 })
  } catch (error: any) {
    console.error('[Warming API] Error creating session:', error.message)
    return NextResponse.json(
      { error: 'Erro ao criar sessão de aquecimento', detail: error.message },
      { status: 500 }
    )
  }
}
