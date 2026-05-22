import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
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

    const updated = await db.campaign.update({
      where: { id: campaignId },
      data: { status: 'running', statusReason: null, pausedAt: null },
      include: {
        chips: { include: { chip: true } },
        sequenceSteps: { orderBy: { stepOrder: 'asc' } },
        contactList: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    console.error('Campaign resume error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao retomar campanha' },
      { status: 500 }
    )
  }
}
