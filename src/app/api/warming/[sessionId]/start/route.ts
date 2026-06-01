import { NextRequest, NextResponse } from 'next/server'
import { startWarmingSession } from '@/lib/warming-engine'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params
    await startWarmingSession(sessionId)
    return NextResponse.json({ message: 'Sessão iniciada' })
  } catch (error: any) {
    console.error('[Warming API] Error starting session:', error.message)
    return NextResponse.json(
      { error: error.message || 'Erro ao iniciar sessão' },
      { status: 400 }
    )
  }
}
