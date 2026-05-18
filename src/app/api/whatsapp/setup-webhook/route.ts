import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { setWebhook } from '@/lib/evolution-api'

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
        { error: 'Chip não possui instância Evolution API vinculada' },
        { status: 400 }
      )
    }

    const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`

    await setWebhook(chip.evolutionInstance, webhookUrl, [
      'MESSAGES_UPSERT',
      'MESSAGES_UPDATE',
      'SEND_MESSAGE',
      'CONNECTION_UPDATE',
      'INSTANCE_DELETED',
    ])

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
