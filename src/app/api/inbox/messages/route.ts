import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/inbox/messages
 * Returns messages for a specific conversation (chipId + remoteJid)
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
      isCampaign: false,  // Never show campaign blast messages in inbox
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
