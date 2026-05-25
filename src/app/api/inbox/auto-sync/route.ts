import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/inbox/auto-sync
 * Syncs recent messages from Evolution API for ALL connected chips.
 *
 * IMPORTANT: Evolution Go v3 does NOT support /chat/findMessages.
 * Message sync is handled 100% via webhook events (Message, SEND_MESSAGE, etc.)
 * at /api/whatsapp/webhook. This endpoint now only returns stats and
 * does NOT attempt to fetch messages from the Evolution API.
 *
 * The frontend can still call this to check sync status.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { chipId } = body as { chipId?: string }

    // Get connected chips
    const chips = await db.chip.findMany({
      where: {
        status: 'connected',
        evolutionInstance: { not: null },
        ...(chipId ? { id: chipId } : {}),
      },
      select: {
        id: true,
        evolutionInstance: true,
        name: true,
      },
    })

    // Return stats — message sync is handled via webhooks
    return NextResponse.json({
      synced: 0,
      errors: 0,
      fixed: 0,
      chips: chips.length,
      note: 'Message sync in Evolution Go v3 is handled via webhook events, not polling.',
    })
  } catch (error) {
    console.error('Auto-sync error:', error)
    return NextResponse.json(
      { error: 'Erro na sincronização automática' },
      { status: 500 }
    )
  }
}
