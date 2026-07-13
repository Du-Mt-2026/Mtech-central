import { NextRequest, NextResponse } from 'next/server'
import { startCampaign } from '@/lib/sending-engine'
import { getAuditContext, auditLog } from '@/lib/audit-helper'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    const ctx = await getAuditContext(req)
    console.log(`[Campaign Start] Starting campaign ${campaignId}`)
    const { messageCount } = await startCampaign(campaignId)
    console.log(`[Campaign Start] Campaign ${campaignId} started with ${messageCount} messages`)

    await auditLog(ctx, {
      action: 'CAMPAIGN_STARTED',
      category: 'campaign',
      targetId: campaignId,
      targetType: 'campaign',
      details: { messageCount },
    })

    return NextResponse.json({
      success: true,
      messageCount,
    })
  } catch (error: any) {
    console.error(`[Campaign Start] Error for campaign ${campaignId}:`, error)
    const ctx = await getAuditContext(req)
    await auditLog(ctx, {
      action: 'CAMPAIGN_START_FAILED',
      category: 'campaign',
      targetId: campaignId,
      targetType: 'campaign',
      details: { error: error.message?.substring(0, 200) },
    })
    return NextResponse.json(
      { error: error.message || 'Erro ao iniciar campanha' },
      { status: 500 }
    )
  }
}
