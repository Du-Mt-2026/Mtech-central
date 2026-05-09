import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { campaignId } = body

    // Build where clause
    const where: Record<string, unknown> = { status: 'failed' }
    if (campaignId) where.campaignId = campaignId

    // Count how many will be reset
    const count = await db.message.count({ where })

    if (count === 0) {
      return NextResponse.json({ success: true, resetCount: 0, message: 'Nenhuma mensagem falha encontrada' })
    }

    // Reset all failed messages to pending
    const result = await db.message.updateMany({
      where,
      data: {
        status: 'pending',
        error: null,
        sentAt: null,
      },
    })

    return NextResponse.json({
      success: true,
      resetCount: result.count,
      campaignId: campaignId || null,
    })
  } catch (error) {
    console.error('Resend all failed error:', error)
    return NextResponse.json({ error: 'Erro ao reenviar mensagens falhas' }, { status: 500 })
  }
}
