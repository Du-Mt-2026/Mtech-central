import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getRunningCampaigns, processNextMessage, startCampaign, performBreakWindowReadingPresence } from '@/lib/sending-engine'
import { healthCheckDisconnectedChips, processQueue } from '@/lib/reconnection-queue'
import { processAllWarmingSessions, autoStartScheduledSessions } from '@/lib/warming-engine'

/**
 * Process messages for running campaigns.
 * Also checks for scheduled campaigns whose time has come and auto-starts them.
 *
 * TRIGGERED BY: cron-job.org (external free cron service)
 * SECURITY: Requires CRON_SECRET in header or query param to prevent unauthorized access.
 *
 * KEY IMPROVEMENT: Instead of processing just 1 message per campaign per cron tick,
 * this now uses a time-based approach — it processes messages in a loop
 * until the function is about to timeout (25 seconds max for Vercel serverless).
 */
export async function POST(request: NextRequest) {
  // Security: Verify CRON_SECRET to prevent unauthorized access
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const headerSecret = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace('Bearer ', '')
    const querySecret = new URL(request.url).searchParams.get('cron_secret')

    // Try to read from body without consuming it
    let bodyCronSecret: string | undefined
    try {
      const clonedRequest = request.clone()
      const body = await clonedRequest.json()
      bodyCronSecret = body.cron_secret
    } catch { /* no body or invalid JSON */ }

    const providedSecret = headerSecret || querySecret || bodyCronSecret

    if (providedSecret !== cronSecret) {
      return NextResponse.json(
        { error: 'Unauthorized — invalid or missing cron secret' },
        { status: 401 }
      )
    }
  }

  const FUNCTION_TIMEOUT_MS = 25_000 // cron-job.org timeout is 30s, leave 5s margin
  const startTime = Date.now()

  try {
    // 0. Warm up DB connection (Neon cold start can take 2-3s)
    // This simple query ensures the connection pool is ready
    try {
      await db.$queryRaw`SELECT 1`
    } catch {
      // DB connection failed — try one more time after a brief pause
      try {
        await new Promise(resolve => setTimeout(resolve, 1000))
        await db.$queryRaw`SELECT 1`
      } catch (dbError: any) {
        console.error('[ProcessAll] DB connection failed after retry:', dbError.message)
        return NextResponse.json(
          { error: 'Database connection failed', detail: dbError.message },
          { status: 503 }
        )
      }
    }

    // 1. Auto-start scheduled campaigns whose scheduledAt has passed
    let scheduledCampaigns: { id: string; name: string }[] = []
    try {
      const now = new Date()
      scheduledCampaigns = await db.campaign.findMany({
        where: {
          status: 'scheduled',
          scheduledAt: { lte: now },
        },
        select: { id: true, name: true },
      })
    } catch (error: any) {
      console.error('[ProcessAll] Error fetching scheduled campaigns:', error.message)
      // Continue — don't let this block processing
    }

    const startedCampaigns: { id: string; name: string; messageCount?: number }[] = []
    const startErrors: { id: string; name: string; error: string }[] = []

    for (const campaign of scheduledCampaigns) {
      try {
        const { messageCount } = await startCampaign(campaign.id)
        startedCampaigns.push({ id: campaign.id, name: campaign.name, messageCount })
      } catch (error: any) {
        startErrors.push({ id: campaign.id, name: campaign.name, error: error.message })
        console.error(`[ProcessAll] Failed to auto-start campaign ${campaign.name}:`, error.message)
      }
    }

    // 2. Get running campaigns (with stuck message recovery)
    let campaignIds: string[] = []
    try {
      campaignIds = await getRunningCampaigns()
    } catch (error: any) {
      console.error('[ProcessAll] Error getting running campaigns:', error.message)
      // Try to get campaigns without stuck message recovery
      try {
        const campaigns = await db.campaign.findMany({
          where: { status: 'running' },
          select: { id: true },
        })
        campaignIds = campaigns.map(c => c.id)
      } catch (fallbackError: any) {
        console.error('[ProcessAll] Fallback campaign fetch also failed:', fallbackError.message)
      }
    }

    if (campaignIds.length === 0 && startedCampaigns.length === 0) {
      // Still process warming sessions even when no campaigns are running
      // Note: This is the ONLY warming processing path when there are no campaigns.
      // When there ARE campaigns, warming is processed below (step 5) — don't process twice.
      try {
        const autoStarted = await autoStartScheduledSessions()
        if (autoStarted.length > 0) {
          console.debug(`[ProcessAll] Auto-started ${autoStarted.length} warming sessions`)
        }
        const warmingResult = await processAllWarmingSessions()
        if (warmingResult.errors > 0) {
          console.warn(`[ProcessAll] Warming had ${warmingResult.errors} errors across ${warmingResult.sessions} sessions (messagesSent=${warmingResult.messagesSent})`)
        }
        if (warmingResult.sessions > 0 || warmingResult.messagesSent > 0) {
          return NextResponse.json({
            message: 'No campaigns, but warming sessions processed',
            processed: 0,
            startedScheduled: 0,
            warming: warmingResult,
          })
        }
      } catch { /* non-critical */ }

      return NextResponse.json({
        message: 'No running or scheduled campaigns to process',
        processed: 0,
        startedScheduled: 0,
      })
    }

    const allResults: Array<{
      campaignId: string
      processed: number
      skipped: number
      reason?: string
      remaining: number
      error?: string
    }> = []
    let totalProcessed = 0
    let totalSkipped = 0

    // Process each campaign — v5.0 PARALLEL CHIP SENDING
    // Instead of one message per campaign per tick, we now loop within each
    // campaign to allow multiple chips to send in parallel. The loop continues
    // until no more chips are ready (all in cooldown/interval) or we hit the
    // function timeout. Each chip operates independently with its own nextSendAt.
    const MAX_CONSECUTIVE_SKIPS = 3 // Stop after 3 consecutive skips without progress

    for (const campaignId of campaignIds) {
      let campaignProcessed = 0
      let campaignSkipped = 0
      let lastReason = ''
      let campaignError: string | undefined
      let consecutiveSkips = 0
      const skipContactIds = new Set<string>()  // Contacts with unmet step delays — skip them to allow other chips to send

      // Inner loop: keep processing messages for this campaign while chips are ready
      while (Date.now() - startTime < FUNCTION_TIMEOUT_MS - 5000) {
        try {
          const result = await processNextMessage(campaignId, skipContactIds)

          if (result.processed) {
            campaignProcessed++
            totalProcessed++
            consecutiveSkips = 0 // Reset on successful send

            // STEP FOLLOW-UP: When a message is sent with a short delay (≤ 30s),
            // sleep for that delay so the chip becomes ready and step 2 can be
            // picked up within the same cron tick. Without this, the loop would
            // immediately try again, find "no_ready_chip" (chip.nextSendAt is in
            // the future), and break — forcing step 2 to wait for the next cron
            // tick (up to 60 seconds later).
            if (result.delayMs > 0 && result.delayMs <= 30_000) {
              const sleepMs = Math.max(result.delayMs, 1000) // At least 1 second
              console.debug(`[ProcessAll] Step follow-up: sleeping ${Math.round(sleepMs/1000)}s for chip to become ready`)
              await new Promise(resolve => setTimeout(resolve, sleepMs))
            }
          } else {
            campaignSkipped++
            totalSkipped++
            lastReason = result.reason || ''
            consecutiveSkips++

            // If this contact has an unmet step delay, add to skip list so we can try other contacts/chips
            if (result.skippedContactId) {
              skipContactIds.add(result.skippedContactId)
              consecutiveSkips = 0  // Don't count step_delay as a real skip
            }

            // Campaign-level blocks: stop trying this campaign entirely
            if (result.completed) break
            if (lastReason === 'paused') break
            if (lastReason.includes('outside_sending_window')) break
            if (lastReason.startsWith('break_')) break

            // No ready chips at all: stop trying this campaign
            if (lastReason === 'no_ready_chip') break

            // Chip-specific issues (hourly_limit, daily_limit, cooldown, chip_interval_wait):
            // Try again — other chips might be ready. But stop after too many consecutive skips.
            if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
              console.debug(`[ProcessAll] Campaign ${campaignId}: ${consecutiveSkips} consecutive skips (${lastReason}) — moving to next campaign`)
              break
            }
          }

          // If campaign was just completed, stop
          if (result.completed) break

        } catch (msgError: any) {
          // Individual message processing error — don't crash the whole loop
          console.error(`[ProcessAll] Error processing message for campaign ${campaignId}:`, msgError.message)
          campaignError = msgError.message
          campaignSkipped++
          totalSkipped++
          break // Stop on unexpected error
        }
      }

      allResults.push({
        campaignId,
        processed: campaignProcessed,
        skipped: campaignSkipped,
        reason: lastReason || undefined,
        remaining: 0,
        error: campaignError,
      })
    }

    // Calculate remaining pending messages for processed campaigns
    const processedCampaignIds = allResults.map(r => r.campaignId).filter(Boolean)
    try {
      if (processedCampaignIds.length > 0) {
        const remainingCounts = await db.message.groupBy({
          by: ['campaignId'],
          where: {
            campaignId: { in: processedCampaignIds },
            status: 'pending',
          },
          _count: true,
        })

        const remainingMap: Record<string, number> = {}
        for (const rc of remainingCounts) {
          if (rc.campaignId) remainingMap[rc.campaignId] = rc._count
        }

        for (const r of allResults) {
          r.remaining = remainingMap[r.campaignId] || 0
        }
      }
    } catch { /* non-critical */ }

    const totalRemaining = allResults.reduce((sum, r) => sum + (r.remaining || 0), 0)

    // 3. Process reconnection queue — check disconnected chips and reconnect them
    //    This runs on every cron tick to ensure disconnected chips are recovered
    let reconnectionResult = { checked: 0, queued: 0, alreadyQueued: 0 }
    try {
      // Process the existing queue first (pick next chip to reconnect)
      await processQueue()

      // v5.0 IMPROVEMENT: Always run health check on every tick.
      // Previously, health check only ran when the queue was empty. But after
      // Evolution Go crashes (e.g., OOM restart), ALL chips disconnect simultaneously.
      // If we wait until the queue is empty, it takes much longer to detect new
      // disconnections. The health check is cheap (one DB query + one API test)
      // and already deduplicates against the in-memory queue.
      reconnectionResult = await healthCheckDisconnectedChips()
    } catch (reconnectError: any) {
      console.error('[ProcessAll] Reconnection health check error:', reconnectError.message)
      // Non-critical — don't fail the whole cron
    }

    // 4. ANTI-BAN: Break window reading presence
    //    During break windows (lunch, meeting), randomly make chips appear online
    //    briefly as if checking WhatsApp — humans check their phones during breaks.
    //    This runs only when we're in a break window AND no messages are being sent.
    let breakReadingCount = 0
    if (totalProcessed === 0) {
      try {
        breakReadingCount = await performBreakWindowReadingPresence()
        if (breakReadingCount > 0) {
          console.debug(`[ProcessAll] Break window reading: ${breakReadingCount} chips appeared online briefly`)
        }
      } catch (breakError: any) {
        console.error('[ProcessAll] Break window reading error:', breakError.message)
        // Non-critical
      }
    }

    // 5. CHIP WARMING: Process running warming sessions
    //    Chips "talk to each other" to generate positive history on WhatsApp servers.
    //    Auto-start scheduled sessions whose time has come, then process messages.
    let warmingResult = { sessions: 0, messagesSent: 0, errors: 0 }
    try {
      // Auto-start scheduled warming sessions
      const autoStarted = await autoStartScheduledSessions()
      if (autoStarted.length > 0) {
        console.debug(`[ProcessAll] Auto-started ${autoStarted.length} warming sessions`)
      }

      // Process messages for running warming sessions
      if (Date.now() - startTime < FUNCTION_TIMEOUT_MS - 5000) {
        // Only run if we have at least 5s left before timeout
        warmingResult = await processAllWarmingSessions()
        if (warmingResult.messagesSent > 0) {
          console.debug(`[ProcessAll] Warming: ${warmingResult.messagesSent} messages sent across ${warmingResult.sessions} sessions`)
        }
      }
    } catch (warmingError: any) {
      console.error('[ProcessAll] Warming processing error:', warmingError.message)
      // Non-critical — don't fail the whole cron
    }

    const elapsedMs = Date.now() - startTime

    return NextResponse.json({
      processed: totalProcessed,
      skipped: totalSkipped,
      remaining: totalRemaining,
      campaigns: campaignIds.length,
      results: allResults,
      startedScheduled: startedCampaigns.length,
      startedCampaigns,
      startErrors: startErrors.length > 0 ? startErrors : undefined,
      reconnection: reconnectionResult,
      breakReading: breakReadingCount,
      warming: warmingResult,
      elapsedMs,
    })
  } catch (error: any) {
    console.error('[ProcessAll] Unhandled error:', error)
    return NextResponse.json(
      {
        error: error.message || 'Erro ao processar campanhas',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}

// Also support GET for cron-job.org (simpler to configure with URL params)
export async function GET(request: NextRequest) {
  return POST(request)
}
