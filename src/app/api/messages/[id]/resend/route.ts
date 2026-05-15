import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Find the message
    const message = await db.message.findUnique({ where: { id } })

    if (!message) {
      return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
    }

    if (message.status !== 'failed') {
      return NextResponse.json(
        { error: 'Apenas mensagens com status "failed" podem ser reenviadas' },
        { status: 400 }
      )
    }

    // Reset message to pending so the cron will pick it up again
    const updated = await db.message.update({
      where: { id },
      data: {
        status: 'pending',
        error: null,
        sentAt: null,
      },
    })

    return NextResponse.json({ success: true, message: updated })
  } catch (error) {
    console.error('Resend message error:', error)
    return NextResponse.json({ error: 'Erro ao reenviar mensagem' }, { status: 500 })
  }
}
