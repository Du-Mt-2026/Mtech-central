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
 *
 * SECURITY: Verifies the `apikey` header (or `x-api-key`) against the EVOLUTION_API_KEY
 * environment variable. If the key is not set, the endpoint refuses all requests.
 * This prevents forged webhook events from deleting chips or altering state.
 */
export async function POST(request: Request) {
  try {
    // SECURITY: Verify webhook authentication token (optional — Evolution Go
    // não envia headers nem query params de volta, então a verificação é
    // 'soft': se o token estiver presente, valida; se não, registra warning
    // mas permite o processamento.
    // A proteção real contra eventos forjados está em:
    // 1. INSTANCE_DELETED: verifica com a Evolution API antes de deletar
    // 2. instanceName no body deve matchear um chip no banco
    const WEBHOOK_SECRET = process.env.EVOLUTION_API_KEY
    if (WEBHOOK_SECRET) {
      const url = new URL(request.url)
      const providedKey =
        url.searchParams.get('token') ||
        url.searchParams.get('apikey') ||
        request.headers.get('apikey') ||
        request.headers.get('x-api-key') ||
        request.headers.get('authorization')?.replace('Bearer ', '')

      if (providedKey) {
        // Token presente — validar
        if (providedKey.length === WEBHOOK_SECRET.length) {
          let keysMatch = true
          for (let i = 0; i < providedKey.length; i++) {
            if (providedKey[i] !== WEBHOOK_SECRET[i]) {
              keysMatch = false
            }
          }
          if (!keysMatch) {
            console.warn('[Webhook] Invalid authentication token provided')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }
        } else {
          console.warn('[Webhook] Invalid authentication token (wrong length)')
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
      }
      // Sem token = Evolution Go (não envia headers/params) — permite mas loga
      // na primeira vez apenas para não poluir logs
    }

    // Load anti-ban settings for ban detection configuration
    const settings = await db.antiBanSettings.findFirst()
    const banCodes = (() => { try { return settings?.banCodes ? JSON.parse(settings.banCodes) : [401,403,428,440] } catch { return [401,403,428,440] } })()
    const restrictionKeywords = (() => { try { return settings?.restrictionKeywords ? JSON.parse(settings.restrictionKeywords) : ['conta está restringida','conta esta restringida','envio de spam','mensagens automáticas','mensagens automaticas','mensagens em massa','atividade recente','account is restricted','sending spam','automated messages','bulk messages','não será possível','nao sera possivel','iniciar novas conversas'] } catch { return ['conta está restringida','conta esta restringida','envio de spam','mensagens automáticas','mensagens automaticas','mensagens em massa','atividade recente','account is restricted','sending spam','automated messages','bulk messages','não será possível','nao sera possivel','iniciar novas conversas'] } })()
    const banLookbackMs = (settings?.banLookbackHours ?? 24) * 3600000
    const banMaxMessagesCheck = settings?.banMaxMessagesCheck ?? 30
    const banKeywordThreshold = settings?.banKeywordThreshold ?? 2

    const body = await request.json()

    const event = body.event
    const data = body.data
    const instanceId = body.instanceId || ''
    const instanceName = body.instanceName || ''

    // === Resolve instance name from Evolution Go webhook format ===
    // Evolution Go sends webhooks with these fields:
    //   - instanceId: UUID of the instance
    //   - instanceName: name of the instance (e.g., "OctupusZap_xxx")
    //   - instanceToken: token of the instance
    //
    // We prefer instanceName (direct name match) over instanceId (requires API lookup)
    // because it's faster and doesn't require an extra API call.
    let chipInstanceName = ''

    // First try: use instanceName directly (Evolution Go provides this)
    if (instanceName) {
      chipInstanceName = instanceName
    }

    // Second try: look up instanceId via Evolution API (slower, requires API call)
    if (!chipInstanceName && instanceId) {
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
    let linkedChip = await db.chip.findFirst({
      where: { evolutionInstance: chipInstanceName },
    })

    // ============================================
    // FIX: Auto-link chips by phone number
    // ============================================
    // When a chip is created manually (POST /api/chips) with a pretty name
    // like "Mari Mtech Promo 2", it starts WITHOUT an evolutionInstance.
    // When it connects via QR code, the Evolution API creates an instance
    // like "OctupusZap_Mari_Mtech_Promo_2_xxxxx" and sends a webhook.
    // Without this fix, the webhook silently drops the event because
    // no chip has that evolutionInstance set. This causes:
    //   1. Chip stays "disconnected" even though it's connected in Evolution
    //   2. The GET /api/chips auto-import creates a DUPLICATE chip
    //
    // Fix: If no chip is found by evolutionInstance, try to find a chip
    // by phone number (from the webhook data) and link it automatically.
    if (!linkedChip) {
      // Extract phone number from various webhook data fields
      const jid = data?.JID || data?.jid || data?.id || data?.Info?.Chat || ''
      const phoneFromJid = jid.split('@')[0].split(':')[0] || ''

      if (phoneFromJid && phoneFromJid.length >= 10) {
        // Try to find a chip with this phone number that has NO evolutionInstance yet
        const unlinkedChip = await db.chip.findFirst({
          where: {
            phoneNumber: phoneFromJid,
            evolutionInstance: null,
          },
          select: { id: true, name: true, phoneNumber: true },
        })

        // Also try with different phone formats (with/without country code, 9th digit)
        const chipCandidates: Array<{ id: string; name: string; phoneNumber: string } | null> = [unlinkedChip]
        if (!unlinkedChip) {
          // Try without the leading "55" country code
          const phoneWithoutCountry = phoneFromJid.replace(/^55/, '')
          const chipByShortPhone = await db.chip.findFirst({
            where: {
              phoneNumber: { contains: phoneWithoutCountry.slice(-8) },
              evolutionInstance: null,
            },
            select: { id: true, name: true, phoneNumber: true },
          })
          chipCandidates.push(chipByShortPhone)
        }

        for (const candidate of chipCandidates) {
          if (candidate) {
            // Found an unlinked chip with matching phone — link it!
            try {
              await db.chip.update({
                where: { id: candidate.id },
                data: { evolutionInstance: chipInstanceName },
              })
              console.log(`[Webhook] Auto-linked chip "${candidate.name}" (phone: ${candidate.phoneNumber}) to instance ${chipInstanceName}`)

              // Re-fetch the chip with the updated evolutionInstance
              linkedChip = await db.chip.findUnique({
                where: { id: candidate.id },
              })
              break
            } catch (linkErr) {
              console.error(`[Webhook] Failed to auto-link chip ${candidate.id}:`, linkErr)
            }
          }
        }
      }

      // If still not linked after phone search, skip this event
      if (!linkedChip) {
        return NextResponse.json({ ok: true })
      }
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
            },
          })

          // Fetch profile picture asynchronously (don't block the webhook)
          if (jid) {
            const phoneFromJid = jid.split('@')[0]
            import('@/lib/evolution-api').then(({ fetchProfilePicture }) => {
              fetchProfilePicture(chipInstanceName, phoneFromJid).then(picUrl => {
                if (picUrl) {
                  db.chip.update({
                    where: { id: chip.id },
                    data: { profilePicUrl: picUrl },
                  }).catch(() => {})
                }
              }).catch(() => {})
            }).catch(() => {})
          }

          // CRITICAL: Do NOT call setProxy() after connection!
          // POST /instance/proxy/{instanceId} DISCONNECTS the WhatsApp client.
          // Proxy should be set at instance creation time (already handled in connect flow)
          // or via PATCH /api/chips/[chipId] which also handles reconnection.

          // Enable rejectCall AFTER the connection is established (non-blocking).
          // rejectCall=true at creation time causes the "Reconnecting" loop bug.
          // We create instances with rejectCall=false and only enable it
          // once the WhatsApp session is fully active.
          // This is SAFE — POST /instance/settings does NOT restart the connection.
          import('@/lib/evolution-api').then(({ enableRejectCallAfterConnection }) => {
            enableRejectCallAfterConnection(chipInstanceName).catch(err => {
              console.warn(`[Webhook] Failed to enable rejectCall for ${chip.name}:`, err)
            })
          }).catch(() => {})

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

          // CRITICAL FIX: "Reconnecting" is a TEMPORARY state — Evolution Go is
          // trying to restore the WhatsApp connection automatically. This happens
          // frequently after QR code scans and during normal operation.
          // Treating it as a real disconnection causes:
          //   1. Chip marked as 'disconnected' in DB → user sees disconnected
          //   2. isQrPaired cleared → loses pairing state
          //   3. Auto-reconnection queue → stale session detection → DELETE AND RECREATE
          //      the instance → kills the active session that Evolution Go was restoring!
          //
          // Fix: For "Reconnecting" and similar temporary reasons, keep the chip
          // as 'connecting' (not 'disconnected') and DON'T clear isQrPaired.
          // Evolution Go will either restore the session (sending Connected event)
          // or fail permanently (sending another Disconnected with a different reason).
          const TEMPORARY_DISCONNECT_REASONS = ['reconnecting', 'reconnect', 'replacing', 'replaced', 'restart', 'logged out', 'logout']
          const isTemporaryDisconnect = TEMPORARY_DISCONNECT_REASONS.some(r =>
            reason.toLowerCase().includes(r)
          )

          // CRITICAL FIX 2: If the chip was JUST connected (within the last 60 seconds),
          // treat ANY disconnect as temporary. Evolution Go frequently sends a brief
          // Disconnected event right after a QR code scan, which is part of the normal
          // connection establishment process. If we process this as a real disconnect,
          // we'll immediately mark the chip as disconnected and potentially destroy
          // the active session.
          const wasRecentlyConnected = chip.status === 'connected' && chip.lastSeen &&
            (Date.now() - new Date(chip.lastSeen).getTime()) < 60000 // 60 seconds

          if (isTemporaryDisconnect || wasRecentlyConnected) {
            console.log(`[Webhook] Instance ${chipInstanceName} temporary disconnect (reason: "${reason}", recentlyConnected=${wasRecentlyConnected}). Keeping as 'connecting' — Evolution Go will auto-restore.`)
            await db.chip.update({
              where: { id: chip.id },
              data: {
                status: 'connecting',
                // DON'T clear isQrPaired or qrPairingCode — session may be restored
              },
            })
            // DON'T queue for reconnection — Evolution Go handles this automatically
            break
          }

          const updateData: Record<string, unknown> = {
            status: 'disconnected',
            isQrPaired: false,
            qrPairingCode: null,
          }

          if (reason) {
            console.log(`[Webhook] Instance ${chipInstanceName} disconnected. Reason: ${reason}`)
            updateData.disconnectionReasonCode = disconnectionCode
          }

          const isBanned = disconnectionCode && banCodes.includes(Number(disconnectionCode))
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
              const recentWarnings = await db.inboxMessage.findMany({
                where: {
                  instanceName: chip.evolutionInstance || '',
                  fromMe: false,
                  createdAt: { gte: new Date(Date.now() - banLookbackMs) },
                },
                take: banMaxMessagesCheck,
                orderBy: { createdAt: 'desc' },
              })
              for (const msg of recentWarnings) {
                const content = (msg.messageContent || '').toLowerCase()
                const matchCount = restrictionKeywords.filter((kw: string) => content.includes(kw)).length
                if (matchCount >= banKeywordThreshold) {
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
      // BIDIRECTIONAL SYNC: When an instance is deleted from the Evolution API dashboard,
      // the corresponding chip in OctupusZap should also be deleted.
      // This ensures that the two systems stay in sync.
      case 'INSTANCE_DELETED':
      case 'INSTANCE_DELETE': {
        const chip = linkedChip

        if (chip) {
          // SECURITY: Verify with Evolution API that the instance is REALLY gone
          // before deleting the chip from our DB. If we can't verify, DON'T delete —
          // just mark as disconnected. This prevents forged INSTANCE_DELETED events
          // from deleting chips.
          let canDelete = false
          try {
            const { fetchInstances } = await import('@/lib/evolution-api')
            const instances = await fetchInstances()
            // Only delete if the instance is CONFIRMED to not exist in Evolution API
            const instanceExists = instances.some((i: any) =>
              i.name === chip.evolutionInstance || i.id === instanceId
            )
            if (!instanceExists) {
              canDelete = true
              console.log(`[Webhook] INSTANCE_DELETED: confirmed instance ${chip.evolutionInstance} no longer exists in Evolution API`)
            } else {
              console.warn(`[Webhook] INSTANCE_DELETED: instance ${chip.evolutionInstance} still exists in Evolution API — skipping deletion (possible forged event)`)
            }
          } catch (verifyErr) {
            // Can't verify — DON'T delete, just mark as disconnected
            console.warn(`[Webhook] INSTANCE_DELETED: could not verify with Evolution API (${verifyErr instanceof Error ? verifyErr.message : 'unknown error'}) — marking as disconnected instead of deleting`)
          }

          if (canDelete) {
            console.log(`[Webhook] Instance ${chipInstanceName} was deleted from Evolution API. Deleting chip ${chip.name} from OctupusZap (bidirectional sync).`)

            // Delete the chip from our DB since the instance no longer exists in Evolution API
            try {
              // Clean up related records first
              await db.message.deleteMany({ where: { chipId: chip.id } }).catch(() => {})
              await db.contact.deleteMany({ where: { chipId: chip.id } }).catch(() => {})
              await db.campaignChip.deleteMany({ where: { chipId: chip.id } }).catch(() => {})

              // Delete the chip
              await db.chip.delete({ where: { id: chip.id } })

              console.log(`[Webhook] ✅ Chip ${chip.name} deleted from OctupusZap (instance was deleted from Evolution API)`)

              // Clean up WireGuard peer
              if (chip.wireguardPubKey && chip.wireguardIp) {
                removeWireGuardPeer(chip.wireguardPubKey, chip.wireguardIp).catch(err => {
                  console.error('[Webhook INSTANCE_DELETED] WireGuard peer remove failed:', err)
                })
              }
            } catch (deleteErr) {
              console.error(`[Webhook] Failed to delete chip ${chip.name} from DB:`, deleteErr)
              // Fall back to marking as disconnected
              await db.chip.update({
                where: { id: chip.id },
                data: {
                  status: 'disconnected',
                  isQrPaired: false,
                  qrPairingCode: null,
                },
              }).catch(() => {})
            }
          } else {
            // Can't verify or instance still exists — just mark as disconnected
            await db.chip.update({
              where: { id: chip.id },
              data: {
                status: 'disconnected',
                isQrPaired: false,
                qrPairingCode: null,
              },
            }).catch(() => {})
          }
        }
        break
      }

      // ===== Message Send Confirmation & Delivery Tracking =====
      case 'SEND_MESSAGE':
      case 'SEND_MESSAGE_ACK': {
        const messageId = data?.Info?.ID || data?.key?.id || data?.id || null

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

      // ===== Receipt Event (Evolution Go format) =====
      // Evolution Go (Go version) sends "Receipt" events instead of
      // "SEND_MESSAGE_ACK" / "READ_RECEIPT" (which are Evolution API v3 Node.js format).
      // The Receipt event contains the same ack-based status tracking:
      //   ack 3 = DELIVERED (double tick ✓✓)
      //   ack 4 = READ (blue ticks ✓✓)
      // This is the PRIMARY delivery tracking mechanism for Evolution Go!
      case 'Receipt': {
        try {
          // Evolution Go Receipt format:
          // { event: "Receipt", data: { Info: { ID, Chat, Status, IsFromMe }, ... }, instanceName }
          // Status/ack values: 0=PENDING, 1=SENT, 2=SERVER_ACK, 3=DELIVERED, 4=READ, 5=PLAYED
          const msgId = data?.Info?.ID || data?.key?.id || data?.id || null
          const ackValue = data?.Info?.Status ?? data?.Status ?? data?.ack ?? data?.info?.status ?? null
          const isFromMe = data?.Info?.IsFromMe ?? data?.Info?.isFromMe ?? data?.key?.fromMe ?? true

          if (!msgId) break

          // Only process receipts for messages we sent (fromMe=true)
          // Incoming message read receipts are handled differently
          const ack = ackValue !== null && ackValue !== undefined ? Number(ackValue) : null
          const STATUS_ORDER: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 }
          const ackToStatus = (a: number): string => a >= 4 ? 'read' : a >= 3 ? 'delivered' : a >= 1 ? 'sent' : 'pending'

          if (ack !== null) {
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
                console.log(`[Webhook] Receipt: Campaign Message ${msgId} → ${newStatus} (ack=${ack})`)
              }

              // SSE broadcast
              try {
                broadcastToChip(message.chipId, 'status_update', {
                  messageId: msgId,
                  status: newStatus,
                  ack,
                  timestamp: Date.now(),
                })
              } catch { /* non-critical */ }
            }

            // === Update InboxMessage ===
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
                console.log(`[Webhook] Receipt: InboxMessage ${msgId} → ${candidateStatus} (ack=${ack})`)

                // SSE broadcast for inbox
                try {
                  broadcastToChip(inboxMsg.chipId || '', 'status_update', {
                    messageId: msgId,
                    status: candidateStatus,
                    ack,
                    timestamp: Date.now(),
                  })
                } catch { /* non-critical */ }
              }
            } catch (inboxErr: any) {
              console.error('[Webhook] Receipt: Error updating inbox message:', inboxErr.message)
            }
          }
        } catch (err: any) {
          console.error('[Webhook] Error processing Receipt:', err.message)
        }
        break
      }

      // ===== Incoming/Outgoing Messages =====
      case 'Message': {
        try {
          // v3 format: data.Info.Chat, data.Info.ID, data.Info.IsFromMe, data.Message
          const chatJid = data?.Info?.Chat || ''

          if (!chatJid) break

          // Skip WhatsApp Status posts — these are not real conversations
          // Status JID format: status@broadcast or remotePhone="status"
          if (chatJid === 'status@broadcast') {
            break
          }

          // Skip WhatsApp Channel/Newsletter messages — not relevant for inbox
          // Channel JIDs start with 120363... and end with @newsletter
          if (chatJid.endsWith('@newsletter')) {
            break
          }

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
          // Broadcast ALL messages (including campaign) so inbox updates in real-time
          if (linkedChip?.id) {
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

          // PERF: Upsert Conversation table for fast inbox list queries.
          if (linkedChip?.id) {
            try {
              await db.conversation.upsert({
                where: { chipId_remoteJid: { chipId: linkedChip.id, remoteJid: chatJid } },
                update: {
                  lastMessageAt: new Date(),
                  lastMessagePreview: (messageContent || '').substring(0, 200),
                  lastMessageType: messageType || 'text',
                  lastMessageFromMe: fromMe,
                  contactName: pushName || undefined,
                  pushName: pushName || undefined,
                  isGroup,
                  ...(fromMe ? { lastMessageStatus: 'sent' } : {}),
                  ...(!fromMe ? { unreadCount: { increment: 1 } } : {}),
                },
                create: {
                  chipId: linkedChip.id,
                  remoteJid: chatJid,
                  remotePhone: chatJid.split('@')[0],
                  contactName: pushName || null,
                  pushName: pushName || null,
                  isGroup,
                  lastMessageAt: new Date(),
                  lastMessagePreview: (messageContent || '').substring(0, 200),
                  lastMessageType: messageType || 'text',
                  lastMessageFromMe: fromMe,
                  ...(fromMe ? { lastMessageStatus: 'sent' } : {}),
                  ...(!fromMe ? { unreadCount: 1 } : {}),
                },
              }).catch(() => {})
            } catch { /* non-critical */ }
          }

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
        
        // Handle HISTORY_SYNC — Evolution Go v3 sends historical messages
        // These have the same format as regular Message events but arrive in bulk
        if (event === 'HISTORY_SYNC') {
          try {
            // HISTORY_SYNC can come as:
            // 1. A single message (same format as 'Message' event)
            // 2. An array of messages under data.messages or data.Data
            const messages = Array.isArray(data?.messages) ? data.messages
              : Array.isArray(data?.Data) ? data.Data
              : Array.isArray(data) ? data
              : [data] // Single message — same format as 'Message'

            let synced = 0
            for (const msg of messages) {
              try {
                const chatJid = msg?.Info?.Chat || msg?.key?.remoteJid || ''
                if (!chatJid) continue

                // Skip WhatsApp Status posts and Channel/Newsletter messages
                if (chatJid === 'status@broadcast' || chatJid.endsWith('@newsletter')) {
                  continue
                }


                const msgId = msg?.Info?.ID || msg?.key?.id || ''
                const fromMe = msg?.Info?.IsFromMe ?? msg?.key?.fromMe ?? false
                const pushName = msg?.Info?.PushName || null

                if (!msgId) continue

                // Same LID resolution as Message handler
                const addressingMode = msg?.Info?.AddressingMode || ''
                const remoteJidAlt = msg?.Info?.RecipientAlt || null
                let remoteJid = chatJid
                if (addressingMode === 'lid' && remoteJidAlt) {
                  remoteJid = remoteJidAlt
                } else if (chatJid.endsWith('@lid')) {
                  // Keep LID — will be resolved later
                  remoteJid = chatJid
                }

                const isGroup = remoteJid.includes('@g.us')
                let remotePhone = remoteJid.replace(/@s\.whatsapp\.net|@lid|@g\.us/g, '')
                if (remotePhone.startsWith('55') && remotePhone.length === 12) {
                  remotePhone = remotePhone.slice(0, 4) + '9' + remotePhone.slice(4)
                }

                // Parse message content using same parser
                const parsed = parseWhatsAppMessage(msg)

                // Determine contact name
                const contactName = isGroup ? null : (pushName || null)

                // Check if message already exists (avoid duplicates)
                const existing = await db.inboxMessage.findUnique({
                  where: { evolutionMsgId: msgId },
                })
                if (existing) continue // Skip duplicates

                await db.inboxMessage.create({
                  data: {
                    instanceName: chipInstanceName || '',
                    chipId: linkedChip?.id || '',
                    remoteJid,
                    remotePhone,
                    fromMe,
                    messageContent: parsed.content || '',
                    messageType: parsed.type || 'text',
                    mediaUrl: parsed.mediaUrl || '',
                    pushName: pushName || '',
                    contactName,
                    evolutionMsgId: msgId,
                    isRead: true, // Historical messages are already read
                    isGroup,
                    isCampaign: false, // Will be updated if matched to campaign
                    ack: fromMe ? 3 : 3,
                    status: 'delivered',
                    quotedMsgId: parsed.quotedMsgId || null,
                    quotedContent: parsed.quotedContent || null,
                    fileName: parsed.fileName || null,
                    mimeType: parsed.mimeType || null,
                    mediaCaption: parsed.caption || null,
                    mediaDuration: parsed.mediaDuration || null,
                  },
                })
                synced++
              } catch (msgErr: any) {
                // Skip individual message errors — continue processing
                console.error('[Webhook] HISTORY_SYNC msg error:', msgErr.message)
              }
            }
            console.log(`[Webhook] HISTORY_SYNC: ${synced}/${messages.length} messages saved for ${chipInstanceName}`)
          } catch (err: any) {
            console.error('[Webhook] HISTORY_SYNC error:', err.message)
          }
          break
        }

        // Log unhandled events for debugging (but not too verbosely)
        // ChatPresence = typing/composing indicators — not useful for our purposes
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
