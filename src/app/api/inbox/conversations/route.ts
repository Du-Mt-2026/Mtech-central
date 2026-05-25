import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/inbox/conversations
 * Returns a Chatwoot-like conversation list with:
 * - Chip info
 * - Last message preview
 * - Unread count
 * - Contact name/phone
 * - Group info (name, subject)
 *
 * Query params:
 * - chipId: filter by specific chip
 * - search: search by contact name, phone, or message content
 * - showGroups: include group conversations (default true)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const chipId = searchParams.get('chipId') || undefined
    const search = searchParams.get('search') || undefined
    const showGroups = searchParams.get('showGroups') !== 'false' // default true

    if (!chipId) {
      return NextResponse.json({ conversations: [] })
    }

    // Build where clause
    const where: Record<string, unknown> = {
      chipId,
      isCampaign: false,  // Never show campaign blast messages in inbox
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
      take: 1000, // Increased to capture group conversations properly
    })

    // Step 2: Try to fetch group names from Evolution API for group conversations
    // For groups, the "contactName" should be the group subject/name, not the pushName of the last sender
    const groupJids = [...new Set(allMessages.filter(m => m.isGroup).map(m => m.remoteJid))]
    const groupNameMap = new Map<string, string>() // jid -> group name

    // Try to get group metadata from the chip's Evolution API instance
    if (groupJids.length > 0) {
      try {
        const chip = await db.chip.findUnique({ where: { id: chipId } })
        if (chip?.evolutionInstance) {
          const { fetchGroupMetadata } = await import('@/lib/evolution-api')
          for (const jid of groupJids) {
            try {
              const meta = await fetchGroupMetadata(chip.evolutionInstance, jid)
              if (meta?.subject) {
                groupNameMap.set(jid, meta.subject)
              }
            } catch {
              // Skip if API fails for this group
            }
          }
        }
      } catch {
        // Skip group metadata fetch if not available
      }
    }

    // Step 2.5: Build a fallback group name from existing messages
    // Look for the most common non-empty contactName/pushName pattern in each group
    // Or use the remoteJid phone part
    for (const jid of groupJids) {
      if (groupNameMap.has(jid)) continue
      // Try to find a group name from the contactName field of fromMe messages
      // (when we send to a group, sometimes the group name is saved)
      const groupMsgs = allMessages.filter(m => m.remoteJid === jid)
      
      // For groups, look for a consistent name in messages
      // Priority: contactName from fromMe messages (likely group name), then any non-empty pushName
      const fromMeMsg = groupMsgs.find(m => m.fromMe && m.contactName && m.contactName !== 'unknown')
      if (fromMeMsg?.contactName) {
        groupNameMap.set(jid, fromMeMsg.contactName)
        continue
      }
      
      // Fallback: use the group phone number as identifier
      const groupPhone = jid.split('@')[0]
      groupNameMap.set(jid, `Grupo ${groupPhone.slice(-4)}`)
    }

    // Step 3: Group by remoteJid to build conversation list
    const conversationMap = new Map<string, {
      chipId: string | null
      remoteJid: string
      remotePhone: string
      contactName: string | null
      pushName: string | null
      groupName: string | null
      lastMessage: { content: string; type: string; fromMe: boolean; senderName: string | null }
      lastMessageAt: Date
      unreadCount: number
      totalMessages: number
      isGroup: boolean
      participants: Set<string>
    }>()

    for (const msg of allMessages) {
      const key = msg.remoteJid
      const existing = conversationMap.get(key)
      
      // Determine sender name for this message
      const senderName = msg.isGroup
        ? (msg.pushName || 'unknown')
        : null

      if (!existing) {
        // First message for this remoteJid = it's the most recent (since ordered desc)
        // For groups: use group name, NOT the pushName of the sender
        // For individuals: use contactName or pushName
        const displayName = msg.isGroup
          ? (groupNameMap.get(msg.remoteJid) || msg.contactName || `Grupo`)
          : (msg.contactName || msg.pushName)

        conversationMap.set(key, {
          chipId: msg.chipId,
          remoteJid: msg.remoteJid,
          remotePhone: msg.remotePhone,
          contactName: displayName,
          pushName: msg.pushName,
          groupName: msg.isGroup ? (groupNameMap.get(msg.remoteJid) || null) : null,
          lastMessage: {
            content: (msg.messageContent || '').substring(0, 100),
            type: msg.messageType,
            fromMe: msg.fromMe,
            senderName: msg.isGroup ? (msg.pushName || null) : null,
          },
          lastMessageAt: msg.createdAt,
          unreadCount: (!msg.isRead && !msg.fromMe) ? 1 : 0,
          totalMessages: 1,
          isGroup: msg.isGroup,
          participants: msg.isGroup ? new Set(msg.pushName ? [msg.pushName] : []) : new Set(),
        })
      } else {
        // Additional message for this remoteJid
        existing.totalMessages++
        if (!msg.isRead && !msg.fromMe) {
          existing.unreadCount++
        }
        // Track unique participants in group
        if (msg.isGroup && msg.pushName) {
          existing.participants.add(msg.pushName)
        }
        // Use the best contact name available
        // For groups: NEVER override with pushName — keep group name
        if (!msg.isGroup) {
          if (!existing.contactName && msg.contactName) {
            existing.contactName = msg.contactName
          }
          if (!existing.contactName && msg.pushName) {
            existing.contactName = msg.pushName
          }
        }
      }
    }

    // Step 4: Sort by last message time (most recent first)
    const conversations = Array.from(conversationMap.values())
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    // Step 5: Get chip info
    const chip = await db.chip.findUnique({
      where: { id: chipId },
      select: { id: true, name: true, phoneNumber: true, profilePicUrl: true, status: true },
    })

    // Step 6: Format response
    const formatted = conversations.map(c => ({
      chipId: c.chipId,
      remoteJid: c.remoteJid,
      remotePhone: c.remotePhone,
      contactName: c.contactName || c.pushName || c.remotePhone || 'Desconhecido',
      pushName: c.pushName,
      groupName: c.groupName,
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt.toISOString(),
      unreadCount: c.unreadCount,
      totalMessages: c.totalMessages,
      isGroup: c.isGroup,
      participantCount: c.isGroup ? c.participants.size : null,
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
