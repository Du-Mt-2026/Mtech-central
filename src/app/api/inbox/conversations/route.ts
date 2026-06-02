import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getArchivedChatJidsWithNames } from '@/lib/evolution-api'

/**
 * GET /api/inbox/conversations
 * Returns all conversations for a chip, like WhatsApp inbox.
 *
 * VISIBILITY RULES (v3.0 — simplified):
 * - Show ALL conversations (personal, campaign, groups)
 * - isCampaign flag is just for UI indicator (megaphone icon), NOT visibility
 * - Merge LID and s.whatsapp.net JIDs into one conversation per contact
 * - Filter out archived chats
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

    // Fetch chip info ONCE at the top
    const chip = await db.chip.findUnique({
      where: { id: chipId },
      select: { id: true, name: true, phoneNumber: true, profilePicUrl: true, status: true, evolutionInstance: true },
    })

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Fetch ALL messages for this chip
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
      where: baseWhere,
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
        ack: true,
        status: true,
      },
      take: 2000,
    })

    if (allMessages.length === 0) {
      return NextResponse.json({ conversations: [] })
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Group names for group conversations
    // ═══════════════════════════════════════════════════════════════════

    const groupJids = [...new Set(allMessages.filter(m => m.isGroup).map(m => m.remoteJid))]
    const groupNameMap = new Map<string, string>()

    if (groupJids.length > 0) {
      // First, try to load from DB cache (GroupMetadata table)
      try {
        const cachedGroups = await db.groupMetadata.findMany({
          where: { groupJid: { in: groupJids } },
          select: { groupJid: true, subject: true, participantCount: true },
        })
        for (const cg of cachedGroups) {
          if (cg.subject && cg.subject !== 'unknown' && !/^\d{10,}$/.test(cg.subject)) {
            groupNameMap.set(cg.groupJid, cg.subject)
          }
        }
      } catch { /* non-critical */ }

      // Then, for groups NOT in cache (or with bad cached names), fetch from Evolution API
      const uncachedGroupJids = groupJids.filter(jid => {
        const name = groupNameMap.get(jid)
        return !name || name === 'unknown' || /^\d{10,}$/.test(name) || /^Grupo\s+\d{3,}$/i.test(name)
      })
      if (uncachedGroupJids.length > 0 && chip?.evolutionInstance) {
        try {
          const { fetchGroupMetadata } = await import('@/lib/evolution-api')
          for (const jid of uncachedGroupJids) {
            try {
              const meta = await fetchGroupMetadata(chip.evolutionInstance, jid)
              if (meta?.subject && meta.subject !== 'unknown') {
                groupNameMap.set(jid, meta.subject)
                try {
                  await db.groupMetadata.upsert({
                    where: { groupJid: jid },
                    create: { groupJid: jid, subject: meta.subject, participantCount: meta.participants || 0, chipId },
                    update: { subject: meta.subject, participantCount: meta.participants || 0, updatedAt: new Date() },
                  })
                } catch { /* non-critical */ }
              }
            } catch { /* skip — Evolution API may be down */ }
          }
        } catch { /* skip */ }
      }
    }

    // Fallback group names from messages
    for (const jid of groupJids) {
      const currentName = groupNameMap.get(jid)
      if (currentName && !/^\d{10,}$/.test(currentName) && !/^Grupo\s+\d{3,}$/i.test(currentName) && currentName !== 'unknown') continue
      const groupMsgs = allMessages.filter(m => m.remoteJid === jid)
      const namedMsg = groupMsgs.find(m => m.contactName && m.contactName !== 'unknown' && !m.contactName.startsWith('Grupo ') && !/^\d{10,}$/.test(m.contactName))
      if (namedMsg?.contactName) {
        groupNameMap.set(jid, namedMsg.contactName)
      } else {
        const jidNum = jid.split('@')[0]
        const shortId = jidNum.length > 6 ? `...${jidNum.slice(-6)}` : jidNum
        groupNameMap.set(jid, `Grupo ${shortId}`)
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Build phone → canonical JID mapping (DEDUP KEY)
    // ═══════════════════════════════════════════════════════════════════

    const normalizePhone = (phone: string): string => phone.replace(/^55/, '').replace(/\D/g, '')

    // Build phone → preferred JID (prefer s.whatsapp.net over lid)
    const phoneToCanonicalJid = new Map<string, string>()
    for (const msg of allMessages) {
      if (msg.isGroup) continue
      const phone = normalizePhone(msg.remotePhone || msg.remoteJid.split('@')[0])
      if (!phone) continue
      const existing = phoneToCanonicalJid.get(phone)
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
      lastMessage: { content: string; type: string; fromMe: boolean; senderName: string | null; isCampaign: boolean; status: string; ack: number }
      lastMessageAt: Date
      unreadCount: number
      totalMessages: number
      isGroup: boolean
      hasCampaignMessages: boolean
      participants: Set<string>
      allJids: Set<string>
    }>()

    // Process in reverse (oldest first) so lastMessage ends up as the actual last
    const sortedMessages = [...allMessages].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )

    for (const msg of sortedMessages) {
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
            status: (msg as any).status || 'pending',
            ack: (msg as any).ack ?? 0,
          },
          lastMessageAt: msg.createdAt,
          unreadCount: (!msg.isRead && !msg.fromMe) ? 1 : 0,
          totalMessages: 1,
          isGroup: msg.isGroup,
          hasCampaignMessages: msg.isCampaign,
          participants: msg.isGroup ? new Set(msg.pushName ? [msg.pushName] : []) : new Set(),
          allJids: new Set([msg.remoteJid]),
        })
      } else {
        existing.totalMessages++
        if (!msg.isRead && !msg.fromMe) {
          existing.unreadCount++
        }
        if (msg.isCampaign) {
          existing.hasCampaignMessages = true
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
        // Update lastMessage if this message is newer
        if (new Date(msg.createdAt) > new Date(existing.lastMessageAt)) {
          existing.lastMessage = {
            content: (msg.messageContent || '').substring(0, 100),
            type: msg.messageType,
            fromMe: msg.fromMe,
            senderName: msg.isGroup ? (msg.pushName || null) : null,
            isCampaign: msg.isCampaign,
            status: (msg as any).status || 'pending',
            ack: (msg as any).ack ?? 0,
          }
          existing.lastMessageAt = msg.createdAt
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Filter archived + sort
    // ═══════════════════════════════════════════════════════════════════

    let archivedJids = new Set<string>()
    const chatNameMap = new Map<string, string>()
    try {
      if (chip?.evolutionInstance) {
        const allChats = await getArchivedChatJidsWithNames(chip.evolutionInstance)
        for (const [jid, info] of allChats) {
          if (info.archived) archivedJids.add(jid)
          if (info.name && !/^\d{10,}$/.test(info.name) && info.name !== 'unknown') {
            chatNameMap.set(jid, info.name)
          }
        }
      }
    } catch { /* non-critical */ }

    // Fill in group names from chat list if still missing
    for (const [jid, name] of chatNameMap) {
      if (jid.endsWith('@g.us')) {
        const currentName = groupNameMap.get(jid)
        if (!currentName || /^\d{10,}$/.test(currentName) || /^Grupo\s/i.test(currentName) || currentName === 'unknown') {
          groupNameMap.set(jid, name)
          try {
            await db.groupMetadata.upsert({
              where: { groupJid: jid },
              create: { groupJid: jid, subject: name, chipId },
              update: { subject: name, updatedAt: new Date() },
            })
          } catch { /* non-critical */ }
        }
      }
    }

    // Fetch cached profile pictures from Conversation table
    const cachedPics = new Map<string, string>()
    try {
      const convPics = await db.conversation.findMany({
        where: { chipId, profilePicUrl: { not: null } },
        select: { remoteJid: true, remotePhone: true, profilePicUrl: true },
      })
      for (const cp of convPics) {
        if (cp.profilePicUrl) {
          if (cp.remoteJid) cachedPics.set(cp.remoteJid, cp.profilePicUrl)
          if (cp.remotePhone) cachedPics.set(cp.remotePhone, cp.profilePicUrl)
        }
      }
    } catch { /* non-critical — Conversation table may not exist yet */ }

    const conversations = Array.from(conversationMap.values())
      .filter(c => {
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
      remoteJid: c.canonicalJid,
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
      profilePicUrl: cachedPics.get(c.canonicalJid) || cachedPics.get(c.remotePhone) || null,
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
