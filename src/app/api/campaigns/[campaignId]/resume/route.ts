import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuditContext, auditLog } from '@/lib/audit-helper'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    const ctx = await getAuditContext(req)
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
    }

    if (campaign.status !== 'paused') {
      return NextResponse.json(
        { error: `Não é possível retomar uma campanha com status "${campaign.status}". Apenas campanhas "paused" podem ser retomadas.` },
        { status: 400 }
      )
    }

    // Reset messages stuck in 'sending' state back to 'pending' so they can be reprocessed
    const resetResult = await db.message.updateMany({
      where: {
        campaignId: campaignId,
        status: 'sending',
      },
      data: {
        status: 'pending',
      },
    })
    const recoveredCount = resetResult.count

    const updated = await db.campaign.update({
      where: { id: campaignId },
      data: { status: 'running', statusReason: null, pausedAt: null, nextSendAt: null },
      include: {
        chips: { include: { chip: true } },
        sequenceSteps: { orderBy: { stepOrder: 'asc' } },
        contactList: { select: { id: true, name: true } },
      },
    })

    await auditLog(ctx, {
      action: 'CAMPAIGN_RESUMED',
      category: 'campaign',
      targetId: campaignId,
      targetType: 'campaign',
      details: { name: campaign.name, recoveredMessages: recoveredCount },
    })

    const response: Record<string, unknown> = { ...updated }
    if (recoveredCount > 0) {
      response._recoveredMessages = recoveredCount
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Campaign resume error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao retomar campanha' },
      { status: 500 }
    )
  }
}
