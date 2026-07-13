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

    if (campaign.status !== 'running') {
      return NextResponse.json(
        { error: `Não é possível pausar uma campanha com status "${campaign.status}". Apenas campanhas "running" podem ser pausadas.` },
        { status: 400 }
      )
    }

    const updated = await db.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'paused',
        statusReason: 'Pausada manualmente pelo usuário',
        pausedAt: new Date(),
        nextSendAt: null, // Clear interval lock so campaign doesn't get stuck
      },
      include: {
        chips: { include: { chip: true } },
        sequenceSteps: { orderBy: { stepOrder: 'asc' } },
        contactList: { select: { id: true, name: true } },
      },
    })

    await auditLog(ctx, {
      action: 'CAMPAIGN_PAUSED',
      category: 'campaign',
      targetId: campaignId,
      targetType: 'campaign',
      details: { name: campaign.name },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    console.error('Campaign pause error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao pausar campanha' },
      { status: 500 }
    )
  }
}
