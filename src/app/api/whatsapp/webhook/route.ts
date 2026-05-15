import { NextResponse } from 'next/server'
import { INSTANCE_PREFIX } from '@/lib/evolution-api'
import { db } from '@/lib/db'

/**
 * Webhook endpoint for Evolution API to send status updates
 * Evolution API calls this when:
 * - Messages are sent/delivered/read
 * - Connection status changes
 * - New messages arrive
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    const event = body.event
    const instance = body.instance
    const data = body.data

    if (!instance) {
      return NextResponse.json({ ok: true })
    }

    // Only process OctupusZap instances
    if (!instance.startsWith(INSTANCE_PREFIX)) {
      return NextResponse.json({ ok: true })
    }

    // Handle different events
    switch (event) {
      case 'CONNECTION_UPDATE': {
        // Connection status changed - find chip by evolutionInstance
        const chip = await db.chip.findFirst({
          where: { evolutionInstance: instance },
        })

        if (chip) {
          const newStatus = data?.state === 'open' ? 'connected'
            : data?.state === 'connecting' ? 'connecting'
            : 'disconnected'

          await db.chip.update({
            where: { id: chip.id },
            data: {
              status: newStatus,
              isQrPaired: data?.state === 'open',
              lastSeen: data?.state === 'open' ? new Date() : chip.lastSeen,
            },
          })
        }
        break
      }

      case 'SEND_MESSAGE': {
        // Our message was sent — update status and store evolutionMessageId
        if (data?.key?.id) {
          // Try to find message by evolutionMessageId
          const existing = await db.message.findFirst({
            where: { evolutionMessageId: data.key.id },
          })

          if (existing) {
            await db.message.update({
              where: { id: existing.id },
              data: {
                status: 'sent',
                sentAt: existing.sentAt || new Date(),
                evolutionMessageId: data.key.id,
              },
            })
          }
        }
        break
      }

      case 'MESSAGES_UPDATE': {
        // Message status updated (delivered, read, etc.)
        if (data && Array.isArray(data)) {
          for (const msg of data) {
            const evolutionId = msg.key?.id
            if (!evolutionId) continue

            // Find our message by the Evolution API message ID
            const message = await db.message.findFirst({
              where: { evolutionMessageId: evolutionId },
            })

            if (!message) continue

            // Map Evolution API status to our status
            if (msg.status === 'delivered') {
              await db.message.update({
                where: { id: message.id },
                data: {
                  status: 'delivered',
                  deliveredAt: new Date(),
                },
              })
            } else if (msg.status === 'read') {
              await db.message.update({
                where: { id: message.id },
                data: {
                  status: 'read',
                  deliveredAt: message.deliveredAt || new Date(),
                  readAt: new Date(),
                },
              })
            } else if (msg.status === 'failed' || msg.status === 'error') {
              await db.message.update({
                where: { id: message.id },
                data: {
                  status: 'failed',
                  error: `Webhook: message ${msg.status}`,
                },
              })
            }
          }
        }
        break
      }

      case 'MESSAGES_UPSERT': {
        // Incoming messages — save to InboxMessage table
        if (data?.key?.remoteJid && !data?.key?.fromMe) {
          try {
            const msgId = data.key.id
            const remoteJid = data.key.remoteJid
            const pushName = data.pushName || null

            // Extract text content from the message
            let messageContent = ''
            let messageType = 'text'

            if (data.message) {
              if (data.message.conversation) {
                messageContent = data.message.conversation
              } else if (data.message.extendedTextMessage?.text) {
                messageContent = data.message.extendedTextMessage.text
              } else if (data.message.imageMessage) {
                messageContent = data.message.imageMessage.caption || ''
                messageType = 'image'
              } else if (data.message.videoMessage) {
                messageContent = data.message.videoMessage.caption || ''
                messageType = 'video'
              } else if (data.message.audioMessage) {
                messageContent = ''
                messageType = 'audio'
              } else if (data.message.documentMessage) {
                messageContent = data.message.documentMessage.caption || ''
                messageType = 'document'
              } else if (data.message.stickerMessage) {
                messageContent = ''
                messageType = 'sticker'
              } else if (data.message.contactMessage) {
                messageContent = data.message.contactMessage.displayName || ''
                messageType = 'contact'
              } else if (data.message.locationMessage) {
                messageContent = `${data.message.locationMessage.degreesLat}, ${data.message.locationMessage.degreesLong}`
                messageType = 'location'
              } else {
                messageContent = JSON.stringify(data.message).substring(0, 500)
                messageType = 'unknown'
              }
            }

            // Only save if we have content or a media type
            if (messageContent || messageType !== 'text') {
              await db.inboxMessage.upsert({
                where: { evolutionMsgId: msgId },
                update: {},
                create: {
                  instanceName: instance,
                  remoteJid,
                  fromMe: false,
                  messageContent,
                  messageType,
                  pushName,
                  evolutionMsgId: msgId,
                },
              })
            }

            console.log(`[Webhook] Saved incoming message from ${remoteJid} on ${instance}`)
          } catch (inboxErr) {
            console.error('[Webhook] Error saving inbox message:', inboxErr)
          }
        }
        break
      }

      default:
        // Silently ignore unhandled events
        break
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    // Always return 200 to Evolution API to avoid retry storms
    return NextResponse.json({ ok: true })
  }
}
