import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTextMessage, sendMediaMessage, sendQuotedReply, markChatAsRead } from '@/lib/evolution-api'

/**
 * POST /api/inbox/reply
 * Send a reply message from the inbox
 *
 * Body:
 * - chipId: the chip ID to send from
 * - remoteJid: the contact's JID to send to
 * - content: text content
 * - mediaUrl: optional media URL
 * - mediatype: optional media type (image, video, document, audio)
 * - quotedMsgId: optional evolutionMsgId of the message being replied to (for quoted reply)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { chipId, remoteJid, content, mediaUrl, mediatype, quotedMsgId } = body

    if (!chipId || !remoteJid) {
      return NextResponse.json(
        { error: 'chipId e remoteJid são obrigatórios' },
        { status: 400 }
      )
    }

    if (!content && !mediaUrl) {
      return NextResponse.json(
        { error: 'Conteúdo ou mídia é obrigatório' },
        { status: 400 }
      )
    }

    // Find the chip
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    if (chip.status !== 'connected') {
      return NextResponse.json({ error: 'Chip não está conectado' }, { status: 400 })
    }

    if (!chip.evolutionInstance) {
      return NextResponse.json({ error: 'Chip sem instância Evolution' }, { status: 400 })
    }

    // Extract phone number from remoteJid
    const phoneNumber = remoteJid.split('@')[0]

    let evolutionResponse
    let quotedContent: string | null = null
    let quotedType: string | null = null
    let quotedPushName: string | null = null

    // If replying to a specific message, fetch its content for the quoted preview
    if (quotedMsgId) {
      const quotedMsg = await db.inboxMessage.findFirst({
        where: { evolutionMsgId: quotedMsgId },
        select: { messageContent: true, messageType: true, pushName: true },
      })
      if (quotedMsg) {
        quotedContent = quotedMsg.messageContent?.substring(0, 200) || null
        quotedType = quotedMsg.messageType
        quotedPushName = quotedMsg.pushName
      }
    }

    // Send message via Evolution API
    if (quotedMsgId && !mediaUrl) {
      // v2.1: Quoted reply (contextInfo) — shows "you replied to: ..." in WhatsApp
      evolutionResponse = await sendQuotedReply(
        chip.evolutionInstance,
        phoneNumber,
        content,
        quotedMsgId
      )
    } else if (mediaUrl && mediatype) {
      evolutionResponse = await sendMediaMessage(
        chip.evolutionInstance,
        phoneNumber,
        mediaUrl,
        mediatype as 'image' | 'document' | 'video' | 'audio',
        { caption: content || '' }
      )
    } else {
      evolutionResponse = await sendTextMessage(
        chip.evolutionInstance,
        phoneNumber,
        content
      )
    }

    // Save the sent message to InboxMessage
    // CRITICAL: Set ack=1, status='sent' immediately so the UI shows ✓ (not clock)
    // The webhook will upgrade this to delivered/read when the receipt arrives.
    const evolutionMsgId = evolutionResponse?.key?.id || null
    const savedMessage = await db.inboxMessage.create({
      data: {
        instanceName: chip.evolutionInstance,
        chipId: chip.id,
        remoteJid,
        remotePhone: phoneNumber,
        fromMe: true,
        messageContent: content || '',
        messageType: mediaUrl ? (mediatype || 'text') : 'text',
        mediaUrl: mediaUrl || null,
        pushName: chip.profileName || chip.name,
        contactName: null,
        evolutionMsgId,
        isRead: true,
        isGroup: remoteJid.includes('@g.us'),
        isCampaign: false,  // Manual reply from inbox — not a campaign blast
        ack: 1,             // SENT — message was dispatched to Evolution API
        status: 'sent',     // Show ✓ immediately (webhook upgrades later)
        // v2.1: Quoted reply fields (contextInfo)
        quotedMsgId: quotedMsgId || null,
        quotedContent,
        quotedType,
        quotedPushName,
      },
    })

    // Mark the chat as read on the WhatsApp side (so the contact sees blue ✓✓)
    try {
      await markChatAsRead(chip.evolutionInstance, remoteJid)
    } catch {
      // Non-critical — best effort
    }

    return NextResponse.json({
      success: true,
      message: savedMessage,
    })
  } catch (error: any) {
    console.error('Inbox reply error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao enviar mensagem' },
      { status: 500 }
    )
  }
}
