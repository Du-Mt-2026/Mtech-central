import { NextResponse } from 'next/server'
import { getRunningCampaigns, processCampaign } from '@/lib/sending-engine'

// This endpoint should be called by a cron job to process all running campaigns
export async function POST() {
  try {
    const campaignIds = await getRunningCampaigns()

    if (campaignIds.length === 0) {
      return NextResponse.json({ message: 'No running campaigns', processed: 0 })
    }

    const results = []
    for (const campaignId of campaignIds) {
      const result = await processCampaign(campaignId)
      results.push({ campaignId, ...result })
    }

    return NextResponse.json({
      processed: results.length,
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
