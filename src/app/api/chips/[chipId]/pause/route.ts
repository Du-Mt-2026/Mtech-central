import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/audit-log'

/**
 * POST /api/chips/{chipId}/pause
 * Marca o chip como pausado individualmente.
 *
 * Comportamento:
 * - O chip continua conectado ao WhatsApp (não desconecta)
 * - Não recebe novas mensagens de campanha
 * - Mensagens pendentes atribuídas a ele ficam aguardando (não são redistribuídas)
 * - Para reativar, usar POST /api/chips/{chipId}/resume
 *
 * Body opcional:
 *   { "reason": "motivo da pausa" }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ chipId: string }> }) {
  const { chipId } = await params
  try {
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    let reason: string | null = null
    try {
      const body = await req.json()
      reason = body?.reason ?? null
    } catch {
      // Body vazio ou inválido — sem motivo
    }

    const updated = await db.chip.update({
      where: { id: chipId },
      data: {
        paused: true,
        pausedAt: new Date(),
        pauseReason: reason,
      },
    })

    console.log(`[Chip Pause] Chip ${chip.name} (${chip.phoneNumber}) pausado individualmente${reason ? ` — motivo: ${reason}` : ''}`)

    const session = await getSession()
    await logAction({
      userId: session?.userId,
      userName: session?.username,
      userRole: session?.role,
      action: 'PAUSE_CHIP',
      category: 'chip',
      targetId: chipId,
      targetType: 'chip',
      details: { name: chip.name, phoneNumber: chip.phoneNumber, reason },
    })

    return NextResponse.json({
      success: true,
      chip: updated,
      message: `Chip ${chip.name} pausado. Não receberá novas mensagens até ser retomado.`,
    })
  } catch (error: any) {
    console.error('[Chip Pause] Error:', error)
    return NextResponse.json({ error: error.message || 'Erro ao pausar chip' }, { status: 500 })
  }
}
