// API Routes for individual Warming Session
// GET    /api/warming/[sessionId]       — Get session details + stats
// PATCH  /api/warming/[sessionId]       — Update session config
// DELETE /api/warming/[sessionId]       — Delete session

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getWarmingStats } from '@/lib/warming-engine'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params
    const stats = await getWarmingStats(sessionId)

    if (!stats) {
      return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })
    }

    return NextResponse.json({ stats })
  } catch (error: any) {
    console.error('[Warming API] Error getting session:', error.message)
    return NextResponse.json(
      { error: 'Erro ao buscar sessão' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params
    const body = await request.json()

    const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
    if (!session) {
      return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })
    }

    // Only allow updates on draft or paused sessions
    if (session.status === 'running') {
      return NextResponse.json({ error: 'Não é possível editar sessão em execução. Pause primeiro.' }, { status: 400 })
    }

    const allowedFields = [
      'name', 'strategy', 'intervalMin', 'intervalMax',
      'activeHoursStart', 'activeHoursEnd', 'timezone',
      'messagesPerChip', 'messageTypeDistribution',
    ]

    const data: Record<string, any> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'messageTypeDistribution') {
          data[field] = JSON.stringify(body[field])
        } else {
          data[field] = body[field]
        }
      }
    }

    // Handle JSON fields separately
    if (body.chipIds !== undefined) {
      data.chipIds = JSON.stringify(body.chipIds)
    }
    if (body.messageTemplates !== undefined) {
      data.messageTemplates = JSON.stringify(body.messageTemplates)
    }
    if (body.breakWindows !== undefined) {
      data.breakWindows = JSON.stringify(body.breakWindows)
    }
    if (body.scheduledAt !== undefined) {
      data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null
    }

    const updated = await db.warmingSession.update({
      where: { id: sessionId },
      data,
    })

    return NextResponse.json({ session: updated })
  } catch (error: any) {
    console.error('[Warming API] Error updating session:', error.message)
    return NextResponse.json(
      { error: 'Erro ao atualizar sessão', detail: error.message },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params

    const session = await db.warmingSession.findUnique({ where: { id: sessionId } })
    if (!session) {
      return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })
    }

    if (session.status === 'running') {
      return NextResponse.json({ error: 'Não é possível deletar sessão em execução. Cancele primeiro.' }, { status: 400 })
    }

    await db.warmingSession.delete({ where: { id: sessionId } })

    return NextResponse.json({ message: 'Sessão deletada' })
  } catch (error: any) {
    console.error('[Warming API] Error deleting session:', error.message)
    return NextResponse.json(
      { error: 'Erro ao deletar sessão' },
      { status: 500 }
    )
  }
}
