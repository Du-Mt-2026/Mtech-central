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
 */
export async function POST(request: Request) {
  const FUNCTION_TIMEOUT_MS = 50_000 // Vercel timeout is 60s, leave 10s margin
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
    let totalProcessed = 0
    let totalFailed = 0
    let totalRemaining = 0
    let lastReason = ''

    for (const campaignId of campaignIds) {
      // Process up to 10 messages per campaign per invocation
      for (let attempt = 0; attempt < 10; attempt++) {
        // Check if we're about to timeout
        if (Date.now() - startTime > FUNCTION_TIMEOUT_MS) {
          console.log(`[Process] Approaching function timeout after ${totalProcessed} messages`)
          break
        }

        const result = await processNextMessage(campaignId)

        if (result.processed) {
          totalProcessed++
        } else {
          lastReason = result.reason || ''
        }

        totalRemaining = result.remaining >= 0 ? result.remaining : totalRemaining

        // If campaign is complete, stop
        if (result.completed) break

        // If hard block (ban, window, cooldown), stop this campaign
        if (!result.processed && ['outside_sending_window', 'whatsapp_warning_detected'].some(r => lastReason.includes(r))) {
          break
        }

        // If the delay is longer than the time remaining, stop
        const remainingTime = FUNCTION_TIMEOUT_MS - (Date.now() - startTime)
        if (result.delayMs > remainingTime) {
          break
        }

        // Wait the anti-ban interval before the next message
        if (result.processed && result.delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, result.delayMs))
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
