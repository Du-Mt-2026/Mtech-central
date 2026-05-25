import { NextResponse } from 'next/server'
import { sendTextMessage, setPresence, formatPhoneNumber } from '@/lib/evolution-router'
import { formatPhoneNumber as v3FormatPhone, getInstanceName as v3GetInstanceName } from '@/lib/evolution-api'
import { db } from '@/lib/db'

function calculateTypingDuration(text: string): number {
  const TYPING_SPEED_MIN = 6
  const TYPING_SPEED_MAX = 14
  const TYPING_MIN_MS = 3000
  const TYPING_MAX_MS = 25000
  const TYPING_PAUSE_CHANCE = 0.3

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
      return NextResponse.json({ error: 'chipId, contactPhone e content são obrigatórios' }, { status: 400 })
    }

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    if (chip.status !== 'connected') return NextResponse.json({ error: 'Chip não está conectado' }, { status: 400 })
    if (chip.sentToday >= chip.dailyLimit) return NextResponse.json({ error: 'Limite diário atingido' }, { status: 400 })

    const instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)
    const formattedPhone = v3FormatPhone(contactPhone)
    const typingDurationMs = calculateTypingDuration(content)

    try {
      await setPresence(instanceName, 'v3', formattedPhone, 'composing', typingDurationMs)
    } catch (typingErr) {
      console.error('Typing simulation failed:', typingErr)
    }

    await new Promise(resolve => setTimeout(resolve, typingDurationMs))
    const sendDelay = delayMs || Math.floor(Math.random() * 800) + 200
    await new Promise(resolve => setTimeout(resolve, sendDelay))

    const result = await sendTextMessage(instanceName, 'v3', formattedPhone, content)

    if (contactId) {
      await db.message.updateMany({
        where: { chipId, contactId, status: 'sending' },
        data: { status: 'sent', sentAt: new Date(), evolutionMessageId: result.key?.id || null },
      })
    }

    await db.chip.update({ where: { id: chipId }, data: { sentToday: { increment: 1 } } })

    return NextResponse.json({ success: true, messageId: result.key?.id, remoteJid: result.key?.remoteJid, typingDurationMs })
  } catch (error: any) {
    console.error('Send message error:', error)
    if (chipId && contactId) {
      try {
        await db.message.updateMany({
          where: { chipId, contactId, status: 'sending' },
          data: { status: 'failed', error: error.message || 'Erro desconhecido' },
        })
      } catch (dbErr) { console.error('Failed to update message status:', dbErr) }
    }
    return NextResponse.json({ error: error.message || 'Erro ao enviar mensagem' }, { status: 500 })
  }
}
