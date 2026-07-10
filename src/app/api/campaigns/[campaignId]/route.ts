import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startCampaign } from '@/lib/sending-engine'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/audit-log'

// Allowed fields for PATCH (whitelist to prevent arbitrary data injection)
const ALLOWED_FIELDS = [
  'name', 'status', 'sendIntervalMin', 'sendIntervalMax',
  'contactListId', 'scheduledAt', 'antiBanEnabled', 'warmingMode',
  'nextSendAt',
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

    // PROBLEMA 5: incluir messageStatusCounts (status breakdown) no retorno.
    // Sem isso, o frontend não consegue exibir o botão "Reenviar falhadas" no
    // detalhe da campanha, porque openDetail() busca este endpoint e sobrescreve
    // o selectedCampaign — fazendo messageStatusCounts.failed ficar undefined.
    const statusCounts = await db.message.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { status: true },
    })
    const messageStatusCounts: Record<string, number> = {}
    for (const sc of statusCounts) {
      messageStatusCounts[sc.status] = sc._count.status
    }

    return NextResponse.json({ ...campaign, messageStatusCounts })
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
          data: body.chipIds.map((chipId: string) => ({
            campaignId,
            chipId,
            contactLimit: body.chipDistribution?.[chipId] ?? null,
          })),
        })
      }
      delete body.chipIds
      delete body.chipDistribution
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

      // Audit log for status transitions
      const session = await getSession()
      await logAction({
        userId: session?.userId,
        userName: session?.username,
        userRole: session?.role,
        action: `CAMPAIGN_${newStatus.toUpperCase()}`,
        category: 'campaign',
        targetId: campaignId,
        targetType: 'campaign',
        details: { from: currentCampaign.status, to: newStatus, name: currentCampaign.name },
      })

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
          // Resuming from pause — clear the status reason and pausedAt
          // Also recover messages stuck in 'sending' state (they were interrupted by the pause)
          const stuckMessages = await db.message.findMany({
            where: { campaignId: currentCampaign.id, status: 'sending' },
          })
          if (stuckMessages.length > 0) {
            // Reset stuck messages back to 'pending' so they can be re-processed
            await db.message.updateMany({
              where: { campaignId: currentCampaign.id, status: 'sending' },
              data: { status: 'pending' },
            })
            console.log(`[Campaign Resume] Recovered ${stuckMessages.length} messages stuck in 'sending' state for campaign ${campaignId}`)
          }
          await db.campaign.update({
            where: { id: campaignId },
            data: { status: 'running', statusReason: null, pausedAt: null },
          })
        }
      } else if (newStatus === 'paused') {
        await db.campaign.update({
          where: { id: campaignId },
          data: { status: 'paused', statusReason: 'Pausada manualmente pelo usuário', pausedAt: new Date() },
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
      // PROBLEMA 5: incluir messageStatusCounts também no PATCH (após status transition)
      const patchStatusCounts = await db.message.groupBy({
        by: ['status'],
        where: { campaignId },
        _count: { status: true },
      })
      const patchMessageStatusCounts: Record<string, number> = {}
      for (const sc of patchStatusCounts) {
        patchMessageStatusCounts[sc.status] = sc._count.status
      }
      return NextResponse.json({ ...updatedCampaign, messageStatusCounts: patchMessageStatusCounts })
    }

    // Non-status updates — apply whitelisted fields only
    const updateData: Record<string, unknown> = {}
    for (const field of ALLOWED_FIELDS) {
      if (field === 'status') continue // Already handled above
      if (body[field] !== undefined) {
        if (field === 'scheduledAt' || field === 'nextSendAt') {
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
    // PROBLEMA 5: incluir messageStatusCounts também no PATCH (non-status updates)
    const nonStatusCounts = await db.message.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { status: true },
    })
    const nonStatusMessageStatusCounts: Record<string, number> = {}
    for (const sc of nonStatusCounts) {
      nonStatusMessageStatusCounts[sc.status] = sc._count.status
    }
    return NextResponse.json({ ...campaign, messageStatusCounts: nonStatusMessageStatusCounts })
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
    const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { name: true } })

    await db.sequenceStep.deleteMany({ where: { campaignId } })
    await db.campaignChip.deleteMany({ where: { campaignId } })
    await db.message.deleteMany({ where: { campaignId } })
    await db.campaign.delete({ where: { id: campaignId } })

    const session = await getSession()
    await logAction({
      userId: session?.userId,
      userName: session?.username,
      userRole: session?.role,
      action: 'DELETE_CAMPAIGN',
      category: 'campaign',
      targetId: campaignId,
      targetType: 'campaign',
      details: { name: campaign?.name },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
  }
}
