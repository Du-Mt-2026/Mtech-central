// API Routes for Warming Message Pool (estratégia "ai_bot")
// GET    /api/warming/message-pool         — List messages (with filters)
// POST   /api/warming/message-pool         — Create a new message
// POST   /api/warming/message-pool/seed    — (handled by /seed/route.ts)
// DELETE /api/warming/message-pool         — Bulk delete (by ids array in body)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Categorias válidas — mantidas em sync com seed-warming-message-pool.ts
const VALID_CATEGORIES = [
  'saudacao',
  'emoji_unico',
  'emoji_combo',
  'pergunta_geral',
  'declaracao_casual',
  'produto_mtech',
  'info_pedido',
  'conversa_fiada',
] as const

// GET — List messages with optional filters
// Query params:
//   ?category=saudacao   — filter by category
//   ?active=true         — filter active/inactive
//   ?search=ola          — search in content (case-insensitive)
//   ?limit=100&offset=0  — pagination (default 100, max 1000)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const activeParam = searchParams.get('active')
    const search = searchParams.get('search')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 1000)
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build where clause
    const where: any = {}
    if (category && VALID_CATEGORIES.includes(category as any)) {
      where.category = category
    }
    if (activeParam === 'true') where.active = true
    if (activeParam === 'false') where.active = false
    if (search) {
      where.content = { contains: search, mode: 'insensitive' }
    }

    const [messages, total] = await Promise.all([
      db.warmingMessagePool.findMany({
        where,
        orderBy: { category: 'asc' },
        take: limit,
        skip: offset,
      }),
      db.warmingMessagePool.count({ where }),
    ])

    // Contagem por categoria (para o UI mostrar badges)
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
    console.error('[MessagePool API] Error listing messages:', error.message)
    return NextResponse.json(
      { error: 'Erro ao listar mensagens do pool' },
      { status: 500 }
    )
  }
}

// POST — Create a new message
// Body: { category, content, weight?, active? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { category, content, weight = 1.0, active = true } = body

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `Categoria inválida. Válidas: ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 }
      )
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json(
        { error: 'Conteúdo da mensagem é obrigatório' },
        { status: 400 }
      )
    }

    const message = await db.warmingMessagePool.create({
      data: {
        category,
        content: content.trim(),
        weight: typeof weight === 'number' && weight > 0 ? weight : 1.0,
        active: typeof active === 'boolean' ? active : true,
      },
    })

    return NextResponse.json({ message })
  } catch (error: any) {
    console.error('[MessagePool API] Error creating message:', error.message)
    return NextResponse.json(
      { error: 'Erro ao criar mensagem no pool' },
      { status: 500 }
    )
  }
}

// DELETE — Bulk delete by ids (or delete all in a category)
// Body: { ids?: string[], category?: string }
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { ids, category } = body

    if (Array.isArray(ids) && ids.length > 0) {
      const result = await db.warmingMessagePool.deleteMany({
        where: { id: { in: ids } },
      })
      return NextResponse.json({ deleted: result.count })
    }

    if (category && VALID_CATEGORIES.includes(category)) {
      const result = await db.warmingMessagePool.deleteMany({
        where: { category },
      })
      return NextResponse.json({ deleted: result.count, category })
    }

    return NextResponse.json(
      { error: 'Forneça "ids" (array) ou "category" para deletar' },
      { status: 400 }
    )
  } catch (error: any) {
    console.error('[MessagePool API] Error deleting messages:', error.message)
    return NextResponse.json(
      { error: 'Erro ao deletar mensagens do pool' },
      { status: 500 }
    )
  }
}
