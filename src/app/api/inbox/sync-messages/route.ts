import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getEvolutionCredentials } from '@/lib/evolution-api'

/**
 * POST /api/inbox/sync-messages
 * Syncs missing messages from Evolution API into InboxMessage table.
 * This is useful when webhooks were down or missed messages.
 *
 * Body: {
 *   chipId: string        - The chip to sync messages for
 *   remoteJid?: string    - Optional: only sync for this specific contact
 *   limit?: number        - Max messages to fetch per conversation (default 50)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { chipId, remoteJid, limit = 50 } = body as {
      chipId?: string
      remoteJid?: string
      limit?: number
    }

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    // Get the chip
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip || !chip.evolutionInstance) {
      return NextResponse.json({ error: 'Chip não encontrado ou sem instância' }, { status: 404 })
    }

    const creds = await getEvolutionCredentials()
    const instanceName = chip.evolutionInstance

    // Get conversations from our DB to know which contacts to sync
    let conversationsToSync: string[] = []

    if (remoteJid) {
      conversationsToSync = [remoteJid]
    } else {
      // Get all distinct remoteJids for this chip
      const distinctJids = await db.inboxMessage.findMany({
        where: { chipId },
        select: { remoteJid: true },
        distinct: ['remoteJid'],
      })
      conversationsToSync = distinctJids.map(j => j.remoteJid)
    }

    let synced = 0
    let skipped = 0
    let errors = 0

    // Also fetch the latest messages from Evolution API for the most recent conversations
    // This catches conversations that don't exist in our DB yet
    try {
      const fetchUrl = `${creds.url}/chat/findMessages/${instanceName}`
      const fetchRes = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'apikey': creds.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          number: remoteJid || '',
          limit,
          page: 1,
        }),
      })

      if (fetchRes.ok) {
        const fetchData = await fetchRes.json()
        const messages = fetchData?.messages?.records || fetchData?.messages || []

        for (const msg of messages) {
          try {
            const msgId = msg.key?.id
            if (!msgId) { skipped++; continue }

            // Handle LID format
            const rawRemoteJid = msg.key.remoteJid || ''
            const addressingMode = msg.key.addressingMode
            const remoteJidAlt = msg.key.remoteJidAlt || null
            const effectiveRemoteJid = (addressingMode === 'lid' && remoteJidAlt) ? remoteJidAlt : rawRemoteJid

            // Skip group messages
            if (effectiveRemoteJid.includes('@g.us')) { skipped++; continue }

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

            if (!messageContent && messageType === 'text') { skipped++; continue }

            const remotePhone = effectiveRemoteJid.split('@')[0]

            // Try to find contact name
            let contactName: string | null = pushName
            if (!fromMe) {
              const contact = await db.contact.findFirst({
                where: { phone: { contains: remotePhone.replace(/^55/, '') } },
              })
              if (contact?.name) {
                contactName = contact.name
              }
            }

            // Calculate createdAt from messageTimestamp (Unix timestamp in seconds)
            const timestamp = msg.messageTimestamp
            const createdAt = timestamp
              ? new Date(typeof timestamp === 'object' && timestamp.low ? timestamp.low * 1000 : Number(timestamp) * 1000)
              : new Date()

            await db.inboxMessage.upsert({
              where: { evolutionMsgId: msgId },
              update: {},
              create: {
                instanceName,
                chipId,
                remoteJid: effectiveRemoteJid,
                remotePhone,
                fromMe,
                messageContent,
                messageType,
                mediaUrl,
                pushName,
                contactName,
                evolutionMsgId: msgId,
                isRead: fromMe || msg.MessageUpdate?.some((u: any) => u.status === 'READ'),
                isGroup: effectiveRemoteJid.includes('@g.us'),
                createdAt,
              },
            })
            synced++
          } catch (msgErr) {
            errors++
            console.error('[SyncMessages] Error syncing message:', msgErr)
          }
        }
      }
    } catch (fetchErr) {
      console.error('[SyncMessages] Error fetching from Evolution API:', fetchErr)
    }

    return NextResponse.json({
      chipId,
      instanceName,
      synced,
      skipped,
      errors,
      conversationsChecked: conversationsToSync.length,
    })
  } catch (error) {
    console.error('Sync messages error:', error)
    return NextResponse.json(
      { error: 'Erro ao sincronizar mensagens' },
      { status: 500 }
    )
  }
}
