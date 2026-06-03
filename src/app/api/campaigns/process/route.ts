import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { processNextMessage, startCampaign } from '@/lib/sending-engine'

/**
 * POST /api/campaigns/process
 * Process messages for a specific campaign or all running campaigns.
 * Called continuously by the frontend to keep campaigns running in real-time.
 *
 * Body: { campaignId?: string } — if provided, processes only that campaign; otherwise all running.
 *
 * This is the PRIMARY sending mechanism. The Vercel Cron is a backup.
 *
 * v5.0 PARALLEL CHIPS: After a successful send, we DON'T wait the full per-chip delay.
 * The delay is already persisted in chip.nextSendAt, so that chip won't be selected again.
 * We immediately try the next message (likely for a different chip that IS ready).
 * This allows multiple chips to send in parallel within the same campaign.
 *
 * Campaign-level blocks (sending window, break window, no_ready_chip, paused) stop the loop.
 * Chip-specific blocks (cooldown, interval, hourly/daily limit) are just skipped — other
 * chips may be ready to send.
 */
export async function POST(request: Request) {
  // Load settings for configurable timeouts and message limits
  const settings = await db.antiBanSettings.findFirst()
  const FUNCTION_TIMEOUT_MS = settings?.functionTimeoutMs ?? 50_000
  const maxMessagesPerInvocation = settings?.maxMessagesPerInvocation ?? 10
  const minRemainingTimeMs = settings?.minRemainingTimeMs ?? 3000
  const startTime = Date.now()

  try {
    let body: any = {}
    try { body = await request.json() } catch { /* no body */ }

    // 1. Auto-start scheduled campaigns whose time has come
    const now = new Date()
    const scheduledCampaigns = await db.campaign.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: now },
      },
      select: { id: true, name: true },
    })

    const startedCampaigns: string[] = []
    for (const campaign of scheduledCampaigns) {
      try {
        await startCampaign(campaign.id)
        startedCampaigns.push(campaign.id)
        console.log(`[Process] Auto-started scheduled campaign: ${campaign.name}`)
      } catch (error: any) {
        console.error(`[Process] Failed to auto-start campaign ${campaign.name}:`, error.message)
      }
    }

    // 2. Get campaign IDs to process
    let campaignIds: string[] = []
    if (body.campaignId) {
      // Process specific campaign
      const campaign = await db.campaign.findUnique({
        where: { id: body.campaignId },
        select: { id: true, status: true },
      })
      if (campaign && (campaign.status === 'running' || campaign.status === 'paused')) {
        campaignIds = [campaign.id]
      }
    } else {
      // Process all running campaigns
      const campaigns = await db.campaign.findMany({
        where: { status: 'running' },
        select: { id: true },
      })
      campaignIds = campaigns.map(c => c.id)
    }

    if (campaignIds.length === 0 && startedCampaigns.length === 0) {
      return NextResponse.json({
        processed: 0,
        remaining: 0,
        campaigns: 0,
        message: 'Nenhuma campanha em execução',
      })
    }

    // 3. Process messages in a time-based loop
    // v5.0 PARALLEL CHIPS: Inner loop keeps processing while chips are ready.
    // After a successful send, we DON'T wait the per-chip delay — we immediately
    // try the next message (which will likely be for a different ready chip).
    // The per-chip delay is persisted in chip.nextSendAt, so that chip is excluded
    // from the next query automatically.
    let totalProcessed = 0
    let totalFailed = 0
    let totalRemaining = 0
    let lastReason = ''
    const allEvents: Array<{ type: string; chipName?: string; campaignName?: string; reason?: string }> = []
    const MAX_CONSECUTIVE_SKIPS = 3 // Stop after 3 consecutive skips without progress

    for (const campaignId of campaignIds) {
      let consecutiveSkips = 0

      // Inner loop: keep processing messages for this campaign while chips are ready
      while (Date.now() - startTime < FUNCTION_TIMEOUT_MS - minRemainingTimeMs && consecutiveSkips < MAX_CONSECUTIVE_SKIPS) {
        const result = await processNextMessage(campaignId)

        if (result.processed) {
          totalProcessed++
          consecutiveSkips = 0 // Reset on successful send
        } else {
          lastReason = result.reason || ''
          consecutiveSkips++
        }

        // Collect events for frontend notifications
        if (result.events?.length) {
          // Look up campaign name for events that don't have it
          for (const evt of result.events) {
            if (!evt.campaignName) {
              const c = await db.campaign.findUnique({ where: { id: campaignId }, select: { name: true } })
              evt.campaignName = c?.name || 'Desconhecida'
            }
          }
          allEvents.push(...result.events)
        }

        totalRemaining = result.remaining >= 0 ? result.remaining : totalRemaining

        // If campaign is complete, stop
        if (result.completed) break

        // ============================================
        // v5.0: Campaign-level blocks vs chip-specific blocks
        // ============================================
        // Campaign-level blocks: stop trying this campaign entirely
        //   - outside_sending_window: no sends allowed right now
        //   - break_*: in a break window (lunch, meeting)
        //   - paused: campaign was paused
        //   - no_ready_chip: ALL chips are in cooldown/interval/disconnected
        //
        // Chip-specific blocks: just skip, other chips may be ready
        //   - chip_interval_wait: this chip's nextSendAt not reached
        //   - cooldown: this chip is in cooldown
        //   - hourly_limit: this chip hit hourly limit
        //   - daily_limit: this chip hit daily limit (messages reassigned to other chips)
        //   - disconnected_reassigned: chip disconnected, messages moved to other chips

        if (!result.processed) {
          // Campaign-level blocks — stop this campaign entirely
          if (lastReason.includes('outside_sending_window')) break
          if (lastReason.startsWith('break_')) break
          if (lastReason === 'paused') break
          if (lastReason === 'no_ready_chip') break
          if (lastReason.includes('auto_paused_no_campaign_chips')) break

          // whatsapp_warning_detected — this is serious, pause the campaign
          if (lastReason.includes('whatsapp_warning_detected')) break

          // Campaign-level interval (legacy, shouldn't happen in v5.0 but safety net)
          if (lastReason === 'campaign_interval_wait') break

          // Chip-specific issues: DON'T break — other chips may be ready
          // The consecutiveSkips counter will stop us after MAX_CONSECUTIVE_SKIPS
          // chip_interval_wait, cooldown, hourly_limit, daily_limit, disconnected_reassigned
          // are all chip-specific and shouldn't block the entire campaign
        }

        // ============================================
        // v5.0: Smart delay handling for parallel chips
        // ============================================
        // After a SUCCESSFUL send:
        //   - DON'T wait the full per-chip delay (60-148s)
        //   - The delay is already persisted in chip.nextSendAt
        //   - The next processNextMessage call will skip this chip
        //   - Instead, wait just 1-2 seconds (anti-ban stagger) and try next chip
        //
        // After a SKIPPED send (chip-specific issue):
        //   - Wait just 1 second and try next chip
        //
        // After a SKIPPED send (step delay, waiting for previous step):
        //   - Wait the actual delay (it's contact-specific, not chip-specific)
        if (result.delayMs > 0) {
          if (result.processed) {
            // v5.0: Successful send — DON'T wait the full per-chip delay!
            // Just a short stagger (1-3s) to avoid hammering the DB/API
            const staggerMs = 1000 + Math.floor(Math.random() * 2000)
            const remainingTime = FUNCTION_TIMEOUT_MS - (Date.now() - startTime)
            if (remainingTime < minRemainingTimeMs) break
            const waitTime = Math.min(staggerMs, remainingTime - minRemainingTimeMs)
            if (waitTime > 0) {
              await new Promise(resolve => setTimeout(resolve, waitTime))
            }
          } else if (lastReason.startsWith('step_delay_') || lastReason === 'waiting_for_previous_step' || lastReason === 'waiting_for_sending_step') {
            // Step delay is contact-specific — must wait it (or as much as we can)
            const remainingTime = FUNCTION_TIMEOUT_MS - (Date.now() - startTime)
            if (remainingTime < minRemainingTimeMs) break
            const waitTime = Math.min(result.delayMs, remainingTime - minRemainingTimeMs)
            if (waitTime > 0) {
              console.log(`[Process] Waiting ${Math.round(waitTime/1000)}s (step delay, reason: ${lastReason})`)
              await new Promise(resolve => setTimeout(resolve, waitTime))
            }
          } else {
            // Chip-specific skip (cooldown, interval, limit) — short delay only
            const remainingTime = FUNCTION_TIMEOUT_MS - (Date.now() - startTime)
            if (remainingTime < minRemainingTimeMs) break
            const shortWait = Math.min(result.delayMs, 2000, remainingTime - minRemainingTimeMs)
            if (shortWait > 0) {
              await new Promise(resolve => setTimeout(resolve, shortWait))
            }
          }
        }
      }
    }

    const elapsedMs = Date.now() - startTime

    return NextResponse.json({
      processed: totalProcessed,
      failed: totalFailed,
      remaining: totalRemaining,
      campaigns: campaignIds.length,
      startedScheduled: startedCampaigns.length,
      lastReason: lastReason || undefined,
      elapsedMs,
      events: allEvents.length > 0 ? allEvents : undefined,
    })
  } catch (error: any) {
    console.error('[Process] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao processar campanhas' },
      { status: 500 }
    )
  }
}

// GET for quick status check
export async function GET(request: Request) {
  const campaigns = await db.campaign.findMany({
    where: { status: 'running' },
    select: { id: true, name: true },
  })

  const scheduled = await db.campaign.findMany({
    where: { status: 'scheduled' },
    select: { id: true, name: true, scheduledAt: true },
  })

  return NextResponse.json({
    running: campaigns.length,
    scheduled: scheduled.length,
    campaigns,
    scheduledCampaigns: scheduled,
  })
}
