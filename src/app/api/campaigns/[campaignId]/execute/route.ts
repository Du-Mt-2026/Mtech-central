import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTextMessage, sendMediaMessage, setPresence, formatPhoneNumber, getInstanceName } from '@/lib/evolution-api'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      include: {
        contactList: { include: { contacts: true } },
        chips: { include: { chip: true } },
        sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      },
    })

    if (!campaign) return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
    if (!campaign.contactList) return NextResponse.json({ error: 'Sem lista de contatos' }, { status: 400 })
    if (campaign.chips.length === 0) return NextResponse.json({ error: 'Sem chips atribuídos' }, { status: 400 })

    const contacts = campaign.contactList.contacts
    if (contacts.length === 0) return NextResponse.json({ error: 'Lista vazia' }, { status: 400 })

    const antiBan = await db.antiBanSettings.findFirst()

    // Build message items from sequence steps with their variations
    type MsgItem = { content: string; mediaUrl: string | null; mediatype: string | null; delayMinutes: number; stepOrder: number }
    type VariationObj = { content: string; mediaUrl?: string; mediatype?: string }

    const messageItems: MsgItem[] = []
    for (const step of campaign.sequenceSteps) {
      // Parse variations for this step
      let stepVariations: VariationObj[] = []
      try {
        const raw = JSON.parse(step.variations || '[]')
        if (Array.isArray(raw) && raw.length > 0) {
          stepVariations = raw.filter((v: any) => v.content && v.content.trim())
        }
      } catch { /* ignore parse errors */ }

      // If step has variations, each variation becomes a possible message for this step
      // The main content + mediaUrl/mediatype is the "default" variation (index 0)
      if (stepVariations.length > 0) {
        for (const v of stepVariations) {
          messageItems.push({
            content: v.content,
            mediaUrl: v.mediaUrl || step.mediaUrl || null,
            mediatype: v.mediatype || step.mediatype || null,
            delayMinutes: step.delayMinutes,
            stepOrder: step.stepOrder,
          })
        }
      } else {
        // No variations — use the step's main content
        messageItems.push({
          content: step.content,
          mediaUrl: step.mediaUrl || null,
          mediatype: step.mediatype || null,
          delayMinutes: step.delayMinutes,
          stepOrder: step.stepOrder,
        })
      }
    }

    if (messageItems.length === 0) {
      return NextResponse.json({ error: 'Campanha sem mensagens configuradas' }, { status: 400 })
    }

    // Group message items by stepOrder for random variation selection
    const stepsMap = new Map<number, MsgItem[]>()
    for (const item of messageItems) {
      if (!stepsMap.has(item.stepOrder)) stepsMap.set(item.stepOrder, [])
      stepsMap.get(item.stepOrder)!.push(item)
    }

    // Create pending messages: each contact gets a random variation from step 1
    // (Subsequent steps will be created after step 1 is delivered)
    const step1Items = stepsMap.get(1) || messageItems

    // Create pending messages — for single-step campaigns, use random variation from all items
    // For multi-step campaigns, start with step 1 (subsequent steps sent after delays)
    const isFirstStepOnly = stepsMap.size > 1
    const itemsToUse = isFirstStepOnly ? step1Items : messageItems

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i]
      const chipAssignment = campaign.chips[i % campaign.chips.length]
      // Pick a random variation for this contact
      const msgItem = itemsToUse[Math.floor(Math.random() * itemsToUse.length)]
      await db.message.create({
        data: {
          campaignId: campaign.id,
          chipId: chipAssignment.chipId,
          contactId: contact.id,
          content: msgItem.content,
          mediaUrl: msgItem.mediaUrl,
          mediatype: msgItem.mediatype,
          status: 'pending',
        },
      })
    }

    await db.campaign.update({
      where: { id: campaignId },
      data: { status: 'running', startedAt: new Date() },
    })

    // Fire and forget background processing
    processCampaignMessages(campaignId, antiBan, campaign).catch(err =>
      console.error('Campaign processing error:', err)
    )

    return NextResponse.json({
      success: true,
      message: `Campanha iniciada com ${contacts.length} contatos`,
      totalMessages: contacts.length,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params
    const messages = await db.message.findMany({
      where: { campaignId },
      select: { status: true },
    })
    const sc: Record<string, number> = {}
    for (const m of messages) sc[m.status] = (sc[m.status] || 0) + 1
    const done = (sc.sent || 0) + (sc.delivered || 0) + (sc.read || 0) + (sc.failed || 0)
    return NextResponse.json({ total: messages.length, ...sc, progress: messages.length > 0 ? Math.round((done / messages.length) * 100) : 0 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function processCampaignMessages(campaignId: string, antiBan: any, campaign: any) {
  const intervalMin = antiBan?.messageIntervalMin || campaign.sendIntervalMin || 30
  const intervalMax = antiBan?.messageIntervalMax || campaign.sendIntervalMax || 90

  let hasMore = true
  while (hasMore) {
    const current = await db.campaign.findUnique({ where: { id: campaignId } })
    if (!current || current.status !== 'running') break

    const next = await db.message.findFirst({ where: { campaignId, status: 'pending' } })
    if (!next) { hasMore = false; break }

    const chip = await db.chip.findUnique({ where: { id: next.chipId } })
    if (!chip || chip.status !== 'connected' || chip.sentToday >= chip.dailyLimit) {
      await db.message.update({ where: { id: next.id }, data: { status: 'failed', error: !chip ? 'Sem chip' : chip.status !== 'connected' ? 'Chip offline' : 'Limite diário' } })
      continue
    }

    try {
      await db.message.update({ where: { id: next.id }, data: { status: 'sending' } })
      const instanceName = getInstanceName(chip.id, chip.name)
      const contact = await db.contact.findUnique({ where: { id: next.contactId } })
      if (!contact) { await db.message.update({ where: { id: next.id }, data: { status: 'failed', error: 'Contato não encontrado' } }); continue }

      const phone = formatPhoneNumber(contact.phone)
      const typingDelay = antiBan ? Math.floor(Math.random() * (antiBan.typingMaxDelay - antiBan.typingMinDelay) + antiBan.typingMinDelay) : 1500
      try { await setPresence(instanceName, phone, 'composing', typingDelay) } catch {}

      // Send media or text based on message fields
      if (next.mediaUrl && next.mediatype) {
        const validMediaTypes = ['image', 'document', 'video', 'audio']
        const mt = next.mediatype as 'image' | 'document' | 'video' | 'audio'
        if (validMediaTypes.includes(mt)) {
          await sendMediaMessage(instanceName, phone, next.mediaUrl, mt, { caption: next.content || '' })
        } else {
          await sendTextMessage(instanceName, phone, next.content)
        }
      } else {
        await sendTextMessage(instanceName, phone, next.content)
      }
      await db.message.update({ where: { id: next.id }, data: { status: 'sent', sentAt: new Date() } })
      await db.chip.update({ where: { id: chip.id }, data: { sentToday: { increment: 1 } } })
    } catch (err: any) {
      await db.message.update({ where: { id: next.id }, data: { status: 'failed', error: err.message } })
    }

    const delay = Math.floor(Math.random() * (intervalMax - intervalMin) + intervalMin) * 1000
    await new Promise(r => setTimeout(r, delay))
  }

  const pending = await db.message.count({ where: { campaignId, status: 'pending' } })
  if (pending === 0) await db.campaign.update({ where: { id: campaignId }, data: { status: 'completed', completedAt: new Date() } })
}
