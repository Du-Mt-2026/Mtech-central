import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getInstanceName, checkWhatsAppNumbers } from '@/lib/evolution-router'
import { normalizePhone } from '@/lib/phone-utils'

// Daily verification limit per chip (safe anti-ban threshold)
const DAILY_VERIFY_LIMIT = 300

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { phones, chipId } = body

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return NextResponse.json(
        { error: 'Lista de telefones é obrigatória' },
        { status: 400 }
      )
    }

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    // Look up the chip's proxy settings and Evolution instance from DB
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    // --- Anti-ban: daily verification limit ---
    // Reset counter if it's a new day
    const now = new Date()
    const lastReset = new Date(chip.lastVerifiedResetAt)
    const isDifferentDay = now.getFullYear() !== lastReset.getFullYear() ||
      now.getMonth() !== lastReset.getMonth() ||
      now.getDate() !== lastReset.getDate()

    let currentVerifiedToday = chip.verifiedToday

    if (isDifferentDay) {
      await db.chip.update({
        where: { id: chipId },
        data: { verifiedToday: 0, lastVerifiedResetAt: now },
      })
      currentVerifiedToday = 0
    }

    // Check if chip has hit daily limit
    if (currentVerifiedToday >= DAILY_VERIFY_LIMIT) {
      return NextResponse.json(
        {
          error: `Chip "${chip.name}" atingiu o limite diário de ${DAILY_VERIFY_LIMIT} verificações. Use outro chip ou aguarde até amanhã.`,
          code: 'DAILY_LIMIT_REACHED',
          dailyLimit: DAILY_VERIFY_LIMIT,
          verifiedToday: currentVerifiedToday,
        },
        { status: 429 }
      )
    }

    // Cap the batch to not exceed daily limit
    const remainingQuota = DAILY_VERIFY_LIMIT - currentVerifiedToday
    const cappedPhones = phones.slice(0, remainingQuota)

    if (cappedPhones.length < phones.length) {
      console.warn(`Chip ${chip.name}: capped verification batch from ${phones.length} to ${cappedPhones.length} (daily limit)`)
    }

    // Determine the Evolution instance name
    const instanceName = chip.evolutionInstance || getInstanceName(chip.id, chip.name)

    // Format phone numbers using centralized normalizePhone (handles DDD 55 correctly)
    const formattedPhones = cappedPhones
      .map((phone: string) => normalizePhone(phone))
      .filter((p: string) => p.length >= 10 && p.length <= 15)

    if (formattedPhones.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum telefone válido encontrado após formatação' },
        { status: 400 }
      )
    }

    // Call Evolution Go's user/check endpoint to verify which numbers exist on WhatsApp
    // In v3: POST /user/check with { number: [...] } and instanceId header
    // Docs: https://docs.evolutionfoundation.com.br/en/evolution-go/check-a-user
    const results = await checkWhatsAppNumbers(instanceName, formattedPhones)

    // Normalize results to the format the frontend expects
    const normalizedResults: Array<{ number: string; exists: boolean; jid?: string; name?: string; error?: string }> = results.map((item: any, idx: number) => ({
      number: item.query || formattedPhones[idx] || '',
      exists: item.exists === true,
      jid: item.jid || '',
      name: '',
      error: !item.exists ? 'not_on_whatsapp' : '',
    }))

    // Update verification count for this chip
    await db.chip.update({
      where: { id: chipId },
      data: {
        verifiedToday: currentVerifiedToday + formattedPhones.length,
      },
    })

    return NextResponse.json({
      results: normalizedResults,
      chipName: chip.name,
      verifiedToday: currentVerifiedToday + formattedPhones.length,
      dailyLimit: DAILY_VERIFY_LIMIT,
      quotaRemaining: DAILY_VERIFY_LIMIT - (currentVerifiedToday + formattedPhones.length),
    })
  } catch (error: any) {
    console.error('Verifier check error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro interno ao verificar números' },
      { status: 500 }
    )
  }
}
