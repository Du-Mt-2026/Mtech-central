import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/inbox/poll
 * Lightweight polling endpoint that checks for new messages and status changes.
 * Returns updated conversations, counts, and ack/status changes for the inbox.
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

    // INBOX VISIBILITY: Only include messages where the CONTACT wrote (fromMe: false)
    const contactJids = await db.inboxMessage.findMany({
      where: { chipId: chipId || undefined, fromMe: false, isGroup: false, isCampaign: false },
      select: { remoteJid: true, remotePhone: true },
      distinct: ['remoteJid'],
    })
    const contactJidArr = Array.from(new Set(contactJids.map(r => r.remoteJid)))
    const contactPhoneArr = Array.from(new Set(contactJids.map(r => r.remotePhone).filter(Boolean) as string[]))

    const where: Record<string, unknown> = {
      ...(chipId ? { chipId } : {}),
      ...(since ? { createdAt: { gt: since } } : {}),
      OR: [
        { isCampaign: false, remoteJid: { in: contactJidArr } },
        { isCampaign: true, remoteJid: { in: contactJidArr } },
        ...(contactPhoneArr.length > 0 ? [
          { isCampaign: false, remotePhone: { in: contactPhoneArr } },
          { isCampaign: true, remotePhone: { in: contactPhoneArr } },
        ] : []),
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

    // Get ack/status changes for fromMe messages since last poll
    // This lets the frontend update check marks (✓ → ✓✓ → ✓✓ blue) in real-time
    const ackChanges = since ? await db.inboxMessage.findMany({
      where: {
        fromMe: true,
        ...(chipId ? { chipId } : {}),
        status: { in: ['delivered', 'read'] },
        readAt: { gte: since },
      },
      select: {
        id: true,
        evolutionMsgId: true,
        chipId: true,
        remoteJid: true,
        status: true,
        ack: true,
        deliveredAt: true,
        readAt: true,
      },
      take: 50,
    }) : []

    // Get the global latest message timestamp (for next poll's "since" param)
    const latestMsg = await db.inboxMessage.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    return NextResponse.json({
      newMessages,
      ackChanges,
      unreadCounts: Object.fromEntries(unreadMap),
      latestTimestamp: latestMsg?.createdAt?.toISOString() || null,
      hasNew: newMessages.length > 0 || ackChanges.length > 0,
    })
  } catch (error) {
    console.error('Inbox poll error:', error)
    return NextResponse.json(
      { error: 'Erro ao verificar novas mensagens' },
      { status: 500 }
    )
  }
}
