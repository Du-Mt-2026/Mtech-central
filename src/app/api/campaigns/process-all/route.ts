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

    // Process each campaign — try to send multiple messages per campaign per tick
    for (const campaignId of campaignIds) {
      let campaignProcessed = 0
      let campaignSkipped = 0
      let lastReason = ''
      let campaignError: string | undefined

      // Process up to 10 messages per campaign per tick
      for (let attempt = 0; attempt < 10; attempt++) {
        // Check if we're about to timeout
        if (Date.now() - startTime > FUNCTION_TIMEOUT_MS) {
          break
        }

        try {
          const result = await processNextMessage(campaignId)

          if (result.processed) {
            campaignProcessed++
            totalProcessed++
          } else {
            campaignSkipped++
            totalSkipped++
            lastReason = result.reason || ''
          }

          // If no message was processed and the reason is a hard block (ban, window, etc.),
          // don't retry this campaign in this tick
          if (!result.processed && ['cooldown', 'outside_sending_window', 'chip_banned', 'whatsapp_warning_detected'].some(r => lastReason.includes(r))) {
            break
          }

          // Wait the delay before processing the next message
          if (result.delayMs > 0) {
            const remainingTime = FUNCTION_TIMEOUT_MS - (Date.now() - startTime)
            if (remainingTime < 3000) break // Not enough time to wait + process
            const waitTime = Math.min(result.delayMs, remainingTime - 3000)
            if (waitTime > 0) {
              await new Promise(resolve => setTimeout(resolve, waitTime))
            }
          }

          // If campaign is complete, stop processing it
          if (result.completed) break

        } catch (msgError: any) {
          // Individual message processing error — don't crash the whole loop
          console.error(`[ProcessAll] Error processing message for campaign ${campaignId}:`, msgError.message)
          campaignError = msgError.message
          campaignSkipped++
          totalSkipped++
          break // Stop processing this campaign, move to next
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
