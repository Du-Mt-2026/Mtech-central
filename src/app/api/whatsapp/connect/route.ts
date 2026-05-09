import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createInstance, fetchInstances, connectInstance, setWebhook, findInstanceByName, getInstanceName } from '@/lib/evolution-api'

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

    const instanceName = getInstanceName(chip.id, chip.name)

    // Check if instance already exists
    let existing = await findInstanceByName(instanceName)

    if (!existing) {
      // Create new instance
      const newInstance = await createInstance(instanceName)

      // Set webhook to receive status updates
      const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://mtech-central.vercel.app'}/api/whatsapp/webhook`
      try {
        await setWebhook(newInstance.name, webhookUrl, [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'SEND_MESSAGE',
          'CONNECTION_UPDATE',
        ])
      } catch (webhookErr) {
        console.error('Failed to set webhook:', webhookErr)
      }

      existing = newInstance
    }

    // Connect to get QR Code
    const connectResult = await connectInstance(existing.name)

    // Update chip in database
    await db.chip.update({
      where: { id: chipId },
      data: {
        status: 'connecting',
        qrPairingCode: connectResult.code || null,
      },
    })

    return NextResponse.json({
      instanceName: existing.name,
      qrcode: connectResult.base64 || null,
      code: connectResult.code || null,
      status: existing.connectionStatus,
    })
  } catch (error: any) {
    console.error('WhatsApp connect error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao conectar WhatsApp' },
      { status: 500 }
    )
  }
}
