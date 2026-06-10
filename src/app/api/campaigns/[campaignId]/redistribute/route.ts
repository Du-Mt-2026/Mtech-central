import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/campaigns/[campaignId]/redistribute
 *
 * Redistribute pending messages across chips based on contactLimit settings.
 * This is used when a campaign is paused and the user wants to change
 * how contacts are distributed among chips without restarting the campaign.
 *
 * Body: {
 *   chipDistribution: { [chipId]: contactLimit }  // 0 = auto/equal split
 * }
 *
 * Logic:
 * 1. Get all pending messages for the campaign
 * 2. Update CampaignChip.contactLimit for each chip
 * 3. Reassign pending messages according to the new distribution
 * 4. Messages already sent/delivered are NOT affected
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params
  try {
    const body = await req.json()
    const { chipDistribution } = body

    if (!chipDistribution || typeof chipDistribution !== 'object') {
      return NextResponse.json({ error: 'chipDistribution é obrigatório' }, { status: 400 })
    }

    // Fetch campaign with chips
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      include: {
        chips: { include: { chip: true } },
      },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
    }

    // Only allow redistribution when campaign is paused or draft
    if (!['paused', 'draft'].includes(campaign.status)) {
      return NextResponse.json(
        { error: 'Só é possível redistribuir contatos quando a campanha está pausada ou em rascunho' },
        { status: 400 }
      )
    }

    // Update CampaignChip.contactLimit for each chip
    for (const [chipId, contactLimit] of Object.entries(chipDistribution)) {
      await db.campaignChip.updateMany({
        where: { campaignId, chipId },
        data: { contactLimit: (contactLimit as number) > 0 ? contactLimit as number : null },
      })
    }

    // Get all pending messages
    const pendingMessages = await db.message.findMany({
      where: {
        campaignId,
        status: 'pending',
      },
      orderBy: { id: 'asc' },
    })

    if (pendingMessages.length === 0) {
      return NextResponse.json({
        message: 'Nenhuma mensagem pendente para redistribuir',
        redistributed: 0,
      })
    }

    // Build assignment plan based on contactLimit
    const chips = campaign.chips.map(cc => cc.chip).filter(c => c.evolutionInstance)

    // Re-read the updated CampaignChip records
    const updatedCampaignChips = await db.campaignChip.findMany({
      where: { campaignId },
      include: { chip: true },
    })

    const chipLimits = new Map<string, number>()
    let fixedTotal = 0
    const chipsWithAutoLimit: string[] = []

    for (const cc of updatedCampaignChips) {
      const chipId = cc.chipId
      const limit = cc.contactLimit
      if (limit && limit > 0) {
        chipLimits.set(chipId, limit)
        fixedTotal += limit
      } else {
        chipsWithAutoLimit.push(chipId)
      }
    }

    // Auto chips get equal share of remaining
    const remainingContacts = Math.max(0, pendingMessages.length - fixedTotal)
    const autoLimitPerChip = chipsWithAutoLimit.length > 0
      ? Math.ceil(remainingContacts / chipsWithAutoLimit.length)
      : 0
    for (const chipId of chipsWithAutoLimit) {
      chipLimits.set(chipId, autoLimitPerChip)
    }

    // Build assignment plan
    const assignmentPlan: { chipId: string; count: number }[] = []
    for (const cc of updatedCampaignChips) {
      const chip = cc.chip
      if (!chip.evolutionInstance) continue
      const limit = chipLimits.get(chip.id) || 0
      if (limit > 0) {
        assignmentPlan.push({ chipId: chip.id, count: limit })
      }
    }

    // Assign messages to chips
    const contactChipAssignments: string[] = []
    let contactIdx = 0
    for (const plan of assignmentPlan) {
      const assignCount = Math.min(plan.count, pendingMessages.length - contactIdx)
      for (let j = 0; j < assignCount; j++) {
        contactChipAssignments.push(plan.chipId)
        contactIdx++
      }
    }
    // Remaining contacts via round-robin
    while (contactIdx < pendingMessages.length) {
      const chip = chips[contactIdx % chips.length]
      contactChipAssignments.push(chip.id)
      contactIdx++
    }

    // Group pending messages by contactId to reassign ALL steps for a contact together
    const contactGroups = new Map<string, string[]>() // contactId → [messageId, ...]
    for (const msg of pendingMessages) {
      if (!contactGroups.has(msg.contactId)) {
        contactGroups.set(msg.contactId, [])
      }
      contactGroups.get(msg.contactId)!.push(msg.id)
    }

    // Build the unique contacts list in order of first appearance
    const uniqueContacts: string[] = []
    const seenContacts = new Set<string>()
    for (const msg of pendingMessages) {
      if (!seenContacts.has(msg.contactId)) {
        seenContacts.add(msg.contactId)
        uniqueContacts.push(msg.contactId)
      }
    }

    // Assign each unique contact to a chip
    let redistributeCount = 0
    for (let i = 0; i < uniqueContacts.length; i++) {
      const contactId = uniqueContacts[i]
      const assignedChipId = contactChipAssignments[i] || chips[i % chips.length].id
      const messageIds = contactGroups.get(contactId) || []

      // Update all messages for this contact to the assigned chip
      if (messageIds.length > 0) {
        await db.message.updateMany({
          where: { id: { in: messageIds } },
          data: { chipId: assignedChipId },
        })
        redistributeCount += messageIds.length
      }
    }

    console.log(`[Redistribute] Campaign ${campaignId}: redistributed ${redistributeCount} messages across ${chips.length} chips`)

    return NextResponse.json({
      message: `${redistributeCount} mensagens redistribuídas com sucesso`,
      redistributed: redistributeCount,
      distribution: Object.fromEntries(chipLimits),
    })
  } catch (error) {
    console.error('Redistribute error:', error)
    return NextResponse.json({ error: 'Erro ao redistribuir mensagens' }, { status: 500 })
  }
}
