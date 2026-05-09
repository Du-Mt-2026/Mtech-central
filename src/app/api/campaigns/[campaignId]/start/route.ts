import { NextRequest, NextResponse } from 'next/server'
import { startCampaign, processCampaign } from '@/lib/sending-engine'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    // Start the campaign: creates pending messages and sets status to running
    const { messageCount } = await startCampaign(campaignId)

    // Process the first batch of messages
    // In production, this would be called by a cron job or worker
    const result = await processCampaign(campaignId)

    return NextResponse.json({
      success: true,
      messageCount,
      result,
    })
  } catch (error: any) {
    console.error('Campaign start error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao iniciar campanha' },
      { status: 500 }
    )
  }
}
