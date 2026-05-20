import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/inbox/conversations
 * Returns a Chatwoot-like conversation list with:
 * - Chip info
 * - Last message preview
 * - Unread count
 * - Contact name/phone
 *
 * Query params:
 * - chipId: filter by specific chip
 * - search: search by contact name, phone, or message content
 * - showGroups: include group conversations (default false)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const chipId = searchParams.get('chipId') || undefined
    const search = searchParams.get('search') || undefined
    const showGroups = searchParams.get('showGroups') === 'true'

    // Build where clause for messages
    const messageWhere: Record<string, unknown> = {}
    if (chipId) messageWhere.chipId = chipId
    if (!showGroups) messageWhere.isGroup = false

    if (search) {
      messageWhere.OR = [
        { contactName: { contains: search, mode: 'insensitive' } },
        { pushName: { contains: search, mode: 'insensitive' } },
        { remotePhone: { contains: search, mode: 'insensitive' } },
        { messageContent: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Get distinct conversations (grouped by chipId + remoteJid)
    // Use raw SQL for efficient grouping
    const conversations = await db.$queryRaw<
      Array<{
        chipId: string | null
        remoteJid: string
        remotePhone: string
        contactName: string | null
        pushName: string | null
        lastMessageContent: string
        lastMessageType: string
        lastMessageFromMe: boolean
        lastMessageAt: Date
        unreadCount: bigint
        totalMessages: bigint
        isGroup: boolean
      }>
    >`
      SELECT
        im."chipId",
        im."remoteJid",
        im."remotePhone",
        MAX(im."contactName") as "contactName",
        MAX(im."pushName") as "pushName",
        (SELECT im2."messageContent" FROM "InboxMessage" im2
         WHERE im2."chipId" = im."chipId" AND im2."remoteJid" = im."remoteJid"
         ORDER BY im2."createdAt" DESC LIMIT 1) as "lastMessageContent",
        (SELECT im3."messageType" FROM "InboxMessage" im3
         WHERE im3."chipId" = im."chipId" AND im3."remoteJid" = im."remoteJid"
         ORDER BY im3."createdAt" DESC LIMIT 1) as "lastMessageType",
        (SELECT im4."fromMe" FROM "InboxMessage" im4
         WHERE im4."chipId" = im."chipId" AND im4."remoteJid" = im."remoteJid"
         ORDER BY im4."createdAt" DESC LIMIT 1) as "lastMessageFromMe",
        MAX(im."createdAt") as "lastMessageAt",
        COUNT(CASE WHEN im."isRead" = false AND im."fromMe" = false THEN 1 END) as "unreadCount",
        COUNT(*) as "totalMessages"
      FROM "InboxMessage" im
      WHERE 1=1
        ${chipId ? `AND im."chipId" = '${chipId}'` : ''}
        ${!showGroups ? `AND im."isGroup" = false` : ''}
      GROUP BY im."chipId", im."remoteJid", im."remotePhone"
      ORDER BY MAX(im."createdAt") DESC
      LIMIT 100
    `

    // Get chip info for all chipIds in conversations
    const chipIds = [...new Set(conversations.map(c => c.chipId).filter(Boolean))] as string[]
    const chips = chipIds.length > 0
      ? await db.chip.findMany({
          where: { id: { in: chipIds } },
          select: { id: true, name: true, phoneNumber: true, profilePicUrl: true, status: true },
        })
      : []

    const chipMap = new Map(chips.map(c => [c.id, c]))

    // Format response
    const formatted = conversations.map(c => ({
      chipId: c.chipId,
      remoteJid: c.remoteJid,
      remotePhone: c.remotePhone,
      contactName: c.contactName || c.pushName || c.remotePhone,
      pushName: c.pushName,
      lastMessage: {
        content: c.lastMessageContent?.substring(0, 100) || '',
        type: c.lastMessageType,
        fromMe: c.lastMessageFromMe,
      },
      lastMessageAt: c.lastMessageAt,
      unreadCount: Number(c.unreadCount),
      totalMessages: Number(c.totalMessages),
      isGroup: c.isGroup,
      chip: c.chipId ? chipMap.get(c.chipId) || null : null,
    }))

    return NextResponse.json({ conversations: formatted })
  } catch (error) {
    console.error('Inbox conversations error:', error)
    return NextResponse.json(
      { error: 'Erro ao buscar conversas' },
      { status: 500 }
    )
  }
}
