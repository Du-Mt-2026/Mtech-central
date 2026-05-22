import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { evolutionFetch } from '@/lib/evolution-api'

/**
 * POST /api/inbox/auto-sync
 * Syncs recent messages from Evolution API for ALL connected chips.
 * Called automatically by the frontend every 10 seconds.
 * Uses upsert to handle race conditions and duplicate messages.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { chipId } = body as { chipId?: string }

    // Get connected chips
    const chips = await db.chip.findMany({
      where: {
        status: 'connected',
        evolutionInstance: { not: null },
        ...(chipId ? { id: chipId } : {}),
      },
      select: {
        id: true,
        evolutionInstance: true,
        name: true,
      },
    })

    if (chips.length === 0) {
      return NextResponse.json({ synced: 0, chips: 0 })
    }

    let totalSynced = 0
    let totalErrors = 0
    let totalFixed = 0

    for (const chip of chips) {
      try {
        // Fetch recent messages from Evolution API
        const fetchRes = await evolutionFetch(`/chat/findMessages/${chip.evolutionInstance}`, {
          method: 'POST',
          body: JSON.stringify({
            number: '',
            limit: 50,
            page: 1,
          }),
        })

        if (!fetchRes.ok) continue

        const fetchData = await fetchRes.json()
        const messages = fetchData?.messages?.records || fetchData?.messages || []

        for (const msg of messages) {
          try {
            const msgId = msg.key?.id
            if (!msgId) continue

            // Handle LID format
            const rawRemoteJid = msg.key.remoteJid || ''
            const addressingMode = msg.key.addressingMode
            const remoteJidAlt = msg.key.remoteJidAlt || null

            // Use the phone-based JID when available, fall back to LID
            let effectiveRemoteJid = (addressingMode === 'lid' && remoteJidAlt) ? remoteJidAlt : rawRemoteJid

            // Normalize Brazilian phone numbers in JID
            const jidSuffix = effectiveRemoteJid.split('@')[1] || ''
            let phonePart = effectiveRemoteJid.split('@')[0]
            if (phonePart.startsWith('55') && phonePart.length === 12 && jidSuffix === 's.whatsapp.net') {
              phonePart = phonePart.slice(0, 4) + '9' + phonePart.slice(4)
              effectiveRemoteJid = `${phonePart}@${jidSuffix}`
            }

            // Skip group messages
            if (effectiveRemoteJid.includes('@g.us')) continue

            const fromMe = msg.key.fromMe === true
            const pushName = msg.pushName || null

            // Extract content
            let messageContent = ''
            let messageType = 'text'
            let mediaUrl: string | null = null

            if (msg.message) {
              if (msg.message.conversation) {
                messageContent = msg.message.conversation
              } else if (msg.message.extendedTextMessage?.text) {
                messageContent = msg.message.extendedTextMessage.text
              } else if (msg.message.imageMessage) {
                messageContent = msg.message.imageMessage.caption || ''
                messageType = 'image'
                mediaUrl = msg.message.imageMessage.url || null
              } else if (msg.message.videoMessage) {
                messageContent = msg.message.videoMessage.caption || ''
                messageType = 'video'
                mediaUrl = msg.message.videoMessage.url || null
              } else if (msg.message.audioMessage) {
                messageContent = ''
                messageType = 'audio'
                mediaUrl = msg.message.audioMessage.url || null
              } else if (msg.message.documentMessage) {
                messageContent = msg.message.documentMessage.caption || ''
                messageType = 'document'
                mediaUrl = msg.message.documentMessage.url || null
              } else if (msg.message.stickerMessage) {
                messageContent = ''
                messageType = 'sticker'
                mediaUrl = msg.message.stickerMessage.url || null
              } else {
                messageContent = JSON.stringify(msg.message).substring(0, 500)
                messageType = 'unknown'
              }
            }

            if (!messageContent && messageType === 'text') continue

            const remotePhone = effectiveRemoteJid.split('@')[0]

            // Try to find contact name
            let contactName: string | null = pushName
            if (!fromMe) {
              const contact = await db.contact.findFirst({
                where: { phone: { contains: remotePhone.replace(/^55/, '') } },
              })
              if (contact?.name) contactName = contact.name
            }

            // Calculate createdAt from messageTimestamp
            const timestamp = msg.messageTimestamp
            const createdAt = timestamp
              ? new Date(typeof timestamp === 'object' && timestamp.low ? timestamp.low * 1000 : Number(timestamp) * 1000)
              : new Date()

            // Use upsert to handle race conditions and existing messages
            // NOTE: Do NOT update chipId on update — a message might exist under a different chip's perspective
            // (e.g., sent from Dudinha's chip, received on Artur's chip). The first chip to save it wins.
            await db.inboxMessage.upsert({
              where: { evolutionMsgId: msgId },
              update: {
                // Always update to fix LID-based or non-normalized JIDs
                remoteJid: effectiveRemoteJid,
                remotePhone,
                // chipId is NOT updated here — first chip to save the message keeps ownership
                fromMe,
                messageContent,
                contactName,
              },
              create: {
                instanceName: chip.evolutionInstance!,
                chipId: chip.id,
                remoteJid: effectiveRemoteJid,
                remotePhone,
                fromMe,
                messageContent,
                messageType,
                mediaUrl,
                pushName,
                contactName,
                evolutionMsgId: msgId,
                isRead: fromMe,
                isGroup: effectiveRemoteJid.includes('@g.us'),
                createdAt,
              },
            })
            totalSynced++
          } catch (msgErr) {
            totalErrors++
            console.error('[AutoSync] Error syncing message:', msgErr)
          }
        }
      } catch (chipErr) {
        totalErrors++
      }
    }

    return NextResponse.json({
      synced: totalSynced,
      errors: totalErrors,
      fixed: totalFixed,
      chips: chips.length,
    })
  } catch (error) {
    console.error('Auto-sync error:', error)
    return NextResponse.json(
      { error: 'Erro na sincronização automática' },
      { status: 500 }
    )
  }
}
