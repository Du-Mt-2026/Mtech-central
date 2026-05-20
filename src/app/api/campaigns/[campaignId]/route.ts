import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startCampaign } from '@/lib/sending-engine'

// Allowed fields for PATCH (whitelist to prevent arbitrary data injection)
const ALLOWED_FIELDS = [
  'name', 'status', 'sendIntervalMin', 'sendIntervalMax',
  'contactListId', 'scheduledAt', 'antiBanEnabled', 'warmingMode',
] as const

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['scheduled', 'running', 'cancelled'],
  scheduled: ['running', 'cancelled'],
  running: ['paused', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: [],
  cancelled: [],
}

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

    // Fetch current campaign for status transition validation
    const currentCampaign = await db.campaign.findUnique({
      where: { id: campaignId },
    })
    if (!currentCampaign) {
      return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
    }

    // If updating steps, handle them separately
    if (body.steps) {
      await db.sequenceStep.deleteMany({ where: { campaignId } })
      if (body.steps.length > 0) {
        await db.sequenceStep.createMany({
          data: body.steps.map((step: { stepOrder: number; content: string; delayMinutes: number; delayUnit?: string; mediaUrl?: string; mediatype?: string; variations?: string }) => ({
            campaignId,
            stepOrder: step.stepOrder,
            content: step.content,
            delayMinutes: step.delayMinutes ?? 0,
            delayUnit: step.delayUnit ?? 'minutes',
            mediaUrl: step.mediaUrl || null,
            mediatype: step.mediatype || null,
            variations: step.variations || '[]',
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

    // Handle status transitions
    if (body.status !== undefined && body.status !== currentCampaign.status) {
      const newStatus = body.status
      const allowedTransitions = VALID_TRANSITIONS[currentCampaign.status] || []

      if (!allowedTransitions.includes(newStatus)) {
        return NextResponse.json(
          { error: `Transição inválida: ${currentCampaign.status} → ${newStatus}` },
          { status: 400 }
        )
      }

      // Handle specific transitions
      if (newStatus === 'scheduled') {
        if (!body.scheduledAt && !currentCampaign.scheduledAt) {
          return NextResponse.json(
            { error: 'Campanha agendada precisa de scheduledAt' },
            { status: 400 }
          )
        }
        await db.campaign.update({
          where: { id: campaignId },
          data: {
            status: 'scheduled',
            scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
          },
        })
      } else if (newStatus === 'running') {
        // Starting a campaign from draft/scheduled/paused
        if (currentCampaign.status === 'draft' || currentCampaign.status === 'scheduled') {
          // First time starting — create messages and set running
          try {
            await startCampaign(campaignId)
          } catch (startError: any) {
            return NextResponse.json(
              { error: startError.message || 'Erro ao iniciar campanha' },
              { status: 500 }
            )
          }
        } else if (currentCampaign.status === 'paused') {
          // Resuming from pause
          await db.campaign.update({
            where: { id: campaignId },
            data: { status: 'running' },
          })
        }
      } else if (newStatus === 'paused') {
        await db.campaign.update({
          where: { id: campaignId },
          data: { status: 'paused' },
        })
      } else if (newStatus === 'cancelled') {
        // Cancel campaign and mark all pending messages as failed
        await db.message.updateMany({
          where: { campaignId, status: { in: ['pending', 'sending'] } },
          data: { status: 'failed', error: 'Campanha cancelada' },
        })
        await db.campaign.update({
          where: { id: campaignId },
          data: { status: 'cancelled' },
        })
      }

      // Return updated campaign
      const updatedCampaign = await db.campaign.findUnique({
        where: { id: campaignId },
        include: {
          chips: { include: { chip: true } },
          sequenceSteps: { orderBy: { stepOrder: 'asc' } },
          contactList: { select: { id: true, name: true } },
        },
      })
      return NextResponse.json(updatedCampaign)
    }

    // Non-status updates — apply whitelisted fields only
    const updateData: Record<string, unknown> = {}
    for (const field of ALLOWED_FIELDS) {
      if (field === 'status') continue // Already handled above
      if (body[field] !== undefined) {
        if (field === 'scheduledAt') {
          updateData[field] = body[field] ? new Date(body[field]) : null
        } else {
          updateData[field] = body[field]
        }
      }
    }

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
    return NextResponse.json({ error: 'Erro ao atualizar campanha' }, { status: 500 })
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
