import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createInstance, fetchInstances, connectInstance, setWebhook, setProxy, findInstanceByName, getInstanceName } from '@/lib/evolution-api'

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
      existing = newInstance
    }

    // Always ensure webhook is configured (for both new and existing instances)
    const webhookUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/whatsapp/webhook`
    try {
      await setWebhook(existing.name, webhookUrl, [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'SEND_MESSAGE',
        'CONNECTION_UPDATE',
      ])
    } catch (webhookErr) {
      console.error('Failed to set webhook:', webhookErr)
    }

    // Apply SOCKS5 proxy if configured on the chip
    if (chip.proxyMode === 'socks5' && chip.socks5Host && chip.socks5Port) {
      try {
        await setProxy(existing.name, {
          enabled: true,
          host: chip.socks5Host,
          port: String(chip.socks5Port),
          username: chip.socks5User || '',
          password: chip.socks5Pass || '',
        })
      } catch (proxyErr) {
        console.error('Failed to set proxy on instance:', proxyErr)
      }
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
