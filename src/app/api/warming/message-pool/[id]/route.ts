// API Route: /api/warming/message-pool/[id]
// PUT    — Update a single message (content, weight, active, category)
// DELETE — Delete a single message by id

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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

interface RouteContext {
  params: Promise<{ id: string }>
}

// PUT — Update a message
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const { category, content, weight, active } = body

    // Build update data (only fields that are provided)
    const updateData: any = {}
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category)) {
        return NextResponse.json(
          { error: `Categoria inválida. Válidas: ${VALID_CATEGORIES.join(', ')}` },
          { status: 400 }
        )
      }
      updateData.category = category
    }
    if (content !== undefined) {
      if (typeof content !== 'string' || content.trim().length === 0) {
        return NextResponse.json(
          { error: 'Conteúdo não pode ser vazio' },
          { status: 400 }
        )
      }
      updateData.content = content.trim()
    }
    if (weight !== undefined) {
      if (typeof weight !== 'number' || weight <= 0) {
        return NextResponse.json(
          { error: 'Weight deve ser um número positivo' },
          { status: 400 }
        )
      }
      updateData.weight = weight
    }
    if (active !== undefined) {
      updateData.active = Boolean(active)
    }

    const updated = await db.warmingMessagePool.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ message: updated })
  } catch (error: any) {
    console.error('[MessagePool API] Error updating message:', error.message)
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'Erro ao atualizar mensagem do pool' },
      { status: 500 }
    )
  }
}

// DELETE — Delete a single message
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params

    await db.warmingMessagePool.delete({ where: { id } })

    return NextResponse.json({ deleted: 1, id })
  } catch (error: any) {
    console.error('[MessagePool API] Error deleting message:', error.message)
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'Erro ao deletar mensagem do pool' },
      { status: 500 }
    )
  }
}
