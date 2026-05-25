// API Routes for Chip Warming (Aquecimento de Chips)
// GET  /api/warming         — List all warming sessions
// POST /api/warming         — Create a new warming session

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { DEFAULT_WARMING_TEMPLATES } from '@/lib/warming-engine'

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
      intervalMin = 45,
      intervalMax = 120,
      activeHoursStart = 480,
      activeHoursEnd = 1260,
      breakWindows = [],
      timezone = 'America/Sao_Paulo',
      messageTypeDistribution = { text: 47, image: 27, audio: 26 },
      scheduledAt,
    } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    if (!chipIds || chipIds.length < 2) {
      return NextResponse.json({ error: 'Precisa de pelo menos 2 chips' }, { status: 400 })
    }

    // Validate chips exist
    const chips = await db.chip.findMany({
      where: { id: { in: chipIds } },
      select: { id: true, status: true, evolutionInstance: true },
    })

    if (chips.length < 2) {
      return NextResponse.json({ error: 'Chips não encontrados no banco de dados' }, { status: 400 })
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
        intervalMin,
        intervalMax,
        activeHoursStart,
        activeHoursEnd,
        breakWindows: JSON.stringify(breakWindows),
        timezone,
        messageTypeDistribution: JSON.stringify(messageTypeDistribution),
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: 'draft',
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
