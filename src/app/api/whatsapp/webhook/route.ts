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
        // Incoming messages — log for now (future: inbox feature)
        if (data?.key?.remoteJid && !data?.key?.fromMe) {
          console.log(`Incoming message from ${data.key.remoteJid} on ${instance}`)
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
