// API Route for a single Warming Message Pool item
// GET    /api/warming/message-pool/[id]   — Get a single message
// PATCH  /api/warming/message-pool/[id]   — Update a message
// DELETE /api/warming/message-pool/[id]   — Soft-delete (active=false) or hard-delete (?hard=true)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { invalidatePoolCache, AI_BOT_CATEGORIES } from '@/lib/ai-bot-warming'

type Params = { params: { id: string } }

// GET — Get a single message
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const message = await db.warmingMessagePool.findUnique({
      where: { id: params.id },
    })

    if (!message) {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
    }

    return NextResponse.json({ message })
  } catch (error: any) {
    console.error('[MessagePool API] Error getting:', error.message)
    return NextResponse.json(
      { error: 'Erro ao buscar mensagem', detail: error.message },
      { status: 500 }
    )
  }
}

// PATCH — Update a message
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const body = await request.json()
    const { category, content, weight, active } = body

    const existing = await db.warmingMessagePool.findUnique({
      where: { id: params.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
    }

    if (category !== undefined && !(AI_BOT_CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json(
        { error: `Categoria inválida. Categorias válidas: ${AI_BOT_CATEGORIES.join(', ')}` },
        { status: 400 }
      )
    }

    if (content !== undefined && !content.trim()) {
      return NextResponse.json({ error: 'Conteúdo não pode ser vazio' }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}
    if (category !== undefined) updateData.category = category.trim()
    if (content !== undefined) updateData.content = content.trim()
    if (weight !== undefined) updateData.weight = Math.max(1, Math.min(100, Number(weight) || 1))
    if (active !== undefined) updateData.active = Boolean(active)

    const message = await db.warmingMessagePool.update({
      where: { id: params.id },
      data: updateData,
    })

    invalidatePoolCache()

    return NextResponse.json({ message })
  } catch (error: any) {
    console.error('[MessagePool API] Error updating:', error.message)
    return NextResponse.json(
      { error: 'Erro ao atualizar mensagem', detail: error.message },
      { status: 500 }
    )
  }
}

// DELETE — Soft-delete (default) or hard-delete (with ?hard=true)
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { searchParams } = new URL(request.url)
    const hardDelete = searchParams.get('hard') === 'true'

    const existing = await db.warmingMessagePool.findUnique({
      where: { id: params.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
    }

    if (hardDelete) {
      await db.warmingMessagePool.delete({ where: { id: params.id } })
    } else {
      await db.warmingMessagePool.update({
        where: { id: params.id },
        data: { active: false },
      })
    }

    invalidatePoolCache()

    return NextResponse.json({ success: true, hardDeleted: hardDelete })
  } catch (error: any) {
    console.error('[MessagePool API] Error deleting:', error.message)
    return NextResponse.json(
      { error: 'Erro ao deletar mensagem', detail: error.message },
      { status: 500 }
    )
  }
}
