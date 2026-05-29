import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jwtVerify } from 'jose'

const AUTH_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || '')

export async function POST(req: NextRequest) {
  // Security: Only master users can run migrations
  try {
    const token = req.cookies.get('octupuszap-session')?.value
    if (!token) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }
    const { payload } = await jwtVerify(token, AUTH_SECRET)
    const role = (payload.role as string) || 'operador'
    if (role !== 'master') {
      return NextResponse.json({ error: 'Acesso negado. Apenas master pode executar migrações.' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Sessão expirada' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const action = body.action || 'default'

    // Mark existing campaign messages in inbox as isCampaign=true
    if (action === 'mark-campaign-inbox') {
      // Find all InboxMessages that match a campaign Message record
      const campaignMessages = await db.message.findMany({
        where: { evolutionMessageId: { not: null } },
        select: { evolutionMessageId: true },
      })

      const campaignMsgIds = campaignMessages
        .map(m => m.evolutionMessageId)
        .filter((id): id is string => !!id)

      const updateResult = await db.inboxMessage.updateMany({
        where: {
          evolutionMsgId: { in: campaignMsgIds },
          isCampaign: false,
        },
        data: { isCampaign: true },
      })

      return NextResponse.json({
        success: true,
        action: 'mark-campaign-inbox',
        campaignMsgIdsFound: campaignMsgIds.length,
        inboxMessagesUpdated: updateResult.count,
        message: `Marcadas ${updateResult.count} mensagens de campanha no inbox. Elas desaparecerão da caixa de entrada.`,
      })
    }

    // Mark chip-to-chip (warming) messages as isCampaign
    // These are phantom conversations from the warming engine between chips
    if (action === 'mark-warming-inbox') {
      // Get all chip phone numbers
      const chips = await db.chip.findMany({
        select: { phoneNumber: true, name: true },
      })

      let totalUpdated = 0

      for (const chip of chips) {
        // Find inbox messages where the remote phone matches a chip's phone number
        // This means the message was chip-to-chip (warming), not a real conversation
        const updated = await db.inboxMessage.updateMany({
          where: {
            isCampaign: false,
            OR: [
              { remotePhone: chip.phoneNumber },
              { remotePhone: { contains: chip.phoneNumber.replace(/^55/, '') } },
              { remotePhone: { contains: chip.phoneNumber } },
            ],
          },
          data: { isCampaign: true },
        })
        totalUpdated += updated.count
      }

      return NextResponse.json({
        success: true,
        action: 'mark-warming-inbox',
        chipsChecked: chips.length,
        inboxMessagesUpdated: totalUpdated,
        message: `Marcadas ${totalUpdated} mensagens chip-to-chip (aquecimento) como isCampaign. Elas desaparecerão da caixa de entrada.`,
      })
    }

    // Fix: Clear invalid profilePicUrl values (JIDs stored instead of URLs)
    if (action === 'fix-profile-pic-urls') {
      const result = await db.chip.updateMany({
        where: {
          profilePicUrl: { contains: '@s.whatsapp.net' },
        },
        data: { profilePicUrl: null },
      })
      return NextResponse.json({
        success: true,
        action: 'fix-profile-pic-urls',
        chipsFixed: result.count,
        message: `Limpos ${result.count} profilePicUrl inválidos (JIDs salvos como URL).`,
      })
    }

    // Fix: Update ack/status for old messages that have ack=0 (pre-v2 data)
    if (action === 'fix-inbox-ack-status') {
      // fromMe=false (incoming) should be ack=3 (delivered), status='delivered'
      const incoming = await db.inboxMessage.updateMany({
        where: { fromMe: false, ack: 0, status: 'pending' },
        data: { ack: 3, status: 'delivered' },
      })
      // fromMe=true (outgoing) should be ack=1 (sent), status='sent'
      const outgoing = await db.inboxMessage.updateMany({
        where: { fromMe: true, ack: 0, status: 'pending' },
        data: { ack: 1, status: 'sent' },
      })
      return NextResponse.json({
        success: true,
        action: 'fix-inbox-ack-status',
        incomingUpdated: incoming.count,
        outgoingUpdated: outgoing.count,
        message: `Atualizados ack/status: ${incoming.count} recebidas (delivered), ${outgoing.count} enviadas (sent).`,
      })
    }

    // Fix: Extract quotedMsgId from old reaction messages that have raw JSON content
    if (action === 'fix-reaction-quoted-msgid') {
      // Find reaction messages with null quotedMsgId but content containing reactionMessage JSON
      const reactionMessages = await db.inboxMessage.findMany({
        where: {
          messageType: 'reaction',
          quotedMsgId: null,
          messageContent: { contains: 'reactionMessage' },
        },
        select: { id: true, messageContent: true },
        take: 500,
      })

      let fixed = 0
      for (const msg of reactionMessages) {
        try {
          // Try to extract the target message ID from the raw JSON
          const match = msg.messageContent.match(/"key"\s*:\s*\{[^}]*"id"\s*:\s*"([^"]+)"/)
          if (match && match[1]) {
            await db.inboxMessage.update({
              where: { id: msg.id },
              data: {
                quotedMsgId: match[1],
                messageContent: 'Reação', // Clean up the raw JSON
              },
            })
            fixed++
          }
        } catch {
          // Skip individual errors
        }
      }

      // Also fix reaction messages with content "Reação: EMOJI" that have null quotedMsgId
      const simpleReactions = await db.inboxMessage.findMany({
        where: {
          messageType: 'reaction',
          quotedMsgId: null,
          messageContent: { startsWith: 'Reação:' },
        },
        select: { id: true },
        take: 500,
      })

      return NextResponse.json({
        success: true,
        action: 'fix-reaction-quoted-msgid',
        rawJsonFixed: fixed,
        simpleReactionsWithoutTarget: simpleReactions.length,
        message: `Corrigidos ${fixed} reactionMsgIds a partir de JSON bruto. ${simpleReactions.length} reações sem target (webhook não forneceu o ID).`,
      })
    }

    // Fix: Convert old 'unknown' messageType messages to proper types
    if (action === 'fix-unknown-message-types') {
      // Messages with content starting with "{" or "[" are likely unparsed messages
      const unknownJson = await db.inboxMessage.findMany({
        where: {
          messageType: 'unknown',
          messageContent: { startsWith: '{' },
        },
        select: { id: true, messageContent: true },
        take: 500,
      })

      let fixedToReaction = 0
      let fixedToDeleted = 0
      let fixedToOther = 0

      for (const msg of unknownJson) {
        try {
          if (msg.messageContent.includes('reactionMessage')) {
            // This is an old reaction message that wasn't parsed correctly
            const emojiMatch = msg.messageContent.match(/"text"\s*:\s*"([^"]+)"/)
            const emoji = emojiMatch ? emojiMatch[1] : ''
            await db.inboxMessage.update({
              where: { id: msg.id },
              data: {
                messageType: 'reaction',
                messageContent: emoji ? `Reação: ${emoji}` : 'Reação',
              },
            })
            fixedToReaction++
          } else if (msg.messageContent.includes('protocolMessage')) {
            await db.inboxMessage.update({
              where: { id: msg.id },
              data: { messageType: 'deleted', messageContent: 'Mensagem apagada' },
            })
            fixedToDeleted++
          } else {
            // Keep as unknown but clean up content
            await db.inboxMessage.update({
              where: { id: msg.id },
              data: { messageContent: 'Mensagem não suportada' },
            })
            fixedToOther++
          }
        } catch {
          // Skip
        }
      }

      return NextResponse.json({
        success: true,
        action: 'fix-unknown-message-types',
        fixedToReaction,
        fixedToDeleted,
        fixedToOther,
        message: `Corrigidos tipos: ${fixedToReaction} reações, ${fixedToDeleted} apagadas, ${fixedToOther} outros.`,
      })
    }

    // Fix: Backfill reactionEmoji on original messages from standalone reaction messages
    if (action === 'backfill-reaction-emoji') {
      // Find all reaction messages that have a quotedMsgId
      const reactionMessages = await db.inboxMessage.findMany({
        where: {
          messageType: 'reaction',
          quotedMsgId: { not: null },
        },
        select: { id: true, quotedMsgId: true, messageContent: true, pushName: true, remoteJid: true },
        take: 1000,
      })

      let updated = 0
      let notFound = 0

      for (const reaction of reactionMessages) {
        try {
          // Find the target message by evolutionMsgId
          const targetMsg = await db.inboxMessage.findFirst({
            where: {
              OR: [
                { evolutionMsgId: reaction.quotedMsgId },
                { id: reaction.quotedMsgId! },
              ],
            },
          })

          if (targetMsg) {
            const emoji = reaction.messageContent?.replace('Reação: ', '').trim() || '👍'
            const fromJid = reaction.remoteJid || ''
            const fromName = reaction.pushName || 'unknown'

            let reactions: Array<{ emoji: string; from: string; fromJid: string }> = []
            try {
              reactions = targetMsg.reactionEmoji ? JSON.parse(targetMsg.reactionEmoji) : []
            } catch { reactions = [] }

            // Check if this reaction already exists
            const exists = reactions.some(r => r.fromJid === fromJid && r.emoji === emoji)
            if (!exists) {
              reactions.push({ emoji, from: fromName, fromJid })
              await db.inboxMessage.update({
                where: { id: targetMsg.id },
                data: { reactionEmoji: JSON.stringify(reactions) },
              })
              updated++
            }
          } else {
            notFound++
          }
        } catch {
          // Skip individual errors
        }
      }

      return NextResponse.json({
        success: true,
        action: 'backfill-reaction-emoji',
        reactionsProcessed: reactionMessages.length,
        targetMessagesUpdated: updated,
        targetsNotFound: notFound,
        message: `Backfill: ${updated} mensagens originais tiveram reactionEmoji atualizado. ${notFound} targets não encontrados.`,
      })
    }

    // Default: Add pausedAt column to Campaign table if it doesn't exist
    await db.$executeRawUnsafe(`
      ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3)
    `)
    return NextResponse.json({ success: true, message: 'Migration complete: pausedAt column added' })
  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Migration failed',
      hint: 'If column already exists, this is safe to ignore'
    }, { status: 500 })
  }
}
