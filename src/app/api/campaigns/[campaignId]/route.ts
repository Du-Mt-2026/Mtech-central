import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      include: {
        _count: { select: { messages: true, chips: true } },
        chips: { include: { chip: true } },
        sequenceSteps: { orderBy: { stepOrder: 'asc' } },
        contactList: { select: { id: true, name: true } },
      },
    })
    if (!campaign) {
      return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
    }
    return NextResponse.json(campaign)
  } catch {
    return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    const body = await req.json()
    
    // If updating steps, handle them separately
    if (body.steps) {
      await db.sequenceStep.deleteMany({ where: { campaignId } })
      if (body.steps.length > 0) {
        await db.sequenceStep.createMany({
          data: body.steps.map((step: { stepOrder: number; content: string; delayMinutes: number }) => ({
            campaignId,
            stepOrder: step.stepOrder,
            content: step.content,
            delayMinutes: step.delayMinutes ?? 0,
          })),
        })
      }
      delete body.steps
    }

    // If updating chips
    if (body.chipIds) {
      await db.campaignChip.deleteMany({ where: { campaignId } })
      if (body.chipIds.length > 0) {
        await db.campaignChip.createMany({
          data: body.chipIds.map((chipId: string) => ({ campaignId, chipId })),
        })
      }
      delete body.chipIds
    }

    const updateData: Record<string, unknown> = {}
    if (body.status !== undefined) {
      updateData.status = body.status
      if (body.status === 'running' && !body.startedAt) {
        updateData.startedAt = new Date()
      }
      if (body.status === 'completed') {
        updateData.completedAt = new Date()
      }
    }
    if (body.name !== undefined) updateData.name = body.name
    if (body.sendIntervalMin !== undefined) updateData.sendIntervalMin = body.sendIntervalMin
    if (body.sendIntervalMax !== undefined) updateData.sendIntervalMax = body.sendIntervalMax
    if (body.contactListId !== undefined) updateData.contactListId = body.contactListId

    const campaign = await db.campaign.update({
      where: { id: campaignId },
      data: updateData,
      include: {
        chips: { include: { chip: true } },
        sequenceSteps: { orderBy: { stepOrder: 'asc' } },
        contactList: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json(campaign)
  } catch (error) {
    console.error('Campaign PATCH error:', error)
    return NextResponse.json({ error: 'Erro ao atualizar campanha' }, { status: 404 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    await db.sequenceStep.deleteMany({ where: { campaignId } })
    await db.campaignChip.deleteMany({ where: { campaignId } })
    await db.message.deleteMany({ where: { campaignId } })
    await db.campaign.delete({ where: { id: campaignId } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
  }
}
