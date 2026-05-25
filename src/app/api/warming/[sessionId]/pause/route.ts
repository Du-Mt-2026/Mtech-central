import { NextRequest, NextResponse } from 'next/server'
import { pauseWarmingSession } from '@/lib/warming-engine'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params
    await pauseWarmingSession(sessionId)
    return NextResponse.json({ message: 'Sessão pausada' })
  } catch (error: any) {
    console.error('[Warming API] Error pausing session:', error.message)
    return NextResponse.json(
      { error: error.message || 'Erro ao pausar sessão' },
      { status: 400 }
    )
  }
}
