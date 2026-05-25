import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/inbox/sync-messages
 * Syncs missing messages from Evolution API into InboxMessage table.
 *
 * IMPORTANT: Evolution Go v3 does NOT support /chat/findMessages.
 * Message sync is handled 100% via webhook events (Message, SEND_MESSAGE, etc.)
 * at /api/whatsapp/webhook.
 *
 * This endpoint now only returns stats about existing inbox messages.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { chipId } = body as {
      chipId?: string
      remoteJid?: string
      limit?: number
    }

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    // Get the chip
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip || !chip.evolutionInstance) {
      return NextResponse.json({ error: 'Chip não encontrado ou sem instância' }, { status: 404 })
    }

    // Count existing non-campaign messages in inbox for this chip
    const messageCount = await db.inboxMessage.count({
      where: { chipId, isCampaign: false },
    })

    return NextResponse.json({
      chipId,
      instanceName: chip.evolutionInstance,
      synced: 0,
      skipped: 0,
      errors: 0,
      fixed: 0,
      conversationsChecked: 0,
      existingMessages: messageCount,
      note: 'Message sync in Evolution Go v3 is handled via webhook events, not polling.',
    })
  } catch (error) {
    console.error('Sync messages error:', error)
    return NextResponse.json(
      { error: 'Erro ao sincronizar mensagens' },
      { status: 500 }
    )
  }
}
