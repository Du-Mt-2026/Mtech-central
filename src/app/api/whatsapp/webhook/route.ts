import { NextResponse } from 'next/server'
import { INSTANCE_PREFIX, deleteInstance, getInstanceQRCode } from '@/lib/evolution-api'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'
import { db } from '@/lib/db'

/**
 * Webhook endpoint for Evolution Go API to send status updates
 * Evolution Go calls this when:
 * - Messages are sent/delivered/read
 * - Connection status changes (including disconnections)
 * - New messages arrive
 * - QR codes are generated
 * - Instance is deleted or connection is lost
 *
 * Evolution Go v3 webhook format:
 * { event: "Message"|"Connected"|"Disconnected"|"QRCode"|"SEND_MESSAGE"|..., data: {...}, instanceId: "uuid" }
 *
 * Evolution API v2 webhook format (backward compatible):
 * { event: "CONNECTION_UPDATE"|"MESSAGES_UPSERT"|"SEND_MESSAGE"|"INSTANCE_DELETED"|..., instance: "name", data: {...} }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    const event = body.event
    const data = body.data
    // v3 uses instanceId (UUID), v2 uses instance (name)
    // For v3, we need to resolve the instance name from our database
    const instanceId = body.instanceId || ''
    const instanceName = body.instance || ''

    // For v3 webhooks: find the chip by instanceId (UUID) or by instance name
    let chipInstanceName = instanceName
    if (!chipInstanceName && instanceId) {
      // Try to find chip by the Evolution Go instance UUID
      // We store the name in evolutionInstance, but we can look up by finding
      // chips whose evolutionInstance matches a name that corresponds to this UUID
      // For now, we'll search by checking if the chip's evolutionInstance matches
      // This requires the instanceId-to-name mapping from the API
      // Alternative: store the instance UUID in a new field
      // For the migration, we'll try to find the chip by querying instances
      try {
        const { fetchInstances } = await import('@/lib/evolution-api')
        const instances = await fetchInstances()
        const matched = instances.find((i: any) => i.id === instanceId)
        if (matched) {
          chipInstanceName = matched.name
        }
      } catch {
        // Can't resolve, use instanceId as fallback
        chipInstanceName = instanceId
      }
    }

    if (!chipInstanceName) {
      return NextResponse.json({ ok: true })
    }

    // Only process OctupusZap instances
    if (!chipInstanceName.startsWith(INSTANCE_PREFIX)) {
      return NextResponse.json({ ok: true })
    }

    console.log(`[Webhook] Event: ${event} | Instance: ${chipInstanceName}`)

    // Handle different events — support both v2 and v3 event names
    switch (event) {
      // ===== Connection Events (v3 names + v2 fallback) =====
      case 'Connected':
      case 'PairSuccess': {
        // v3: Instance connected successfully
        const chip = await db.chip.findFirst({
          where: { evolutionInstance: chipInstanceName },
        })

        if (chip) {
          // Extract profile name from v3 data if available
          const profileName = data?.Name || data?.name || data?.pushName || null
          const jid = data?.JID || data?.jid || data?.id || ''

          await db.chip.update({
            where: { id: chip.id },
            data: {
              status: 'connected',
              isQrPaired: true,
              lastSeen: new Date(),
              ...(profileName ? { profileName } : {}),
              ...(jid ? { profilePicUrl: jid } : {}),
            },
          })
          console.log(`[Webhook] Chip ${chip.name} connected!`)
        }
        break
      }

      case 'Disconnected': {
        // v3: Instance disconnected
        const chip = await db.chip.findFirst({
          where: { evolutionInstance: chipInstanceName },
        })

        if (chip) {
          const reason = data?.Reason || data?.reason || data?.disconnect_reason || ''
          const disconnectionCode = data?.Code || data?.code || null

          const updateData: Record<string, unknown> = {
            status: 'disconnected',
            isQrPaired: false,
            qrPairingCode: null,
          }

          if (reason) {
            console.log(`[Webhook] Instance ${chipInstanceName} disconnected. Reason: ${reason}`)
            updateData.disconnectionReasonCode = disconnectionCode
          }

          // Check for ban codes
          const BAN_CODES = [401, 403, 428, 440]
          if (disconnectionCode && BAN_CODES.includes(Number(disconnectionCode))) {
            updateData.status = 'banned'
            console.log(`[Webhook] Chip ${chip.name} marked as BANNED — disconnection code: ${disconnectionCode}`)
          }

          await db.chip.update({
            where: { id: chip.id },
            data: updateData,
          })
        }
        break
      }

      case 'CONNECTION_UPDATE': {
        // v2 fallback: Connection status changed
        const chip = await db.chip.findFirst({
          where: { evolutionInstance: chipInstanceName },
        })

        if (chip) {
          const state = data?.state
          const newStatus = state === 'open' ? 'connected'
            : state === 'connecting' ? 'connecting'
            : 'disconnected'

          const updateData: Record<string, unknown> = {
            status: newStatus,
            isQrPaired: state === 'open',
            lastSeen: state === 'open' ? new Date() : chip.lastSeen,
          }

          if (state === 'close' || state === 'disconnected') {
            updateData.isQrPaired = false
            updateData.qrPairingCode = null

            const reason = data?.reason || data?.disconnectReason || ''
            const disconnectionCode = data?.code || data?.statusCode || null
            if (reason) {
              console.log(`[Webhook] Instance ${chipInstanceName} disconnected. Reason: ${reason}`)
              updateData.disconnectionReasonCode = disconnectionCode
            }

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

      // ===== QR Code Event (v3) =====
      case 'QRCode': {
        // v3: QR code generated — update chip with QR data
        const chip = await db.chip.findFirst({
          where: { evolutionInstance: chipInstanceName },
        })

        if (chip) {
          const qrcode = data?.Qrcode || data?.qrcode || null
          const code = data?.Code || data?.code || null

          await db.chip.update({
            where: { id: chip.id },
            data: {
              status: 'connecting',
              qrPairingCode: code || null,
            },
          })

          console.log(`[Webhook] QR Code received for ${chipInstanceName}`)
        }
        break
      }

      // ===== Instance Deleted Events =====
      case 'INSTANCE_DELETED':
      case 'INSTANCE_DELETE': {
        // Instance was deleted from Evolution API
        const chip = await db.chip.findFirst({
          where: { evolutionInstance: chipInstanceName },
        })

        if (chip) {
          console.log(`[Webhook] Instance ${chipInstanceName} was deleted. Removing chip ${chip.name} from database.`)

          if (chip.wireguardPubKey && chip.wireguardIp) {
            removeWireGuardPeer(chip.wireguardPubKey, chip.wireguardIp).catch(err => {
              console.error('[Webhook INSTANCE_DELETED] WireGuard peer remove failed:', err)
            })
          }

          await db.message.deleteMany({ where: { chipId: chip.id } })
          await db.contact.deleteMany({ where: { chipId: chip.id } })
          await db.campaignChip.deleteMany({ where: { chipId: chip.id } })
          await db.chip.delete({ where: { id: chip.id } })
        }
        break
      }

      // ===== Message Send Confirmation (v3 + v2) =====
      case 'SEND_MESSAGE': {
        // Our message was sent — update status
        // v3 format: data.Info.ID, data.Message
        // v2 format: data.key.id, data.key.remoteJid
        const messageId = data?.Info?.ID || data?.key?.id

        if (messageId) {
          const existing = await db.message.findFirst({
            where: { evolutionMessageId: messageId },
          })

          if (existing) {
            await db.message.update({
              where: { id: existing.id },
              data: {
                status: 'sent',
                sentAt: existing.sentAt || new Date(),
                evolutionMessageId: messageId,
              },
            })

            // Save to InboxMessage
            try {
              const chip = await db.chip.findUnique({ where: { id: existing.chipId } })
              if (chip) {
                const contact = await db.contact.findUnique({ where: { id: existing.contactId } })
                let remoteJid = data?.Info?.Chat || data?.key?.remoteJid || `${contact?.phone || ''}@s.whatsapp.net`
                let remotePhone = contact?.phone || ''

                // Normalize Brazilian phone
                const jidSuffix = remoteJid.split('@')[1] || ''
                let phonePart = remoteJid.split('@')[0]
                if (phonePart.startsWith('55') && phonePart.length === 12 && jidSuffix === 's.whatsapp.net') {
                  phonePart = phonePart.slice(0, 4) + '9' + phonePart.slice(4)
                  remoteJid = `${phonePart}@${jidSuffix}`
                  remotePhone = phonePart
                }

                await db.inboxMessage.upsert({
                  where: { evolutionMsgId: messageId },
                  update: { remoteJid, remotePhone },
                  create: {
                    instanceName: chip.evolutionInstance || chipInstanceName,
                    chipId: chip.id,
                    remoteJid,
                    remotePhone,
                    fromMe: true,
                    messageContent: existing.content || '',
                    messageType: existing.mediatype || 'text',
                    mediaUrl: existing.mediaUrl,
                    pushName: chip.profileName || chip.name,
                    contactName: contact?.name || null,
                    evolutionMsgId: messageId,
                    isRead: true,
                    isGroup: remoteJid.includes('@g.us'),
                  },
                })
              }
            } catch (inboxErr) {
              console.error('[Webhook] Error saving sent message to inbox:', inboxErr)
            }
          } else {
            // No campaign message — save directly to inbox
            try {
              // v3 format uses data.Info.Chat, v2 uses data.key.remoteJid
              const rawRemoteJid = data?.Info?.Chat || data?.key?.remoteJid || ''
              const addressingMode = data?.key?.addressingMode || data?.Info?.AddressingMode
              const remoteJidAlt = data?.key?.remoteJidAlt || null
              let remoteJid = (addressingMode === 'lid' && remoteJidAlt) ? remoteJidAlt : rawRemoteJid

              // Normalize Brazilian phone
              const jidSuffix = remoteJid.split('@')[1] || ''
              let phonePart = remoteJid.split('@')[0]
              if (phonePart.startsWith('55') && phonePart.length === 12 && jidSuffix === 's.whatsapp.net') {
                phonePart = phonePart.slice(0, 4) + '9' + phonePart.slice(4)
                remoteJid = `${phonePart}@${jidSuffix}`
              }

              const remotePhone = remoteJid.split('@')[0]
              const chip = await db.chip.findFirst({ where: { evolutionInstance: chipInstanceName } })

              // Extract content — v3 uses data.Message, v2 uses data.message
              const msg = data?.Message || data?.message || {}
              let messageContent = ''
              let messageType = 'text'
              let mediaUrl: string | null = null

              if (msg.conversation) messageContent = msg.conversation
              else if (msg.extendedTextMessage?.text) messageContent = msg.extendedTextMessage.text
              else if (msg.imageMessage) { messageContent = msg.imageMessage.caption || ''; messageType = 'image'; mediaUrl = msg.imageMessage.url || null }
              else if (msg.videoMessage) { messageContent = msg.videoMessage.caption || ''; messageType = 'video'; mediaUrl = msg.videoMessage.url || null }
              else if (msg.audioMessage) { messageType = 'audio'; mediaUrl = msg.audioMessage.url || null }
              else if (msg.documentMessage) { messageContent = msg.documentMessage.caption || ''; messageType = 'document'; mediaUrl = msg.documentMessage.url || null }

              if (messageContent || messageType !== 'text') {
                let contactName: string | null = chip?.profileName || chip?.name || null
                if (chip) {
                  const contact = await db.contact.findFirst({
                    where: { phone: { contains: remotePhone.replace(/^55/, '') } },
                  })
                  if (contact?.name) contactName = contact.name
                }

                await db.inboxMessage.upsert({
                  where: { evolutionMsgId: messageId },
                  update: { remoteJid, remotePhone },
                  create: {
                    instanceName: chipInstanceName,
                    chipId: chip?.id || null,
                    remoteJid,
                    remotePhone,
                    fromMe: true,
                    messageContent,
                    messageType,
                    mediaUrl,
                    pushName: chip?.profileName || chip?.name || null,
                    contactName,
                    evolutionMsgId: messageId,
                    isRead: true,
                    isGroup: remoteJid.includes('@g.us'),
                  },
                })
              }
            } catch (inboxErr) {
              console.error('[Webhook] Error saving direct send to inbox:', inboxErr)
            }
          }
        }
        break
      }

      // ===== Message Status Updates (v2) =====
      case 'MESSAGES_UPDATE': {
        if (data && Array.isArray(data)) {
          for (const msg of data) {
            const evolutionId = msg.key?.id
            if (!evolutionId) continue

            const message = await db.message.findFirst({
              where: { evolutionMessageId: evolutionId },
            })

            if (!message) continue

            if (msg.status === 'delivered') {
              await db.message.update({
                where: { id: message.id },
                data: { status: 'delivered', deliveredAt: new Date() },
              })
            } else if (msg.status === 'read') {
              await db.message.update({
                where: { id: message.id },
                data: { status: 'read', deliveredAt: message.deliveredAt || new Date(), readAt: new Date() },
              })
            } else if (msg.status === 'failed' || msg.status === 'error') {
              await db.message.update({
                where: { id: message.id },
                data: { status: 'failed', error: `Webhook: message ${msg.status}` },
              })
            }
          }
        }
        break
      }

      // ===== Read Receipt (v3) =====
      case 'READ_RECEIPT': {
        // v3: Message read receipt
        if (data?.Info?.ID || data?.key?.id) {
          const evolutionId = data?.Info?.ID || data?.key?.id
          const message = await db.message.findFirst({
            where: { evolutionMessageId: evolutionId },
          })

          if (message) {
            await db.message.update({
              where: { id: message.id },
              data: {
                status: 'read',
                deliveredAt: message.deliveredAt || new Date(),
                readAt: new Date(),
              },
            })
          }
        }
        break
      }

      // ===== Incoming/Outgoing Messages (v3 + v2) =====
      case 'Message':
      case 'MESSAGES_UPSERT': {
        // Incoming AND outgoing messages — save to InboxMessage
        // v3 format: data.Info.Chat, data.Message
        // v2 format: data.key.remoteJid, data.message, data.pushName
        const chatJid = data?.Info?.Chat || data?.key?.remoteJid || ''

        if (chatJid) {
          try {
            const msgId = data?.Info?.ID || data?.key?.id || ''
            const fromMe = data?.Info?.IsFromMe ?? data?.key?.fromMe ?? false
            const pushName = data?.Info?.PushName || data?.pushName || null

            // Handle LID resolution
            const addressingMode = data?.key?.addressingMode || data?.Info?.AddressingMode || ''
            const remoteJidAlt = data?.key?.remoteJidAlt || data?.Info?.RecipientAlt || null
            let remoteJid = (addressingMode === 'lid' && remoteJidAlt) ? remoteJidAlt : chatJid

            // Normalize Brazilian phone numbers
            const jidSuffix = remoteJid.split('@')[1] || ''
            let phonePart = remoteJid.split('@')[0]
            if (phonePart.startsWith('55') && phonePart.length === 12 && jidSuffix === 's.whatsapp.net') {
              phonePart = phonePart.slice(0, 4) + '9' + phonePart.slice(4)
              remoteJid = `${phonePart}@${jidSuffix}`
            }

            const isGroup = remoteJid.includes('@g.us')

            // Extract message content — support both v3 (data.Message) and v2 (data.message) formats
            const msg = data?.Message || data?.message || {}
            let messageContent = ''
            let messageType = 'text'
            let mediaUrl: string | null = null

            if (msg.conversation) {
              messageContent = msg.conversation
            } else if (msg.extendedTextMessage?.text) {
              messageContent = msg.extendedTextMessage.text
            } else if (msg.imageMessage) {
              messageContent = msg.imageMessage.caption || ''
              messageType = 'image'
              mediaUrl = msg.imageMessage.url || null
            } else if (msg.videoMessage) {
              messageContent = msg.videoMessage.caption || ''
              messageType = 'video'
              mediaUrl = msg.videoMessage.url || null
            } else if (msg.audioMessage) {
              messageContent = ''
              messageType = 'audio'
              mediaUrl = msg.audioMessage.url || null
            } else if (msg.documentMessage) {
              messageContent = msg.documentMessage.caption || ''
              messageType = 'document'
              mediaUrl = msg.documentMessage.url || null
            } else if (msg.stickerMessage) {
              messageContent = ''
              messageType = 'sticker'
              mediaUrl = msg.stickerMessage.url || null
            } else if (msg.contactMessage) {
              messageContent = msg.contactMessage.displayName || ''
              messageType = 'contact'
            } else if (msg.locationMessage) {
              messageContent = `${msg.locationMessage.degreesLatitude || msg.locationMessage.degreesLat}, ${msg.locationMessage.degreesLongitude || msg.locationMessage.degreesLong}`
              messageType = 'location'
            } else if (msg.documentWithCaptionMessage?.message?.documentMessage) {
              // v3 wraps documents in documentWithCaptionMessage
              const doc = msg.documentWithCaptionMessage.message.documentMessage
              messageContent = doc.caption || ''
              messageType = 'document'
              mediaUrl = doc.URL || doc.url || null
            } else {
              messageContent = JSON.stringify(msg).substring(0, 500)
              messageType = 'unknown'
            }

            if (messageContent || messageType !== 'text') {
              const remotePhone = remoteJid.split('@')[0]

              const chip = await db.chip.findFirst({
                where: { evolutionInstance: chipInstanceName },
              })

              let contactName: string | null = pushName
              if (!fromMe && chip) {
                const contact = await db.contact.findFirst({
                  where: { phone: { contains: remotePhone.replace(/^55/, '') } },
                })
                if (contact?.name) contactName = contact.name
              }

              await db.inboxMessage.upsert({
                where: { evolutionMsgId: msgId },
                update: {
                  remoteJid,
                  remotePhone,
                  chipId: chip?.id || null,
                  contactName,
                  fromMe,
                  messageContent,
                  messageType,
                  mediaUrl,
                  pushName,
                },
                create: {
                  instanceName: chipInstanceName,
                  chipId: chip?.id || null,
                  remoteJid,
                  remotePhone,
                  fromMe,
                  messageContent,
                  messageType,
                  mediaUrl,
                  pushName,
                  contactName,
                  evolutionMsgId: msgId,
                  isRead: fromMe,
                  isGroup,
                },
              })
            }

            console.log(`[Webhook] Saved ${fromMe ? 'outgoing' : 'incoming'} message on ${chipInstanceName}`)
          } catch (inboxErr) {
            console.error('[Webhook] Error saving inbox message:', inboxErr)
          }
        }
        break
      }

      default:
        // Log unhandled events for debugging
        console.log(`[Webhook] Unhandled event: ${event} for ${chipInstanceName}`)
        break
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    // Always return 200 to avoid retry storms
    return NextResponse.json({ ok: true })
  }
}
