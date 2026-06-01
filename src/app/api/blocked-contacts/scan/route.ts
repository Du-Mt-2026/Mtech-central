import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Scan for blocked contacts — automatically detects contacts who likely
 * blocked the sender number based on undelivered messages.
 *
 * Detection logic:
 *   1. Find all messages that are still "sent" (not delivered) after a time window
 *   2. Group by (chipId, contactPhone) to find contacts with multiple undelivered
 *   3. Apply confidence levels:
 *      - HIGH:   3+ undelivered messages to same contact across campaigns, 48h+ since first send
 *      - MEDIUM: 2 undelivered messages, 48h+ since first send
 *      - LOW:    1 undelivered message, 72h+ since send (could be phone off)
 *   4. Create/update BlockedContact records
 *   5. Auto-skip these contacts in future campaigns
 *
 * Query params:
 *   - hours: time window in hours (default: 48)
 *   - chipId: scan only this chip (optional)
 *   - dryRun: if true, returns results without saving (default: false)
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const hours = parseInt(searchParams.get('hours') || '48', 10)
    const chipId = searchParams.get('chipId') || undefined
    const dryRun = searchParams.get('dryRun') === 'true'

    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000)

    // Step 1: Find all messages that are "sent" (not delivered) and older than the cutoff
    // These are messages that left our server but never got a delivery receipt
    const undeliveredMessages = await db.message.findMany({
      where: {
        status: 'sent',
        sentAt: { lte: cutoffTime },
        deliveredAt: null,
        ...(chipId ? { chipId } : {}),
      },
      include: {
        contact: { select: { id: true, phone: true, name: true } },
        chip: { select: { id: true, name: true, phoneNumber: true } },
      },
      take: 5000, // Safety limit
    })

    console.log(`[BlockedScan] Found ${undeliveredMessages.length} undelivered messages older than ${hours}h`)

    // Step 2: Group by (chipId, contactPhone) to find repeat offenders
    const grouped = new Map<string, {
      chipId: string
      chipName: string
      chipPhone: string
      contactId: string | null
      contactPhone: string
      contactName: string
      undeliveredCount: number
      lastSentAt: Date
      firstSentAt: Date
    }>()

    for (const msg of undeliveredMessages) {
      const key = `${msg.chipId}::${msg.contact.phone}`

      if (grouped.has(key)) {
        const existing = grouped.get(key)!
        existing.undeliveredCount++
        if (msg.sentAt && msg.sentAt > existing.lastSentAt) {
          existing.lastSentAt = msg.sentAt
        }
        if (msg.sentAt && msg.sentAt < existing.firstSentAt) {
          existing.firstSentAt = msg.sentAt
        }
      } else {
        grouped.set(key, {
          chipId: msg.chipId,
          chipName: msg.chip.name,
          chipPhone: msg.chip.phoneNumber,
          contactId: msg.contact.id,
          contactPhone: msg.contact.phone,
          contactName: msg.contact.name,
          undeliveredCount: 1,
          lastSentAt: msg.sentAt || new Date(),
          firstSentAt: msg.sentAt || new Date(),
        })
      }
    }

    // Step 3: Apply confidence levels and create BlockedContact records
    const blocked: Array<{
      chipId: string
      chipName: string
      contactPhone: string
      contactName: string
      confidence: string
      undeliveredCount: number
      lastSentAt: Date
      firstSentAt: Date
      action: 'created' | 'updated' | 'already_blocked' | 'skipped_redelivered'
    }> = []

    // Also check: did this contact LATER receive messages from the same chip?
    // If yes, they're not blocked — just had phone off for a while.
    // We check if any message to this (chipId, contactPhone) has status 'delivered' or 'read'
    // that was sent AFTER the undelivered message.
    for (const [key, data] of grouped) {
      // Check if there are delivered/read messages to this contact from this chip
      // sent AFTER the last undelivered message
      const laterDelivered = await db.message.findFirst({
        where: {
          chipId: data.chipId,
          contact: { phone: data.contactPhone },
          status: { in: ['delivered', 'read'] },
          sentAt: { gte: data.lastSentAt },
        },
        select: { id: true },
      })

      if (laterDelivered) {
        // Contact received a LATER message — they're not blocked, just had phone off
        blocked.push({
          ...data,
          confidence: 'low',
          action: 'skipped_redelivered',
        })
        continue
      }

      // Determine confidence level
      const hoursSinceFirstSend = (Date.now() - data.firstSentAt.getTime()) / (1000 * 60 * 60)
      let confidence: string

      if (data.undeliveredCount >= 3 && hoursSinceFirstSend >= 48) {
        confidence = 'high'
      } else if (data.undeliveredCount >= 2 && hoursSinceFirstSend >= 48) {
        confidence = 'medium'
      } else if (hoursSinceFirstSend >= 72) {
        confidence = 'low'
      } else {
        // Not enough evidence yet
        continue
      }

      if (dryRun) {
        blocked.push({
          ...data,
          confidence,
          action: 'created',
        })
        continue
      }

      // Create or update BlockedContact
      try {
        const existing = await db.blockedContact.findUnique({
          where: {
            chipId_contactPhone: {
              chipId: data.chipId,
              contactPhone: data.contactPhone,
            },
          },
        })

        if (existing && !existing.unblockedAt) {
          // Already blocked — update stats if new evidence
          if (data.undeliveredCount > existing.undeliveredCount) {
            await db.blockedContact.update({
              where: { id: existing.id },
              data: {
                undeliveredCount: data.undeliveredCount,
                lastSentAt: data.lastSentAt,
                confidence: confidence === 'high' ? 'high' : existing.confidence,
              },
            })
            blocked.push({ ...data, confidence, action: 'updated' })
          } else {
            blocked.push({ ...data, confidence: existing.confidence, action: 'already_blocked' })
          }
        } else if (existing && existing.unblockedAt) {
          // Was unblocked before — don't re-block automatically (user decision)
          blocked.push({ ...data, confidence, action: 'already_blocked' })
        } else {
          // New blocked contact
          await db.blockedContact.create({
            data: {
              chipId: data.chipId,
              contactPhone: data.contactPhone,
              contactId: data.contactId,
              reason: 'undelivered',
              confidence,
              undeliveredCount: data.undeliveredCount,
              lastSentAt: data.lastSentAt,
              autoBlocked: true,
            },
          })
          blocked.push({ ...data, confidence, action: 'created' })
        }
      } catch (err: any) {
        console.error(`[BlockedScan] Error saving blocked contact ${data.contactPhone}:`, err.message)
        blocked.push({ ...data, confidence, action: 'already_blocked' })
      }
    }

    // Step 4: Also mark the pending messages for blocked contacts as 'failed'
    // so the campaign doesn't try to send to them
    let skippedCount = 0
    if (!dryRun) {
      const newlyBlocked = blocked.filter(b => b.action === 'created')
      for (const b of newlyBlocked) {
        const result = await db.message.updateMany({
          where: {
            chipId: b.chipId,
            contact: { phone: b.contactPhone },
            status: 'pending',
          },
          data: {
            status: 'failed',
            error: `Contato bloqueado — ${b.undeliveredCount} mensagens não entregues (confiança: ${b.confidence})`,
          },
        })
        skippedCount += result.count
      }
    }

    const summary = {
      scanned: undeliveredMessages.length,
      candidates: grouped.size,
      newlyBlocked: blocked.filter(b => b.action === 'created').length,
      updated: blocked.filter(b => b.action === 'updated').length,
      alreadyBlocked: blocked.filter(b => b.action === 'already_blocked').length,
      skippedRedelivered: blocked.filter(b => b.action === 'skipped_redelivered').length,
      pendingMessagesSkipped: skippedCount,
      dryRun,
      results: blocked,
    }

    console.log(`[BlockedScan] Complete: ${summary.newlyBlocked} new, ${summary.updated} updated, ${summary.skippedRedelivered} re-delivered (false positives), ${skippedCount} pending messages marked as failed`)

    return NextResponse.json(summary)
  } catch (error: any) {
    console.error('[BlockedScan] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
