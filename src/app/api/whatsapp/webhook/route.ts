import { NextResponse } from 'next/server'
import { removeWireGuardPeer } from '@/lib/wireguard-peer-api'
import { enqueueReconnection, markChipReconnected, dequeueReconnection } from '@/lib/reconnection-queue'
import { db } from '@/lib/db'
import { parseWhatsAppMessage } from '@/lib/whatsapp-message-parser'

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

                await db.inboxMessage.upsert({
                  where: { evolutionMsgId: messageId },
                  update: { remoteJid, remotePhone, isCampaign: true },
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
                    isCampaign: true,  // This is a campaign message, not a real conversation
                  },
                })
              }
            } catch (inboxErr) {
              console.error('[Webhook] Error saving sent message to inbox:', inboxErr)
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
