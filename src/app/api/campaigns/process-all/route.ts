import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getRunningCampaigns, processNextMessage, startCampaign } from '@/lib/sending-engine'

/**
 * Process messages for running campaigns.
 * Also checks for scheduled campaigns whose time has come and auto-starts them.
 *
 * TRIGGERED BY: cron-job.org (external free cron service)
 * SECURITY: Requires CRON_SECRET in header or query param to prevent unauthorized access.
 *
 * KEY IMPROVEMENT: Instead of processing just 1 message per campaign per cron tick,
 * this now uses a time-based approach — it processes messages in a loop
 * until the function is about to timeout (50 seconds max for Vercel).
 * This means more messages get processed per cron invocation while still
 * respecting anti-ban intervals.
 */
export async function POST(request: NextRequest) {
  // Security: Verify CRON_SECRET to prevent unauthorized access
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const headerSecret = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace('Bearer ', '')
    const querySecret = new URL(request.url).searchParams.get('cron_secret')
    const bodySecret: string | undefined = undefined

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
    // 1. Auto-start scheduled campaigns whose scheduledAt has passed
    const now = new Date()
    const scheduledCampaigns = await db.campaign.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: now },
      },
      select: { id: true, name: true },
    })

    const startedCampaigns: { id: string; name: string; messageCount?: number }[] = []
    const startErrors: { id: string; name: string; error: string }[] = []

    for (const campaign of scheduledCampaigns) {
      try {
        const { messageCount } = await startCampaign(campaign.id)
        startedCampaigns.push({ id: campaign.id, name: campaign.name, messageCount })
        console.log(`[ProcessAll] Auto-started scheduled campaign: ${campaign.name} (${messageCount} messages)`)
      } catch (error: any) {
        startErrors.push({ id: campaign.id, name: campaign.name, error: error.message })
        console.error(`[ProcessAll] Failed to auto-start campaign ${campaign.name}:`, error.message)
      }
    }

    // 2. Process running campaigns
    const campaignIds = await getRunningCampaigns()

    if (campaignIds.length === 0 && startedCampaigns.length === 0) {
      return NextResponse.json({
        message: 'No running or scheduled campaigns to process',
        processed: 0,
        startedScheduled: 0,
      })
    }

    const allResults: any[] = []
    let totalProcessed = 0
    let totalSkipped = 0

    // Process each campaign — try to send multiple messages per campaign per tick
    // CONTACT-BY-CONTACT: when a step delay is pending, wait and process the next step
    // for the same contact instead of skipping to another contact.
    for (const campaignId of campaignIds) {
      let campaignProcessed = 0
      let campaignSkipped = 0
      let lastReason = ''

      // Process up to 10 messages per campaign per tick
      // (increased from 5 to handle contact-by-contact with multiple steps)
      for (let attempt = 0; attempt < 10; attempt++) {
        // Check if we're about to timeout
        if (Date.now() - startTime > FUNCTION_TIMEOUT_MS) {
          console.log(`[ProcessAll] Approaching function timeout, stopping. Processed ${totalProcessed} messages.`)
          break
        }

        const result = await processNextMessage(campaignId)

        if (result.processed) {
          campaignProcessed++
          totalProcessed++
        } else {
          campaignSkipped++
          totalSkipped++
          lastReason = result.reason || ''
        }

        // If the delay is longer than the time remaining in this function invocation,
        // don't wait — let the next cron tick handle it
        const remainingTime = FUNCTION_TIMEOUT_MS - (Date.now() - startTime)
        if (result.delayMs > remainingTime) {
          // The interval says we should wait longer than we have — stop processing this campaign
          break
        }

        // If no message was processed and the reason is a hard block (ban, window, etc.),
        // don't retry this campaign in this tick
        if (!result.processed && ['cooldown', 'outside_sending_window', 'chip_banned', 'whatsapp_warning_detected'].some(r => lastReason.includes(r))) {
          break
        }

        // Wait the delay before processing the next message
        // This applies BOTH when a message was processed (anti-ban interval)
        // AND when we're waiting for a step delay (contact-by-contact sequential)
        if (result.delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, result.delayMs))
        }

        // If campaign is complete, stop processing it
        if (result.completed) break
      }

      allResults.push({
        campaignId,
        processed: campaignProcessed,
        skipped: campaignSkipped,
        reason: lastReason || undefined,
      })
    }

    const totalRemaining = allResults.reduce((sum, r) => sum + (r.remaining > 0 ? r.remaining : 0), 0)
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
      elapsedMs,
    })
  } catch (error: any) {
    console.error('Process all campaigns error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao processar campanhas' },
      { status: 500 }
    )
  }
}

// Also support GET for cron-job.org (simpler to configure with URL params)
export async function GET(request: NextRequest) {
  return POST(request)
}
