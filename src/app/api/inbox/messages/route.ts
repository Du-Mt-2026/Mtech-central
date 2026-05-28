import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { markChatAsRead } from '@/lib/evolution-api'

/**
 * GET /api/inbox/messages
 * Returns messages for a specific conversation (chipId + remoteJid)
 *
 * v2.0: Now returns delivery receipt status (ack/status), quoted message data,
 * reaction data, and enriched media metadata — following Chatwoot-like patterns.
 *
 * Query params:
 * - chipId: required - the chip ID
 * - remoteJid: required - the contact's JID
 * - before: cursor for pagination (message createdAt)
 * - limit: number of messages to return (default 50)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const chipId = searchParams.get('chipId')
    const remoteJid = searchParams.get('remoteJid')
    const before = searchParams.get('before')
    const limit = parseInt(searchParams.get('limit') || '50')

    if (!chipId || !remoteJid) {
      return NextResponse.json(
        { error: 'chipId e remoteJid são obrigatórios' },
        { status: 400 }
      )
    }

    const where: Record<string, unknown> = {
      chipId,
      remoteJid,
      // Show ALL messages in a conversation view, including campaign messages
      // This provides context when a contact replies to a campaign message
      // Campaign messages are visually marked in the UI with a distinct style
    }

    // Also match LID variants of this remoteJid
    // (Evolution API V3 uses LID for outgoing, phone JID for incoming)
    const phonePart = remoteJid.split('@')[0]
    if (remoteJid.endsWith('@s.whatsapp.net')) {
      where.OR = [
        { remoteJid },
        { remoteJid: { startsWith: phonePart } },
      ]
      delete where.remoteJid
    }

    if (before) {
      where.createdAt = { lt: new Date(before) }
    }

    const messages = await db.inboxMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Mark unread messages as read
    await db.inboxMessage.updateMany({
      where: {
        chipId,
        remoteJid,
        isRead: false,
        fromMe: false,
      },
      data: { isRead: true },
    })

    // v2.1: Mark chat as read on WhatsApp side (so sender sees blue ✓✓)
    try {
      const chip = await db.chip.findUnique({
        where: { id: chipId },
        select: { evolutionInstance: true, status: true },
      })
      if (chip?.evolutionInstance && chip.status === 'connected') {
        await markChatAsRead(chip.evolutionInstance, remoteJid)
      }
    } catch {
      // Non-critical — best effort. If this fails, the DB is still marked as read.
    }

    // Return in chronological order (oldest first)
    const sorted = [...messages].reverse()

    return NextResponse.json({
      messages: sorted,
      hasMore: messages.length === limit,
    })
  } catch (error) {
    console.error('Inbox messages error:', error)
    return NextResponse.json(
      { error: 'Erro ao buscar mensagens' },
      { status: 500 }
    )
  }
}
