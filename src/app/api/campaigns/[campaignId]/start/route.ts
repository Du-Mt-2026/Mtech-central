import { NextRequest, NextResponse } from 'next/server'
import { startCampaign } from '@/lib/sending-engine'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    console.log(`[Campaign Start] Starting campaign ${campaignId}`)
    const { messageCount } = await startCampaign(campaignId)
    console.log(`[Campaign Start] Campaign ${campaignId} started with ${messageCount} messages`)

    return NextResponse.json({
      success: true,
      messageCount,
    })
  } catch (error: any) {
    console.error(`[Campaign Start] Error for campaign ${campaignId}:`, error)
    return NextResponse.json(
      { error: error.message || 'Erro ao iniciar campanha' },
      { status: 500 }
    )
  }
}
