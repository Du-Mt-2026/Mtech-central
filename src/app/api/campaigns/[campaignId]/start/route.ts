import { NextRequest, NextResponse } from 'next/server'
import { startCampaign } from '@/lib/sending-engine'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    // Start the campaign: creates pending messages and sets status to running
    const { messageCount } = await startCampaign(campaignId)

    // Note: actual message processing is handled separately via
    // /api/campaigns/process-all or a cron job, to avoid serverless timeouts
    return NextResponse.json({
      success: true,
      messageCount,
    })
  } catch (error: any) {
    console.error('Campaign start error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao iniciar campanha' },
      { status: 500 }
    )
  }
}
