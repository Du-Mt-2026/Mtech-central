import { NextResponse } from 'next/server'
import { INSTANCE_PREFIX, deleteInstance } from '@/lib/evolution-api'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'
import { db } from '@/lib/db'

/**
 * Webhook endpoint for Evolution API to send status updates
 * Evolution API calls this when:
 * - Messages are sent/delivered/read
 * - Connection status changes (including disconnections)
 * - New messages arrive
 * - Instance is deleted or connection is lost
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

    console.log(`[Webhook] Event: ${event} | Instance: ${instance}`)

    // Handle different events
    switch (event) {
      case 'CONNECTION_UPDATE': {
        // Connection status changed - find chip by evolutionInstance
        const chip = await db.chip.findFirst({
          where: { evolutionInstance: instance },
        })

        if (chip) {
          const state = data?.state
          const newStatus = state === 'open' ? 'connected'
            : state === 'connecting' ? 'connecting'
            : 'disconnected'

          // If disconnected, also clear QR pairing
          const updateData: Record<string, unknown> = {
            status: newStatus,
            isQrPaired: state === 'open',
            lastSeen: state === 'open' ? new Date() : chip.lastSeen,
          }

          if (state === 'close' || state === 'disconnected') {
            updateData.isQrPaired = false
            updateData.qrPairingCode = null

            // Log disconnection reason if available
            const reason = data?.reason || data?.disconnectReason || ''
            const disconnectionCode = data?.code || data?.statusCode || null
            if (reason) {
              console.log(`[Webhook] Instance ${instance} disconnected. Reason: ${reason}`)
              updateData.disconnectionReasonCode = disconnectionCode
            }

            // Check if the disconnection code indicates a ban
            // WhatsApp ban codes: 401 (logged out), 403 (banned), 428 (replaced), 440 (device removed)
            const BAN_CODES = [401, 403, 428, 440]
            if (disconnectionCode && BAN_CODES.includes(disconnectionCode)) {
              updateData.status = 'banned'
              console.log(`[Webhook] Chip ${chip.name} marked as BANNED — disconnection code: ${disconnectionCode}`)
            }
          }

          await db.chip.update({
            where: { id: chip.id },
            data: updateData,
          })

          console.log(`[Webhook] Chip ${chip.name} status updated: ${chip.status} → ${updateData.status || newStatus}`)
        }
        break
      }

      case 'INSTANCE_DELETED':
      case 'INSTANCE_DELETE': {
        // Instance was deleted from Evolution API (or via another client)
        // Delete the chip from our database too
        const chip = await db.chip.findFirst({
          where: { evolutionInstance: instance },
        })

        if (chip) {
          console.log(`[Webhook] Instance ${instance} was deleted from Evolution API. Removing chip ${chip.name} from database.`)

          // Remove WireGuard peer from KVM8 server (best-effort, non-blocking)
          if (chip.wireguardPubKey && chip.wireguardIp) {
            removeWireGuardPeer(chip.wireguardPubKey, chip.wireguardIp).catch(err => {
              console.error('[Webhook INSTANCE_DELETED] WireGuard peer remove failed:', err)
            })
          }

          // Delete related records
          await db.message.deleteMany({ where: { chipId: chip.id } })
          await db.contact.deleteMany({ where: { chipId: chip.id } })
          await db.campaignChip.deleteMany({ where: { chipId: chip.id } })
          await db.chip.delete({ where: { id: chip.id } })
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
        // Log unhandled events for debugging
        console.log(`[Webhook] Unhandled event: ${event} for ${instance}`)
        break
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    // Always return 200 to Evolution API to avoid retry storms
    return NextResponse.json({ ok: true })
  }
}
