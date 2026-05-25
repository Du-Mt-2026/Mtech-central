import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTextMessage, sendMediaMessage } from '@/lib/evolution-api'

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
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { chipId, remoteJid, content, mediaUrl, mediatype } = body

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

    // Send message via Evolution API
    if (mediaUrl && mediatype) {
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
        evolutionMsgId: evolutionResponse?.key?.id || null,
        isRead: true,
        isGroup: remoteJid.includes('@g.us'),
        isCampaign: false,  // Manual reply from inbox — not a campaign blast
      },
    })

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
