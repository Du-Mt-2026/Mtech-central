import { NextResponse } from 'next/server'
import { getRunningCampaigns, processNextMessage } from '@/lib/sending-engine'

/**
 * Process one message per running campaign.
 * Called by Vercel Cron every minute.
 * Each invocation processes 1 message per campaign (serverless-safe).
 */
export async function POST(request: Request) {
  try {
    const campaignIds = await getRunningCampaigns()

    if (campaignIds.length === 0) {
      return NextResponse.json({ message: 'No running campaigns', processed: 0 })
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
