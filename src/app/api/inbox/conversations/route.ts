import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getArchivedChatJids } from '@/lib/evolution-api'

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

    // Fetch chip info ONCE at the top — reused for group metadata, archive filtering, and response
    const chip = await db.chip.findUnique({
      where: { id: chipId },
      select: { id: true, name: true, phoneNumber: true, profilePicUrl: true, status: true, evolutionInstance: true },
    })

    // ═══════════════════════════════════════════════════════════════════
    // INBOX VISIBILITY RULES:
    // 1. Only show conversations where the CONTACT (not the chip owner) sent
    //    at least one message (fromMe: false). This means:
    //    - Campaigns where nobody replied → HIDDEN
    //    - Campaigns where someone replied → VISIBLE (with campaign context)
    //    - Groups with activity → VISIBLE
    //    - Personal chats where contact wrote → VISIBLE
    //    - Chip owner's outgoing-only chats → HIDDEN
    // 2. For visible conversations, include BOTH campaign and non-campaign
    //    messages so the user has full context.
    // ═══════════════════════════════════════════════════════════════════

    // Step 0: Find all remoteJids where the CONTACT actually wrote something
    // This is the master list of visible conversations.
    // A contact message is: fromMe=false, isCampaign=false (not chip-to-chip warming)
    const contactMessages = await db.inboxMessage.findMany({
      where: {
        chipId,
        fromMe: false,     // Contact sent (not chip owner)
        isCampaign: false, // Not chip-to-chip warming
        isGroup: showGroups ? undefined : false,
      },
      select: { remoteJid: true, remotePhone: true },
      distinct: ['remoteJid'],
    })
    const repliedJids = Array.from(new Set(contactMessages.map(r => r.remoteJid)))
    // Also match by remotePhone to handle LID/phone JID splits
    const repliedPhones = Array.from(new Set(contactMessages.map(r => r.remotePhone).filter(Boolean) as string[]))

    if (repliedJids.length === 0 && repliedPhones.length === 0) {
      // No contacts have written anything yet — return empty
      return NextResponse.json({ conversations: [] })
    }

    // Step 1: Get all messages for visible conversations
    // Include campaign messages for these contacts so the user has context
    const baseWhere: Record<string, unknown> = {
      chipId,
      isGroup: showGroups ? undefined : false,
    }
    if (search) {
      baseWhere.OR = [
        { contactName: { contains: search, mode: 'insensitive' } },
        { pushName: { contains: search, mode: 'insensitive' } },
        { remotePhone: { contains: search, mode: 'insensitive' } },
        { messageContent: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Build OR conditions for visible conversations
    // Match by remoteJid (direct) or remotePhone (for LID resolution)
    const visibleOrConditions: Record<string, unknown>[] = []

    // Non-campaign messages where contact wrote
    visibleOrConditions.push({
      isCampaign: false,
      remoteJid: { in: repliedJids },
    })

    // Campaign messages for contacts that replied (by JID)
    visibleOrConditions.push({
      isCampaign: true,
      remoteJid: { in: repliedJids },
    })

    // Messages matched by phone number (LID resolution)
    if (repliedPhones.length > 0) {
      visibleOrConditions.push({
        isCampaign: false,
        remotePhone: { in: repliedPhones },
      })
      visibleOrConditions.push({
        isCampaign: true,
        remotePhone: { in: repliedPhones },
      })
    }

    const allMessages = await db.inboxMessage.findMany({
      where: {
        ...baseWhere,
        OR: visibleOrConditions,
      },
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
        isCampaign: true,
        createdAt: true,
      },
      take: 1000,
    })

    // Step 2: Try to fetch group names from Evolution API for group conversations
    // For groups, the "contactName" should be the group subject/name, not the pushName of the last sender
    const groupJids = [...new Set(allMessages.filter(m => m.isGroup).map(m => m.remoteJid))]
    const groupNameMap = new Map<string, string>() // jid -> group name

    // Try to get group metadata from the chip's Evolution API instance
    if (groupJids.length > 0 && chip?.evolutionInstance) {
      try {
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
      } catch {
        // Skip group metadata fetch if not available
      }
    }

    // Step 2.5: Build a fallback group name from existing messages
    // Look for the most common non-empty contactName/pushName pattern in each group
    // Or use the remoteJid phone part
    //
    // PRIORITY for group names:
    //   1) Evolution API fetchGroupMetadata (most reliable — always try first)
    //   2) contactName from fromMe messages in DB (may be correct)
    //   3) Fallback to "Grupo XXXX"
    //
    // NOTE: Previously we skipped API fetch if we had a groupNameMap entry,
    // but that entry might be "Grupo XXXX" from the webhook fallback.
    // We should ALWAYS prefer the API result.
    for (const jid of groupJids) {
      // If we already got the name from the API, skip
      if (groupNameMap.has(jid) && !groupNameMap.get(jid)?.startsWith('Grupo ')) {
        continue
      }

      // Try to find a group name from the contactName field of fromMe messages
      // (when we send to a group, sometimes the group name is saved)
      const groupMsgs = allMessages.filter(m => m.remoteJid === jid)
      
      // For groups, look for a consistent name in messages
      // Priority: contactName from fromMe messages (likely group name), then any non-empty pushName
      const fromMeMsg = groupMsgs.find(m => m.fromMe && m.contactName && m.contactName !== 'unknown' && !m.contactName.startsWith('Grupo '))
      if (fromMeMsg?.contactName && !fromMeMsg.contactName.startsWith('Grupo ')) {
        groupNameMap.set(jid, fromMeMsg.contactName)
        continue
      }

      // Try any non-Grupo contactName
      const anyNamedMsg = groupMsgs.find(m => m.contactName && m.contactName !== 'unknown' && !m.contactName.startsWith('Grupo '))
      if (anyNamedMsg?.contactName) {
        groupNameMap.set(jid, anyNamedMsg.contactName)
        continue
      }
      
      // Fallback: use the group phone number as identifier
      const groupPhone = jid.split('@')[0]
      groupNameMap.set(jid, `Grupo ${groupPhone.slice(-4)}`)
    }

    // Step 2.75: Build LID → phone JID mapping for conversation merging
    // Evolution API V3 (whatsmeow) uses LID for outgoing messages:
    //   Outgoing: remoteJid = 123456@lid
    //   Incoming: remoteJid = 5511999990001@s.whatsapp.net
    // These are the SAME conversation but with different JIDs.
    // We need to merge them by mapping LID → phone JID.
    const lidToPhoneMap = new Map<string, string>() // lid JID → phone JID

    // Strategy 1: Match by remotePhone — if LID messages and phone messages share the same remotePhone
    const lidMessages = allMessages.filter(m => m.remoteJid.endsWith('@lid'))
    const phoneMessages = allMessages.filter(m => m.remoteJid.endsWith('@s.whatsapp.net'))

    for (const lidMsg of lidMessages) {
      const lidPhone = lidMsg.remotePhone
      if (!lidPhone) continue

      // Find a phone-based message with the same phone number
      const matchingPhoneMsg = phoneMessages.find(m =>
        m.remotePhone === lidPhone ||
        m.remotePhone?.replace(/^55/, '') === lidPhone.replace(/^55/, '')
      )

      if (matchingPhoneMsg) {
        lidToPhoneMap.set(lidMsg.remoteJid, matchingPhoneMsg.remoteJid)
      }
    }

    // Strategy 2: Match by contactName/pushName for messages without remotePhone match
    for (const lidMsg of lidMessages) {
      if (lidToPhoneMap.has(lidMsg.remoteJid)) continue
      if (!lidMsg.contactName && !lidMsg.pushName) continue

      const nameToMatch = lidMsg.contactName || lidMsg.pushName
      if (!nameToMatch) continue

      const matchingPhoneMsg = phoneMessages.find(m =>
        (m.contactName === nameToMatch || m.pushName === nameToMatch) &&
        !m.isGroup
      )

      if (matchingPhoneMsg) {
        lidToPhoneMap.set(lidMsg.remoteJid, matchingPhoneMsg.remoteJid)
      }
    }

    // Step 3: Group by remoteJid to build conversation list
    const conversationMap = new Map<string, {
      chipId: string | null
      remoteJid: string
      remotePhone: string
      contactName: string | null
      pushName: string | null
      groupName: string | null
      lastMessage: { content: string; type: string; fromMe: boolean; senderName: string | null; isCampaign: boolean }
      lastMessageAt: Date
      unreadCount: number
      totalMessages: number
      isGroup: boolean
      hasCampaignMessages: boolean
      hasContactMessage: boolean  // Track if the contact actually wrote
      participants: Set<string>
    }>()

    for (const msg of allMessages) {
      // Resolve LID → phone JID for conversation merging
      // If this message uses a LID JID, map it to the phone JID so
      // outgoing (LID) and incoming (phone) messages are in the same conversation
      const key = lidToPhoneMap.get(msg.remoteJid) || msg.remoteJid
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
            isCampaign: msg.isCampaign,
          },
          lastMessageAt: msg.createdAt,
          unreadCount: (!msg.isRead && !msg.fromMe && !msg.isCampaign) ? 1 : 0,  // Don't count campaign as unread
          totalMessages: 1,
          isGroup: msg.isGroup,
          hasCampaignMessages: msg.isCampaign,
          hasContactMessage: !msg.fromMe && !msg.isCampaign,
          participants: msg.isGroup ? new Set(msg.pushName ? [msg.pushName] : []) : new Set(),
        })
      } else {
        // Additional message for this remoteJid
        existing.totalMessages++
        if (!msg.isRead && !msg.fromMe && !msg.isCampaign) {
          existing.unreadCount++
        }
        // Track if this conversation has campaign messages
        if (msg.isCampaign) {
          existing.hasCampaignMessages = true
        }
        // Track if the contact actually wrote in this conversation
        if (!msg.fromMe && !msg.isCampaign) {
          existing.hasContactMessage = true
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

    // Step 4: Filter out archived chats (from WhatsApp's archive feature)
    // Users who archive groups in WhatsApp don't want them cluttering the inbox.
    // We fetch the archived chat list from Evolution API and filter them out.
    let archivedJids = new Set<string>()
    try {
      if (chip?.evolutionInstance) {
        archivedJids = await getArchivedChatJids(chip.evolutionInstance)
        if (archivedJids.size > 0) {
          console.debug(`[Inbox] Filtering out ${archivedJids.size} archived chats for chip ${chip.name}`)
        }
      }
    } catch {
      // Non-critical — if we can't fetch archived status, show all conversations
    }

    // Step 5: Sort by last message time (most recent first)
    const conversations = Array.from(conversationMap.values())
      .filter(c => {
        // CRITICAL: Only show conversations where the CONTACT actually wrote
        // This hides: campaign-only blasts, outgoing-only chats, chip-to-chip warming
        // Groups always have contact messages (members send messages), so they pass
        if (!c.hasContactMessage && !c.isGroup) return false
        // Filter out archived conversations — match both the raw remoteJid
        // and the LID-mapped JID (some archived JIDs may use different formats)
        if (archivedJids.has(c.remoteJid)) return false
        // Also check if any LID variant of this JID is archived
        const phonePart = c.remoteJid.split('@')[0]
        for (const archivedJid of archivedJids) {
          if (archivedJid.startsWith(phonePart + '@')) return false
        }
        return true
      })
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    // Step 7: Format response
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
      hasCampaignMessages: c.hasCampaignMessages || false,
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
