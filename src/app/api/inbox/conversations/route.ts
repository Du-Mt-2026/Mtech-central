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

    if (!chipId) {
      return NextResponse.json({ conversations: [] })
    }

    // Build where clause
    const where: Record<string, unknown> = {
      chipId,
      isGroup: showGroups ? undefined : false,
    }
    if (!showGroups) where.isGroup = false

    if (search) {
      where.OR = [
        { contactName: { contains: search, mode: 'insensitive' } },
        { pushName: { contains: search, mode: 'insensitive' } },
        { remotePhone: { contains: search, mode: 'insensitive' } },
        { messageContent: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Step 1: Get all messages for this chip, ordered by most recent first
    const allMessages = await db.inboxMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        chipId: true,
        remoteJid: true,
        remotePhone: true,
        fromMe: true,
        messageContent: true,
        messageType: true,
        mediaUrl: true,
        pushName: true,
        contactName: true,
        isRead: true,
        isGroup: true,
        createdAt: true,
      },
      take: 500, // Limit to avoid huge queries
    })

    // Step 2: Group by remoteJid to build conversation list
    const conversationMap = new Map<string, {
      chipId: string | null
      remoteJid: string
      remotePhone: string
      contactName: string | null
      pushName: string | null
      lastMessage: { content: string; type: string; fromMe: boolean }
      lastMessageAt: Date
      unreadCount: number
      totalMessages: number
      isGroup: boolean
    }>()

    for (const msg of allMessages) {
      const key = msg.remoteJid
      const existing = conversationMap.get(key)

      if (!existing) {
        // First message for this remoteJid = it's the most recent (since ordered desc)
        conversationMap.set(key, {
          chipId: msg.chipId,
          remoteJid: msg.remoteJid,
          remotePhone: msg.remotePhone,
          contactName: msg.contactName || msg.pushName,
          pushName: msg.pushName,
          lastMessage: {
            content: (msg.messageContent || '').substring(0, 100),
            type: msg.messageType,
            fromMe: msg.fromMe,
          },
          lastMessageAt: msg.createdAt,
          unreadCount: (!msg.isRead && !msg.fromMe) ? 1 : 0,
          totalMessages: 1,
          isGroup: msg.isGroup,
        })
      } else {
        // Additional message for this remoteJid
        existing.totalMessages++
        if (!msg.isRead && !msg.fromMe) {
          existing.unreadCount++
        }
        // Use the best contact name available
        if (!existing.contactName && msg.contactName) {
          existing.contactName = msg.contactName
        }
        if (!existing.contactName && msg.pushName) {
          existing.contactName = msg.pushName
        }
      }
    }

    // Step 3: Sort by last message time (most recent first)
    const conversations = Array.from(conversationMap.values())
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    // Step 4: Get chip info
    const chip = await db.chip.findUnique({
      where: { id: chipId },
      select: { id: true, name: true, phoneNumber: true, profilePicUrl: true, status: true },
    })

    // Step 5: Format response
    const formatted = conversations.map(c => ({
      chipId: c.chipId,
      remoteJid: c.remoteJid,
      remotePhone: c.remotePhone,
      contactName: c.contactName || c.pushName || c.remotePhone || 'Desconhecido',
      pushName: c.pushName,
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt.toISOString(),
      unreadCount: c.unreadCount,
      totalMessages: c.totalMessages,
      isGroup: c.isGroup,
      chip: chip ? {
        id: chip.id,
        name: chip.name,
        phoneNumber: chip.phoneNumber,
        profilePicUrl: chip.profilePicUrl,
        status: chip.status,
      } : null,
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
