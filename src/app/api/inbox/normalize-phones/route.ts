import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/inbox/normalize-phones
 * 
 * This endpoint handles data cleanup tasks:
 * 1. Normalizes phone numbers in InboxMessage (original purpose)
 * 2. Marks campaign messages as isCampaign=true (cleanup for existing data)
 * 
 * Query params:
 * - action: 'normalize' | 'mark-campaign' (default: 'mark-campaign')
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const action = body.action || 'mark-campaign'

    if (action === 'mark-campaign') {
      // Step 1: Mark all InboxMessages that have a matching Message (campaign) record
      // These were sent by campaigns and should NOT appear in the inbox
      const campaignMessages = await db.message.findMany({
        where: { evolutionMessageId: { not: null } },
        select: { evolutionMessageId: true },
      })

      const campaignMsgIds = campaignMessages
        .map(m => m.evolutionMessageId)
        .filter((id): id is string => !!id)

      // Mark matching inbox messages as campaign
      const updateResult = await db.inboxMessage.updateMany({
        where: {
          evolutionMsgId: { in: campaignMsgIds },
          isCampaign: false,
        },
        data: { isCampaign: true },
      })

      // Step 2: Also mark all fromMe=true messages that DON'T have a matching 
      // Message record but look like campaign blasts (sent to contacts that 
      // never replied). This is a heuristic — messages where fromMe=true and
      // the conversation has NO incoming messages from the contact.
      // We skip this for now as it's too aggressive.

      return NextResponse.json({
        action: 'mark-campaign',
        campaignMsgIdsFound: campaignMsgIds.length,
        inboxMessagesUpdated: updateResult.count,
        message: `Marcadas ${updateResult.count} mensagens de campanha no inbox. Elas não aparecerão mais na caixa de entrada.`,
      })
    }

    if (action === 'normalize') {
      // Original phone normalization logic
      const messages = await db.inboxMessage.findMany({
        where: { remotePhone: '' },
        select: { id: true, remoteJid: true },
        take: 500,
      })

      let normalized = 0
      for (const msg of messages) {
        const phone = msg.remoteJid.split('@')[0]
        if (phone) {
          await db.inboxMessage.update({
            where: { id: msg.id },
            data: { remotePhone: phone },
          })
          normalized++
        }
      }

      return NextResponse.json({
        action: 'normalize',
        processed: messages.length,
        normalized,
      })
    }

    return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  } catch (error: any) {
    console.error('Inbox normalize error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro na normalização' },
      { status: 500 }
    )
  }
}
