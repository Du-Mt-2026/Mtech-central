// API Routes for Warming Message Pool
// GET    /api/warming/message-pool         — List messages (with optional category filter)
// POST   /api/warming/message-pool         — Create a single message
//
// See also:
//   /api/warming/message-pool/[id]   — GET/PATCH/DELETE a single message
//   /api/warming/message-pool/bulk   — POST bulk insert (array JSON)
//   /api/warming/message-pool/seed   — POST import the 568-message seed (idempotent)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { invalidatePoolCache } from '@/lib/ai-bot-warming'
import { AI_BOT_CATEGORIES } from '@/lib/ai-bot-warming'

// GET — List messages (with optional filters)
// Query params:
//   ?category=saudacao     — filter by category
//   ?active=true           — filter active only
//   ?search=ola            — search in content (case-insensitive)
//   ?limit=100&offset=0    — pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const activeOnly = searchParams.get('active')
    const search = searchParams.get('search')
    const limit = Math.min(parseInt(searchParams.get('limit') || '500', 10), 5000)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0)

    const where: Record<string, unknown> = {}
    if (category) where.category = category
    if (activeOnly === 'true') where.active = true
    if (activeOnly === 'false') where.active = false
    if (search) {
      where.content = { contains: search, mode: 'insensitive' }
    }

    const [messages, total] = await Promise.all([
      db.warmingMessagePool.findMany({
        where,
        orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
        take: limit,
        skip: offset,
      }),
      db.warmingMessagePool.count({ where }),
    ])

    // Group counts by category for the UI
    const categoryCounts = await db.warmingMessagePool.groupBy({
      by: ['category'],
      _count: { _all: true },
      where: { active: true },
    })

    return NextResponse.json({
      messages,
      total,
      categoryCounts: categoryCounts.reduce((acc, c) => {
        acc[c.category] = c._count._all
        return acc
      }, {} as Record<string, number>),
    })
  } catch (error: any) {
    console.error('[MessagePool API] Error listing:', error.message)
    return NextResponse.json(
      { error: 'Erro ao listar mensagens do pool', detail: error.message },
      { status: 500 }
    )
  }
}

// POST — Create a single message
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { category, content, weight = 1, active = true } = body

    if (!category?.trim()) {
      return NextResponse.json({ error: 'Categoria é obrigatória' }, { status: 400 })
    }

    if (!(AI_BOT_CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json(
        { error: `Categoria inválida. Categorias válidas: ${AI_BOT_CATEGORIES.join(', ')}` },
        { status: 400 }
      )
    }

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Conteúdo é obrigatório' }, { status: 400 })
    }

    const message = await db.warmingMessagePool.create({
      data: {
        category: category.trim(),
        content: content.trim(),
        weight: Math.max(1, Math.min(100, Number(weight) || 1)),
        active: Boolean(active),
      },
    })

    invalidatePoolCache()

    return NextResponse.json({ message }, { status: 201 })
  } catch (error: any) {
    console.error('[MessagePool API] Error creating:', error.message)
    return NextResponse.json(
      { error: 'Erro ao criar mensagem', detail: error.message },
      { status: 500 }
    )
  }
}
