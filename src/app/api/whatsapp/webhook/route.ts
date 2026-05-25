import { NextResponse } from 'next/server'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'
import { enqueueReconnection, markChipReconnected, dequeueReconnection } from '@/lib/reconnection-queue'
import { db } from '@/lib/db'

/**
 * Webhook endpoint for Evolution Go (v3) API status updates.
 *
 * v3 webhook format:
 *   { event: "Message"|"Connected"|"Disconnected"|"QRCode"|"SEND_MESSAGE"|"READ_RECEIPT"|..., data: {...}, instanceId: "uuid" }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    const event = body.event
    const data = body.data
    const instanceId = body.instanceId || ''

    // === Resolve instance name from v3 format ===
    let chipInstanceName = ''

    // v3 format: instanceId is a UUID, need to look up the name
    if (instanceId) {
      try {
        const { fetchInstances } = await import('@/lib/evolution-api')
        const instances = await fetchInstances()
        const matched = instances.find((i: any) => i.id === instanceId)
        if (matched) {
          chipInstanceName = matched.name
        }
      } catch {
        chipInstanceName = instanceId
      }
    }

    if (!chipInstanceName) {
      return NextResponse.json({ ok: true })
    }

    // Find the chip linked to this instance
    const linkedChip = await db.chip.findFirst({
      where: { evolutionInstance: chipInstanceName },
    })

    // If the instance is not linked in our DB, skip it
    if (!linkedChip) {
      return NextResponse.json({ ok: true })
    }

    console.log(`[Webhook] Event: ${event} | Instance: ${chipInstanceName}`)

    // === Handle v3 events ===
    switch (event) {
      // ===== Connection Events =====
      case 'Connected':
      case 'PairSuccess': {
        const chip = linkedChip

        if (chip) {
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

          // Notify reconnection queue — chip successfully reconnected
          // This will also auto-resume any paused campaigns
          await markChipReconnected(chip.id).catch(err => {
            console.error('[Webhook] Error notifying reconnection queue:', err)
          })
        }
        break
      }

      case 'Disconnected': {
        const chip = linkedChip

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

          const BAN_CODES = [401, 403, 428, 440]
          const isBanned = disconnectionCode && BAN_CODES.includes(Number(disconnectionCode))
          if (isBanned) {
            updateData.status = 'banned'
            console.log(`[Webhook] Chip ${chip.name} marked as BANNED — disconnection code: ${disconnectionCode}`)
          }

          await db.chip.update({
            where: { id: chip.id },
            data: updateData,
          })

          // If NOT banned, queue the chip for automatic reconnection
          // Banned chips need manual intervention — don't auto-reconnect them
          if (!isBanned) {
            console.log(`[Webhook] Queueing chip ${chip.name} for auto-reconnection`)
            // Use setTimeout to avoid blocking the webhook response
            // (the reconnection will start after the webhook returns 200)
            setTimeout(() => {
              enqueueReconnection(chip.id, {
                reason: `Webhook Disconnected: ${reason || 'unknown'}`,
              }).catch(err => {
                console.error('[Webhook] Error queueing reconnection:', err)
              })
            }, 1000) // 1 second delay to ensure DB is updated first
          }
        }
        break
      }

      // ===== QR Code Events =====
      case 'QRCode': {
        const chip = linkedChip

        if (chip) {
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

      // ===== Instance Deleted =====
      case 'INSTANCE_DELETED':
      case 'INSTANCE_DELETE': {
        const chip = linkedChip

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

      // ===== Message Send Confirmation =====
      case 'SEND_MESSAGE':
      case 'SEND_MESSAGE_ACK': {
        const messageId = data?.Info?.ID

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
                let remoteJid = data?.Info?.Chat || `${contact?.phone || ''}@s.whatsapp.net`
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
              const rawRemoteJid = data?.Info?.Chat || ''
              const addressingMode = data?.Info?.AddressingMode
              const remoteJidAlt = data?.Info?.RecipientAlt || null
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

              // Extract message content from v3 format (data.Message)
              const msg = data?.Message || {}
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

      // ===== Read Receipt =====
      case 'READ_RECEIPT': {
        const msgId = data?.Info?.ID
        if (msgId) {
          const message = await db.message.findFirst({
            where: { evolutionMessageId: msgId },
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

      // ===== Incoming/Outgoing Messages =====
      case 'Message': {
        try {
          // v3 format: data.Info.Chat, data.Info.ID, data.Info.IsFromMe, data.Message
          const chatJid = data?.Info?.Chat || ''

          if (!chatJid) break

          const msgId = data?.Info?.ID || ''
          const fromMe = data?.Info?.IsFromMe ?? false
          const pushName = data?.Info?.PushName || null

          // Handle LID resolution (v3)
          const addressingMode = data?.Info?.AddressingMode || ''
          const remoteJidAlt = data?.Info?.RecipientAlt || null
          let remoteJid = (addressingMode === 'lid' && remoteJidAlt) ? remoteJidAlt : chatJid

          // Normalize Brazilian phone numbers
          const jidSuffix = remoteJid.split('@')[1] || ''
          let phonePart = remoteJid.split('@')[0]
          if (phonePart.startsWith('55') && phonePart.length === 12 && jidSuffix === 's.whatsapp.net') {
            phonePart = phonePart.slice(0, 4) + '9' + phonePart.slice(4)
            remoteJid = `${phonePart}@${jidSuffix}`
          }

          const isGroup = remoteJid.includes('@g.us')

          // Extract message content
          const msg = data?.Message || {}
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
