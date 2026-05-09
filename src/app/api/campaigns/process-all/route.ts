import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getRunningCampaigns, processNextMessage, startCampaign } from '@/lib/sending-engine'

/**
 * Process one message per running campaign.
 * Also checks for scheduled campaigns whose time has come and auto-starts them.
 * Called by Vercel Cron every minute.
 * Each invocation processes 1 message per campaign (serverless-safe).
 */
export async function POST(request: Request) {
  // Verify CRON_SECRET for production security (Vercel Cron sends this header)
  if (process.env.CRON_SECRET) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

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

    const results = []
    for (const campaignId of campaignIds) {
      const result = await processNextMessage(campaignId)
      results.push({ campaignId, ...result })
    }

    const totalProcessed = results.filter(r => r.processed).length
    const totalRemaining = results.reduce((sum, r) => sum + (r.remaining > 0 ? r.remaining : 0), 0)

    return NextResponse.json({
      processed: totalProcessed,
      remaining: totalRemaining,
      campaigns: results.length,
      results,
      startedScheduled: startedCampaigns.length,
      startedCampaigns,
      startErrors: startErrors.length > 0 ? startErrors : undefined,
    })
  } catch (error: any) {
    console.error('Process all campaigns error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao processar campanhas' },
      { status: 500 }
    )
  }
}

// Also support GET for Vercel Cron
export async function GET(request: Request) {
  return POST(request)
}
