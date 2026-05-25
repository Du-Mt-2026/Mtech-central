import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { setWebhook } from '@/lib/evolution-router'

// POST /api/whatsapp/setup-webhook — Configure webhook for an existing chip's Evolution instance
export async function POST(request: Request) {
  try {
    const { chipId } = await request.json()

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    if (!chip.evolutionInstance) {
      return NextResponse.json(
        { error: 'Chip não possui instância Evolution vinculada' },
        { status: 400 }
      )
    }

    // Prefer stable NEXT_PUBLIC_APP_URL over deployment-specific VERCEL_URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
    const webhookUrl = `${appUrl}/api/whatsapp/webhook`

    await setWebhook(chip.evolutionInstance, webhookUrl)

    return NextResponse.json({
      success: true,
      instanceName: chip.evolutionInstance,
      webhookUrl,
    })
  } catch (error: any) {
    console.error('Setup webhook error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao configurar webhook' },
      { status: 500 }
    )
  }
}
