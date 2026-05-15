import { NextResponse } from 'next/server'
import { sendTextMessage, setPresence, formatPhoneNumber, getInstanceName } from '@/lib/evolution-api'
import { db } from '@/lib/db'

export async function POST(request: Request) {
  let chipId: string | undefined
  let contactId: string | undefined

  try {
    const body = await request.json()
    chipId = body.chipId
    contactId = body.contactId
    const { contactPhone, content, delayMs } = body

    if (!chipId || !contactPhone || !content) {
      return NextResponse.json(
        { error: 'chipId, contactPhone e content são obrigatórios' },
        { status: 400 }
      )
    }

    // Get chip and check status
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    if (chip.status !== 'connected') {
      return NextResponse.json({ error: 'Chip não está conectado' }, { status: 400 })
    }

    // Check daily limit
    if (chip.sentToday >= chip.dailyLimit) {
      return NextResponse.json({ error: 'Limite diário atingido' }, { status: 400 })
    }

    const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)
    const formattedPhone = formatPhoneNumber(contactPhone)

    // Simulate typing before sending (anti-ban)
    try {
      const antiBan = await db.antiBanSettings.findFirst()
      const typingDelay = antiBan
        ? Math.floor(Math.random() * (antiBan.typingMaxDelay - antiBan.typingMinDelay) + antiBan.typingMinDelay)
        : 1500

      await setPresence(instanceName, formattedPhone, 'composing', typingDelay)
    } catch (typingErr) {
      console.error('Typing simulation failed:', typingErr)
      // Continue even if typing fails
    }

    // Add small delay after typing before sending
    const sendDelay = delayMs || Math.floor(Math.random() * 1000) + 500
    await new Promise(resolve => setTimeout(resolve, sendDelay))

    // Send the message
    const result = await sendTextMessage(instanceName, formattedPhone, content)

    // Update message status in database if contactId is provided
    if (contactId) {
      await db.message.updateMany({
        where: {
          chipId,
          contactId,
          status: 'sending',
        },
        data: {
          status: 'sent',
          sentAt: new Date(),
          evolutionMessageId: result.key?.id || null,
        },
      })
    }

    // Update chip daily counter
    await db.chip.update({
      where: { id: chipId },
      data: { sentToday: { increment: 1 } },
    })

    return NextResponse.json({
      success: true,
      messageId: result.key?.id,
      remoteJid: result.key?.remoteJid,
    })
  } catch (error: any) {
    console.error('Send message error:', error)

    // Update message status to failed
    if (chipId && contactId) {
      try {
        await db.message.updateMany({
          where: { chipId, contactId, status: 'sending' },
          data: { status: 'failed', error: error.message || 'Erro desconhecido' },
        })
      } catch (dbErr) {
        console.error('Failed to update message status:', dbErr)
      }
    }

    return NextResponse.json(
      { error: error.message || 'Erro ao enviar mensagem' },
      { status: 500 }
    )
  }
}
