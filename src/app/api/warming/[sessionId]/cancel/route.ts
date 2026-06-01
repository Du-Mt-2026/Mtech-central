import { NextRequest, NextResponse } from 'next/server'
import { cancelWarmingSession } from '@/lib/warming-engine'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params
    await cancelWarmingSession(sessionId)
    return NextResponse.json({ message: 'Sessão cancelada' })
  } catch (error: any) {
    console.error('[Warming API] Error cancelling session:', error.message)
    return NextResponse.json(
      { error: error.message || 'Erro ao cancelar sessão' },
      { status: 400 }
    )
  }
}
