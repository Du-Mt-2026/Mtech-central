import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTextMessage, sendMediaMessage, sendQuotedReply, markChatAsRead } from '@/lib/evolution-api'
import { writeFile } from 'fs/promises'
import path from 'path'

/**
 * POST /api/inbox/reply
 * Send a reply message from the inbox
 *
 * Supports two content types:
 * 1. application/json — for text-only or text + mediaUrl replies
 * 2. multipart/form-data — for file uploads (proper media sending)
 *
 * JSON Body:
 * - chipId, remoteJid, content, mediaUrl, mediatype, quotedMsgId
 *
 * FormData Body:
 * - chipId, remoteJid, content, mediatype, quotedMsgId, file (File object)
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let chipId: string, remoteJid: string, content: string, mediaUrl: string | undefined, mediatype: string | undefined, quotedMsgId: string | undefined

    if (contentType.includes('multipart/form-data')) {
      // Handle file upload via FormData
      const formData = await request.formData()
      chipId = formData.get('chipId') as string
      remoteJid = formData.get('remoteJid') as string
      content = (formData.get('content') as string) || ''
      mediatype = (formData.get('mediatype') as string) || undefined
      quotedMsgId = (formData.get('quotedMsgId') as string) || undefined

      const file = formData.get('file') as File | null
      if (file) {
        // Save file to /upload directory and create a data URL for Evolution API
        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)

        // Generate unique filename
        const ext = file.name.split('.').pop() || 'bin'
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`
        const filePath = path.join(process.cwd(), 'upload', uniqueName)

        await writeFile(filePath, buffer)

        // For Evolution API, use base64 data URI (works reliably with sendMediaMessage)
        const base64 = buffer.toString('base64')
        const mimeType = file.type || 'application/octet-stream'
        mediaUrl = `data:${mimeType};base64,${base64}`

        if (!mediatype) {
          mediatype = file.type.startsWith('image') ? 'image'
            : file.type.startsWith('video') ? 'video'
            : file.type.startsWith('audio') ? 'audio'
            : 'document'
        }
      }
    } else {
      // Handle JSON body (backward compatible)
      const body = await request.json()
      chipId = body.chipId
      remoteJid = body.remoteJid
      content = body.content
      mediaUrl = body.mediaUrl
      mediatype = body.mediatype
      quotedMsgId = body.quotedMsgId
    }

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
      // Quoted reply (contextInfo) — shows "you replied to: ..." in WhatsApp
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
        // Quoted reply fields (contextInfo)
        quotedMsgId: quotedMsgId || null,
        quotedContent,
        quotedType,
        quotedPushName,
      },
    })

    // Mark the chat as read on the WhatsApp side
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
