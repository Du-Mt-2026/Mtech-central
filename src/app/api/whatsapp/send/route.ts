import { NextResponse } from 'next/server'
import { sendTextMessage, setPresence, formatPhoneNumber, getInstanceName } from '@/lib/evolution-api'
import { db } from '@/lib/db'

/**
 * Calculate realistic typing duration based on message length.
 * Same logic as sending-engine.ts — human-like typing speed.
 */
function calculateTypingDuration(text: string): number {
  const TYPING_SPEED_MIN = 6    // chars/second (slow typer on mobile)
  const TYPING_SPEED_MAX = 14   // chars/second (fast typer)
  const TYPING_MIN_MS = 3000    // minimum 3 seconds even for short messages
  const TYPING_MAX_MS = 25000   // cap at 25 seconds
  const TYPING_PAUSE_CHANCE = 0.3  // 30% chance of a "thinking pause"

  const typingSpeed = Math.random() * (TYPING_SPEED_MAX - TYPING_SPEED_MIN) + TYPING_SPEED_MIN
  let durationMs = (text.length / typingSpeed) * 1000

  durationMs = Math.max(TYPING_MIN_MS, Math.min(TYPING_MAX_MS, durationMs))

  if (Math.random() < TYPING_PAUSE_CHANCE) {
    durationMs += Math.floor(Math.random() * 3000) + 1000
  }

  return Math.round(durationMs)
}

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

    // REALISTIC TYPING SIMULATION
    // Calculate typing duration proportional to message length (not fixed 500ms-2000ms)
    const typingDurationMs = calculateTypingDuration(content)

    try {
      // Send "composing" presence with the calculated delay
      await setPresence(instanceName, formattedPhone, 'composing', typingDurationMs)
    } catch (typingErr) {
      console.error('Typing simulation failed:', typingErr)
      // Continue even if typing fails
    }

    // WAIT the full typing duration — the contact sees "digitando..." realistically
    await new Promise(resolve => setTimeout(resolve, typingDurationMs))

    // Small additional delay before sending (simulates pressing "send" button)
    const sendDelay = delayMs || Math.floor(Math.random() * 800) + 200
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
      typingDurationMs,
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
