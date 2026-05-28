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
 *
 * VISIBILITY RULES (v2.2):
 * 1. Only show contacts that RECEIVED a campaign message AND wrote back.
 *    - Campaign where nobody replied → HIDDEN
 *    - Campaign where someone replied → VISIBLE
 *    - Personal chats (no campaign) → HIDDEN
 *    - Groups with activity → VISIBLE
 * 2. Merge LID and s.whatsapp.net JIDs into one conversation per contact.
 *    The canonical key is the phone number, not the JID.
 *    This prevents "Renato Alves Filho" from appearing 2+ times.
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

    // Fetch chip info ONCE at the top
    const chip = await db.chip.findUnique({
      where: { id: chipId },
      select: { id: true, name: true, phoneNumber: true, profilePicUrl: true, status: true, evolutionInstance: true },
    })

    // ═══════════════════════════════════════════════════════════════════
    // STEP 0: Build the list of VISIBLE phone numbers.
    //
    // A contact is visible if:
    //   a) They RECEIVED a campaign message from this chip (isCampaign=true, fromMe=true)
    //   b) AND they wrote back (fromMe=false, isCampaign=false)
    //
    // For groups: always visible if they have any contact message.
    // ═══════════════════════════════════════════════════════════════════

    // 0a: Find all phone numbers that received campaign messages
    const campaignTargets = await db.inboxMessage.findMany({
      where: {
        chipId,
        isCampaign: true,
        fromMe: true,
      },
      select: { remoteJid: true, remotePhone: true },
    })

    // Map: phone number → Set of JIDs (handles LID + s.whatsapp.net)
    const campaignPhoneToJids = new Map<string, Set<string>>()
    for (const msg of campaignTargets) {
      const phone = msg.remotePhone || msg.remoteJid.split('@')[0]
      if (!phone) continue
      // Normalize: strip leading 55 for matching
      const normalized = phone.replace(/^55/, '')
      if (!campaignPhoneToJids.has(normalized)) {
        campaignPhoneToJids.set(normalized, new Set())
      }
      campaignPhoneToJids.get(normalized)!.add(msg.remoteJid)
    }

    // 0b: Find all phone numbers where the contact wrote back
    const contactReplies = await db.inboxMessage.findMany({
      where: {
        chipId,
        fromMe: false,
        isCampaign: false,
        isGroup: showGroups ? undefined : false,
      },
      select: { remoteJid: true, remotePhone: true, isGroup: true },
      distinct: ['remoteJid'],
    })

    // Map: phone number → Set of JIDs for contacts that replied
    const replyPhoneToJids = new Map<string, Set<string>>()
    const groupReplyJids = new Set<string>() // Groups are always visible if they have replies
    for (const msg of contactReplies) {
      if (msg.isGroup) {
        groupReplyJids.add(msg.remoteJid)
        continue
      }
      const phone = msg.remotePhone || msg.remoteJid.split('@')[0]
      if (!phone) continue
      const normalized = phone.replace(/^55/, '')
      if (!replyPhoneToJids.has(normalized)) {
        replyPhoneToJids.set(normalized, new Set())
      }
      replyPhoneToJids.get(normalized)!.add(msg.remoteJid)
    }

    // 0c: INTERSECTION — only contacts that received campaign AND replied
    const visibleNormalizedPhones = new Set<string>()
    for (const phone of campaignPhoneToJids.keys()) {
      // Check if this phone (or a variant) also has a reply
      if (replyPhoneToJids.has(phone)) {
        visibleNormalizedPhones.add(phone)
        continue
      }
      // Try with/without country code
      if (phone.startsWith('0') && replyPhoneToJids.has(phone.slice(1))) {
        visibleNormalizedPhones.add(phone)
        continue
      }
      // Try adding 55 prefix
      if (replyPhoneToJids.has('55' + phone)) {
        visibleNormalizedPhones.add(phone)
        continue
      }
    }

    if (visibleNormalizedPhones.size === 0 && groupReplyJids.size === 0) {
      return NextResponse.json({ conversations: [] })
    }

    // 0d: Build the full set of JIDs to query for
    const visibleJids = new Set<string>()
    for (const phone of visibleNormalizedPhones) {
      const jids = campaignPhoneToJids.get(phone) || new Set()
      const replyJids = replyPhoneToJids.get(phone) || new Set()
      for (const jid of jids) visibleJids.add(jid)
      for (const jid of replyJids) visibleJids.add(jid)
    }
    for (const jid of groupReplyJids) visibleJids.add(jid)

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Fetch all messages for visible conversations
    // ═══════════════════════════════════════════════════════════════════

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

    const allMessages = await db.inboxMessage.findMany({
      where: {
        ...baseWhere,
        remoteJid: { in: Array.from(visibleJids) },
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

    // Also fetch by remotePhone for messages that use different JIDs but same phone
    const visiblePhones = Array.from(visibleNormalizedPhones)
    const phoneOnlyMessages = visiblePhones.length > 0 ? await db.inboxMessage.findMany({
      where: {
        chipId,
        remotePhone: { in: visiblePhones },
        isGroup: showGroups ? undefined : false,
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
      take: 500,
    }) : []

    // Merge and deduplicate by message ID
    const seenIds = new Set<string>()
    const mergedMessages = [...allMessages, ...phoneOnlyMessages].filter(msg => {
      if (seenIds.has(msg.id)) return false
      seenIds.add(msg.id)
      return true
    })

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Group names for group conversations
    // ═══════════════════════════════════════════════════════════════════

    const groupJids = [...new Set(mergedMessages.filter(m => m.isGroup).map(m => m.remoteJid))]
    const groupNameMap = new Map<string, string>()

    if (groupJids.length > 0 && chip?.evolutionInstance) {
      try {
        const { fetchGroupMetadata } = await import('@/lib/evolution-api')
        for (const jid of groupJids) {
          try {
            const meta = await fetchGroupMetadata(chip.evolutionInstance, jid)
            if (meta?.subject) {
              groupNameMap.set(jid, meta.subject)
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // Fallback group names from messages
    for (const jid of groupJids) {
      if (groupNameMap.has(jid) && !groupNameMap.get(jid)?.startsWith('Grupo ')) continue
      const groupMsgs = mergedMessages.filter(m => m.remoteJid === jid)
      const namedMsg = groupMsgs.find(m => m.contactName && m.contactName !== 'unknown' && !m.contactName.startsWith('Grupo '))
      if (namedMsg?.contactName) {
        groupNameMap.set(jid, namedMsg.contactName)
      } else {
        groupNameMap.set(jid, `Grupo ${jid.split('@')[0].slice(-4)}`)
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Build phone → canonical JID mapping (DEDUP KEY)
    //
    // Instead of grouping by JID (which creates duplicates for LID vs phone),
    // we group by NORMALIZED PHONE NUMBER.
    // This ensures "Renato Alves Filho" appears only once regardless of
    // whether messages use @lid or @s.whatsapp.net.
    // ═══════════════════════════════════════════════════════════════════

    const normalizePhone = (phone: string): string => phone.replace(/^55/, '').replace(/\D/g, '')

    // Build phone → preferred JID (prefer s.whatsapp.net over lid)
    const phoneToCanonicalJid = new Map<string, string>()
    for (const msg of mergedMessages) {
      if (msg.isGroup) continue
      const phone = normalizePhone(msg.remotePhone || msg.remoteJid.split('@')[0])
      if (!phone) continue
      const existing = phoneToCanonicalJid.get(phone)
      // Prefer s.whatsapp.net over @lid as the canonical JID
      if (!existing || msg.remoteJid.endsWith('@s.whatsapp.net')) {
        phoneToCanonicalJid.set(phone, msg.remoteJid)
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: Group messages into conversations using PHONE as key
    // ═══════════════════════════════════════════════════════════════════

    const conversationMap = new Map<string, {
      chipId: string | null
      canonicalJid: string
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
      hasContactMessage: boolean
      participants: Set<string>
      allJids: Set<string>  // Track all JIDs for this contact
    }>()

    for (const msg of mergedMessages) {
      // For groups, use the JID directly (no phone-based merging)
      const dedupKey = msg.isGroup
        ? msg.remoteJid
        : normalizePhone(msg.remotePhone || msg.remoteJid.split('@')[0])

      const canonicalJid = msg.isGroup
        ? msg.remoteJid
        : (phoneToCanonicalJid.get(dedupKey) || msg.remoteJid)

      const existing = conversationMap.get(dedupKey)

      if (!existing) {
        const displayName = msg.isGroup
          ? (groupNameMap.get(msg.remoteJid) || msg.contactName || `Grupo`)
          : (msg.contactName || msg.pushName)

        conversationMap.set(dedupKey, {
          chipId: msg.chipId,
          canonicalJid,
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
          unreadCount: (!msg.isRead && !msg.fromMe && !msg.isCampaign) ? 1 : 0,
          totalMessages: 1,
          isGroup: msg.isGroup,
          hasCampaignMessages: msg.isCampaign,
          hasContactMessage: !msg.fromMe && !msg.isCampaign,
          participants: msg.isGroup ? new Set(msg.pushName ? [msg.pushName] : []) : new Set(),
          allJids: new Set([msg.remoteJid]),
        })
      } else {
        existing.totalMessages++
        if (!msg.isRead && !msg.fromMe && !msg.isCampaign) {
          existing.unreadCount++
        }
        if (msg.isCampaign) {
          existing.hasCampaignMessages = true
        }
        if (!msg.fromMe && !msg.isCampaign) {
          existing.hasContactMessage = true
        }
        if (msg.isGroup && msg.pushName) {
          existing.participants.add(msg.pushName)
        }
        // Better contact name: prefer contactName over pushName
        if (!msg.isGroup) {
          if (msg.contactName && msg.contactName !== 'unknown' && (!existing.contactName || existing.contactName === 'unknown')) {
            existing.contactName = msg.contactName
          }
          if (!existing.contactName && msg.pushName) {
            existing.contactName = msg.pushName
          }
        }
        // Track all JIDs
        existing.allJids.add(msg.remoteJid)
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Filter archived + sort
    // ═══════════════════════════════════════════════════════════════════

    let archivedJids = new Set<string>()
    try {
      if (chip?.evolutionInstance) {
        archivedJids = await getArchivedChatJids(chip.evolutionInstance)
      }
    } catch { /* non-critical */ }

    const conversations = Array.from(conversationMap.values())
      .filter(c => {
        // Only show conversations where the contact actually wrote
        if (!c.hasContactMessage && !c.isGroup) return false
        // Filter archived — check all JIDs for this contact
        for (const jid of c.allJids) {
          if (archivedJids.has(jid)) return false
        }
        // Also check by phone prefix
        const phonePart = c.canonicalJid.split('@')[0]
        for (const archivedJid of archivedJids) {
          if (archivedJid.startsWith(phonePart + '@')) return false
        }
        return true
      })
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    // ═══════════════════════════════════════════════════════════════════
    // STEP 6: Format response
    // ═══════════════════════════════════════════════════════════════════

    const formatted = conversations.map(c => ({
      chipId: c.chipId,
      remoteJid: c.canonicalJid,  // Use canonical JID (s.whatsapp.net preferred over lid)
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
