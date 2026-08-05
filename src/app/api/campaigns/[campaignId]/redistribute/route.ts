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

    // Build chipMap early — used for capacity-based sorting
    const chipMap = new Map(chips.map(c => [c.id, c]))

    // Re-read the updated CampaignChip records (no include needed — we only need chipId + contactLimit)
    const updatedCampaignChips = await db.campaignChip.findMany({
      where: { campaignId },
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

    // If fixedTotal exceeds pending messages, scale down proportionally
    // prioritizing chips with more remaining daily capacity
    if (fixedTotal > pendingMessages.length && fixedTotal > 0) {
      const scaleFactor = pendingMessages.length / fixedTotal
      let distributed = 0
      const sortedChipIdsWithLimits = [...chipLimits.keys()].sort((a, b) => {
        const chipA = chipMap.get(a)
        const chipB = chipMap.get(b)
        const capA = chipA ? (chipA.dailyLimit || 200) - (chipA.sentToday || 0) : 0
        const capB = chipB ? (chipB.dailyLimit || 200) - (chipB.sentToday || 0) : 0
        if (capA !== capB) return capB - capA
        return Math.random() > 0.5 ? 1 : -1
      })
      for (const chipId of sortedChipIdsWithLimits) {
        const scaledLimit = Math.floor((chipLimits.get(chipId) || 0) * scaleFactor)
        chipLimits.set(chipId, scaledLimit)
        distributed += scaledLimit
      }
      const remainder = pendingMessages.length - distributed
      for (let i = 0; i < remainder; i++) {
        const chipId = sortedChipIdsWithLimits[i % sortedChipIdsWithLimits.length]
        chipLimits.set(chipId, (chipLimits.get(chipId) || 0) + 1)
      }
      fixedTotal = pendingMessages.length
    }

    // Auto chips get equal share of remaining, with extra going to higher-capacity chips
    const remainingContacts = Math.max(0, pendingMessages.length - fixedTotal)
    if (chipsWithAutoLimit.length > 0 && remainingContacts > 0) {
      const basePerChip = Math.floor(remainingContacts / chipsWithAutoLimit.length)
      let extra = remainingContacts - basePerChip * chipsWithAutoLimit.length
      const sortedAutoChips = [...chipsWithAutoLimit].sort((a, b) => {
        const chipA = chipMap.get(a)
        const chipB = chipMap.get(b)
        const capA = chipA ? (chipA.dailyLimit || 200) - (chipA.sentToday || 0) : 0
        const capB = chipB ? (chipB.dailyLimit || 200) - (chipB.sentToday || 0) : 0
        if (capA !== capB) return capB - capA
        return Math.random() > 0.5 ? 1 : -1
      })
      for (const chipId of sortedAutoChips) {
        const limit = basePerChip + (extra > 0 ? 1 : 0)
        chipLimits.set(chipId, limit)
        if (extra > 0) extra--
      }
    }

    // Build assignment plan — use chipMap for evolution instance check
    const assignmentPlan: { chipId: string; count: number }[] = []
    for (const cc of updatedCampaignChips) {
      const chip = chipMap.get(cc.chipId)
      if (!chip?.evolutionInstance) continue
      const limit = chipLimits.get(cc.chipId) || 0
      if (limit > 0) {
        assignmentPlan.push({ chipId: cc.chipId, count: limit })
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
    // Remaining contacts: assign to chips with most remaining capacity
    if (contactIdx < pendingMessages.length) {
      const chipsByCapacity = [...chips].sort((a, b) => {
        const capA = (a.dailyLimit || 200) - (a.sentToday || 0)
        const capB = (b.dailyLimit || 200) - (b.sentToday || 0)
        if (capA !== capB) return capB - capA
        return Math.random() > 0.5 ? 1 : -1
      })
      while (contactIdx < pendingMessages.length) {
        contactChipAssignments.push(chipsByCapacity[contactIdx % chipsByCapacity.length].id)
        contactIdx++
      }
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
