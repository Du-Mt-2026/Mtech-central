import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/audit-log'

/**
 * POST /api/chips/{chipId}/resume
 * Reativa um chip que foi pausado individualmente.
 *
 * Após retomar:
 * - O chip volta a receber novas mensagens de campanha
 * - Mensagens pendentes atribuídas a ele começam a ser processadas no próximo cron tick
 * - Limpa paused, pausedAt e pauseReason
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ chipId: string }> }) {
  const { chipId } = await params
  try {
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    if (!chip.paused) {
      return NextResponse.json({
        success: true,
        chip,
        message: `Chip ${chip.name} já estava ativo.`,
      })
    }

    const updated = await db.chip.update({
      where: { id: chipId },
      data: {
        paused: false,
        pausedAt: null,
        pauseReason: null,
      },
    })

    console.log(`[Chip Resume] Chip ${chip.name} (${chip.phoneNumber}) retomado — voltará a receber mensagens`)

    const session = await getSession()
    await logAction({
      userId: session?.userId,
      userName: session?.username,
      userRole: session?.role,
      action: 'RESUME_CHIP',
      category: 'chip',
      targetId: chipId,
      targetType: 'chip',
      details: { name: chip.name, phoneNumber: chip.phoneNumber },
    })

    return NextResponse.json({
      success: true,
      chip: updated,
      message: `Chip ${chip.name} retomado. Voltará a receber mensagens no próximo ciclo do cron.`,
    })
  } catch (error: any) {
    console.error('[Chip Resume] Error:', error)
    return NextResponse.json({ error: error.message || 'Erro ao retomar chip' }, { status: 500 })
  }
}
