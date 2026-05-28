import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/inbox/conversations/sync
 * Syncs the Conversation table from existing InboxMessages.
 * This is a one-time migration + ongoing sync utility.
 *
 * For each unique (chipId, remoteJid) pair in InboxMessage:
 *   - Creates or updates a Conversation record
 *   - Links InboxMessages to their Conversation
 *   - Populates lastMessageAt, lastMessagePreview, unreadCount, etc.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const chipId = body.chipId as string | undefined

    const where: Record<string, unknown> = {
      isCampaign: false,
    }
    if (chipId) where.chipId = chipId

    // Step 1: Find all distinct (chipId, remoteJid) pairs
    const distinctPairs = await db.inboxMessage.groupBy({
      by: ['chipId', 'remoteJid'],
      where,
      _max: { createdAt: true },
      _count: { id: true },
    })

    let created = 0
    let updated = 0
    let linked = 0

    for (const pair of distinctPairs) {
      if (!pair.chipId || !pair.remoteJid) continue

      // Get the latest message for this conversation
      const lastMsg = await db.inboxMessage.findFirst({
        where: {
          chipId: pair.chipId,
          remoteJid: pair.remoteJid,
          isCampaign: false,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          messageContent: true,
          messageType: true,
          fromMe: true,
          status: true,
          isRead: true,
          createdAt: true,
          contactName: true,
          pushName: true,
          isGroup: true,
          remotePhone: true,
        },
      })

      if (!lastMsg) continue

      // Count unread
      const unreadCount = await db.inboxMessage.count({
        where: {
          chipId: pair.chipId,
          remoteJid: pair.remoteJid,
          isCampaign: false,
          isRead: false,
          fromMe: false,
        },
      })

      // Get group name from GroupMetadata
      let groupName: string | null = null
      let participantCount: number | null = null
      if (lastMsg.isGroup) {
        const groupMeta = await db.groupMetadata.findUnique({
          where: { groupJid: pair.remoteJid },
          select: { subject: true, participantCount: true },
        })
        if (groupMeta) {
          groupName = groupMeta.subject
          participantCount = groupMeta.participantCount
        }
      }

      // Determine display name
      const contactName = lastMsg.isGroup
        ? (groupName || lastMsg.contactName || null)
        : (lastMsg.contactName || lastMsg.pushName || null)

      // Upsert conversation
      try {
        const existing = await db.conversation.findUnique({
          where: {
            chipId_remoteJid: {
              chipId: pair.chipId,
              remoteJid: pair.remoteJid,
            },
          },
        })

        if (existing) {
          // Only update if the new lastMessageAt is more recent
          if (lastMsg.createdAt > existing.lastMessageAt) {
            await db.conversation.update({
              where: { id: existing.id },
              data: {
                contactName,
                groupName,
                isGroup: lastMsg.isGroup,
                remotePhone: lastMsg.remotePhone,
                lastMessageAt: lastMsg.createdAt,
                lastMessagePreview: (lastMsg.messageContent || '').substring(0, 200),
                lastMessageType: lastMsg.messageType,
                lastMessageFromMe: lastMsg.fromMe,
                lastMessageStatus: lastMsg.status,
                unreadCount,
                participantCount,
              },
            })
            updated++
          }
        } else {
          await db.conversation.create({
            data: {
              chipId: pair.chipId,
              remoteJid: pair.remoteJid,
              remotePhone: lastMsg.remotePhone,
              contactName,
              pushName: lastMsg.pushName,
              groupName,
              isGroup: lastMsg.isGroup,
              lastMessageAt: lastMsg.createdAt,
              lastMessagePreview: (lastMsg.messageContent || '').substring(0, 200),
              lastMessageType: lastMsg.messageType,
              lastMessageFromMe: lastMsg.fromMe,
              lastMessageStatus: lastMsg.status,
              unreadCount,
              participantCount,
            },
          })
          created++
        }

        // Link messages to this conversation
        const conv = await db.conversation.findUnique({
          where: {
            chipId_remoteJid: {
              chipId: pair.chipId,
              remoteJid: pair.remoteJid,
            },
          },
        })

        if (conv) {
          const linkResult = await db.inboxMessage.updateMany({
            where: {
              chipId: pair.chipId,
              remoteJid: pair.remoteJid,
              isCampaign: false,
              conversationId: null,
            },
            data: { conversationId: conv.id },
          })
          linked += linkResult.count
        }
      } catch (err) {
        console.error(`[ConversationSync] Error for ${pair.remoteJid}:`, err)
      }
    }

    return NextResponse.json({
      success: true,
      conversationsProcessed: distinctPairs.length,
      created,
      updated,
      messagesLinked: linked,
    })
  } catch (error) {
    console.error('Conversation sync error:', error)
    return NextResponse.json(
      { error: 'Erro ao sincronizar conversas' },
      { status: 500 }
    )
  }
}
