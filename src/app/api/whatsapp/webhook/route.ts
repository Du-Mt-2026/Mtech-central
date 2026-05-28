import { NextResponse } from 'next/server'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'
import { enqueueReconnection, markChipReconnected, dequeueReconnection } from '@/lib/reconnection-queue'
import { db } from '@/lib/db'
import { parseWhatsAppMessage } from '@/lib/whatsapp-message-parser'
import { broadcastToChip } from '@/app/api/inbox/events/route'

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

          // CRITICAL: Also check for temporary ban (Meta doesn't always send ban codes!)
          // Temp bans show "conta está restringida" in the inbox but NO disconnection code
          // If we auto-reconnect a temp-banned chip, Meta may escalate to permanent ban
          let isTempBanned = false
          if (!isBanned) {
            try {
              const RESTRICTION_KEYWORDS = [
                'conta está restringida', 'conta esta restringida',
                'envio de spam', 'mensagens automáticas', 'mensagens automaticas',
                'mensagens em massa', 'atividade recente',
                'account is restricted', 'sending spam',
                'automated messages', 'bulk messages',
                'não será possível', 'nao sera possivel',
                'iniciar novas conversas',
              ]
              const recentWarnings = await db.inboxMessage.findMany({
                where: {
                  instanceName: chip.evolutionInstance || '',
                  fromMe: false,
                  createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                },
                take: 30,
                orderBy: { createdAt: 'desc' },
              })
              for (const msg of recentWarnings) {
                const content = (msg.messageContent || '').toLowerCase()
                const matchCount = RESTRICTION_KEYWORDS.filter(kw => content.includes(kw)).length
                if (matchCount >= 2) {
                  isTempBanned = true
                  updateData.status = 'banned'
                  console.warn(`[Webhook] Chip ${chip.name} detected as TEMP BANNED via inbox message — NOT queueing for reconnection`)
                  break
                }
              }
            } catch (err: any) {
              console.error(`[Webhook] Error checking inbox for temp ban: ${err.message}`)
            }
          }

          await db.chip.update({
            where: { id: chip.id },
            data: updateData,
          })

          // If NOT banned (neither permanent nor temporary), queue the chip for automatic reconnection
          // Banned chips need manual intervention — don't auto-reconnect them
          if (!isBanned && !isTempBanned) {
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

      // ===== Message Send Confirmation & Delivery Tracking =====
      case 'SEND_MESSAGE':
      case 'SEND_MESSAGE_ACK': {
        const messageId = data?.Info?.ID

        // Evolution API v3 ack values (from whatsmeow protocol):
        //   0 = PENDING  — message queued, not yet sent
        //   1 = SENT (DEVICE_ACK) — sent from device to WhatsApp server
        //   2 = RECEIVED (SERVER_ACK) — received by WhatsApp server
        //   3 = DELIVERED — delivered to recipient's device (double tick ✓✓)
        //   4 = READ — read by recipient (blue ticks ✓✓)
        //   5 = PLAYED — played (audio/video)
        //
        // CRITICAL: SEND_MESSAGE_ACK fires MULTIPLE times as the message
        // progresses through ack stages. We must upgrade the status
        // (never downgrade) and set timestamps accordingly.
        //
        // Chatwoot pattern: status is MONOTONIC — only advances.
        const ackValue = data?.Info?.Status ?? data?.Status ?? data?.info?.status ?? null

        if (messageId) {
          // Helper: compute new status from ack value (monotonic upgrade only)
          const computeNewStatus = (currentStatus: string, currentAck: number, newAck: number) => {
            const STATUS_ORDER: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 }
            const ackToStatus = (a: number): string => a >= 4 ? 'read' : a >= 3 ? 'delivered' : a >= 1 ? 'sent' : 'pending'
            const candidate = ackToStatus(newAck)
            return (STATUS_ORDER[candidate] ?? 0) > (STATUS_ORDER[currentStatus] ?? 0) ? candidate : currentStatus
          }

          // === Update Campaign Message (Message table) ===
          const existing = await db.message.findFirst({
            where: { evolutionMessageId: messageId },
          })

          if (existing) {
            // Determine the new status based on ack value
            // Only UPGRADE status — never downgrade (delivered > sent > pending)
            let newStatus = existing.status
            let deliveredAt = existing.deliveredAt
            let readAt = existing.readAt
            let sentAt = existing.sentAt

            if (ackValue !== null && ackValue !== undefined) {
              const ack = Number(ackValue)
              newStatus = computeNewStatus(existing.status, existing.status === 'pending' ? 0 : existing.status === 'sent' ? 1 : existing.status === 'delivered' ? 2 : existing.status === 'read' ? 3 : 0, ack)
              if (newStatus === 'read') {
                deliveredAt = deliveredAt || new Date()
                readAt = new Date()
              } else if (newStatus === 'delivered') {
                deliveredAt = new Date()
              }
            } else {
              // No ack value — this is the initial SEND_MESSAGE event (just sent)
              if (existing.status === 'pending' || existing.status === 'sending') {
                newStatus = 'sent'
              }
            }

            sentAt = sentAt || new Date()

            await db.message.update({
              where: { id: existing.id },
              data: {
                status: newStatus,
                sentAt,
                deliveredAt,
                readAt,
                evolutionMessageId: messageId,
              },
            })

            if (newStatus === 'delivered') {
              console.log(`[Webhook] Message ${messageId} DELIVERED (ack=${ackValue})`)
            } else if (newStatus === 'read') {
              console.log(`[Webhook] Message ${messageId} READ (ack=${ackValue})`)
            }

            // v2.1: SSE broadcast — push status update to inbox clients in real-time
            try {
              broadcastToChip(existing.chipId, 'status_update', {
                messageId,
                status: newStatus,
                ack: ackValue,
                timestamp: Date.now(),
              })
            } catch { /* SSE broadcast is non-critical */ }

            // Save to InboxMessage — but mark as campaign message
            // These are NOT real conversations, just campaign blast messages
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

                // v2.0: Include ack/status in inbox message upsert
                const inboxAck = ackValue !== null && ackValue !== undefined ? Number(ackValue) : 1
                const inboxStatus = inboxAck >= 4 ? 'read' : inboxAck >= 3 ? 'delivered' : inboxAck >= 1 ? 'sent' : 'pending'

                await db.inboxMessage.upsert({
                  where: { evolutionMsgId: messageId },
                  update: { remoteJid, remotePhone, isCampaign: true, ack: inboxAck, status: inboxStatus, ...(inboxStatus === 'delivered' ? { deliveredAt: new Date() } : {}), ...(inboxStatus === 'read' ? { deliveredAt: new Date(), readAt: new Date() } : {}) },
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
                    isCampaign: true,
                    ack: inboxAck,
                    status: inboxStatus,
                    ...(inboxStatus === 'delivered' ? { deliveredAt: new Date() } : {}),
                    ...(inboxStatus === 'read' ? { deliveredAt: new Date(), readAt: new Date() } : {}),
                  },
                })
              }
            } catch (inboxErr) {
              console.error('[Webhook] Error saving sent message to inbox:', inboxErr)
            }

            // === Also update InboxMessage status for this message (delivery receipt) ===
            // This handles the case where the InboxMessage already exists (from a previous event)
            // and we just need to update its ack/status
            try {
              const inboxMsg = await db.inboxMessage.findUnique({ where: { evolutionMsgId: messageId } })
              if (inboxMsg && ackValue !== null && ackValue !== undefined) {
                const ack = Number(ackValue)
                const currentStatusOrder: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 }
                const newAckStatus = ack >= 4 ? 'read' : ack >= 3 ? 'delivered' : ack >= 1 ? 'sent' : 'pending'
                if ((currentStatusOrder[newAckStatus] ?? 0) > (currentStatusOrder[inboxMsg.status] ?? 0)) {
                  await db.inboxMessage.update({
                    where: { id: inboxMsg.id },
                    data: {
                      ack,
                      status: newAckStatus,
                      ...(newAckStatus === 'delivered' || newAckStatus === 'read' ? { deliveredAt: inboxMsg.deliveredAt || new Date() } : {}),
                      ...(newAckStatus === 'read' ? { readAt: new Date() } : {}),
                    },
                  })
                }
              }
            } catch (ackErr) {
              console.error('[Webhook] Error updating inbox message ack:', ackErr)
            }
          } else {
            // No campaign message — could be a warming message (chip-to-chip) or manual send
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

              // 🔍 CRITICAL: Detect chip-to-chip messages (warming)
              // If the remote phone belongs to another chip in the system, this is a warming message,
              // NOT a real conversation. Mark as isCampaign to hide from inbox.
              let isChipToChip = false
              if (remotePhone) {
                const recipientChip = await db.chip.findFirst({
                  where: {
                    OR: [
                      { phoneNumber: remotePhone },
                      { phoneNumber: { contains: remotePhone.replace(/^55/, '') } },
                    ],
                  },
                  select: { id: true },
                })
                isChipToChip = !!recipientChip
              }

              // Extract message content using unified parser
              const msg = data?.Message || {}
              const parsed = parseWhatsAppMessage(msg)
              const messageContent = parsed.content
              const messageType = parsed.type
              const mediaUrl = parsed.mediaUrl

              if (messageContent || messageType !== 'text') {
                let contactName: string | null = chip?.profileName || chip?.name || null
                if (chip) {
                  const contact = await db.contact.findFirst({
                    where: { phone: { contains: remotePhone.replace(/^55/, '') } },
                  })
                  if (contact?.name) contactName = contact.name
                }

                // Chip-to-chip messages are warming, not real conversations — hide from inbox
                const shouldHideFromInbox = isChipToChip

                await db.inboxMessage.upsert({
                  where: { evolutionMsgId: messageId },
                  update: { remoteJid, remotePhone, isCampaign: shouldHideFromInbox },
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
                    isCampaign: shouldHideFromInbox,
                  },
                })

                if (isChipToChip) {
                  console.log(`[Webhook] Chip-to-chip (warming) message detected: ${chipInstanceName} → ${remotePhone}, hiding from inbox`)
                }
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
          // === Update Campaign Message ===
          const message = await db.message.findFirst({
            where: { evolutionMessageId: msgId },
          })

          if (message) {
            // Only upgrade to 'read' — never downgrade
            if (message.status !== 'read') {
              await db.message.update({
                where: { id: message.id },
                data: {
                  status: 'read',
                  deliveredAt: message.deliveredAt || new Date(),
                  readAt: new Date(),
                },
              })
              console.log(`[Webhook] Message ${msgId} READ (via READ_RECEIPT event)`)
            }
          }

          // === v2.0: Update InboxMessage (delivery receipt tracking) ===
          try {
            const inboxMsg = await db.inboxMessage.findUnique({
              where: { evolutionMsgId: msgId },
            })
            if (inboxMsg && inboxMsg.status !== 'read' && inboxMsg.fromMe) {
              const STATUS_ORDER: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 }
              if ((STATUS_ORDER['read'] ?? 0) > (STATUS_ORDER[inboxMsg.status] ?? 0)) {
                await db.inboxMessage.update({
                  where: { id: inboxMsg.id },
                  data: {
                    ack: 4,
                    status: 'read',
                    deliveredAt: inboxMsg.deliveredAt || new Date(),
                    readAt: new Date(),
                  },
                })
                console.log(`[Webhook] InboxMessage ${msgId} READ (via READ_RECEIPT event)`)
                // v2.1: SSE broadcast
                try {
                  broadcastToChip(inboxMsg.chipId || '', 'status_update', {
                    messageId: msgId,
                    status: 'read',
                    ack: 4,
                    timestamp: Date.now(),
                  })
                } catch { /* non-critical */ }
              }
            }
          } catch (err: any) {
            console.error('[Webhook] Error updating inbox message read receipt:', err.message)
          }
        }
        break
      }

      // ===== Message Status Update (delivery tracking backup) =====
      // Evolution API v3 may also send MESSAGES_UPDATE for ack changes.
      // This is a safety net in case SEND_MESSAGE_ACK doesn't include the ack value.
      // v2.0: Also updates InboxMessage status (Chatwoot-like delivery receipts)
      case 'MESSAGES_UPDATE': {
        try {
          // Format varies by Evolution API version — try multiple locations
          const msgId = data?.Info?.ID || data?.key?.id || data?.id || null
          const ackValue = data?.Info?.Status ?? data?.Status ?? data?.ack ?? data?.info?.status ?? null

          if (msgId && ackValue !== null && ackValue !== undefined) {
            const ack = Number(ackValue)
            const STATUS_ORDER: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 }
            const ackToStatus = (a: number): string => a >= 4 ? 'read' : a >= 3 ? 'delivered' : a >= 1 ? 'sent' : 'pending'
            const candidateStatus = ackToStatus(ack)

            // === Update Campaign Message (Message table) ===
            const message = await db.message.findFirst({
              where: { evolutionMessageId: msgId },
            })

            if (message) {
              let newStatus = message.status
              let deliveredAt = message.deliveredAt
              let readAt = message.readAt

              if (ack >= 4 && message.status !== 'read') {
                newStatus = 'read'
                deliveredAt = deliveredAt || new Date()
                readAt = new Date()
              } else if (ack >= 3 && message.status !== 'read' && message.status !== 'delivered') {
                newStatus = 'delivered'
                deliveredAt = new Date()
              }

              if (newStatus !== message.status) {
                await db.message.update({
                  where: { id: message.id },
                  data: { status: newStatus, deliveredAt, readAt },
                })
                console.log(`[Webhook] MESSAGES_UPDATE: Campaign Message ${msgId} → ${newStatus} (ack=${ack})`)
              }
            }

            // === v2.0: Update InboxMessage (delivery receipt tracking) ===
            try {
              const inboxMsg = await db.inboxMessage.findUnique({
                where: { evolutionMsgId: msgId },
              })
              if (inboxMsg && (STATUS_ORDER[candidateStatus] ?? 0) > (STATUS_ORDER[inboxMsg.status] ?? 0)) {
                await db.inboxMessage.update({
                  where: { id: inboxMsg.id },
                  data: {
                    ack,
                    status: candidateStatus,
                    ...(candidateStatus === 'delivered' || candidateStatus === 'read' ? { deliveredAt: inboxMsg.deliveredAt || new Date() } : {}),
                    ...(candidateStatus === 'read' ? { readAt: new Date() } : {}),
                  },
                })
                console.log(`[Webhook] MESSAGES_UPDATE: InboxMessage ${msgId} → ${candidateStatus} (ack=${ack})`)
              }
            } catch (inboxErr: any) {
              console.error('[Webhook] Error updating inbox message status from MESSAGES_UPDATE:', inboxErr.message)
            }
          }
        } catch (err: any) {
          console.error('[Webhook] Error processing MESSAGES_UPDATE:', err.message)
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
          const pushName: string | null = data?.Info?.PushName || null

          // Handle LID resolution (v3)
          // CRITICAL: Evolution API V3 (whatsmeow) uses LID (Linked ID) for addressing.
          // For outgoing messages (fromMe=true), the chatJid may be a LID like:
          //   1234567890@lid — instead of 5511999990001@s.whatsapp.net
          // This causes SPLIT CONVERSATIONS: incoming messages use phone@s.whatsapp.net,
          // outgoing messages use lid@lid — two separate conversations for the same contact.
          //
          // Resolution strategy:
          //   1) If AddressingMode='lid' and RecipientAlt exists → use RecipientAlt (phone JID)
          //   2) If chatJid is a LID without RecipientAlt → try to resolve from existing inbox
          //   3) If still unresolved → keep LID but store a mapping for conversation grouping
          const addressingMode = data?.Info?.AddressingMode || ''
          const remoteJidAlt = data?.Info?.RecipientAlt || null

          // Determine the canonical JID (phone-based, not LID-based)
          let remoteJid: string
          let lidJid: string | null = null  // Store LID for mapping

          if (addressingMode === 'lid' && remoteJidAlt) {
            // Best case: API gives us both LID and phone JID
            remoteJid = remoteJidAlt
            lidJid = chatJid
          } else if (chatJid.endsWith('@lid')) {
            // LID without RecipientAlt — need to resolve from existing data
            lidJid = chatJid

            // Try to find an existing inbox message with this LID as remoteJid
            // that already has been resolved to a phone JID
            const existingResolved = await db.inboxMessage.findFirst({
              where: { remoteJid: chatJid, contactName: { not: null } },
              select: { remoteJid: true, contactName: true, remotePhone: true },
            })

            if (existingResolved) {
              // We've seen this LID before — use the resolved phone
              // But we still have the same LID, so this doesn't help directly
              // Try finding a message from the SAME contact but with phone JID
            }

            // Try to find if we have incoming messages from this contact
            // by matching pushName or other identifiers
            const senderPushName = pushName || data?.Info?.PushName || data?.Info?.SenderName
            const isGroupChat = chatJid.includes('@g.us')
            if (senderPushName && !isGroupChat) {
              const matchByName = await db.inboxMessage.findFirst({
                where: {
                  pushName: senderPushName,
                  fromMe: false,
                  isGroup: false,
                  remoteJid: { endsWith: '@s.whatsapp.net' },
                },
                orderBy: { createdAt: 'desc' },
                select: { remoteJid: true },
              })
              if (matchByName) {
                remoteJid = matchByName.remoteJid
              } else {
                remoteJid = chatJid  // Keep LID — will be resolved later
              }
            } else {
              remoteJid = chatJid  // Keep LID — can't resolve yet
            }
          } else {
            // Normal phone-based JID
            remoteJid = chatJid
          }

          // Normalize Brazilian phone numbers
          const jidSuffix = remoteJid.split('@')[1] || ''
          let phonePart = remoteJid.split('@')[0]
          if (phonePart.startsWith('55') && phonePart.length === 12 && jidSuffix === 's.whatsapp.net') {
            phonePart = phonePart.slice(0, 4) + '9' + phonePart.slice(4)
            remoteJid = `${phonePart}@${jidSuffix}`
          }

          const isGroup = remoteJid.includes('@g.us')

          // PushName fallback for group messages: try alternative fields
          let senderName = pushName
          if (!senderName && isGroup) {
            senderName = data?.Info?.SenderName || data?.ContextInfo?.PushName || data?.Participant || null
          }

          // Extract message content using the unified parser
          const msg = data?.Message || {}
          const parsed = parseWhatsAppMessage(msg)
          const messageContent = parsed.content
          const messageType = parsed.type
          const mediaUrl = parsed.mediaUrl

          if (messageContent || messageType !== 'text') {
            const remotePhone = remoteJid.split('@')[0]

            const chip = await db.chip.findFirst({
              where: { evolutionInstance: chipInstanceName },
            })

            // For individual chats: contactName = contact name (from pushName or Contact table)
            // For groups: contactName = group name (subject), pushName = sender name
            let contactName: string | null = null
            let pushNameForDb: string | null = senderName || pushName  // For groups: sender's name

            if (isGroup) {
              // For GROUP messages: contactName should be the GROUP NAME (subject),
              // NOT the pushName of the sender. The sender's name stays in pushName.
              // Try to get group name from webhook data first (fastest)
              const groupSubject = data?.Info?.GroupSubject || data?.ChatName || data?.Info?.ChatName || null
              if (groupSubject) {
                contactName = groupSubject
              } else {
                // Fallback: try Evolution API group metadata (best-effort, don't block)
                try {
                  const { fetchGroupMetadata } = await import('@/lib/evolution-api')
                  if (chip?.evolutionInstance) {
                    const groupMeta = await fetchGroupMetadata(chip.evolutionInstance, remoteJid)
                    if (groupMeta?.subject) {
                      contactName = groupMeta.subject
                    }
                  }
                } catch {
                  // Skip — group name will be resolved in conversations API
                }
              }
              // For groups, if we still don't have a name, use a placeholder
              if (!contactName || contactName === pushNameForDb) {
                const groupPhone = remoteJid.split('@')[0]
                contactName = `Grupo ${groupPhone.slice(-4)}`
              }
            } else {
              // Individual chat: use pushName or contact name
              contactName = pushName
              if (!fromMe && chip) {
                const contact = await db.contact.findFirst({
                  where: { phone: { contains: remotePhone.replace(/^55/, '') } },
                })
                if (contact?.name) contactName = contact.name
              }
            }

            // Check if this outgoing message is from a campaign (already in Message table)
            let isCampaignMsg = false
            if (fromMe && msgId) {
              const existingCampaignMsg = await db.message.findFirst({
                where: { evolutionMessageId: msgId },
                select: { id: true },
              })
              isCampaignMsg = !!existingCampaignMsg
            }

            // 🔍 CRITICAL: Detect chip-to-chip messages (warming)
            // If the remote phone belongs to another chip, this is a warming message.
            // Also check: if the sender (pushName or linked chip) is a chip AND the recipient is a chip.
            if (!isCampaignMsg && remotePhone) {
              const recipientChip = await db.chip.findFirst({
                where: {
                  OR: [
                    { phoneNumber: remotePhone },
                    { phoneNumber: { contains: remotePhone.replace(/^55/, '') } },
                  ],
                },
                select: { id: true },
              })
              if (recipientChip) {
                isCampaignMsg = true // Chip-to-chip = warming, hide from inbox
                console.log(`[Webhook] Chip-to-chip (warming) message detected: ${chipInstanceName} ↔ ${remotePhone}, hiding from inbox`)
              }
            }

            // === v2.0: Handle reaction messages ===
            // Reactions are special — they target an existing message.
            // Instead of creating a new InboxMessage, we add the reaction
            // to the target message's reactionEmoji field.
            if (parsed.type === 'reaction' && parsed.reactionTargetId) {
              try {
                const targetMsg = await db.inboxMessage.findUnique({
                  where: { evolutionMsgId: parsed.reactionTargetId },
                })
                if (targetMsg) {
                  // Parse existing reactions or start fresh
                  let reactions: Array<{ emoji: string; from: string; fromJid: string }> = []
                  try {
                    reactions = targetMsg.reactionEmoji ? JSON.parse(targetMsg.reactionEmoji) : []
                  } catch { reactions = [] }

                  const fromJid = data?.Info?.SenderJid || data?.Info?.Participant || remoteJid
                  const fromName = pushNameForDb || pushName || 'unknown'

                  if (parsed.reactionEmoji) {
                    // Add or update reaction
                    const existingIdx = reactions.findIndex(r => r.fromJid === fromJid)
                    if (existingIdx >= 0) {
                      reactions[existingIdx].emoji = parsed.reactionEmoji
                    } else {
                      reactions.push({ emoji: parsed.reactionEmoji, from: fromName, fromJid })
                    }
                  } else {
                    // Empty emoji = remove reaction
                    reactions = reactions.filter(r => r.fromJid !== fromJid)
                  }

                  await db.inboxMessage.update({
                    where: { id: targetMsg.id },
                    data: { reactionEmoji: JSON.stringify(reactions) },
                  })
                  console.log(`[Webhook] Reaction "${parsed.reactionEmoji}" on message ${parsed.reactionTargetId} from ${fromName}`)
                }
              } catch (reactionErr: any) {
                console.error('[Webhook] Error processing reaction:', reactionErr.message)
              }

              // Also save the reaction as a separate InboxMessage (for message history)
              // but only if it has content (not removal)
              if (!parsed.reactionEmoji) {
                // Reaction removed — skip creating a separate message
                break
              }
            }

            // === v2.0: Determine initial status for fromMe messages ===
            // Outgoing messages start as 'sent' (they've been accepted by the server)
            // Incoming messages start as 'delivered' (they arrived to us)
            const initialAck = fromMe ? 1 : 3
            const initialStatus = fromMe ? 'sent' : 'delivered'

            // === v2.0: Cache group metadata ===
            if (isGroup && contactName && !contactName.startsWith('Grupo ') && chip?.id) {
              try {
                await db.groupMetadata.upsert({
                  where: { groupJid: remoteJid },
                  update: {
                    subject: contactName,
                    participantCount: 0, // Will be updated by GROUP events
                    chipId: chip.id,
                  },
                  create: {
                    groupJid: remoteJid,
                    subject: contactName,
                    chipId: chip.id,
                  },
                })
              } catch {
                // Non-critical — group metadata cache is best-effort
              }
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
                pushName: pushNameForDb,
                isCampaign: isCampaignMsg,
                // v2.0: Quoted message data
                quotedMsgId: parsed.quotedMsgId,
                quotedContent: parsed.quotedContent,
                quotedType: parsed.quotedType,
                quotedPushName: parsed.quotedPushName,
                // v2.0: Enriched media metadata
                fileName: parsed.fileName,
                mimeType: parsed.mimeType,
                mediaCaption: parsed.caption,
                mediaDuration: parsed.mediaDuration,
                // v2.0: Status tracking (only upgrade)
                ...(fromMe ? { ack: initialAck, status: initialStatus } : { ack: initialAck, status: initialStatus }),
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
                pushName: pushNameForDb,
                contactName,
                evolutionMsgId: msgId,
                isRead: fromMe,
                isGroup,
                isCampaign: isCampaignMsg,
                // v2.0: Quoted message data
                quotedMsgId: parsed.quotedMsgId,
                quotedContent: parsed.quotedContent,
                quotedType: parsed.quotedType,
                quotedPushName: parsed.quotedPushName,
                // v2.0: Enriched media metadata
                fileName: parsed.fileName,
                mimeType: parsed.mimeType,
                mediaCaption: parsed.caption,
                mediaDuration: parsed.mediaDuration,
                // v2.0: Status tracking
                ack: initialAck,
                status: initialStatus,
                ...(fromMe && initialStatus === 'sent' ? {} : {}),
                ...(!fromMe && initialStatus === 'delivered' ? {} : {}),
              },
            })

          // v2.1: SSE broadcast — push new message to inbox clients in real-time
          if (!isCampaignMsg && linkedChip?.id) {
            try {
              broadcastToChip(linkedChip.id, 'new_message', {
                remoteJid,
                fromMe,
                messageType,
                messageContent: (messageContent || '').substring(0, 200),
                pushName: pushNameForDb,
                contactName,
                isGroup,
                timestamp: Date.now(),
              })
            } catch { /* SSE broadcast is non-critical */ }
          }

          console.log(`[Webhook] Saved ${fromMe ? 'outgoing' : 'incoming'} message on ${chipInstanceName}`)
          } // end if (messageContent || messageType !== 'text')

        } catch (inboxErr) {
          console.error('[Webhook] Error saving inbox message:', inboxErr)
        }
        break
      }

      default:
        // Handle GROUP events for metadata cache
        if (event === 'GROUP' || event === 'GROUPS_UPSERT' || event === 'GROUPS_UPDATE') {
          try {
            // GROUP event from Evolution API v3:
            // data contains group metadata: id, subject, participants, owner, etc.
            const groupJid = data?.id || data?.JID || data?.jid || data?.key?.id || null
            const subject = data?.subject || data?.name || data?.Subject || data?.Name || null
            
            if (groupJid && subject && linkedChip) {
              const participants = data?.participants || []
              const participantCount = Array.isArray(participants) ? participants.length : 0
              
              await db.groupMetadata.upsert({
                where: { groupJid },
                update: {
                  subject,
                  participantCount,
                  chipId: linkedChip.id,
                  subjectOwner: data?.owner || data?.subjectOwner || null,
                  subjectAt: data?.subjectTime ? new Date(Number(data.subjectTime) * 1000) : null,
                },
                create: {
                  groupJid,
                  subject,
                  participantCount,
                  chipId: linkedChip.id,
                  subjectOwner: data?.owner || data?.subjectOwner || null,
                  subjectAt: data?.subjectTime ? new Date(Number(data.subjectTime) * 1000) : null,
                },
              })
              console.log(`[Webhook] Group metadata cached: ${subject} (${groupJid})`)
            }
          } catch (err: any) {
            console.error('[Webhook] Error caching group metadata:', err.message)
          }
          break
        }
        
        // Log unhandled events for debugging (but not too verbosely)
        if (!['PRESENCE', 'CHAT_PRESENCE', 'CONTACT', 'LABEL'].includes(event)) {
          console.log(`[Webhook] Unhandled event: ${event} for ${chipInstanceName}`)
        }
        break
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    // Always return 200 to avoid retry storms
    return NextResponse.json({ ok: true })
  }
}
