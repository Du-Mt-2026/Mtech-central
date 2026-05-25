import { NextRequest, NextResponse } from 'next/server'
import { resumeWarmingSession } from '@/lib/warming-engine'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params
    await resumeWarmingSession(sessionId)
    return NextResponse.json({ message: 'Sessão retomada' })
  } catch (error: any) {
    console.error('[Warming API] Error resuming session:', error.message)
    return NextResponse.json(
      { error: error.message || 'Erro ao retomar sessão' },
      { status: 400 }
    )
  }
}
