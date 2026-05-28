import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/inbox/poll
 * Lightweight polling endpoint that checks for new messages since last known message.
 * Returns updated conversations and counts for the inbox sidebar.
 *
 * Query params:
 * - chipId: filter by chip
 * - since: ISO timestamp — only return conversations updated after this time
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const chipId = searchParams.get('chipId') || undefined
    const since = searchParams.get('since') ? new Date(searchParams.get('since')!) : undefined

    // Get latest message timestamp for each conversation
    // Include campaign messages where the contact replied
    const repliedJids = await db.inboxMessage.findMany({
      where: { chipId: chipId || undefined, fromMe: false, isGroup: false, isCampaign: false },
      select: { remoteJid: true },
      distinct: ['remoteJid'],
    })
    const repliedJidSet = new Set(repliedJids.map(r => r.remoteJid))

    const where: Record<string, unknown> = {
      ...(chipId ? { chipId } : {}),
      ...(since ? { createdAt: { gt: since } } : {}),
      OR: [
        { isCampaign: false },
        { isCampaign: true, remoteJid: { in: [...repliedJidSet] } },
      ],
    }

    const newMessages = await db.inboxMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        chipId: true,
        remoteJid: true,
        remotePhone: true,
        fromMe: true,
        messageContent: true,
        messageType: true,
        isRead: true,
        createdAt: true,
      },
    })

    // Get total unread count per chip (only non-campaign)
    const unreadPerChip = await db.inboxMessage.groupBy({
      by: ['chipId'],
      where: { chipId: { not: null }, isRead: false, fromMe: false, isGroup: false, isCampaign: false },
      _count: { id: true },
    })
    const unreadMap = new Map<string, number>()
    for (const row of unreadPerChip) {
      if (row.chipId) unreadMap.set(row.chipId, row._count.id)
    }

    // Get the global latest message timestamp (for next poll's "since" param)
    const latestMsg = await db.inboxMessage.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    return NextResponse.json({
      newMessages,
      unreadCounts: Object.fromEntries(unreadMap),
      latestTimestamp: latestMsg?.createdAt?.toISOString() || null,
      hasNew: newMessages.length > 0,
    })
  } catch (error) {
    console.error('Inbox poll error:', error)
    return NextResponse.json(
      { error: 'Erro ao verificar novas mensagens' },
      { status: 500 }
    )
  }
}
