import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { markChatAsRead } from '@/lib/evolution-api'

/**
 * GET /api/inbox/messages
 * Returns messages for a specific conversation (chipId + remoteJid)
 *
 * v2.2: Also searches by remotePhone to find LID-variant messages.
 * When a conversation uses canonicalJid (s.whatsapp.net), we also
 * fetch messages where remotePhone matches but remoteJid is @lid.
 *
 * Query params:
 * - chipId: required - the chip ID
 * - remoteJid: required - the contact's JID (canonical)
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

    const phonePart = remoteJid.split('@')[0]

    // Build OR conditions to match ALL JID variants for this contact
    // This ensures messages from both @lid and @s.whatsapp.net are included
    const orConditions: Record<string, unknown>[] = [
      { remoteJid },  // Exact JID match
    ]

    // Also match by same phone prefix (handles LID ↔ s.whatsapp.net)
    if (phonePart) {
      orConditions.push({ remoteJid: { startsWith: phonePart } })
      // Also match by remotePhone (for cases where remotePhone differs from JID prefix)
      orConditions.push({ remotePhone: phonePart })
      // Try without country code
      const withoutCountryCode = phonePart.replace(/^55/, '')
      if (withoutCountryCode !== phonePart) {
        orConditions.push({ remotePhone: { startsWith: withoutCountryCode } })
      }
    }

    const where: Record<string, unknown> = {
      chipId,
      OR: orConditions,
    }

    if (before) {
      where.createdAt = { lt: new Date(before) }
    }

    const messages = await db.inboxMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Mark unread messages as read (for ALL JID variants)
    await db.inboxMessage.updateMany({
      where: {
        chipId,
        OR: orConditions,
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
