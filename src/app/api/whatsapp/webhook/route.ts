import { NextResponse } from 'next/server'
import { getInstanceName } from '@/lib/evolution-api'
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

    console.log('Webhook received:', JSON.stringify(body).substring(0, 200))

    const event = body.event
    const instance = body.instance
    const data = body.data

    if (!instance) {
      return NextResponse.json({ ok: true })
    }

    // Handle different events
    switch (event) {
      case 'CONNECTION_UPDATE': {
        // Connection status changed - find chip by instance name
        const chips = await db.chip.findMany()
        for (const chip of chips) {
          const chipInstanceName = getInstanceName(chip.id, chip.name)
          if (chipInstanceName === instance) {
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

            console.log(`Chip ${chip.name} status updated to ${newStatus}`)
            break
          }
        }
        break
      }

      case 'SEND_MESSAGE': {
        // Our message was sent - update status
        if (data?.key?.id) {
          // Find message by external ID or update by chip status
          console.log(`Message sent: ${data.key.id} to ${data.key.remoteJid}`)
        }
        break
      }

      case 'MESSAGES_UPDATE': {
        // Message status updated (delivered, read, etc.)
        if (data && Array.isArray(data)) {
          for (const msg of data) {
            if (msg.status === 'delivered' || msg.status === 'read') {
              console.log(`Message ${msg.key?.id} status: ${msg.status}`)
            }
          }
        }
        break
      }

      case 'MESSAGES_UPSERT': {
        // New incoming message - log for now
        console.log('Incoming message from:', data?.key?.remoteJid)
        break
      }

      default:
        console.log(`Unhandled webhook event: ${event}`)
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    // Always return 200 to Evolution API to avoid retry storms
    return NextResponse.json({ ok: true })
  }
}
